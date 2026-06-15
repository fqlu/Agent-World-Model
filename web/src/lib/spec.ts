import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

// The spec lives in the repo at <repo root>/spec. The app runs from web/.
const SPEC_DIR = process.env.SPEC_DIR ?? path.resolve(process.cwd(), "..", "spec");

export type LintRuleDef = { id: string; severity: "error" | "warn" | "info"; summary: string };

export type SpecManifest = {
  spec_version: string;
  workspace: {
    manifest_file: string;
    rulebook_file: string;
    required_root_files: string[];
    optional_root_files?: string[];
    required_capabilities: string[];
    areas_min: number;
  };
  scopes: {
    context_file: string;
    promotion: string;
    entity_overview_required: boolean;
    optional_files: string[];
    recommended_sections: string[];
  };
  collections: {
    wip_notes: { suffix: string; file_pattern: string; required_sections: string[] };
    journal: { path_pattern: string; agent_activity_heading: string };
  };
  entities?: {
    default_mount: string;
    template: string;
    kinds: string[];
    required_frontmatter: string[];
  };
  relationships?: {
    stored_in: string;
    predicates: string[];
    target: string;
  };
  rules: LintRuleDef[];
  profiles: Record<string, ProfileDef>;
};

export type ProfileDef = {
  default_topology?: {
    areas: string[];
    journal: string;
    templates: string;
    archive: string;
    context?: string;
  };
  draft_lifecycle?: { working_prefix: string; production_prefixes: string[] };
  status_flags?: Record<string, string>;
  root_file_allowance?: string[];
  [k: string]: unknown;
};

let cached: SpecManifest | null = null;

export function loadManifest(): SpecManifest {
  if (!cached) {
    const raw = fs.readFileSync(path.join(SPEC_DIR, "manifest.yaml"), "utf-8");
    cached = YAML.parse(raw) as SpecManifest;
  }
  return cached;
}

// Profile template overrides (spec/templates/profiles/<profile>/<name>)
// take precedence over the organisation-neutral base templates.
export function loadTemplate(name: string, profile?: string): string {
  if (profile) {
    const override = path.join(SPEC_DIR, "templates", "profiles", profile, name);
    if (fs.existsSync(override)) return fs.readFileSync(override, "utf-8");
  }
  return fs.readFileSync(path.join(SPEC_DIR, "templates", name), "utf-8");
}

export function listProfiles(): string[] {
  return Object.keys(loadManifest().profiles);
}

export function relationshipPredicates(): string[] {
  return loadManifest().relationships?.predicates ?? [];
}

export function ruleDef(id: string): LintRuleDef {
  const def = loadManifest().rules.find((r) => r.id === id);
  if (!def) throw new Error(`Unknown lint rule: ${id}`);
  return def;
}
