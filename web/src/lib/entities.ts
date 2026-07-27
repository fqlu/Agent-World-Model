import YAML from "yaml";
import { Connector } from "./connector";
import { parseWorkspaceYaml, sectionLines } from "./workspace";
import { journalAgentActivity } from "./ops";

export type EntityKind = "person" | "system" | "concept";
export type EntitySource = "derived" | "asserted";

export type Relation = { predicate: string; target: string; note?: string };

// ---- Trust signals (OKF v0.2 alignment, SPEC §12) ----
// Actor convention: "human:<id>" | "<producer>/<version>" | "process:<id>"
export type Generated = { by: string; at: string };
export type VerifiedEvent = { by: string; at: string; note?: string };
export type SourceRef = { id?: string; resource: string; title?: string };
export type EntityStatus = "draft" | "stable" | "deprecated";
export const ENTITY_STATUSES: EntityStatus[] = ["draft", "stable", "deprecated"];

export type Entity = {
  slug: string;
  name: string;
  kind: EntityKind;
  aliases: string[];
  source: EntitySource;
  confirmed?: string;
  // Trust (all optional; status defaults to "stable" per OKF)
  generated?: Generated;
  verified: VerifiedEvent[];
  sources: SourceRef[];
  status?: EntityStatus;
  stale_after?: string; // YYYY-MM-DD
  attributes: Record<string, string>;
  relations: Relation[];
  notes: string;
};

// Trust tier derived from the signals (OKF v0.2): human-reviewed beats
// machine-confirmed beats unverified.
export function trustTier(e: Entity): "human-reviewed" | "machine-confirmed" | "unverified" {
  if (e.verified.some((v) => v.by.startsWith("human:"))) return "human-reviewed";
  if (e.verified.length) return "machine-confirmed";
  return "unverified";
}

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
  if (typeof d.name !== "string") return null;
  // `kind` is our field; accept OKF's `type` as a fallback so OKF-authored
  // concepts import cleanly.
  const kindRaw = typeof d.kind === "string" ? d.kind : typeof d.type === "string" ? d.type : "";
  if (!KINDS.includes(kindRaw as EntityKind)) return null;
  d.kind = kindRaw;
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
  // Trust fields — tolerant parsing; malformed entries are dropped, not fatal
  const gen = d.generated as Record<string, unknown> | undefined;
  const generated =
    gen && typeof gen === "object" && typeof gen.by === "string" && typeof gen.at === "string"
      ? { by: gen.by, at: gen.at }
      : undefined;
  const verified: VerifiedEvent[] = [];
  if (Array.isArray(d.verified)) {
    for (const v of d.verified) {
      if (v && typeof v === "object" && typeof (v as VerifiedEvent).by === "string" && typeof (v as VerifiedEvent).at === "string") {
        const vv = v as { by: string; at: string; note?: unknown };
        verified.push({ by: vv.by, at: vv.at, note: typeof vv.note === "string" ? vv.note : undefined });
      }
    }
  }
  const sources: SourceRef[] = [];
  if (Array.isArray(d.sources)) {
    for (const s of d.sources) {
      if (s && typeof s === "object" && typeof (s as SourceRef).resource === "string") {
        const ss = s as { id?: unknown; resource: string; title?: unknown };
        sources.push({
          id: typeof ss.id === "string" ? ss.id : undefined,
          resource: ss.resource,
          title: typeof ss.title === "string" ? ss.title : undefined,
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
    generated,
    verified,
    sources,
    status: ENTITY_STATUSES.includes(d.status as EntityStatus) ? (d.status as EntityStatus) : undefined,
    stale_after: typeof d.stale_after === "string" ? d.stale_after : undefined,
    attributes: attrs,
    relations,
    notes: m[2].trim(),
  };
}

export function serializeEntity(e: Entity): string {
  const front: Record<string, unknown> = {
    name: e.name,
    type: e.kind, // OKF-required field (mirrors kind); makes the file a valid OKF concept
    kind: e.kind,
    aliases: e.aliases,
    source: e.source,
  };
  if (e.confirmed) front.confirmed = e.confirmed;
  // Trust signals (OKF v0.2 names, emitted only when present)
  if (e.generated) front.generated = e.generated;
  if (e.verified.length) {
    front.verified = e.verified.map((v) => (v.note ? v : { by: v.by, at: v.at }));
  }
  if (e.sources.length) {
    front.sources = e.sources.map((s) => {
      const out: Record<string, string> = { resource: s.resource };
      if (s.id) out.id = s.id;
      if (s.title) out.title = s.title;
      return out;
    });
  }
  if (e.status && e.status !== "stable") front.status = e.status; // stable is the OKF default
  if (e.stale_after) front.stale_after = e.stale_after;
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

  // ---- Trust stamping (OKF v0.2, SPEC §12) ----
  // The save ritual is the trust event: new files get a `generated` stamp;
  // a derived→asserted transition (the human Confirm) appends a
  // `verified: human:<owner>` event. Deterministic — never fabricates who
  // verified: only the workspace owner's explicit confirm produces one.
  const today = new Date().toISOString().slice(0, 10);
  const preDecl = await readDecl(c);
  const ownerId = preDecl?.owner?.email ? `human:${preDecl.owner.email}` : "human:owner";
  const producer = `${process.env.HUB_APP_NAME?.toLowerCase().replace(/\s+/g, "-") ?? "agent-world-model"}/api`;
  const { entities: existing } = await listEntities(c);
  const existingBySlug = new Map(existing.map((e) => [e.slug, e]));
  for (const e of entities) {
    const prev = existingBySlug.get(e.slug || slugify(e.name));
    if (!e.generated) {
      // preserve the prior stamp on updates; stamp fresh only for new files
      e.generated = prev?.generated ?? { by: producer, at: today };
    }
    const confirmedNow =
      e.source === "asserted" && (!prev || prev.source === "derived");
    const alreadyStamped = e.verified.some((v) => v.by === ownerId && v.at === today);
    if (confirmedNow && !alreadyStamped && prev) {
      e.verified = [...e.verified, { by: ownerId, at: today, note: "confirmed derived → asserted" }];
    }
  }

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
