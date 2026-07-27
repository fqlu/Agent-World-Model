import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

// Bundle visualiser (v0.15) — mirrors Google's OKF reference visualiser:
// a SELF-CONTAINED Cytoscape.js HTML graph written into the bundle itself
// (viz.html), so the map travels with the bundle. Nodes = concepts, edges =
// markdown links between them; colour by concept family, border by trust
// tier (human-reviewed / machine-confirmed / unverified). Works on any OKF
// bundle directory, not just ours.

type VizNode = {
  id: string;
  title: string;
  type: string;
  family: string; // person|system|concept|scope|group|reference|computation|other
  tier: "human" | "machine" | "unverified";
  status: string;
  description: string;
  resource: string;
};

const FAMILY_OF = (type: string, rel: string): string => {
  const t = type.toLowerCase();
  if (t === "person" || t === "system" || t === "concept") return t;
  if (t === "group") return "group";
  if (t.includes("computation")) return "computation";
  if (t === "workstream" || t === "project" || t === "scope") return "scope";
  if (rel.startsWith("scopes/")) return "scope";
  return "reference";
};

export async function generateBundleViz(bundleDir: string, bundleTitle: string): Promise<void> {
  const nodes: VizNode[] = [];
  const edges: { from: string; to: string }[] = [];
  const files: string[] = [];

  async function walk(dir: string) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".md")) files.push(path.relative(bundleDir, p));
    }
  }
  await walk(bundleDir);
  const fileSet = new Set(files);

  for (const rel of files) {
    if (rel === "index.md" || rel === "log.md") continue;
    const md = await fs.readFile(path.join(bundleDir, rel), "utf-8");
    const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    let d: Record<string, unknown> = {};
    try {
      d = fm ? ((YAML.parse(fm[1]) as Record<string, unknown>) ?? {}) : {};
    } catch {
      /* tolerate */
    }
    const verified = Array.isArray(d.verified) ? (d.verified as { by?: string }[]) : [];
    const tier = verified.some((v) => String(v?.by ?? "").startsWith("human:"))
      ? "human"
      : verified.length
        ? "machine"
        : "unverified";
    nodes.push({
      id: rel,
      title: String(d.title ?? md.match(/^#\s+(.+)$/m)?.[1] ?? path.basename(rel, ".md")),
      type: String(d.type ?? "?"),
      family: FAMILY_OF(String(d.type ?? ""), rel),
      tier,
      status: String(d.status ?? "stable"),
      description: String(d.description ?? ""),
      resource: String(d.resource ?? ""),
    });
    // edges: markdown links to other bundle files (bundle-absolute or relative)
    for (const m of md.matchAll(/\]\((\/?[^)#\s]+\.md)\)/g)) {
      const target = m[1].replace(/^\//, "");
      if (fileSet.has(target) && target !== rel && target !== "index.md" && target !== "log.md") {
        edges.push({ from: rel, to: target });
      }
    }
  }

  // Synthesised containment edges: a reference/computation concept belongs to
  // the scope whose workspace path is the longest prefix of its resource —
  // without these the content docs float unconnected (their inline links
  // point at workspace paths, not bundle files).
  const scopeVizNodes = nodes.filter((n) => n.family === "scope" && n.resource && n.resource !== "?");
  for (const n of nodes) {
    if (n.family !== "reference" && n.family !== "computation") continue;
    if (!n.resource || n.resource === "?") continue;
    let best: VizNode | null = null;
    for (const s of scopeVizNodes) {
      if (n.resource.startsWith(s.resource + "/") && (!best || s.resource.length > best.resource.length)) best = s;
    }
    if (best) edges.push({ from: n.id, to: best.id });
  }

  // Resolved from cwd (the web/ dir for both the dev server and the CLI) —
  // createRequire(import.meta.url) does not survive Next's bundling.
  const cytoscape = await fs.readFile(
    path.join(process.cwd(), "node_modules", "cytoscape", "dist", "cytoscape.min.js"),
    "utf-8",
  );

  const COLORS: Record<string, string> = {
    person: "#22c55e",
    system: "#3b82f6",
    concept: "#8b5cf6",
    scope: "#f9fafb",
    group: "#f59e0b",
    computation: "#ec4899",
    reference: "#94a3b8",
  };
  const TIER_BORDER: Record<string, string> = { human: "#16a34a", machine: "#2563eb", unverified: "#d4d4d8" };

  const data = {
    nodes: nodes.map((n) => ({ data: { ...n, color: COLORS[n.family] ?? "#94a3b8", border: TIER_BORDER[n.tier] } })),
    edges: edges.map((e, i) => ({ data: { id: `e${i}`, source: e.from, target: e.to } })),
  };

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${escapeHtml(bundleTitle)} — OKF bundle graph</title>
<style>
 body{margin:0;font:13px system-ui,sans-serif;display:flex;height:100vh;background:#fff;color:#18181b}
 #cy{flex:1}
 #side{width:300px;border-left:1px solid #e5e7eb;padding:14px;overflow:auto}
 #side h1{font-size:15px;margin:0 0 6px}
 .badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;background:#f4f4f5;margin-right:4px}
 .legend{position:fixed;left:10px;bottom:10px;background:#fffc;padding:8px 10px;border-radius:8px;font-size:11px;line-height:1.7}
 .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px;vertical-align:middle}
 #meta{color:#71717a;font-size:12px}
</style></head><body>
<div id="cy"></div>
<div id="side"><h1>${escapeHtml(bundleTitle)}</h1>
<p id="meta">${nodes.length} concepts · ${edges.length} links · self-contained OKF bundle graph.<br>Click a node. Border = trust tier (green: human-reviewed, blue: machine-confirmed, grey: unverified).</p>
<div id="detail"></div></div>
<div class="legend">${Object.entries(COLORS).map(([k, v]) => `<span class="dot" style="background:${v};border:1px solid #d4d4d8"></span>${k}<br>`).join("")}</div>
<script>${cytoscape}</script>
<script>
const DATA = ${JSON.stringify(data)};
const cy = cytoscape({
  container: document.getElementById('cy'),
  elements: DATA,
  layout: {name:'cose', animate:false, nodeRepulsion: 40000, idealEdgeLength: 90},
  style: [
    {selector:'node', style:{'background-color':'data(color)','border-width':3,'border-color':'data(border)','label':'data(title)','font-size':9,'width':22,'height':22,'text-wrap':'ellipsis','text-max-width':'110px','text-valign':'bottom','text-margin-y':4,'color':'#3f3f46'}},
    {selector:'node[status="deprecated"]', style:{'opacity':0.45}},
    {selector:'node[family="computation"]', style:{'shape':'diamond','width':28,'height':28}},
    {selector:'edge', style:{'width':1,'line-color':'#d4d4d8','curve-style':'bezier','target-arrow-shape':'triangle','target-arrow-color':'#d4d4d8','arrow-scale':0.7}},
    {selector:'.hl', style:{'line-color':'#6366f1','target-arrow-color':'#6366f1','border-color':'#6366f1'}}
  ]
});
cy.on('tap','node',e=>{
  cy.elements().removeClass('hl');
  const n=e.target; n.addClass('hl'); n.connectedEdges().addClass('hl');
  const d=n.data();
  document.getElementById('detail').innerHTML =
    '<h2 style="font-size:14px;margin:12px 0 4px">'+esc(d.title)+'</h2>'+
    '<div><span class="badge">'+esc(d.type)+'</span><span class="badge">'+esc(d.tier)+'</span><span class="badge">'+esc(d.status)+'</span></div>'+
    (d.description?'<p>'+esc(d.description)+'</p>':'')+
    (d.resource?'<p style="font-size:11px;color:#71717a;word-break:break-all">resource: '+esc(d.resource)+'</p>':'')+
    '<p style="font-size:11px;color:#a1a1aa;word-break:break-all">'+esc(d.id)+'</p>';
});
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
</script></body></html>`;
  await fs.writeFile(path.join(bundleDir, "viz.html"), html);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
