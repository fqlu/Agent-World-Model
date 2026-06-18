"use client";

import { useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Position,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type ModelNode = {
  id: string;
  kind: "person" | "system" | "concept" | "scope";
  label: string;
  attributes?: Record<string, string>;
};
type ModelEdge = { from: string; to: string; predicate: string; note?: string };
type WorldModel = { nodes: ModelNode[]; edges: ModelEdge[] };

type VKind = "person" | "system" | "concept" | "scope" | "group";

const NODE_STYLE: Record<VKind, React.CSSProperties> = {
  person: { background: "#d1fae5", border: "1px solid #059669", color: "#065f46" },
  system: { background: "#e0f2fe", border: "1px solid #0284c7", color: "#075985" },
  concept: { background: "#ede9fe", border: "1px solid #7c3aed", color: "#5b21b6" },
  group: { background: "#fef3c7", border: "1px solid #d97706", color: "#92400e" },
  scope: { background: "#ffffff", border: "1px solid #d4d4d8", color: "#18181b" },
};
const COLUMN: Record<VKind, number> = { scope: 0, person: 1, system: 2, concept: 3, group: 4 };

function vkind(n: ModelNode): VKind {
  if (n.id.startsWith("group:")) return "group";
  return n.kind;
}
// "<Area>/<Entity>" key for grouping scopes by their top-level client/entity.
function clientKey(scopeId: string): { key: string; label: string } | null {
  if (!scopeId.startsWith("scope:")) return null;
  const segs = scopeId.slice(6).split("/");
  if (segs.length < 2) return { key: segs[0], label: segs[0] };
  return { key: `${segs[0]}/${segs[1]}`, label: segs[1] };
}

const ALL_KINDS: VKind[] = ["person", "system", "concept", "group", "scope"];

export default function ModelGraph({ model }: { model: WorldModel }) {
  const [focus, setFocus] = useState("all"); // "all" | "client:<key>" | "group:<id>"
  const [kinds, setKinds] = useState<Set<VKind>>(new Set(ALL_KINDS));

  const clientOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of model.nodes) {
      const c = clientKey(n.id);
      if (c) m.set(c.key, c.label);
    }
    return [...m.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [model.nodes]);

  const groupOptions = useMemo(
    () => model.nodes.filter((n) => n.id.startsWith("group:")).map((n) => ({ id: n.id, label: n.label })),
    [model.nodes],
  );

  // Which node ids survive the focus filter (before kind toggles).
  const focused = useMemo(() => {
    if (focus === "all") return new Set(model.nodes.map((n) => n.id));
    let seeds: Set<string>;
    let alwaysInclude: string | null = null;
    if (focus.startsWith("client:")) {
      // seeds = every scope under this client/entity
      const key = focus.slice("client:".length);
      seeds = new Set(
        model.nodes.filter((n) => n.id === `scope:${key}` || n.id.startsWith(`scope:${key}/`)).map((n) => n.id),
      );
    } else {
      // focus = "group:<groupNodeId>"; seeds = the group's member scopes
      const groupId = focus.slice("group:".length);
      alwaysInclude = groupId;
      seeds = new Set(model.edges.filter((e) => e.to === groupId).map((e) => e.from));
    }
    // visible = seeds + everything one hop away
    const visible = new Set(seeds);
    for (const e of model.edges) {
      if (seeds.has(e.from)) visible.add(e.to);
      if (seeds.has(e.to)) visible.add(e.from);
    }
    if (alwaysInclude) visible.add(alwaysInclude);
    return visible;
  }, [focus, model.nodes, model.edges]);

  const visibleNodes = useMemo(
    () => model.nodes.filter((n) => focused.has(n.id) && kinds.has(vkind(n))),
    [model.nodes, focused, kinds],
  );
  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  const rfNodes: Node[] = useMemo(() => {
    const perCol: Record<number, number> = {};
    return visibleNodes.map((n) => {
      const k = vkind(n);
      const col = COLUMN[k] ?? 0;
      const row = (perCol[col] = (perCol[col] ?? 0) + 1);
      const attrs = n.attributes
        ? Object.entries(n.attributes).slice(0, 2).map(([a, b]) => `${a}: ${b}`).join("\n")
        : "";
      return {
        id: n.id,
        position: { x: col * 280, y: row * 88 },
        data: { label: attrs ? `${n.label}\n${attrs}` : n.label },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: { ...NODE_STYLE[k], fontSize: 11, borderRadius: 8, padding: "6px 10px", width: 180, whiteSpace: "pre-line" },
      };
    });
  }, [visibleNodes]);

  const rfEdges: Edge[] = useMemo(
    () =>
      model.edges
        .filter((e) => visibleIds.has(e.from) && visibleIds.has(e.to))
        .map((e, i) => ({
          id: `e${i}`,
          source: e.from,
          target: e.to,
          label: e.predicate,
          labelStyle: { fontSize: 10, fill: "#52525b" },
          labelBgStyle: { fill: "#f4f4f5" },
          style: {
            stroke: e.predicate === "in-group" ? "#a1a1aa" : "#6366f1",
            strokeWidth: 1.5,
            strokeDasharray: e.predicate === "in-group" ? "4 3" : undefined,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: e.predicate === "in-group" ? "#a1a1aa" : "#6366f1" },
        })),
    [model.edges, visibleIds],
  );

  const toggleKind = (k: VKind) =>
    setKinds((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  // Remount React Flow when the visible set changes so fitView re-centres.
  const flowKey = `${focus}|${[...kinds].sort().join(",")}`;

  return (
    <div className="space-y-3">
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <label className="text-sm font-medium text-zinc-700">
          Focus
          <select
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            className="ml-2 max-w-64 rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="all">Whole model</option>
            <optgroup label="Client">
              {clientOptions.map((c) => (
                <option key={c.key} value={`client:${c.key}`}>{c.label}</option>
              ))}
            </optgroup>
            {groupOptions.length > 0 && (
              <optgroup label="Context group">
                {groupOptions.map((g) => (
                  <option key={g.id} value={`group:${g.id}`}>{g.label}</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          {ALL_KINDS.map((k) => (
            <button
              key={k}
              onClick={() => toggleKind(k)}
              className={`badge border ${kinds.has(k) ? "border-transparent" : "opacity-40"}`}
              style={NODE_STYLE[k]}
            >
              {k}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-zinc-500">
          {rfNodes.length} nodes · {rfEdges.length} edges
        </span>
      </div>

      <div className="card overflow-hidden">
        <div style={{ height: "calc(100vh - 22rem)", minHeight: 460 }}>
          <ReactFlow key={flowKey} nodes={rfNodes} edges={rfEdges} fitView minZoom={0.1} proOptions={{ hideAttribution: true }}>
            <Background />
            <Controls />
          </ReactFlow>
        </div>
        <div className="flex flex-wrap gap-3 border-t border-zinc-100 px-3 py-2 text-xs text-zinc-500">
          <span>solid = typed relationship · dashed = group membership</span>
          <span className="ml-auto">tip: pick a client or group in Focus to isolate its sub-graph</span>
        </div>
      </div>
    </div>
  );
}
