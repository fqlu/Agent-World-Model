import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  loadManifest,
  PROFILES_DIR,
  BASE_TEMPLATES_DIR,
  PROFILE_NAME_RE,
  type ProfileDef,
  type ProfileTopology,
} from "./spec";

// Profiles are org-specific presets that live OUTSIDE the protocol spec, one
// folder each: profiles/<name>/profile.yaml + optional templates/ overrides.
// Every profile is custom (created, edited and deleted from the app). Nothing
// is hard-deleted: a deleted profile or reset template moves to
// profiles/_archive/. Files are read fresh on every call so hand edits show up.

const PROFILE_FILE = "profile.yaml";
const TEMPLATES_SUBDIR = "templates";
const ARCHIVE_DIR = "_archive";

export class ProfileError extends Error {}

// Keys the settings form owns. Anything else in profile.yaml is preserved and
// editable as "additional settings" YAML.
export const MANAGED_KEYS = [
  "description",
  "default_topology",
  "draft_lifecycle",
  "status_flags",
  "root_file_allowance",
] as const;

// Templates the app renders WITH a profile (scaffold + adopt). The other files
// in spec/templates/ are protocol references, not profile-overridable.
export const PROFILE_TEMPLATES: Array<{ file: string; usedFor: string }> = [
  {
    file: "AGENTS.md",
    usedFor:
      "The agent rulebook generated at the workspace root (scaffold, adopt, and AGENTS.md regeneration).",
  },
  {
    file: "_Overview.md",
    usedFor:
      "Installed as “_Overview Template.md”, and the body of new scope overviews created during adoption.",
  },
  { file: "WIP Note.md", usedFor: "Installed as “WIP Note Template.md”." },
  { file: "Daily Journal.md", usedFor: "Installed as “Daily Journal Template.md”." },
  { file: "_Tasks.md", usedFor: "Installed as “_Tasks Template.md”." },
];

// AGENTS.md is rendered by scaffold.renderAgentsMd, which fills these.
export const AGENTS_PLACEHOLDERS: Array<{ token: string; meaning: string }> = [
  { token: "{{spec_version}}", meaning: "protocol version (audit ST-005 expects it)" },
  { token: "{{profile}}", meaning: "profile name (audit ST-005 expects it)" },
  { token: "{{owner_name}}", meaning: "workspace owner's name" },
  { token: "{{owner_email}}", meaning: "workspace owner's email" },
  { token: "{{map}}", meaning: "the declared folder topology" },
  { token: "{{rules_summary}}", meaning: "enforced audit rules" },
  { token: "{{house_rules}}", meaning: "the workspace's house rules" },
  { token: "{{profile_rules}}", meaning: "this profile's lifecycle, flags and root files" },
];

export function isValidProfileName(name: string): boolean {
  return PROFILE_NAME_RE.test(name);
}

function assertName(name: string) {
  if (!isValidProfileName(name)) {
    throw new ProfileError(
      `"${name}" isn't a valid profile name — use 1–40 lowercase letters, digits or hyphens, starting with a letter or digit.`,
    );
  }
}

function profileDir(name: string): string {
  assertName(name);
  return path.join(PROFILES_DIR, name);
}

function profileFile(name: string): string {
  return path.join(profileDir(name), PROFILE_FILE);
}

export function listProfiles(): string[] {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  return fs
    .readdirSync(PROFILES_DIR, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        isValidProfileName(d.name) &&
        fs.existsSync(path.join(PROFILES_DIR, d.name, PROFILE_FILE)),
    )
    .map((d) => d.name)
    .sort();
}

export function profileExists(name: string): boolean {
  return isValidProfileName(name) && fs.existsSync(path.join(PROFILES_DIR, name, PROFILE_FILE));
}

function parseProfileYaml(name: string, raw: string): ProfileDef {
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (e) {
    throw new ProfileError(
      `profiles/${name}/${PROFILE_FILE} is not valid YAML: ${(e as Error).message.split("\n")[0]}`,
    );
  }
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProfileError(`profiles/${name}/${PROFILE_FILE} must be a YAML mapping.`);
  }
  return parsed as ProfileDef;
}

// The profile as defined on disk, or null if it doesn't exist. Throws
// ProfileError if the file is malformed.
export function getProfile(name: string): ProfileDef | null {
  if (!profileExists(name)) return null;
  return parseProfileYaml(name, fs.readFileSync(profileFile(name), "utf-8"));
}

// For UI listings: never throws, reports a malformed file instead.
export function readProfile(name: string): { def: ProfileDef | null; error: string | null } {
  try {
    return { def: getProfile(name), error: null };
  } catch (e) {
    return { def: null, error: (e as Error).message };
  }
}

// What the engine (scaffold, adopt, linter) should apply for a workspace's
// profile name: the profile if it exists, else the protocol baseline. A
// missing or broken profile degrades to the baseline rather than failing.
export function resolveProfile(name: string | undefined | null): ProfileDef {
  if (name) {
    const { def } = readProfile(name);
    if (def) return def;
  }
  return baselineProfile();
}

export function baselineProfile(): ProfileDef {
  const b = loadManifest().baseline;
  return {
    default_topology: b?.default_topology ?? {
      areas: ["Projects"],
      journal: "Journal",
      templates: "Templates",
      archive: "Archive",
      context: "_Context",
    },
    root_file_allowance: b?.root_file_allowance ?? [],
  };
}

export function extraSettings(def: ProfileDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(def)) {
    if (!(MANAGED_KEYS as readonly string[]).includes(k)) out[k] = v;
  }
  return out;
}

export function profileUsesTemplateOverrides(name: string): string[] {
  const dir = path.join(profileDir(name), TEMPLATES_SUBDIR);
  return PROFILE_TEMPLATES.map((t) => t.file).filter((f) => fs.existsSync(path.join(dir, f)));
}

// ---------------------------------------------------------------- mutations

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
}

function headerComment(name: string): string {
  return ` Profile: ${name} — format documented in profiles/README.md`;
}

export function createProfile(opts: {
  name: string;
  description: string;
  from?: string | null;
}): void {
  const name = opts.name.trim();
  assertName(name);
  const dir = profileDir(name);
  if (fs.existsSync(dir)) throw new ProfileError(`A profile named "${name}" already exists.`);

  if (opts.from) {
    if (!profileExists(opts.from)) throw new ProfileError(`Profile "${opts.from}" doesn't exist.`);
    fs.cpSync(profileDir(opts.from), dir, { recursive: true });
    // Drop the source's leading header comment; the copy gets its own.
    const raw = fs.readFileSync(path.join(dir, PROFILE_FILE), "utf-8").replace(/^(?:#.*\r?\n)+\s*/, "");
    const doc = YAML.parseDocument(raw);
    doc.commentBefore = headerComment(name);
    if (opts.description.trim()) doc.set("description", opts.description.trim());
    else doc.delete("description");
    fs.writeFileSync(path.join(dir, PROFILE_FILE), doc.toString());
    return;
  }

  const base = baselineProfile();
  const doc = new YAML.Document({
    ...(opts.description.trim() ? { description: opts.description.trim() } : {}),
    default_topology: base.default_topology,
    root_file_allowance: base.root_file_allowance ?? [],
  });
  doc.commentBefore = headerComment(name);
  flowShortLists(doc);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, PROFILE_FILE), doc.toString());
}

export type ProfileSettings = {
  description: string;
  topology: ProfileTopology;
  draft: {
    working_prefix: string;
    production_prefixes: string[];
    sharing_only_from_production: boolean;
  } | null;
  status_flags: Record<string, string>;
  root_file_allowance: string[];
  extra: Record<string, unknown>;
};

// Rewrites only the managed keys + the extra keys, keeping key order and
// comments on anything untouched.
export function saveProfileSettings(name: string, s: ProfileSettings): void {
  if (!profileExists(name)) throw new ProfileError(`Profile "${name}" doesn't exist.`);
  for (const k of Object.keys(s.extra)) {
    if ((MANAGED_KEYS as readonly string[]).includes(k)) {
      throw new ProfileError(
        `"${k}" is edited with the form above — remove it from Additional settings.`,
      );
    }
  }
  const file = profileFile(name);
  const doc = YAML.parseDocument(fs.readFileSync(file, "utf-8"));
  if (doc.errors.length) {
    throw new ProfileError(`profiles/${name}/${PROFILE_FILE} is not valid YAML; fix it by hand first.`);
  }

  const setOrDelete = (key: string, value: unknown, keep: boolean) => {
    if (keep) doc.set(key, doc.createNode(value));
    else doc.delete(key);
  };

  setOrDelete("description", s.description, Boolean(s.description));
  const t = s.topology;
  setOrDelete(
    "default_topology",
    {
      areas: t.areas,
      journal: t.journal,
      templates: t.templates,
      archive: t.archive,
      ...(t.context ? { context: t.context } : {}),
      ...(t.entities ? { entities: t.entities } : {}),
    },
    true,
  );
  setOrDelete("draft_lifecycle", s.draft, s.draft !== null);
  setOrDelete("status_flags", s.status_flags, Object.keys(s.status_flags).length > 0);
  setOrDelete("root_file_allowance", s.root_file_allowance, true);

  const current = doc.toJS() as Record<string, unknown> | null;
  for (const k of Object.keys(current ?? {})) {
    if (!(MANAGED_KEYS as readonly string[]).includes(k) && !(k in s.extra)) doc.delete(k);
  }
  for (const [k, v] of Object.entries(s.extra)) doc.set(k, doc.createNode(v));

  flowShortLists(doc);
  fs.writeFileSync(file, doc.toString());
}

// Keep the short string lists readable: areas: [Clients, Internal].
function flowShortLists(doc: YAML.Document) {
  for (const p of [
    ["default_topology", "areas"],
    ["draft_lifecycle", "production_prefixes"],
    ["root_file_allowance"],
  ]) {
    const node = doc.getIn(p, true);
    if (YAML.isSeq(node)) node.flow = true;
  }
}

function archiveTarget(label: string): string {
  const dir = path.join(PROFILES_DIR, ARCHIVE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${label}-${timestamp()}`);
}

// Moves the profile to profiles/_archive/<name>-<timestamp>/. Callers must
// first check no workspace uses it (the DB lives outside this module).
export function archiveProfile(name: string): string {
  if (!profileExists(name)) throw new ProfileError(`Profile "${name}" doesn't exist.`);
  const target = archiveTarget(name);
  fs.renameSync(profileDir(name), target);
  return path.relative(path.dirname(PROFILES_DIR), target);
}

// ---------------------------------------------------------------- templates

function assertTemplate(file: string) {
  if (!PROFILE_TEMPLATES.some((t) => t.file === file)) {
    throw new ProfileError(`"${file}" isn't a profile-overridable template.`);
  }
}

function overridePath(name: string, file: string): string {
  assertTemplate(file);
  return path.join(profileDir(name), TEMPLATES_SUBDIR, file);
}

export function readProfileTemplate(
  name: string,
  file: string,
): { content: string; base: string; overridden: boolean } {
  const base = fs.readFileSync(path.join(BASE_TEMPLATES_DIR, file), "utf-8");
  const p = overridePath(name, file);
  const overridden = fs.existsSync(p);
  return { content: overridden ? fs.readFileSync(p, "utf-8") : base, base, overridden };
}

// Saving content identical to the base template removes the override instead,
// so the profile keeps tracking base-template improvements.
export function saveProfileTemplate(name: string, file: string, content: string): "saved" | "reset" {
  if (!profileExists(name)) throw new ProfileError(`Profile "${name}" doesn't exist.`);
  const normalized = content.replace(/\r\n?/g, "\n");
  const { base, overridden } = readProfileTemplate(name, file);
  if (normalized === base) {
    if (overridden) resetProfileTemplate(name, file);
    return "reset";
  }
  const p = overridePath(name, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, normalized);
  return "saved";
}

// Moves the override to profiles/_archive/<name>-template-<ts>/templates/<file>.
export function resetProfileTemplate(name: string, file: string): void {
  const p = overridePath(name, file);
  if (!fs.existsSync(p)) return;
  const target = path.join(archiveTarget(`${name}-template`), TEMPLATES_SUBDIR, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(p, target);
}
