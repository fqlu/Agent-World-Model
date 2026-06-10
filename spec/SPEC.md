# Drive Context Protocol — Specification

**Version:** 0.1.0 (draft)
**Status:** 🟠 Draft — under review by James Lu
**Reference implementation:** Incubeta Master Folder (jamesfqlu@gmail.com Drive)

---

## 1. Purpose

This spec defines a standard structure for a knowledge Drive that both humans and
AI agents can navigate, edit, and extend without ambiguity. It exists so that:

- **Agents retrieve by address, not by search.** Any agent that knows the protocol
  knows exactly where context lives for a given client, project, or day — no
  embeddings, no retrieval guesswork, full transparency about what was read.
- **People are interoperable.** Two people running this structure on separate
  Drives can hand work (and agents) to each other; the rituals are identical.
- **Memory is durable and inspectable.** What agents and humans did, decided, and
  still owe is written into the structure itself, in plain markdown.

A Drive that follows this spec is called a **workspace**.

### Design principles

1. **Files are the database.** Markdown and folders are canonical. Any app or
   index built on top must be rebuildable from the files alone.
2. **Humans and agents share one substrate.** No agent-only side-channel state.
   Anything an agent knows or did is readable (and editable) by a human.
3. **Non-destructive by contract.** Nothing in a workspace is ever deleted by an
   agent or tool — superseded material moves to `Archive/`.
4. **Convention over enforcement, enforcement over chaos.** The spec defines a
   small set of MUSTs (machine-lintable) and a larger set of SHOULDs. Tools lint
   and propose; humans approve.
5. **Core vs profile.** Rules in this spec are universal. Organisation-specific
   rituals (e.g. Incubeta's `Draft_` lifecycle) live in a named **profile**
   (§10) layered on top.

Keywords MUST / SHOULD / MAY follow RFC 2119 usage. Every MUST and SHOULD maps
to a lint rule in §9 and in `manifest.yaml`.

---

## 2. Workspace topology (declarative)

A workspace's folder layout is **data, not spec**. The spec fixes only the
primitives — scopes (§3), collections (§4), context files (§6), and the three
capabilities **journal**, **templates**, and **archive** — and each workspace
declares where those primitives are mounted in a root topology manifest,
`_Workspace.yaml`:

```yaml
spec_version: 0.1.0
profile: incubeta
mounts:
  areas: [Clients, Internal]   # scope-bearing folders (≥1, any names)
  journal: Journal             # memory capability (§7)
  templates: Templates         # canonical templates for this workspace
  archive: Archive             # non-destruction capability (§8)
```

- The workspace root MUST contain `_Workspace.yaml`, `_PROTOCOL.md`, and
  `_Overview.md`. `[ST-001]`
- Every mount declared in `_Workspace.yaml` MUST exist. `[ST-002]`
- The three capabilities — journal, templates, archive — MUST each be mounted
  somewhere; their paths and names are free. Without them the memory (§7) and
  safety (§8) contracts have no home. `[ST-003]`
- At least one **area** MUST be declared. Areas hold scopes; their names are
  free (`Clients`, `Projects`, `Research`…). `[ST-003]`
- Root items not declared in the manifest are flagged for triage. Profiles MAY
  whitelist extra root files (e.g. `CLAUDE.md`). `[ST-004]`
- `_PROTOCOL.md` is generated from the spec + profile + `_Workspace.yaml` and
  MUST stay in sync with it — its Map section *is* the declared topology, so
  agents learn the layout by reading one file. Retrieval by address survives
  because the address book is declared, not assumed. `[ST-005]`

**Profiles ship starter topologies, not laws.** The `incubeta` profile default
is `Clients/ + Internal/ + Journal/ + Templates/ + Archive/` (the reference
workspace). A teammate might mount `Projects/ + Knowledge/` instead; both lint
clean, and both speak the same protocol.

> **Divergence from reference:** the reference workspace keeps `CLAUDE.md` at
> root with no root `_Overview.md` or `_PROTOCOL.md`. Under this spec the agent
> rulebook is the tool-agnostic `_PROTOCOL.md`; a `CLAUDE.md` (allowed by the
> Incubeta profile) should reduce to pointers at `_PROTOCOL.md` plus
> tool-specific notes.

---

## 3. Scopes

A **scope** is a folder that represents a unit of work or knowledge and carries
its own context file. Scopes nest:

| Level | Name | Example | Parent |
|---|---|---|---|
| 1 | **Entity** | `Hanesbrands (Hanes)/` | an area |
| 2 | **Unit** (product / function / brand) | `Hanes \| Offline CAPI/` | entity |
| 3+ | **Sub-project** | `Hanes \| Offline CAPI \| QA/` | unit or sub-project |

- Every scope MUST contain an `_Overview.md` conforming to §6.1. `[SC-001]`
- A scope MAY contain working files directly (reports, briefs, data exports).
  Per-type subfolders (`Reports/`, `Briefs/`) SHOULD NOT be created. `[SC-002]`
- A scope MAY contain **collections** (§4) and child scopes.

### Non-scope folders

Two kinds of folders are not scopes and need no `_Overview.md`:

- **Collections** (§4) — recognised by reserved suffix (e.g. `… | WIP Notes`).
- **Asset folders** — ad-hoc groupings of files (e.g. `… | QA Reports`).
  Asset folders SHOULD be listed in the parent overview's `## Reference`
  section so they remain discoverable. `[SC-003]`

A folder inside an area that has no `_Overview.md` and no reserved suffix is
flagged for triage: it is either a scope missing its overview (fix) or an asset
folder missing registration (fix differently). `[SC-004]`

---

## 4. Collections

Collections are folders of homogeneous, dated records.

### 4.1 WIP Notes

- Name: `<scope pipe-name> | WIP Notes`.
- Contents: meeting / working-session notes named `YYYY-MM-DD.md`, following
  the WIP Note template. Same-day follow-ups merge into the day's file rather
  than creating a second file. `[CL-001]` `[CL-002]`
- Placement rule: notes scoped to one unit/sub-project live in that scope's
  WIP Notes; cross-unit entity meetings live in the entity-level WIP Notes.

### 4.2 Journal

- Path: `<journal mount>/YYYY/YYYY-MM/YYYY-MM-DD.md`. `[JR-001]`
- One file per day with activity. The journal is an **index**: one line per
  event, each line linking to where the substance lives. No substance in the
  journal itself. `[JR-002]`
- The journal is also the **agent activity log** (§7.3).

---

## 5. Naming

### 5.1 The pipe convention

Scope folders below entity level MUST be named as pipe-separated paths that
mirror their ancestry: `[NM-001]`

```
<Entity short name> | <Unit>
<Entity short name> | <Unit short name> | <Sub-project>
```

- **Short names** are declared in parentheses at the end of a folder's own
  segment — `Hanesbrands (Hanes)`, `TMCA | NVI (New Vehicle Inventory)` — and
  descendants use the short form: `Hanes | Bonds`, `TMCA | NVI | Floodlight`.
  If no parenthesised short name exists, the full segment is the short name.
- Rationale: every folder is self-describing in Drive search results and in
  agent tool output, at the cost of renames cascading. Tools MUST treat a
  parent rename as a propagating operation (§8).

### 5.2 Special files

- Context files are prefixed `_` so they sort first: `_Overview.md`,
  `_Tasks.md`, `_PROTOCOL.md`.
- Dates anywhere in names MUST be ISO `YYYY-MM-DD` (or `YYYY-MM` for months).
  `[NM-002]`
- Entity folder names MUST NOT contain pipes. `[NM-003]`

---

## 6. Context files

### 6.1 `_Overview.md` (required per scope)

The workhorse. Required sections, in order: `[OV-001]`

| Section | Content |
|---|---|
| `## What it is` | 1–3 sentences: what this scope is, the org's remit, who owns it |
| `## Active workstreams` | bullet list: **name** — one-line status → folder/file link |
| `## Key people` | client side / org side, with roles and emails where known |
| `## Recent activity` | newest-first dated one-liners → links; cap ~10 `[OV-002]` |
| `## Reference` | links: key docs, dashboards, production folders, related scopes |

Additional sections MAY be inserted between `Key people` and `Recent activity`
(the reference workspace uses `## Brands`, `## Infrastructure` — both good
practice for entity scopes with shared stack details).

The **root** `_Overview.md` uses the same skeleton, where "What it is"
identifies the workspace owner and what the workspace covers. (Topology is
declared in `_Workspace.yaml`, not here.)

### 6.2 `_Tasks.md` (optional per scope)

Open commitments that outlive a single meeting. Format:

```markdown
# <Scope> — Tasks

## Open
- [ ] YYYY-MM-DD · @owner — task description → [source](link)

## Done (recent)
- [x] YYYY-MM-DD · @owner — task description → [outcome](link)
```

- Agents MUST read `_Tasks.md` (if present) before starting work in a scope
  and MUST move completed items to `## Done` rather than deleting them.
  `[TK-001]`
- Action items in WIP notes are the *origin* of tasks; promoting one to
  `_Tasks.md` is a judgement call — promote what must survive the week.

### 6.3 `_PROTOCOL.md` (workspace root, required)

The agent-facing rulebook, generated by the provisioning tool from this spec,
the active profile, and `_Workspace.yaml`. It declares the spec version and
profile, renders the declared topology as its Map section, and condenses the
operating rules (§7–8) so that *any* agent — regardless of vendor — can be
pointed at the workspace root and behave correctly. `[ST-005]`

---

## 7. Memory

The workspace gives agents three memory surfaces, from coarse to fine:

1. **`_Overview.md` / Recent activity** — curated highlights. The first thing
   read when entering a scope; capped so it stays signal.
2. **Journal** — the chronological record. "What happened on/around date X,
   across everything?"
3. **WIP Notes + `_Tasks.md`** — full substance and open loops per scope.

### 7.3 Agent activity attribution

Any agent session that creates, edits, moves, or archives files MUST append to
that day's journal entry, under a `## Agent activity` heading: `[JR-003]`

```markdown
## Agent activity
- HH:MM · <agent/tool name> · <scope> — what was done → [link]
```

This is the transparency contract: a human can always reconstruct what agents
did to the workspace and when, with no tool-specific log access.

---

## 8. Operating rules (humans and agents)

1. **Read before write.** Entering a scope: read its `_Overview.md`, then
   `_Tasks.md` if present, then recent WIP notes as needed.
2. **Merge, don't overwrite.** Same-date WIP notes and journal files are merged
   into. Overviews are edited surgically, never regenerated wholesale.
3. **Close the loop after changes.** File changed → update the scope's
   `Recent activity` → add a journal line (agents: under `## Agent activity`).
4. **Archive, never delete.** Superseded material moves to the archive mount,
   preserving its path relative to the workspace root
   (`Archive/Clients/Hanes…/file.md`). The move is journaled. `[AR-001]`
5. **Propose, then apply.** Structural operations (renames, moves, new scopes,
   adoption migrations) are proposed as a reviewable plan and executed only on
   human approval. Content edits within the rituals above don't need proposals.
6. **Renames cascade.** Renaming a scope with a pipe-name updates all
   descendant folder names and intra-workspace links; tools must do this
   atomically or not at all.
7. **Ask when ambiguous.** Wrong-but-confident filing is worse than a question.

---

## 9. Lint rules

Severities: **error** (violates a MUST), **warn** (violates a SHOULD),
**info** (worth a look). Machine-readable form lives in `manifest.yaml`.

| ID | Sev | Rule |
|---|---|---|
| ST-001 | error | Root contains `_Workspace.yaml`, `_PROTOCOL.md`, `_Overview.md` |
| ST-002 | error | Every mount declared in `_Workspace.yaml` exists |
| ST-003 | error | Journal, templates, and archive capabilities are mounted; ≥1 area declared |
| ST-004 | warn | No undeclared loose files / top-level folders at root |
| ST-005 | error | `_PROTOCOL.md` in sync with `_Workspace.yaml` (version, profile, map) |
| SC-001 | error | Every scope folder has `_Overview.md` |
| SC-002 | warn | No per-type subfolders (`Reports/`, `Briefs/`…) inside scopes |
| SC-003 | info | Asset folders are referenced from parent overview |
| SC-004 | warn | Area folder is unclassifiable (no overview, no reserved suffix) |
| CL-001 | error | WIP note files are named `YYYY-MM-DD.md` |
| CL-002 | warn | WIP note follows template sections (Discussion/Decisions/Actions) |
| NM-001 | error | Pipe-name prefix mirrors ancestry (short-name aware) |
| NM-002 | warn | Dates in names are ISO format |
| NM-003 | error | Entity folder names contain no pipes |
| OV-001 | error | `_Overview.md` has the five required sections in order |
| OV-002 | info | Recent activity ≤ ~10 entries, newest first |
| TK-001 | warn | `_Tasks.md` items follow the open/done format |
| JR-001 | error | Journal files at `<journal mount>/YYYY/YYYY-MM/YYYY-MM-DD.md` |
| JR-002 | info | Journal lines link out (index, not substance) |
| JR-003 | warn | File-changing agent sessions appear in `## Agent activity` |
| AR-001 | error | `Archive/` mirrors original paths; nothing deleted |

---

## 10. Profiles

A profile layers org-specific ritual onto the core. The first profile is
**`incubeta`** (full definition in `manifest.yaml`):

- **Draft lifecycle:** working files are prefixed `Draft_`; promotion to the
  production Drive strips the prefix and adds `[INT]`/`[EXT]`. Draft files
  never leave the workspace; sharing happens only from production copies.
- **Status flags:** 🟢 Production/Active · 🟡 Beta · 🟠 Draft/Pending · 🔴 Deprecated.
- **Production mapping:** client entity overviews record their production
  Drive folder ID under `## Reference`.
- **Root allowance:** `CLAUDE.md` permitted at workspace root.
- **Internal taxonomy:** `Internal/Solutions/` follows the same scope rules as
  clients (`Solutions | <Category> | <Platform>`), holding cross-client IP with
  deployments cross-linked both ways.

---

## 11. Out of scope for v0.1 (deliberate)

- **Shared zones** — multiple humans co-owning one structure (Shared Drives).
  The multi-user model for now is *same protocol, separate Drives*.
- **Modules** — domain plug-ins (first planned: GTM container audits) that
  read/write inside the structure. Modules must follow §8 like any agent.
- **Non-markdown context** — Sheets/Docs/Slides are first-class *content* but
  not *context*; context files are markdown only.
