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
    required_root_files: string[];
    required_capabilities: string[];
    areas_min: number;
  };
  scopes: {
    context_file: string;
    optional_files: string[];
    overview_required_sections: string[];
    recent_activity_cap: number;
    forbidden_subfolders: string[];
  };
  collections: {
    wip_notes: { suffix: string; file_pattern: string; required_sections: string[] };
    journal: { path_pattern: string; agent_activity_heading: string };
  };
  rules: LintRuleDef[];
  profiles: Record<string, ProfileDef>;
};

export type ProfileDef = {
  default_topology?: { areas: string[]; journal: string; templates: string; archive: string };
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

export function loadTemplate(name: string): string {
  return fs.readFileSync(path.join(SPEC_DIR, "templates", name), "utf-8");
}

export function ruleDef(id: string): LintRuleDef {
  const def = loadManifest().rules.find((r) => r.id === id);
  if (!def) throw new Error(`Unknown lint rule: ${id}`);
  return def;
}
