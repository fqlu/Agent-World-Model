"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import YAML from "yaml";
import { q } from "@/lib/db";
import {
  ProfileError,
  archiveProfile,
  createProfile,
  isValidProfileName,
  profileExists,
  resetProfileTemplate,
  saveProfileSettings,
  saveProfileTemplate,
  type ProfileSettings,
} from "@/lib/profiles";

export type FormState = { error?: string; message?: string };

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function usedBy(name: string): string[] {
  return q
    .listWorkspaces()
    .filter((w) => w.profile === name)
    .map((w) => w.name);
}

function folderName(label: string, value: string, required: boolean): string | undefined {
  if (!value) {
    if (required) throw new ProfileError(`${label} folder is required.`);
    return undefined;
  }
  if (/[\\/]/.test(value) || value.startsWith(".")) {
    throw new ProfileError(
      `${label} folder "${value}" must be a single folder name (no slashes, not starting with a dot).`,
    );
  }
  return value;
}

function parseSettings(fd: FormData): ProfileSettings {
  const areas = list(str(fd, "areas"));
  if (!areas.length) throw new ProfileError("Declare at least one area (the protocol requires one).");
  areas.forEach((a) => folderName("Area", a, true));
  const topology = {
    areas,
    journal: folderName("Journal", str(fd, "journal"), true)!,
    templates: folderName("Templates", str(fd, "templates"), true)!,
    archive: folderName("Archive", str(fd, "archive"), true)!,
    proposals: folderName("Proposals", str(fd, "proposals"), false),
    entities: folderName("Entities", str(fd, "entities"), false),
  };
  const names = [...areas, topology.journal, topology.templates, topology.archive, topology.proposals, topology.entities].filter(Boolean);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new ProfileError(`"${dup}" is used for more than one folder.`);

  let draft: ProfileSettings["draft"] = null;
  if (fd.get("draft_enabled") === "on") {
    const working = str(fd, "working_prefix");
    const production = list(str(fd, "production_prefixes"));
    if (!working) throw new ProfileError("Draft lifecycle needs a working-file prefix (e.g. Draft_).");
    if (!production.length) throw new ProfileError("Draft lifecycle needs at least one production prefix.");
    draft = {
      working_prefix: working,
      production_prefixes: production,
      sharing_only_from_production: fd.get("sharing_only_from_production") === "on",
    };
  }

  const status_flags: Record<string, string> = {};
  for (const [i, raw] of str(fd, "status_flags").split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf(":");
    const label = at > 0 ? line.slice(0, at).trim() : "";
    const marker = at > 0 ? line.slice(at + 1).trim() : "";
    if (!label || !marker) {
      throw new ProfileError(`Status flags line ${i + 1} should look like "production: 🟢".`);
    }
    status_flags[label] = marker;
  }

  let extra: Record<string, unknown> = {};
  const extraRaw = str(fd, "extra");
  if (extraRaw) {
    let parsed: unknown;
    try {
      parsed = YAML.parse(extraRaw);
    } catch (e) {
      throw new ProfileError(`Additional settings aren't valid YAML: ${(e as Error).message.split("\n")[0]}`);
    }
    if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed))) {
      throw new ProfileError("Additional settings must be YAML key/value pairs.");
    }
    extra = (parsed ?? {}) as Record<string, unknown>;
  }

  return {
    description: str(fd, "description"),
    topology,
    draft,
    status_flags,
    root_file_allowance: list(str(fd, "root_file_allowance")),
    extra,
  };
}

function failure(e: unknown): FormState {
  if (e instanceof ProfileError) return { error: e.message };
  throw e;
}

export async function createProfileAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const name = str(fd, "name").toLowerCase();
  try {
    createProfile({ name, description: str(fd, "description"), from: str(fd, "from") || null });
  } catch (e) {
    return failure(e);
  }
  revalidatePath("/profiles");
  redirect(`/profiles/${name}`);
}

export async function saveProfileAction(
  name: string,
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  try {
    saveProfileSettings(name, parseSettings(fd));
  } catch (e) {
    return failure(e);
  }
  revalidatePath("/profiles");
  revalidatePath(`/profiles/${name}`);
  const users = usedBy(name);
  return {
    message: users.length
      ? `Saved. Audits of ${users.join(", ")} use it straight away; their AGENTS.md picks it up the next time it's regenerated (saving the workspace's Rules page, or an Adopt proposal).`
      : "Saved.",
  };
}

export async function deleteProfileAction(name: string): Promise<FormState> {
  if (!isValidProfileName(name) || !profileExists(name)) return { error: `Profile "${name}" doesn't exist.` };
  const users = usedBy(name);
  if (users.length) {
    return {
      error: `Still used by ${users.join(", ")}. Remove those workspaces from the app first.`,
    };
  }
  let archivedTo: string;
  try {
    archivedTo = archiveProfile(name);
  } catch (e) {
    return failure(e);
  }
  revalidatePath("/profiles");
  redirect(`/profiles?deleted=${encodeURIComponent(name)}&archived=${encodeURIComponent(archivedTo)}`);
}

export async function saveTemplateAction(
  name: string,
  file: string,
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  let result: "saved" | "reset";
  try {
    result = saveProfileTemplate(name, file, String(fd.get("content") ?? ""));
  } catch (e) {
    return failure(e);
  }
  revalidatePath(`/profiles/${name}`);
  revalidatePath(`/profiles/${name}/templates/${encodeURIComponent(file)}`);
  return {
    message:
      result === "reset"
        ? "Matches the base template, so the override was removed — this profile now uses the base template."
        : file === "AGENTS.md"
          ? "Saved. Workspaces on this profile pick it up the next time their AGENTS.md is regenerated (saving their Rules page, or an Adopt proposal)."
          : "Saved. New workspaces get it when scaffolded; existing workspaces keep the copy already in their Templates folder.",
  };
}

export async function resetTemplateAction(name: string, file: string): Promise<FormState> {
  try {
    resetProfileTemplate(name, file);
  } catch (e) {
    return failure(e);
  }
  revalidatePath(`/profiles/${name}`);
  revalidatePath(`/profiles/${name}/templates/${encodeURIComponent(file)}`);
  return {
    message: "Reset to the base template. The previous version was moved to profiles/_archive/.",
  };
}
