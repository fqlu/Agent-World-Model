import YAML from "yaml";
import { Connector } from "./connector";
import { parseWorkspaceYaml, sectionLines } from "./workspace";
import { journalAgentActivity } from "./ops";

export type EntityKind = "person" | "system" | "concept";
export type EntitySource = "derived" | "asserted";

export type Relation = { predicate: string; target: string; note?: string };

export type Entity = {
  slug: string;
  name: string;
  kind: EntityKind;
  aliases: string[];
  source: EntitySource;
  confirmed?: string;
  attributes: Record<string, string>;
  relations: Relation[];
  notes: string;
};

export const DEFAULT_ENTITIES_MOUNT = "_Entities";
const KINDS: EntityKind[] = ["person", "system", "concept"];

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "entity"
  );
}

export function parseEntityFile(md: string): Entity | null {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  let data: unknown;
  try {
    data = YAML.parse(m[1]);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.name !== "string" || typeof d.kind !== "string") return null;
  if (!KINDS.includes(d.kind as EntityKind)) return null;
  const attrs: Record<string, string> = {};
  if (d.attributes && typeof d.attributes === "object") {
    for (const [k, v] of Object.entries(d.attributes as Record<string, unknown>)) {
      if (v != null) attrs[k] = String(v);
    }
  }
  const relations: Relation[] = [];
  if (Array.isArray(d.relations)) {
    for (const r of d.relations) {
      if (r && typeof r === "object" && typeof (r as Relation).predicate === "string" && typeof (r as Relation).target === "string") {
        const rr = r as { predicate: string; target: string; note?: unknown };
        relations.push({
          predicate: rr.predicate,
          target: rr.target,
          note: typeof rr.note === "string" ? rr.note : undefined,
        });
      }
    }
  }
  return {
    slug: slugify(d.name),
    name: d.name,
    kind: d.kind as EntityKind,
    aliases: Array.isArray(d.aliases) ? d.aliases.map(String) : [],
    source: d.source === "derived" ? "derived" : "asserted",
    confirmed: typeof d.confirmed === "string" ? d.confirmed : undefined,
    attributes: attrs,
    relations,
    notes: m[2].trim(),
  };
}

export function serializeEntity(e: Entity): string {
  const front: Record<string, unknown> = {
    name: e.name,
    kind: e.kind,
    aliases: e.aliases,
    source: e.source,
  };
  if (e.confirmed) front.confirmed = e.confirmed;
  front.attributes = e.attributes;
  if (e.relations.length) {
    front.relations = e.relations.map((r) =>
      r.note ? { predicate: r.predicate, target: r.target, note: r.note } : { predicate: r.predicate, target: r.target },
    );
  }
  return `---\n${YAML.stringify(front).trimEnd()}\n---\n\n${e.notes.trim()}\n`;
}

async function readDecl(c: Connector) {
  const raw = await c.read("_Workspace.yaml");
  return raw ? parseWorkspaceYaml(raw) : null;
}

export async function entitiesMount(c: Connector): Promise<string | null> {
  const decl = await readDecl(c);
  // explicit mount, or default if the workspace simply hasn't declared one yet
  return decl?.mounts?.entities ?? DEFAULT_ENTITIES_MOUNT;
}

export async function listEntities(
  c: Connector,
): Promise<{ mount: string; entities: Entity[]; problems: string[] }> {
  const mount = (await entitiesMount(c)) ?? DEFAULT_ENTITIES_MOUNT;
  const problems: string[] = [];
  const entities: Entity[] = [];
  if (!(await c.exists(mount))) return { mount, entities, problems };
  for (const e of await c.list(mount)) {
    if (e.kind !== "file" || !e.name.endsWith(".md")) continue;
    const md = await c.read(e.path);
    const ent = md !== null ? parseEntityFile(md) : null;
    if (!ent) {
      problems.push(`${e.path}: not a valid entity file`);
      continue;
    }
    entities.push(ent);
  }
  entities.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return { mount, entities, problems };
}

// Persist the full entity set: write/overwrite files, archive removed ones,
// register the mount, journal. Never deletes.
export async function saveEntities(
  c: Connector,
  entities: Entity[],
): Promise<{ written: string[]; archived: string[] }> {
  const mount = (await entitiesMount(c)) ?? DEFAULT_ENTITIES_MOUNT;
  await c.mkdir(mount);

  // register mount if missing
  const raw = await c.read("_Workspace.yaml");
  if (raw) {
    const doc = YAML.parse(raw) as Record<string, unknown> | null;
    if (doc && typeof doc === "object") {
      const m = (doc.mounts ?? {}) as Record<string, unknown>;
      if (!m.entities) {
        m.entities = mount;
        doc.mounts = m;
        await c.write("_Workspace.yaml", YAML.stringify(doc), { overwrite: true });
      }
    }
  }

  const written: string[] = [];
  const keep = new Set<string>();
  for (const e of entities) {
    const slug = e.slug || slugify(e.name);
    keep.add(`${slug}.md`);
    await c.write(`${mount}/${slug}.md`, serializeEntity({ ...e, slug }), { overwrite: true });
    written.push(`${mount}/${slug}.md`);
  }

  const decl = await readDecl(c);
  const archiveMount = decl?.mounts?.archive ?? "Archive";
  const archived: string[] = [];
  for (const e of await c.list(mount)) {
    if (e.kind !== "file" || !e.name.endsWith(".md") || keep.has(e.name)) continue;
    try {
      await c.move(e.path, `${archiveMount}/${mount}/${e.name}`);
      archived.push(`${archiveMount}/${mount}/${e.name}`);
    } catch {
      /* destination exists — leave in place */
    }
  }

  try {
    await journalAgentActivity(
      c,
      decl?.mounts?.journal ?? "Journal",
      `entities saved — ${entities.length} entit${entities.length === 1 ? "y" : "ies"}${archived.length ? `, ${archived.length} archived` : ""}`,
    );
  } catch {
    /* journal best-effort */
  }
  return { written, archived };
}

// ---- Derived-first extraction from existing overviews ----

export type Candidate = {
  name: string;
  kind: EntityKind;
  attributes: Record<string, string>;
  foundIn: string[]; // scope paths where this was seen
  existing: boolean; // already an asserted entity?
};

// Parse a "Key people" line: "- Sally Wilson — Senior, decision-maker (sally@x.com)"
// also tolerates "Name, Role — email" and bold names.
function parsePersonLine(line: string): { name: string; role?: string; email?: string } | null {
  let s = line.trim().replace(/^[-*]\s*/, "").replace(/\*\*/g, "");
  if (!s || s.startsWith("[") || s.startsWith("*") || s.startsWith("#")) return null;
  if (/^(client side|incubeta side|owner|agency partners?|team)\b/i.test(s)) return null;
  let email: string | undefined;
  const em = s.match(/\(?([\w.+-]+@[\w.-]+\.\w+)\)?/);
  if (em) {
    email = em[1];
    s = s.replace(em[0], "").trim();
  }
  // split name from role on — , – or " - "
  const m = s.match(/^([^—–\-(]+?)\s*[—–]\s*(.*)$/) ?? s.match(/^([^,(]+?),\s*(.*)$/);
  let name: string, role: string | undefined;
  if (m) {
    name = m[1].trim();
    role = m[2].replace(/[()]/g, "").trim() || undefined;
  } else {
    name = s.replace(/[()]/g, "").trim();
  }
  // a plausible person name: 2–4 capitalised words, not a sentence
  if (!/^[A-Z][A-Za-z.'-]+(?:\s+[A-Z(][A-Za-z.'()-]+){0,3}$/.test(name)) return null;
  if (name.split(/\s+/).length > 4) return null;
  return { name, role, email };
}

// Systems: GTM-XXXX, AW-XXXX, GA/G- ids, and `code-formatted` infra tokens.
function extractSystems(md: string): { name: string; type: string }[] {
  const out: { name: string; type: string }[] = [];
  const seen = new Set<string>();
  const push = (name: string, type: string) => {
    if (!seen.has(name)) {
      seen.add(name);
      out.push({ name, type });
    }
  };
  for (const m of md.matchAll(/\bGTM-[A-Z0-9]+\b/g)) push(m[0], "GTM container");
  for (const m of md.matchAll(/\bAW-\d+\b/g)) push(m[0], "Google Ads conversion");
  for (const m of md.matchAll(/\bG-[A-Z0-9]+\b/g)) push(m[0], "GA4 measurement ID");
  return out;
}

export async function extractCandidates(c: Connector): Promise<Candidate[]> {
  const decl = await readDecl(c);
  const areas = decl?.mounts?.areas ?? [];
  const { entities } = await listEntities(c);
  const assertedNames = new Set(entities.map((e) => e.name.toLowerCase()));

  const byKey = new Map<string, Candidate>();
  const add = (name: string, kind: EntityKind, attrs: Record<string, string>, scope: string) => {
    const key = `${kind}:${name.toLowerCase()}`;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.foundIn.includes(scope)) existing.foundIn.push(scope);
      Object.assign(existing.attributes, attrs);
    } else {
      byKey.set(key, {
        name,
        kind,
        attributes: attrs,
        foundIn: [scope],
        existing: assertedNames.has(name.toLowerCase()),
      });
    }
  };

  async function walk(path: string, depth: number) {
    if (depth > 4) return;
    for (const e of await c.list(path)) {
      if (e.kind !== "folder") continue;
      if (e.name.startsWith("_") || e.name.endsWith(" | WIP Notes")) continue;
      const children = await c.list(e.path);
      const ov = children.find((x) => x.name === "_Overview.md");
      if (ov) {
        const md = await c.read(ov.path);
        if (md) {
          for (const line of sectionLines(md, "Key people")) {
            const p = parsePersonLine(line);
            if (p) {
              const attrs: Record<string, string> = {};
              if (p.role) attrs.role = p.role;
              if (p.email) attrs.email = p.email;
              add(p.name, "person", attrs, e.path);
            }
          }
          for (const sys of extractSystems(md)) {
            add(sys.name, "system", { type: sys.type }, e.path);
          }
        }
      }
      await walk(e.path, depth + 1);
    }
  }

  for (const area of areas) {
    if (await c.exists(area)) await walk(area, 1);
  }

  return [...byKey.values()].sort(
    (a, b) => b.foundIn.length - a.foundIn.length || a.name.localeCompare(b.name),
  );
}
