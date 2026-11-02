# Fieldwork architecture and flows

These diagrams describe the current implementation as of **2026-11-02**. They
are code-reading maps, not evidence that hosted Supabase or live model acceptance
has passed. See [verification](../../VERIFICATION.md) for the execution record.

Read the first three documents together, then follow the feature you are studying:

1. [System overview](system-overview.md): execution boundaries, storage, providers.
2. [Fit analysis](fit-analysis.md): one complete UI → API → AI → storage sequence.
3. [Preparation lifecycle](preparation-lifecycle.md): turn analyses into a reviewed
   plan, then share its progress across three views.
4. [Authentication](authentication.md): sessions, bearer tokens, and row ownership.
5. [Resume import](resume-import.md): browser parsing and user-confirmed experience.
6. [Job import](job-import.md): safe page fetching and reviewed extraction.
7. [Data model](data-model.md): physical tables versus logical JSON references.
8. [Model calls](model-calls.md): one call path, usage recording, hosted quota.
9. [Client data](client-data.md): the browser/account store behind the UI.

## Conventions

- **Flowcharts** show decisions, boundaries, and data movement. Arrows do not imply
  that operations happen automatically; explicit user actions are labeled.
- **Sequence diagrams** show calls over time, from top to bottom. Browser, Next.js,
  model provider, and Supabase are distinct participants.
- **State diagrams** describe allowed behavior. A state can be derived in code
  rather than represented by a database column; those distinctions are called out.
- **ER diagrams** show real foreign keys only. Separate logical diagrams use dotted
  arrows for identifiers and snapshots in JSON; they are not extra SQL constraints.

The model produces proposals. Schema/reference validation checks structure and
references; it does not certify that generated statements are semantically true.
User review and explicit confirmation remain part of the product.

## Viewing and maintaining

The source is Mermaid inside fenced Markdown blocks. GitHub renders these blocks;
a Mermaid-capable Markdown preview or [Mermaid Live Editor](https://mermaid.live/)
can also display them. There is no new application dependency or hosted diagram
integration. Use synthetic examples if copying diagram source to an online editor.

Each document ends with relative links to its source of truth. Update the affected
diagram when changing routes, ownership rules, persisted data, or approval behavior.
Keep error details in short notes or separate diagrams rather than crowding the
main path. The existing [case-study diagram](../../CASE-STUDY.md) is a simplified
product illustration; these documents describe implementation details.

## Documentation checks

On 2026-11-02, all ten Mermaid blocks in these documents passed syntax validation
with Mermaid 11.17.2 in a temporary Node/JSDOM environment. Relative links and
Markdown formatting were checked separately. Temporary tooling was installed
outside the repository; application dependencies were not changed.

Headless Chrome exited with a sandbox/process-permission error before producing
previews. Rendered layout and visual readability therefore remain unverified;
parser success does not establish either. Open the Markdown preview in VS Code or
GitHub to inspect the diagrams. No functional application tests are required for
these documentation-only changes, and none were run for this documentation pass.
