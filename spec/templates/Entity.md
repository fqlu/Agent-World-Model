---
name: [Entity name — also the filename slug]
kind: [person | organization | system | concept]
aliases: []                      # other names this entity is known by
source: asserted                 # asserted (human) | derived (extracted from overviews)
confirmed: YYYY-MM-DD            # last time a human confirmed this is current
attributes: {}                   # e.g. role / org / email for a person; type / id for a system;
                                 # facet: pillar | platform | discipline | brand for a facet
relations: []                    # - predicate: member-of | related-to
                                 #   target: <entity slug or scope path>
                                 #   as: <what the relationship is>  (required for related-to)
                                 #   since / until: YYYY-MM-DD       (optional; past until = former)
---

[What this entity is and why it matters to the workspace. Agents read this to
resolve the entity wherever it's referenced.]
