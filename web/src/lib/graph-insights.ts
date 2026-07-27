import { Connector } from "./connector";
import { buildModel } from "./model-gen";

// Graph insights (v0.15) — deterministic topology analysis of the world model.
// No LLM. Finds structure the tree can't show: facet candidates (communities),
// merge candidates (near-duplicate neighbourhoods), overloaded scopes (hubs),
// bus-factor risks (articulation points), and under-integrated nodes
// (isolates). Output = proposals for the human; nothing is ever applied.

export type Insight = {
  kind: "isolate" | "hub" | "duplicate" | "community" | "weak-group" | "bridge";
  title: string;
  detail: string;
  nodes: string[]; // node labels involved
};

type N = { id: string; kind: string; label: string };
type E = { from: string; to: string; predicate: string };

export async function computeInsights(c: Connector): Promise<{ insights: Insight[]; stats: Record<string, number> }> {
  const model = await buildModel(c);
  if (!model) return { insights: [], stats: {} };
  const nodes = model.nodes as N[];
  const edges = model.edges as E[];
  const label = new Map(nodes.map((n) => [n.id, n.label]));
  const insights: Insight[] = [];

  // adjacency — structural edges only (in-group edges would make groups define
  // their own communities, which is circular)
  const adj = new Map<string, Set<string>>();
  const touch = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  for (const e of edges) {
    if (e.predicate === "in-group") continue;
    touch(e.from, e.to);
    touch(e.to, e.from);
  }
  const groupMembers = new Map<string, Set<string>>(); // group id -> member node ids
  const memberGroups = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.predicate !== "in-group") continue;
    if (!groupMembers.has(e.to)) groupMembers.set(e.to, new Set());
    groupMembers.get(e.to)!.add(e.from);
    if (!memberGroups.has(e.from)) memberGroups.set(e.from, new Set());
    memberGroups.get(e.from)!.add(e.to);
  }

  const deg = (id: string) => adj.get(id)?.size ?? 0;
  const real = nodes.filter((n) => !n.id.startsWith("group:"));

  // 1. isolates — under-integrated knowledge
  const isolates = real.filter((n) => deg(n.id) === 0 && !(memberGroups.get(n.id)?.size));
  if (isolates.length) {
    insights.push({
      kind: "isolate",
      title: `${isolates.length} node(s) have no relationships at all`,
      detail: "Nothing points at them and they point at nothing — either the relationships are missing (add them) or the thing is inactive (deprecate it).",
      nodes: isolates.map((n) => n.label).slice(0, 15),
    });
  }

  // 2. hubs — split candidates (scopes) and load concentration (people)
  const scopeHubs = real
    .filter((n) => n.id.startsWith("scope:") && deg(n.id) >= 10)
    .sort((a, b) => deg(b.id) - deg(a.id));
  for (const h of scopeHubs.slice(0, 5)) {
    insights.push({
      kind: "hub",
      title: `"${h.label}" concentrates ${deg(h.id)} connections`,
      detail: "Heavily-connected scopes are decomposition candidates (§3.1) — consider whether distinct workstreams/projects inside it deserve their own sub-scopes.",
      nodes: [h.label],
    });
  }

  // 3. near-duplicate neighbourhoods — merge candidates
  const ents = real.filter((n) => n.id.startsWith("entity:"));
  for (let i = 0; i < ents.length; i++) {
    for (let j = i + 1; j < ents.length; j++) {
      const a = ents[i];
      const b = ents[j];
      if (a.kind !== b.kind) continue;
      // Name similarity only — neighbourhood overlap is NOT a duplicate signal
      // for people/systems (colleagues share clients by design).
      const nameClose = editDistance(a.label.toLowerCase(), b.label.toLowerCase()) <= 2;
      if (nameClose) {
        insights.push({
          kind: "duplicate",
          title: `Possible duplicate: "${a.label}" ↔ "${b.label}"`,
          detail: "Names differ by ≤2 characters — possibly the same thing entered twice (cf. Herman/Harman). Merge, alias, or dismiss.",
          nodes: [a.label, b.label],
        });
      }
    }
  }

  // 4. communities (label propagation, deterministic) vs declared groups
  const ids = [...adj.keys()].sort();
  const lbl = new Map(ids.map((id) => [id, id]));
  for (let it = 0; it < 10; it++) {
    let changed = false;
    for (const id of ids) {
      const counts = new Map<string, number>();
      for (const nb of adj.get(id)!) {
        const l = lbl.get(nb) ?? nb;
        counts.set(l, (counts.get(l) ?? 0) + 1);
      }
      if (!counts.size) continue;
      const best = [...counts.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0][0];
      if (best !== lbl.get(id)) {
        lbl.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const comms = new Map<string, string[]>();
  for (const id of ids) {
    const l = lbl.get(id)!;
    if (!comms.has(l)) comms.set(l, []);
    comms.get(l)!.push(id);
  }
  for (const members of comms.values()) {
    const scopes = members.filter((m) => m.startsWith("scope:"));
    // a community spanning ≥3 scopes across ≥2 clients with no shared group = facet candidate
    if (scopes.length < 3) continue;
    const clients = new Set(scopes.map((s) => s.slice(6).split("/").slice(0, 2).join("/")));
    if (clients.size < 2) continue;
    const sharedGroup = scopes
      .map((s) => memberGroups.get(s) ?? new Set<string>())
      .reduce<Set<string> | null>((acc, g) => (acc === null ? new Set(g) : new Set([...acc].filter((x) => g.has(x)))), null);
    if (sharedGroup && sharedGroup.size) continue;
    insights.push({
      kind: "community",
      title: `Undeclared cluster: ${scopes.length} scopes across ${clients.size} clients interconnect`,
      detail: "These scopes form a dense cluster in the graph but share no context group — a facet/pillar candidate (§3.1). If the association is real, declare it.",
      nodes: members.map((m) => label.get(m) ?? m).slice(0, 12),
    });
  }

  // weak declared groups — members that never actually interconnect
  for (const [gid, members] of groupMembers) {
    if (members.size < 3) continue;
    let intra = 0;
    const arr = [...members];
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++) if (adj.get(arr[i])?.has(arr[j])) intra++;
    if (intra === 0) {
      insights.push({
        kind: "weak-group",
        title: `Group "${label.get(gid) ?? gid}" has no internal connections`,
        detail: "Its members never reference each other outside the group itself. The facet may still be valid (it can encode intent, not just structure) — but check it isn't aspirational.",
        nodes: arr.map((m) => label.get(m) ?? m).slice(0, 12),
      });
    }
  }

  // 5. articulation points — bus-factor / single-path risks (people & systems)
  for (const ap of articulationPoints(adj)) {
    const n = nodes.find((x) => x.id === ap);
    if (!n || n.id.startsWith("scope:") || deg(ap) < 3) continue;
    insights.push({
      kind: "bridge",
      title: `"${n.label}" is a single point of connection`,
      detail: "Removing this node disconnects parts of the graph — for a person or system that reads as bus-factor / single-path operational risk.",
      nodes: [n.label],
    });
  }

  const stats: Record<string, number> = {};
  for (const i of insights) stats[i.kind] = (stats[i.kind] ?? 0) + 1;
  return { insights, stats };
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function articulationPoints(adj: Map<string, Set<string>>): Set<string> {
  const visited = new Set<string>();
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const aps = new Set<string>();
  let timer = 0;
  function dfs(u: string, parent: string | null) {
    visited.add(u);
    disc.set(u, timer);
    low.set(u, timer);
    timer++;
    let children = 0;
    for (const v of adj.get(u) ?? []) {
      if (v === parent) continue;
      if (visited.has(v)) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!));
      } else {
        children++;
        dfs(v, u);
        low.set(u, Math.min(low.get(u)!, low.get(v)!));
        if (parent !== null && low.get(v)! >= disc.get(u)!) aps.add(u);
      }
    }
    if (parent === null && children > 1) aps.add(u);
  }
  for (const id of [...adj.keys()].sort()) if (!visited.has(id)) dfs(id, null);
  return aps;
}
