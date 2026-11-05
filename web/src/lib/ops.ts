import { Connector } from "./connector";
import { readDecl, resolveMounts } from "./config";

// The full vocabulary of structural change. There is deliberately no delete.
export type Op = {
  action: "mkdir" | "write" | "move";
  path: string;
  to?: string; // move target
  content?: string; // write payload
  overwrite?: boolean; // writes refuse to overwrite unless explicitly planned
  note: string; // human-readable explanation shown in the review UI
  selected: boolean; // default selection state in the review UI
  risky?: boolean; // rendered with a warning; default-unselected
  noCascade?: boolean; // move only: skip rewriting references (bulk migrations do their own)
};

export type OpResult = { op: Op; ok: boolean; error?: string; skipped?: boolean };

export async function applyOps(
  c: Connector,
  ops: Op[],
  selectedIdx: Set<number>,
): Promise<OpResult[]> {
  const results: OpResult[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (!selectedIdx.has(i)) {
      results.push({ op, ok: true, skipped: true });
      continue;
    }
    try {
      if (op.action === "mkdir") {
        await c.mkdir(op.path);
      } else if (op.action === "write") {
        if (op.content === undefined) throw new Error("write op without content");
        await c.write(op.path, op.content, { overwrite: op.overwrite });
      } else if (op.action === "move") {
        if (!op.to) throw new Error("move op without target");
        await c.move(op.path, op.to);
        // SPEC §8: renames MUST propagate. Rewrite references to the old path
        // in entity relations/sources and context-group members — otherwise a
        // repair rename orphans every edge that pointed at the folder.
        if (!op.noCascade) {
          try {
            await cascadeRefs(c, op.path, op.to);
          } catch {
            /* cascade is best-effort; the move itself stands */
          }
        }
      }
      results.push({ op, ok: true });
    } catch (e) {
      results.push({ op, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

// Rewrite exact-path references after a move/rename: entity files (relation
// targets, source resources) and legacy root context-group member paths.
// Substring replacement of the full old path is safe — workspace paths are specific.
async function cascadeRefs(c: Connector, from: string, to: string): Promise<void> {
  const decl = await readDecl(c);
  const m = resolveMounts(decl);
  for (const dir of [m.entities, m.context].filter((x): x is string => Boolean(x))) {
    if (!(await c.exists(dir))) continue;
    for (const e of await c.list(dir)) {
      if (e.kind !== "file" || !e.name.endsWith(".md")) continue;
      const md = await c.read(e.path);
      if (md === null || !md.includes(from)) continue;
      await c.write(e.path, md.split(from).join(to), { overwrite: true });
    }
  }
}

// Append an attributed line to today's journal (creating the day file if
// needed) — the transparency contract from SPEC §7.3. v0.16: the journal is a
// log only, so a new day file is just a title and the Agent activity heading.
export async function journalAgentActivity(
  c: Connector,
  journalMount: string,
  message: string,
): Promise<void> {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const day = `${yyyy}-${mm}-${dd}`;
  const path = `${journalMount}/${yyyy}/${yyyy}-${mm}/${day}.md`;
  const appName = process.env.HUB_APP_NAME ?? "Agent World Model";
  const line = `- ${hh}:${min} · ${appName} · ${message}`;

  const heading = "## Agent activity";
  let md = await c.read(path);
  if (md === null) {
    md = `# ${day}\n\n${heading}\n`;
  }
  if (md.includes(heading)) {
    const lines = md.split("\n");
    const idx = lines.findIndex((l) => l.trim() === heading);
    let insertAt = lines.length;
    for (let i = idx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) { insertAt = i; break; }
    }
    // append right after the section's last non-blank line
    while (insertAt > idx + 1 && lines[insertAt - 1].trim() === "") insertAt--;
    lines.splice(insertAt, 0, line);
    md = lines.join("\n");
  } else {
    md = `${md.trimEnd()}\n\n${heading}\n${line}\n`;
  }
  await c.write(path, md, { overwrite: true });
}
