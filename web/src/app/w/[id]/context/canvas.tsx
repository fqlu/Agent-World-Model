"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type TreeNode = {
  rel: string;
  name: string;
  depth: number;
  parentRel: string | null;
  hasChildren: boolean;
};
type GroupMember = { path: string; note?: string }; // path = rel folder path
type ContextGroup = { slug: string; title: string; description: string; members: GroupMember[] };

type GroupState = {
  slug: string;
  title: string;
  description: string;
  position: { x: number; y: number };
};

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "group"
  );
}

function ancestorsOf(rel: string): string[] {
  const parts = rel.split("/");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

const FOLDER_STYLE: React.CSSProperties = {
  fontSize: 12,
  padding: "6px 12px",
  borderRadius: 8,
  border: "1px solid #d4d4d8",
  background: "#ffffff",
  color: "#18181b",
  width: "auto",
  cursor: "pointer",
};

const GROUP_STYLE: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  padding: "10px 14px",
  borderRadius: 10,
  border: "2px solid #4f46e5",
  background: "#eef2ff",
  color: "#312e81",
  width: "auto",
};

const EDGE_DEFAULTS = {
  markerEnd: { type: MarkerType.ArrowClosed, color: "#4f46e5" },
  style: { stroke: "#4f46e5", strokeWidth: 1.5 },
};

export default function ContextCanvas({
  wsId,
  folderPath,
  tree,
  initialGroups,
}: {
  wsId: number;
  folderPath: string;
  tree: TreeNode[];
  initialGroups: ContextGroup[];
}) {
  const treeRels = useMemo(() => new Set(tree.map((t) => t.rel)), [tree]);

  // Members not present in the fetched tree (renamed / beyond depth cap) are
  // invisible on the canvas but preserved verbatim on save.
  const unknownMembers = useMemo(() => {
    const m = new Map<string, GroupMember[]>();
    for (const g of initialGroups) {
      m.set(g.slug, g.members.filter((mb) => !treeRels.has(mb.path)));
    }
    return m;
  }, [initialGroups, treeRels]);

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // start collapsed, but reveal every existing member's branch
    const s = new Set<string>();
    for (const g of initialGroups) {
      for (const mb of g.members) {
        if (treeRels.has(mb.path)) ancestorsOf(mb.path).forEach((a) => s.add(a));
      }
    }
    return s;
  });

  const [groups, setGroups] = useState<GroupState[]>(() =>
    initialGroups.map((g, i) => ({
      slug: g.slug,
      title: g.title,
      description: g.description,
      position: { x: 680, y: 40 + i * 140 },
    })),
  );

  const [allEdges, setAllEdges] = useState<Edge[]>(() =>
    initialGroups.flatMap((g) =>
      g.members
        .filter((m) => treeRels.has(m.path))
        .map((m) => ({
          id: `e:${g.slug}:${m.path}`,
          source: `f:${m.path}`,
          target: `g:${g.slug}`,
          label: m.note,
          data: { note: m.note ?? "" },
          ...EDGE_DEFAULTS,
        })),
    ),
  );

  const [selected, setSelected] = useState<{ kind: "group" | "edge"; id: string } | null>(null);
  const [newGroupTitle, setNewGroupTitle] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const visibleFolders = useMemo(
    () => tree.filter((t) => ancestorsOf(t.rel).every((a) => expanded.has(a))),
    [tree, expanded],
  );

  const nodes: Node[] = useMemo(() => {
    const folders: Node[] = visibleFolders.map((t, i) => ({
      id: `f:${t.rel}`,
      type: "input",
      position: { x: (t.depth - 1) * 36, y: i * 52 },
      data: {
        label: (t.hasChildren ? (expanded.has(t.rel) ? "▾ " : "▸ ") : "") + t.name,
      },
      draggable: false,
      deletable: false,
      sourcePosition: Position.Right,
      style: FOLDER_STYLE,
    }));
    const groupNodes: Node[] = groups.map((g) => ({
      id: `g:${g.slug}`,
      type: "output",
      position: g.position,
      data: { label: g.title },
      targetPosition: Position.Left,
      style:
        selected?.kind === "group" && selected.id === `g:${g.slug}`
          ? { ...GROUP_STYLE, boxShadow: "0 0 0 3px #c7d2fe" }
          : GROUP_STYLE,
    }));
    return [...folders, ...groupNodes];
  }, [visibleFolders, expanded, groups, selected]);

  const visibleEdges = useMemo(() => {
    const visible = new Set(visibleFolders.map((t) => `f:${t.rel}`));
    return allEdges.map((e) =>
      selected?.kind === "edge" && selected.id === e.id
        ? { ...e, style: { stroke: "#4f46e5", strokeWidth: 3 } }
        : e,
    ).filter((e) => visible.has(e.source));
  }, [allEdges, visibleFolders, selected]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const ch of changes) {
        if (ch.type === "position" && ch.position && ch.id.startsWith("g:")) {
          const slug = ch.id.slice(2);
          setGroups((gs) =>
            gs.map((g) => (g.slug === slug ? { ...g, position: ch.position! } : g)),
          );
        }
      }
    },
    [setGroups],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = new Set(
        changes.filter((ch) => ch.type === "remove").map((ch) => (ch as { id: string }).id),
      );
      if (removed.size) setAllEdges((eds) => eds.filter((e) => !removed.has(e.id)));
    },
    [setAllEdges],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source?.startsWith("f:") || !conn.target?.startsWith("g:")) return;
      setAllEdges((eds) => {
        if (eds.some((e) => e.source === conn.source && e.target === conn.target)) return eds;
        return [
          ...eds,
          {
            id: `e:${conn.target.slice(2)}:${conn.source.slice(2)}`,
            source: conn.source,
            target: conn.target,
            data: { note: "" },
            ...EDGE_DEFAULTS,
          },
        ];
      });
    },
    [setAllEdges],
  );

  const onNodeClick = useCallback(
    (_: unknown, n: Node) => {
      if (n.id.startsWith("f:")) {
        const rel = n.id.slice(2);
        const t = tree.find((x) => x.rel === rel);
        if (t?.hasChildren) {
          setExpanded((s) => {
            const next = new Set(s);
            if (next.has(rel)) next.delete(rel);
            else next.add(rel);
            return next;
          });
        }
        setSelected(null);
      } else {
        setSelected({ kind: "group", id: n.id });
      }
    },
    [tree],
  );

  const addGroup = useCallback(() => {
    const title = newGroupTitle.trim();
    if (!title) return;
    const slug = slugify(title);
    setGroups((gs) => {
      if (gs.some((g) => g.slug === slug)) return gs;
      return [
        ...gs,
        { slug, title, description: "", position: { x: 680, y: 40 + gs.length * 140 } },
      ];
    });
    setNewGroupTitle("");
  }, [newGroupTitle]);

  const selectedGroup =
    selected?.kind === "group" ? groups.find((g) => `g:${g.slug}` === selected.id) : null;
  const selectedEdge =
    selected?.kind === "edge" ? allEdges.find((e) => e.id === selected.id) : null;

  const updateSelectedGroup = useCallback(
    (patch: { title?: string; description?: string }) => {
      if (!selectedGroup) return;
      setGroups((gs) =>
        gs.map((g) => (g.slug === selectedGroup.slug ? { ...g, ...patch } : g)),
      );
    },
    [selectedGroup],
  );

  const removeSelectedGroup = useCallback(() => {
    if (!selectedGroup) return;
    setGroups((gs) => gs.filter((g) => g.slug !== selectedGroup.slug));
    setAllEdges((eds) => eds.filter((e) => e.target !== `g:${selectedGroup.slug}`));
    setSelected(null);
  }, [selectedGroup]);

  const updateEdgeNote = useCallback(
    (note: string) => {
      if (!selectedEdge) return;
      setAllEdges((eds) =>
        eds.map((e) =>
          e.id === selectedEdge.id ? { ...e, label: note || undefined, data: { note } } : e,
        ),
      );
    },
    [selectedEdge],
  );

  const removeSelectedEdge = useCallback(() => {
    if (!selectedEdge) return;
    setAllEdges((eds) => eds.filter((e) => e.id !== selectedEdge.id));
    setSelected(null);
  }, [selectedEdge]);

  const save = useCallback(async () => {
    setSaving(true);
    setStatus(null);
    const payload = groups.map((g) => {
      const members: GroupMember[] = allEdges
        .filter((e) => e.target === `g:${g.slug}`)
        .map((e) => {
          const note = (e.data?.note as string) || undefined;
          return { path: e.source.slice(2), ...(note ? { note } : {}) };
        });
      return {
        slug: g.slug,
        title: g.title,
        description: g.description,
        members: [...members, ...(unknownMembers.get(g.slug) ?? [])],
      };
    });
    try {
      const res = await fetch(
        `/api/workspaces/${wsId}/context?path=${encodeURIComponent(folderPath)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ groups: payload }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      setStatus(
        `Saved ${body.written.length} group file(s)` +
          (body.archived.length ? `, archived ${body.archived.length}` : "") +
          ".",
      );
    } catch (e) {
      setStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [groups, allEdges, unknownMembers, wsId, folderPath]);

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="card flex-1 overflow-hidden">
        <div style={{ height: "calc(100vh - 22rem)", minHeight: 420 }}>
          <ReactFlow
            nodes={nodes}
            edges={visibleEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={(_, e) => setSelected({ kind: "edge", id: e.id })}
            onPaneClick={() => setSelected(null)}
            deleteKeyCode={null}
            fitView
            minZoom={0.1}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
      </div>

      <aside className="card w-full shrink-0 space-y-4 self-start p-4 lg:w-80">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">
            New group at {folderPath ? `"${folderPath}"` : "root"}
          </h2>
          <div className="mt-1 flex gap-2">
            <input
              value={newGroupTitle}
              onChange={(e) => setNewGroupTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addGroup()}
              placeholder="Companies I've worked at"
              className="input mt-0 flex-1"
            />
            <button onClick={addGroup} className="btn-secondary shrink-0 px-3">
              Add
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Click a folder (▸/▾) to expand or collapse its subfolders. Drag from any visible
            folder's handle to a group to connect — subfolders inherit their ancestors' groups
            automatically, so only wire a subfolder when its context genuinely differs.
            Connections to collapsed folders are kept.
          </p>
        </div>

        {selectedGroup && (
          <div className="space-y-2 border-t border-zinc-100 pt-3">
            <h3 className="text-sm font-semibold text-zinc-900">Edit group</h3>
            <label className="block text-xs font-medium text-zinc-600">
              Title
              <input
                value={selectedGroup.title}
                onChange={(e) => updateSelectedGroup({ title: e.target.value })}
                className="input"
              />
            </label>
            <label className="block text-xs font-medium text-zinc-600">
              Description (what membership means — agents read this)
              <textarea
                value={selectedGroup.description}
                onChange={(e) => updateSelectedGroup({ description: e.target.value })}
                rows={4}
                className="input"
              />
            </label>
            <button
              onClick={removeSelectedGroup}
              className="text-xs font-medium text-red-600 hover:underline"
            >
              Remove group (file is archived on save)
            </button>
          </div>
        )}

        {selectedEdge && (
          <div className="space-y-2 border-t border-zinc-100 pt-3">
            <h3 className="text-sm font-semibold text-zinc-900">Edit connection</h3>
            <p className="font-mono text-xs text-zinc-500">
              {selectedEdge.source.slice(2)} → {selectedEdge.target.slice(2)}
            </p>
            <label className="block text-xs font-medium text-zinc-600">
              Note (e.g. "current employer, 2024–present")
              <input
                value={(selectedEdge.data?.note as string) ?? ""}
                onChange={(e) => updateEdgeNote(e.target.value)}
                className="input"
              />
            </label>
            <button
              onClick={removeSelectedEdge}
              className="text-xs font-medium text-red-600 hover:underline"
            >
              Remove connection
            </button>
          </div>
        )}

        <div className="border-t border-zinc-100 pt-3">
          <button onClick={save} disabled={saving} className="btn-primary w-full justify-center">
            {saving ? "Saving…" : "Save to workspace"}
          </button>
          {status && (
            <p
              className={`mt-2 text-xs ${status.startsWith("Error") ? "text-red-600" : "text-green-700"}`}
            >
              {status}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
