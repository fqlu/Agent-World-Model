"use client";

import { useMemo } from "react";
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

const NODE_STYLE: Record<string, React.CSSProperties> = {
  person: { background: "#d1fae5", border: "1px solid #059669", color: "#065f46" },
  system: { background: "#e0f2fe", border: "1px solid #0284c7", color: "#075985" },
  concept: { background: "#ede9fe", border: "1px solid #7c3aed", color: "#5b21b6" },
  scope: { background: "#ffffff", border: "1px solid #d4d4d8", color: "#18181b" },
};

// Simple layered layout: scopes left, people middle-left, systems middle-right,
// concepts/groups right. Keeps the graph readable without a physics engine.
const COLUMN: Record<string, number> = { scope: 0, person: 1, system: 2, concept: 3 };

export default function ModelGraph({ model }: { model: WorldModel }) {
  const nodes: Node[] = useMemo(() => {
    const perCol: Record<number, number> = {};
    return model.nodes.map((n) => {
      const col = COLUMN[n.kind] ?? 0;
      const row = (perCol[col] = (perCol[col] ?? 0) + 1);
      const attrs = n.attributes
        ? Object.entries(n.attributes)
            .slice(0, 2)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")
        : "";
      return {
        id: n.id,
        position: { x: col * 280, y: row * 90 },
        data: { label: attrs ? `${n.label}\n${attrs}` : n.label },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: {
          ...NODE_STYLE[n.kind],
          fontSize: 11,
          borderRadius: 8,
          padding: "6px 10px",
          width: 180,
          whiteSpace: "pre-line",
        },
      };
    });
  }, [model.nodes]);

  const edges: Edge[] = useMemo(
    () =>
      model.edges.map((e, i) => ({
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
    [model.edges],
  );

  return (
    <div className="card overflow-hidden">
      <div style={{ height: "calc(100vh - 18rem)", minHeight: 460 }}>
        <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.1} proOptions={{ hideAttribution: true }}>
          <Background />
          <Controls />
        </ReactFlow>
      </div>
      <div className="flex flex-wrap gap-3 border-t border-zinc-100 px-3 py-2 text-xs text-zinc-500">
        <Legend color="#059669" label="person" />
        <Legend color="#0284c7" label="system" />
        <Legend color="#7c3aed" label="concept / group" />
        <Legend color="#d4d4d8" label="scope" />
        <span className="ml-auto">solid = typed relationship · dashed = group membership</span>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
