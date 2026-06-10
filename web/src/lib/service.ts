import { q } from "./db";
import { connectorFor } from "./hub";
import { runAudit, AuditResult } from "./linter";
import { buildScaffoldPlan, ScaffoldOptions } from "./scaffold";
import { buildAdoptionPlan } from "./adopt";
import { Op, applyOps, journalAgentActivity, OpResult } from "./ops";
import { parseWorkspaceYaml } from "./workspace";

export type PlanPayload = { ops: Op[]; notes: string[] };

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
    payload = { ops: buildScaffoldPlan(scaffoldOpts(wsId)), notes: [] };
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
  return results;
}
