# DCP ↔ OKF Compatibility Note

**Status:** 🟢 Implemented (export at OKF v0.2; import-tolerant frontmatter)
**OKF reference:** Open Knowledge Format v0.2 (Google Cloud, 2026-07-25 — "trust
signals"; v0.1 2026-06-12) ·
[spec](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) ·
[blog](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/)
**Our spec:** Drive Context Protocol (DCP) v0.14

> **v0.2 update (2026-07-27).** OKF v0.2 added the trust layer this note
> originally listed as our superset: `generated: {by, at}` (deprecates
> `timestamp`), `verified:` events with `human:<id>`/`<producer>/<version>`
> actors, `sources:` frontmatter (deprecates body Citations), `status` +
> `stale_after` lifecycle, and the `Attested Computation` concept type. DCP
> v0.14 adopts these names natively (SPEC §12): our `source:
> derived|asserted` + propose-then-approve ritual now EMITS standard signals —
> a human confirm appends `verified: human:<owner>`. Remaining DCP-only
> superset: typed relationship predicates (`dcp_relations`), the lint/repair
> engine, house rules, sync. Attested Computations are on the roadmap (ops
> phase).

## Purpose

Decide, field by field, how a DCP workspace maps to an OKF bundle so that
**(a)** we can export a conformant bundle any OKF consumer can read, **(b)** we
can import a bundle and add our governance on top, and **(c)** we know exactly
what OKF cannot represent (our superset) and how we preserve it losslessly for
DCP-aware consumers while degrading gracefully for vanilla ones.

Positioning: **DCP is a governed superset of OKF.** A DCP workspace exports to
a valid OKF bundle; the governance (audit, rules, house rules, lifecycle,
provenance, sync) is the layer OKF deliberately omits and is our value-add.

---

## OKF v0.1 in one screen

- A **bundle** is a directory of markdown files. Each non-reserved `.md` is a
  **concept**.
- Frontmatter: **`type` is the only required field** (free string, no central
  registry). Recommended: `title`, `description`, `resource` (URI), `tags`,
  `timestamp` (ISO 8601). **Unknown fields MUST be preserved** by consumers.
- **Relationships = markdown links** between concepts (`/bundle/relative.md` or
  `./relative.md`). The relationship's meaning is inferred from prose — links
  are **untyped**.
- Reserved files: **`index.md`** (progressive-disclosure listing, no frontmatter
  except the root may carry `okf_version`) and **`log.md`** (change history,
  date-grouped `YYYY-MM-DD`, newest first).
- Conformance = every non-reserved `.md` parses and has a non-empty `type`.

---

## Object mapping (DCP → OKF)

| DCP | OKF | Fidelity | Notes |
|---|---|---|---|
| Workspace (the root) | Bundle (the directory) | clean | Root `index.md` gains `okf_version: "0.1"` |
| `_Index.md` (generated) | `index.md` (reserved) | clean | Same idea; emit under the reserved name. OKF index has no frontmatter except root `okf_version` |
| `Journal/YYYY/…` (per-day files) | `log.md` (single file) | clean (flatten) | Concatenate newest-first under `YYYY-MM-DD` headers on export |
| Entity file (`_Entities/<slug>.md`) | Concept | clean + superset | `kind` → `type`; see field table |
| Scope `_Overview.md` | Concept | needs `type` | Add `type: Scope` (or entity/project/etc.); sections become the concept body |
| Context group (`_Context/<slug>.md`) | Concept (`type: Group`) | clean | `members[]` → body links to member concepts |
| Typed relationship (`relations[]`) | Link (untyped) | **lossy → preserved** | Emit a markdown link (OKF-valid) **and** keep the predicate in an extra frontmatter field so DCP-aware consumers recover the type |
| `_Model.json` (generated) | (no equivalent) | n/a | Drives the export; OKF's graph is implicit in links. Their static visualiser ≈ our graph view |
| `AGENTS.md` (rulebook) | Concept (`type: Reference`/`Playbook`)? | judgement | Optional: surface house rules as a concept so consuming agents see them. The lint *engine* itself stays DCP-side |
| `_Workspace.yaml` (topology + rules) | (no equivalent) | DCP-only | Governance config, not knowledge content — not exported as concepts |
| `Archive/`, `Templates/` | excluded from bundle | clean | Not knowledge; exclude on export |

## Field mapping (DCP entity → OKF concept frontmatter)

| OKF field | Source in DCP | Notes |
|---|---|---|
| `type` *(required)* | entity `kind` (`person`/`system`/`concept`); scopes → `Scope`; groups → `Group` | OKF types are free strings, so our closed set maps directly |
| `title` | entity `name` | |
| `description` | first line of body notes / overview "What it is" | OKF wants a single sentence |
| `resource` | a canonical id/URL from `attributes` (e.g. a GTM container id, a Drive URL) | New: we should promote one attribute to `resource` |
| `tags` | `attributes` keys, context-group memberships | |
| `timestamp` | `confirmed` (ISO) | Align/alias our provenance date to OKF's `timestamp` |
| *(extra)* `source` | provenance `source` (derived/asserted) | Preserved as unknown field; OKF has no author/provenance field |
| *(extra)* `dcp_relations` | `relations[]` with predicates | Lossless type recovery for DCP-aware consumers |

---

## What exports cleanly vs. what's superset-only

**Clean (any OKF consumer reads it correctly):** entities, scopes, context
groups as typed concepts; `index.md`; `log.md`; relationships as links.

**Superset (preserved as extra frontmatter; a vanilla OKF consumer sees a
degraded-but-valid view):**
- **Typed predicates** — OKF links are untyped. We keep `dcp_relations` so the
  edge type survives DCP↔DCP; a vanilla consumer just sees a link.
- **Provenance** (`source`) — no OKF field; preserved as extra.
- **Governance** (rules, house rules, audit, lifecycle) — not knowledge
  content; stays in `_Workspace.yaml`. *This is the point of difference, not a
  gap to paper over.*

**What OKF has that we'd adopt into DCP (cheap, additive):**
- A `type` on every concept-bearing file (entities already carry `kind`).
- A `resource` URI convention.
- `timestamp` aligned to our `confirmed`.
- Recognise the reserved `index.md` / `log.md` names as equivalents of our
  `_Index.md` / journal.

---

## Round-trip behaviour

- **DCP → OKF → DCP:** lossless (predicates/provenance ride in extra fields).
- **DCP → OKF → (vanilla consumer):** valid bundle; loses predicate types and
  provenance, keeps all concepts, links, index, log.
- **(vanilla OKF) → DCP:** concepts → entities/scopes by `type`; untyped links
  → `related-to` by default (or inferred); then our audit/governance applies —
  the import is where we *add* value OKF bundles lack.

---

## Concrete Phase-1 changes (when greenlit — not built yet)

1. **Frontmatter superset:** add optional `type`, `resource`, `timestamp` to
   entity/overview frontmatter; keep richer DCP fields (OKF preserves unknowns).
2. **Export OKF bundle:** walk `_Model.json` + files → write a conformant OKF
   directory (concept-per-file, reserved `index.md` + `log.md`, root
   `okf_version`). One action; we're ~80% there.
3. **Import OKF bundle:** read a bundle → create entities/scopes/relationships,
   then run the audit so governance attaches.
4. **OKF conformance check:** a linter mode asserting every exported concept has
   a non-empty `type` and links resolve.

## Open questions to resolve before building

- Do scopes export as **one concept each** (the `_Overview.md`), or do we also
  emit child working files as concepts? (Lean: overview-as-concept only; files
  are `resource`-referenced.)
- Should **house rules** appear in the bundle as a `Playbook`/`Reference`
  concept so consuming agents inherit them, or stay DCP-only governance?
- `type` vocabulary: emit our literal kinds (`person`/`system`/`concept`/
  `Scope`/`Group`) or richer domain types? (Lean: start literal, let producers
  enrich.)
