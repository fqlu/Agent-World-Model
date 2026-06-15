import { Connector } from "./connector";
import { parseWorkspaceYaml } from "./workspace";
import { listEntities, Entity } from "./entities";
import { parseGroupFile, DEFAULT_CONTEXT_DIR } from "./context";

// The world-model projection (SPEC §6.8): a structured, queryable snapshot of
// every node (entity or scope) and every edge (typed relationship or
// context-group membership), compiled from the canonical markdown.

export type ModelNode = {
  id: string; // "entity:<slug>" or "scope:<path>"
  kind: "person" | "system" | "concept" | "scope";
  label: string;
  attributes?: Record<string, string>;
  source?: string;
};

export type ModelEdge = {
  from: string;
  to: string;
  predicate: string;
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

async function readDecl(c: Connector) {
  const raw = await c.read("_Workspace.yaml");
  return raw ? parseWorkspaceYaml(raw) : null;
}

// Promoted scopes = folders containing _Overview.md (entities + promoted).
export async function promotedScopes(
  c: Connector,
): Promise<{ path: string; name: string }[]> {
  const decl = await readDecl(c);
  const areas = decl?.mounts?.areas ?? [];
  const out: { path: string; name: string }[] = [];
  async function walk(path: string, depth: number) {
    if (depth > 4) return;
    for (const e of await c.list(path)) {
      if (e.kind !== "folder" || e.name.startsWith("_") || e.name.endsWith(" | WIP Notes")) continue;
      const children = await c.list(e.path);
      if (children.some((x) => x.name === "_Overview.md")) {
        out.push({ path: e.path, name: e.name });
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
  for (const s of scopes) addNode({ id: `scope:${s.path}`, kind: "scope", label: s.name });

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
      edges.push({ from: `entity:${e.slug}`, to: toId, predicate: r.predicate, note: r.note });
    }
  }

  // Context-group membership edges (scope —in-group→ pseudo-node per group)
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

export async function writeModel(c: Connector): Promise<boolean> {
  const model = await buildModel(c);
  if (!model) return false;
  await c.write("_Model.json", JSON.stringify(model, null, 2), { overwrite: true });
  return true;
}
