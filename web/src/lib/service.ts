import { q } from "./db";
import { connectorFor } from "./hub";
import { runAudit, AuditResult } from "./linter";
import { buildScaffoldPlan, ScaffoldOptions } from "./scaffold";
import { buildAdoptionPlan } from "./adopt";
import { Op, applyOps, journalAgentActivity, OpResult } from "./ops";
import { parseWorkspaceYaml } from "./workspace";
import { writeIndex } from "./index-gen";
import { writeModel } from "./model-gen";
import {
  buildManifest,
  detectChanges,
  reflectionScaffold,
  diffCount,
  Manifest,
  SyncReport,
} from "./sync";

export type PlanPayload = { ops: Op[]; notes: string[]; manual?: string[] };

function scaffoldOpts(wsId: number): ScaffoldOptions {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  return {
    workspaceName: ws.name,
    ownerName: process.env.HUB_OWNER_NAME ?? ws.name,
    ownerEmail: process.env.HUB_OWNER_EMAIL ?? ws.account_email ?? "owner@unknown",
    profile: ws.profile,
  };
}

export async function runAuditSvc(wsId: number): Promise<{ auditId: number; result: AuditResult }> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const result = await runAudit(connectorFor(ws), ws.profile);
  const auditId = q.insertAudit(wsId, result.findings, result.stats);
  return { auditId, result };
}

export async function createProposalSvc(
  wsId: number,
  kind: "scaffold" | "adopt",
): Promise<number> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  let payload: PlanPayload;
  if (kind === "scaffold") {
    payload = { ops: buildScaffoldPlan(scaffoldOpts(wsId)), notes: [], manual: [] };
  } else {
    payload = await buildAdoptionPlan(connectorFor(ws), scaffoldOpts(wsId));
  }
  return q.insertProposal(wsId, kind, payload);
}

export async function applyProposalSvc(
  proposalId: number,
  selected: number[],
): Promise<OpResult[]> {
  const proposal = q.getProposal(proposalId);
  if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
  if (proposal.status === "applied") throw new Error("Proposal already applied");
  const ws = q.getWorkspace(proposal.workspace_id);
  if (!ws) throw new Error("Workspace not found");

  const c = connectorFor(ws);
  const plan = JSON.parse(proposal.plan) as PlanPayload;
  const results = await applyOps(c, plan.ops, new Set(selected));

  // Journal the application (SPEC §7.3). Best-effort — the apply itself stands.
  try {
    const declRaw = await c.read("_Workspace.yaml");
    const decl = declRaw ? parseWorkspaceYaml(declRaw) : null;
    const journalMount = decl?.mounts?.journal ?? "Journal";
    const applied = results.filter((r) => !r.skipped && r.ok).length;
    const failed = results.filter((r) => !r.skipped && !r.ok).length;
    await journalAgentActivity(
      c,
      journalMount,
      `${ws.name} — applied ${proposal.kind} proposal #${proposalId}: ${applied} operation(s)${failed ? `, ${failed} failed` : ""}`,
    );
  } catch {
    // workspace may not have a journal yet (e.g. partial scaffold) — fine
  }

  const failed = results.some((r) => !r.skipped && !r.ok);
  q.finishProposal(proposalId, failed ? "applied_with_errors" : "applied", results);

  // Regenerate derived artifacts (SPEC §6.5, §6.8) — best-effort
  try {
    await writeIndex(c, ws.name);
    await writeModel(c);
  } catch {
    // generation must never fail an apply
  }
  return results;
}

export async function detectSyncSvc(
  wsId: number,
): Promise<SyncReport & { syncedAt: string | null }> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const row = q.getSyncState(wsId);
  const stored: Manifest | null = row ? (JSON.parse(row.manifest) as Manifest) : null;
  const report = await detectChanges(connectorFor(ws), stored);
  return { ...report, syncedAt: row?.synced_at ?? null };
}

export async function applySyncSvc(wsId: number): Promise<{
  report: SyncReport;
  scaffold: string;
  syncedAt: string | null;
}> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const c = connectorFor(ws);
  const row = q.getSyncState(wsId);
  const stored: Manifest | null = row ? (JSON.parse(row.manifest) as Manifest) : null;

  // 1. detect drift (pre-write)
  const report = await detectChanges(c, stored);

  // 2. re-derive projections so they match the files again
  try {
    await writeIndex(c, ws.name);
    await writeModel(c);
  } catch {
    /* generation is best-effort */
  }

  // 3. journal the sync (skipped on first baseline to keep it quiet)
  if (!report.firstRun && diffCount(report.diff) > 0) {
    try {
      const declRaw = await c.read("_Workspace.yaml");
      const journal = (declRaw ? parseWorkspaceYaml(declRaw) : null)?.mounts?.journal ?? "Journal";
      const d = report.diff;
      await journalAgentActivity(
        c,
        journal,
        `synced — ${d.modified.length} modified, ${d.added.length} added, ${d.removed.length} removed; projections refreshed`,
      );
    } catch {
      /* journal best-effort */
    }
  }

  // 4. re-snapshot (captures the journal write + refreshed state) so the same
  //    drift isn't reported again next time
  const finalManifest = await buildManifest(c);
  q.saveSyncState(wsId, finalManifest);

  return {
    report,
    scaffold: reflectionScaffold(report.diff, row?.synced_at ?? null),
    syncedAt: row?.synced_at ?? null,
  };
}

export async function getRulesSvc(wsId: number) {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const c = connectorFor(ws);
  const raw = await c.read("_Workspace.yaml");
  const decl = raw ? parseWorkspaceYaml(raw) : null;
  const { resolveRuleConfig } = await import("./rules");
  const cfg = resolveRuleConfig(decl);
  return {
    rules: cfg.rules,
    conventions: cfg.conventions,
    profile: ws.profile,
  };
}

// Persist rule overrides + tunable conventions into _Workspace.yaml, then
// regenerate AGENTS.md so the rulebook matches. Only non-default overrides are
// written, keeping the file clean.
export async function saveRulesSvc(
  wsId: number,
  overrides: Record<string, string>,
  conventions: { relationship_predicates?: string[]; wip_required_sections?: string[] },
): Promise<{ ok: true }> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const c = connectorFor(ws);
  const YAML = (await import("yaml")).default;
  const raw = await c.read("_Workspace.yaml");
  if (!raw) throw new Error("Workspace has no _Workspace.yaml");
  const doc = YAML.parse(raw) as Record<string, unknown>;

  const cleanOverrides: Record<string, string> = {};
  for (const [id, sev] of Object.entries(overrides)) {
    if (["off", "error", "warn", "info"].includes(sev)) cleanOverrides[id] = sev;
  }
  const rulesBlock: Record<string, unknown> = {};
  if (Object.keys(cleanOverrides).length) rulesBlock.overrides = cleanOverrides;
  const conv: Record<string, unknown> = {};
  if (conventions.relationship_predicates?.length)
    conv.relationship_predicates = conventions.relationship_predicates;
  if (conventions.wip_required_sections?.length)
    conv.wip_required_sections = conventions.wip_required_sections;
  if (Object.keys(conv).length) rulesBlock.conventions = conv;

  if (Object.keys(rulesBlock).length) doc.rules = rulesBlock;
  else delete doc.rules;

  await c.write("_Workspace.yaml", YAML.stringify(doc), { overwrite: true });

  // Regenerate AGENTS.md from the new effective config
  try {
    const newDecl = parseWorkspaceYaml(YAML.stringify(doc));
    const mounts = {
      areas: newDecl?.mounts?.areas ?? [],
      journal: newDecl?.mounts?.journal ?? "Journal",
      templates: newDecl?.mounts?.templates ?? "Templates",
      archive: newDecl?.mounts?.archive ?? "Archive",
      context: newDecl?.mounts?.context,
      entities: newDecl?.mounts?.entities,
    };
    const { renderAgentsMd } = await import("./scaffold");
    const agents = renderAgentsMd(
      {
        workspaceName: ws.name,
        ownerName: process.env.HUB_OWNER_NAME ?? ws.name,
        ownerEmail: process.env.HUB_OWNER_EMAIL ?? ws.account_email ?? "owner@unknown",
        profile: ws.profile,
      },
      mounts,
      newDecl,
    );
    await c.write("AGENTS.md", agents, { overwrite: true });
    const journal = newDecl?.mounts?.journal ?? "Journal";
    await journalAgentActivity(c, journal, `rule config updated; AGENTS.md regenerated`);
  } catch {
    /* AGENTS regen / journal best-effort */
  }
  return { ok: true };
}

export async function regenerateIndexSvc(wsId: number): Promise<boolean> {
  const ws = q.getWorkspace(wsId);
  if (!ws) throw new Error(`Workspace ${wsId} not found`);
  const c = connectorFor(ws);
  const ok = await writeIndex(c, ws.name);
  try {
    await writeModel(c);
  } catch {}
  if (ok) {
    try {
      const declRaw = await c.read("_Workspace.yaml");
      const decl = declRaw ? parseWorkspaceYaml(declRaw) : null;
      await journalAgentActivity(
        c,
        decl?.mounts?.journal ?? "Journal",
        `${ws.name} — regenerated _Index.md`,
      );
    } catch {
      // journal is best-effort here too
    }
  }
  return ok;
}
