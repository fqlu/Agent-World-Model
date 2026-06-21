"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { q } from "@/lib/db";
import {
  runAuditSvc,
  createProposalSvc,
  applyProposalSvc,
  regenerateIndexSvc,
} from "@/lib/service";

export async function createWorkspaceAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "local");
  const root = String(formData.get("root") ?? "").trim();
  const accountEmail = String(formData.get("account_email") ?? "").trim() || null;
  const profile = String(formData.get("profile") ?? "").trim() || "incubeta";
  if (!name || !root) throw new Error("Name and root are required");
  const id = q.createWorkspace({ name, kind, root, account_email: accountEmail, profile });
  redirect(`/w/${id}`);
}

export async function regenerateIndexAction(wsId: number) {
  await regenerateIndexSvc(wsId);
  revalidatePath(`/w/${wsId}`);
  redirect(`/w/${wsId}`);
}

export async function removeWorkspaceAction(wsId: number) {
  // Only removes the app's reference — the Drive folder and files are untouched.
  q.deleteWorkspace(wsId);
  revalidatePath("/");
  redirect("/");
}

export async function runAuditAction(wsId: number) {
  const { auditId } = await runAuditSvc(wsId);
  redirect(`/w/${wsId}/audit/${auditId}`);
}

export async function createProposalAction(wsId: number, kind: "scaffold" | "adopt") {
  const pid = await createProposalSvc(wsId, kind);
  redirect(`/w/${wsId}/proposal/${pid}`);
}

export async function applyProposalAction(
  wsId: number,
  proposalId: number,
  formData: FormData,
) {
  const selected = formData
    .getAll("op")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n));
  await applyProposalSvc(proposalId, selected);
  revalidatePath(`/w/${wsId}/proposal/${proposalId}`);
  redirect(`/w/${wsId}/proposal/${proposalId}`);
}
