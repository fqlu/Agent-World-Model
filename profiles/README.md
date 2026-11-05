# Profiles

A **profile** is an organisation-specific preset you pick when creating a
workspace: its starter folder layout, draft lifecycle, status flags, extra
root files, and template overrides. Profiles are not part of the Drive Context
Protocol: the spec in `../spec/` stays organisation-neutral, and every profile
here is custom.

Manage them from the app's **Profiles** page (create, clone, edit, edit
templates, delete). You can also edit these files by hand; the app reads them
fresh on every request.

## Layout

```
profiles/
  <name>/
    profile.yaml        ← settings (format below)
    templates/          ← optional overrides of ../spec/templates/<file>
  _archive/             ← deleted profiles, timestamped (never hard-deleted)
```

Names are lowercase letters, digits and hyphens. Folders starting with `_` or
`.` are ignored. A template missing from `templates/` falls back to the
neutral base template in `spec/templates/`.

## profile.yaml

```yaml
description: One line shown in the profile picker.
default_topology:            # starter layout for scaffolding, not law
  areas: [Clients, Internal] # at least one
  journal: Journal
  templates: Templates
  archive: Archive
  context: _Context          # optional
  entities: _Entities        # optional
draft_lifecycle:             # optional
  working_prefix: "Draft_"
  production_prefixes: ["[INT]", "[EXT]"]
  sharing_only_from_production: true
status_flags:                # optional, label → marker
  production: "🟢"
root_file_allowance: [CLAUDE.md]   # extra files allowed at workspace root (ST-004)
# Any other keys are kept as-is (edit them under "Additional settings").
```

Changes affect workspaces that use the profile: audits pick them up straight
away, and generated files (`AGENTS.md`, installed templates) pick them up the
next time they are regenerated.

Set `PROFILES_DIR` to keep profiles somewhere else (default: this folder).
