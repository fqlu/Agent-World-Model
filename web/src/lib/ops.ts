import { Connector } from "./connector";
import { loadTemplate } from "./spec";

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
      }
      results.push({ op, ok: true });
    } catch (e) {
      results.push({ op, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

// Append an attributed line to today's journal (creating the day file from the
// template if needed) — the transparency contract from SPEC §7.3.
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
    md = loadTemplate("Daily Journal.md")
      .replace(/^# YYYY-MM-DD/m, `# ${day}`)
      .split("\n")
      // drop placeholder client sections from the template for generated files
      .filter(
        (l) =>
          !l.startsWith("## [") &&
          !l.startsWith("- [One-line") &&
          !l.startsWith("- HH:MM") &&
          l.trim() !== "- ...",
      )
      .join("\n");
  }
  if (md.includes(heading)) {
    const lines = md.split("\n");
    const idx = lines.findIndex((l) => l.trim() === heading);
    let insertAt = lines.length;
    for (let i = idx + 1; i < lines.length; i++) {
      if (lines[i].startsWith("## ")) { insertAt = i; break; }
    }
    lines.splice(insertAt, 0, line);
    md = lines.join("\n");
  } else {
    md = `${md.trimEnd()}\n\n${heading}\n${line}\n`;
  }
  await c.write(path, md, { overwrite: true });
}
