import { Connector } from "./connector";
import { parseFrontmatter } from "./workspace";
import { readDecl } from "./config";
import { listEntities, Entity } from "./entities";
import { parseGroupFile, DEFAULT_CONTEXT_DIR } from "./context";

// The world-model projection (SPEC §6.8): a structured, queryable snapshot of
// every node (entity or scope) and every edge (typed relationship or
// context-group membership), compiled from the canonical markdown.

export type ModelNode = {
  id: string; // "entity:<slug>" or "scope:<path>"
  kind: "person" | "organization" | "system" | "concept" | "scope";
  label: string;
  attributes?: Record<string, string>;
  source?: string;
};

export type ModelEdge = {
  from: string;
  to: string;
  predicate: string;
  as?: string;
  since?: string;
  until?: string;
  note?: string;
};

export type WorldModel = {
  spec_version?: string;
  profile?: string;
  generated: string;
  stats: { nodes: number; edges: number; entities: number; scopes: number };
  nodes: ModelNode[];
  edges: ModelEdge[];
};

export type ScopeInfo = { path: string; name: string; scopeType?: string; facets: string[] };

// Effective facets (SPEC §3.1): a scope's own plus every ancestor scope's.
export function effectiveFacets(scopes: ScopeInfo[]): Map<string, string[]> {
  const own = new Map(scopes.map((s) => [s.path, s.facets]));
  const out = new Map<string, string[]>();
  for (const s of scopes) {
    const set = new Set<string>();
    const parts = s.path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      for (const f of own.get(parts.slice(0, i).join("/")) ?? []) set.add(f);
    }
    out.set(s.path, [...set]);
  }
  return out;
}

// Promoted scopes = folders containing _Overview.md (entities + promoted).
export async function promotedScopes(
  c: Connector,
): Promise<ScopeInfo[]> {
  const decl = await readDecl(c);
  const areas = decl?.mounts?.areas ?? [];
  const out: ScopeInfo[] = [];
  async function walk(path: string, depth: number) {
    if (depth > 4) return;
    for (const e of await c.list(path)) {
      if (e.kind !== "folder" || e.name.startsWith("_") || e.name.endsWith(" | WIP Notes")) continue;
      const children = await c.list(e.path);
      const ov = children.find((x) => x.name === "_Overview.md");
      if (ov) {
        const md = await c.read(ov.path);
        const fm = md !== null ? parseFrontmatter(md).data : {};
        const st = fm.scope_type as string | undefined;
        const facets = Array.isArray(fm.facets) ? fm.facets.map(String).map((x) => x.trim()).filter(Boolean) : [];
        out.push({ path: e.path, name: e.name, scopeType: st, facets });
      }
      await walk(e.path, depth + 1);
    }
  }
  for (const area of areas) if (await c.exists(area)) await walk(area, 1);
  return out;
}

export async function buildModel(c: Connector): Promise<WorldModel | null> {
  const decl = await readDecl(c);
  if (!decl?.mounts?.areas?.length) return null;

  const nodes: ModelNode[] = [];
  const edges: ModelEdge[] = [];
  const nodeIds = new Set<string>();
  const addNode = (n: ModelNode) => {
    if (!nodeIds.has(n.id)) {
      nodeIds.add(n.id);
      nodes.push(n);
    }
  };

  // Scope nodes
  const scopes = await promotedScopes(c);
  for (const s of scopes)
    addNode({
      id: `scope:${s.path}`,
      kind: "scope",
      label: s.name,
      attributes: s.scopeType ? { scope_type: s.scopeType } : undefined,
    });

  // Entity nodes
  let entities: Entity[] = [];
  try {
    entities = (await listEntities(c)).entities;
  } catch {
    /* entities optional */
  }
  const entityBySlug = new Map<string, Entity>();
  for (const e of entities) {
    entityBySlug.set(e.slug, e);
    addNode({
      id: `entity:${e.slug}`,
      kind: e.kind,
      label: e.name,
      attributes: Object.keys(e.attributes).length ? e.attributes : undefined,
      source: e.source,
    });
  }

  // Typed relationship edges (resolve target → entity or scope)
  const scopePaths = new Set(scopes.map((s) => s.path));
  for (const e of entities) {
    for (const r of e.relations) {
      let toId: string | null = null;
      if (entityBySlug.has(r.target)) toId = `entity:${r.target}`;
      else if (scopePaths.has(r.target)) toId = `scope:${r.target}`;
      if (!toId) {
        // dangling target — surface as a placeholder node so the edge shows
        toId = `unresolved:${r.target}`;
        addNode({ id: toId, kind: "scope", label: `${r.target} (unresolved)` });
      }
      edges.push({
        from: `entity:${e.slug}`,
        to: toId,
        predicate: r.predicate,
        ...(r.as ? { as: r.as } : {}),
        ...(r.since ? { since: r.since } : {}),
        ...(r.until ? { until: r.until } : {}),
        ...(r.note ? { note: r.note } : {}),
      });
    }
  }

  // Facet membership edges (v0.16, SPEC §3.1): scope —facet→ facet entity.
  // Direct declarations only; inheritance is computed by readers.
  for (const s of scopes) {
    for (const f of s.facets) {
      const toId = entityBySlug.has(f) ? `entity:${f}` : `unresolved:${f}`;
      if (!entityBySlug.has(f)) addNode({ id: toId, kind: "concept", label: `${f} (unresolved facet)` });
      edges.push({ from: `scope:${s.path}`, to: toId, predicate: "facet" });
    }
  }

  // LEGACY (v0.15) context-group membership edges (scope —in-group→ group)
  const ctxName = decl.mounts.context ?? DEFAULT_CONTEXT_DIR;
  async function collectGroups(dirPath: string, basePath: string) {
    for (const e of await c.list(dirPath)) {
      if (e.kind !== "file" || !e.name.endsWith(".md")) continue;
      const md = await c.read(e.path);
      const g = md !== null ? parseGroupFile(md) : null;
      if (!g) continue;
      const gid = `group:${dirPath}/${g.slug}`;
      addNode({ id: gid, kind: "concept", label: g.title });
      for (const m of g.members) {
        const memberPath = basePath ? `${basePath}/${m.path}` : m.path;
        const sid = `scope:${memberPath}`;
        if (!nodeIds.has(sid)) addNode({ id: sid, kind: "scope", label: m.path });
        edges.push({ from: sid, to: gid, predicate: "in-group", note: m.note });
      }
    }
  }
  async function walkForGroups(path: string, depth: number) {
    if (depth > 5) return;
    for (const e of await c.list(path)) {
      if (e.kind !== "folder") continue;
      if (e.name === ctxName) {
        await collectGroups(e.path, path);
        continue;
      }
      if (e.name.startsWith("_")) continue;
      await walkForGroups(e.path, depth + 1);
    }
  }
  if (decl.mounts.context && (await c.exists(decl.mounts.context))) {
    await collectGroups(decl.mounts.context, "");
  }
  for (const area of decl.mounts.areas) {
    if (await c.exists(area)) await walkForGroups(area, 1);
  }

  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  return {
    spec_version: decl.spec_version,
    profile: decl.profile,
    generated: stamp,
    stats: {
      nodes: nodes.length,
      edges: edges.length,
      entities: entities.length,
      scopes: scopes.length,
    },
    nodes,
    edges,
  };
}

// v0.16 (SPEC §6.8): the model is a tooling view, never stored in the Drive.
// Only legacy v0.15 workspaces still get a _Model.json file.
export async function writeModel(c: Connector): Promise<boolean> {
  const decl = await readDecl(c);
  if (decl?.layout !== "v0.15") return false;
  const model = await buildModel(c);
  if (!model) return false;
  await c.write("_Model.json", JSON.stringify(model, null, 2), { overwrite: true });
  return true;
}
