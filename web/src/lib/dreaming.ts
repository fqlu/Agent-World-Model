import { Connector } from "./connector";
import { loadManifest, loadTemplate } from "./spec";
import { WorkspaceDecl } from "./workspace";
import { readDecl, resolveMounts } from "./config";

// Dreaming (spec/DREAMING.md): the protocol's out-of-band reflection agent.
// The app generates the agent's brief — <proposals>/dreaming/INSTRUCTIONS.md —
// from spec/templates/dreaming/INSTRUCTIONS.md and the `dreaming:` block of
// the AGENTS.md header. Nobody edits the brief by hand.

export type OtherAgent = { name: string; note?: string };

export type DreamingSettings = {
  agent_name: string;
  mode: "dry-run" | "live";
  runtime: "drive-mcp" | "vm";
  drive_path: string;
  timezone: string;
  nightly: string;
  weekly: string;
  report_channel: string;
  budget: string;
  other_agents: OtherAgent[];
  notes: string;
};

export const DREAMING_FOLDER = "dreaming";
export const BRIEF_FILE = "INSTRUCTIONS.md";
const APP_REPO = process.env.HUB_APP_REPO ?? "https://github.com/fqlu/Agent-World-Model.git";

// A local Google Drive mirror path ("…/My Drive/X") becomes "My Drive/X".
export function guessDrivePath(root: string | undefined, workspaceName: string): string {
  const m = root?.match(/\/(My Drive\/.+?)\/?$/) ?? root?.match(/\/(Shared drives\/.+?)\/?$/);
  return m ? m[1] : `My Drive/${workspaceName}`;
}

export function resolveDreaming(
  decl: WorkspaceDecl | null,
  ctx: { workspaceName: string; root?: string },
): DreamingSettings {
  const d = ((decl as Record<string, unknown> | null)?.dreaming ?? {}) as Partial<DreamingSettings>;
  const str = (v: unknown, dflt: string) => (typeof v === "string" && v.trim() ? v.trim() : dflt);
  return {
    agent_name: str(d.agent_name, "dreaming-agent"),
    mode: d.mode === "live" ? "live" : "dry-run",
    runtime: d.runtime === "vm" ? "vm" : "drive-mcp",
    drive_path: str(d.drive_path, guessDrivePath(ctx.root, ctx.workspaceName)),
    timezone: str(d.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),
    nightly: str(d.nightly, "02:30"),
    weekly: str(d.weekly, "Sun 03:30"),
    report_channel: str(d.report_channel, "the chat you were started from"),
    budget: str(d.budget, "about 400 files per run"),
    other_agents: Array.isArray(d.other_agents)
      ? d.other_agents
          .filter((a): a is OtherAgent => Boolean(a && typeof (a as OtherAgent).name === "string"))
          .map((a) => ({ name: a.name, ...(a.note ? { note: String(a.note) } : {}) }))
      : [],
    notes: typeof d.notes === "string" ? d.notes : "",
  };
}

export function briefPath(decl: WorkspaceDecl | null): string {
  return `${resolveMounts(decl).proposals}/${DREAMING_FOLDER}/${BRIEF_FILE}`;
}

export function renderDreamingBrief(
  decl: WorkspaceDecl | null,
  ctx: { workspaceName: string; root?: string },
): string {
  const s = resolveDreaming(decl, ctx);
  const m = resolveMounts(decl);
  const owner = decl?.owner ?? {};
  const live = s.mode === "live";
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const ignore = decl?.ignore?.length ? decl.ignore.map((p) => `\`${p}/\``).join(", ") : "none";
  const others = s.other_agents.length
    ? "\n" + s.other_agents.map((a) => `  - \`${a.name}\`${a.note ? ` — ${a.note}` : ""}`).join("\n")
    : "none declared.";
  return loadTemplate(`${DREAMING_FOLDER}/${BRIEF_FILE}`)
    .replaceAll("{{spec_version}}", String(decl?.spec_version ?? loadManifest().spec_version))
    .replaceAll("{{generated_at}}", stamp)
    .replaceAll("{{agent_name}}", s.agent_name)
    .replaceAll("{{workspace_name}}", ctx.workspaceName)
    .replaceAll("{{owner_name}}", owner.name ?? "the owner")
    .replaceAll("{{owner_email}}", owner.email ?? "unknown")
    .replaceAll("{{timezone}}", s.timezone)
    .replaceAll("{{drive_path}}", s.drive_path)
    .replaceAll("{{rclone_path}}", s.drive_path.replace(/^My Drive\//, ""))
    .replaceAll("{{app_repo}}", APP_REPO)
    .replaceAll("{{areas}}", m.areas.map((a) => `\`${a}/\``).join(", ") || "(none declared)")
    .replaceAll("{{entities}}", m.entities)
    .replaceAll("{{journal}}", m.journal)
    .replaceAll("{{proposals}}", m.proposals)
    .replaceAll("{{templates}}", m.templates)
    .replaceAll("{{archive}}", m.archive)
    .replaceAll("{{ignore_list}}", ignore)
    .replaceAll("{{other_agents}}", others)
    .replaceAll("{{nightly}}", s.nightly)
    .replaceAll("{{weekly}}", s.weekly)
    .replaceAll("{{report_channel}}", s.report_channel)
    .replaceAll("{{budget}}", s.budget)
    .replaceAll("{{mode}}", s.mode)
    .replaceAll(
      "{{mode_apply_rule}}",
      live
        ? "- **accept** with no result (accepted in the Markdown fallback): apply its `ops` exactly, only if each file's md5 still equals `base_md5`; otherwise treat it as `stale`."
        : "- **accept** with no result (accepted in the Markdown fallback): **dry-run — don't apply.** List what you would have done.",
    )
    .replaceAll(
      "{{mode_text}}",
      live
        ? "**Live.** Apply accepted items and answered follow-ups as described in step 5, with the stale-write check."
        : "**Dry run.** Write only your proposals JSON, its Markdown rendering, `suppressions.json` and your journal line. Don't apply any ops; list what you would have done. The owner switches you to live in the app.",
    )
    .replaceAll("{{owner_notes}}", s.notes.trim() || "*(none)*");
}

export async function writeDreamingBrief(
  c: Connector,
  ctx: { workspaceName: string; root?: string },
): Promise<string> {
  const decl = await readDecl(c);
  const p = briefPath(decl);
  await c.write(p, renderDreamingBrief(decl, ctx), { overwrite: true });
  return p;
}

// The one message the owner sends their agent platform to start dreaming.
export function kickoffMessage(decl: WorkspaceDecl | null, ctx: { workspaceName: string; root?: string }): string {
  const s = resolveDreaming(decl, ctx);
  const brief = `${s.drive_path}/${briefPath(decl)}`;
  return [
    `You are **${s.agent_name}**, the dreaming agent for my workspace \`${s.drive_path}\`.`,
    ``,
    `Your standing instructions are the file \`${brief}\`. At the start of **every** run, re-read it and follow it exactly; it overrides anything in this chat. Never edit it.`,
    ``,
    `Runtime: \`${s.runtime}\`. Mode: **${s.mode}**. Schedule: nightly at ${s.nightly} and weekly on ${s.weekly} (${s.timezone}). Report to: ${s.report_channel}.`,
    ``,
    `Start now with one run.`,
  ].join("\n");
}
