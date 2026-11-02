# Job import

[Architecture index](README.md)

## How to read these diagrams

The main path separates page fetching from model extraction. Each is an explicit
user action, and the user can inspect/change text between them. The smaller
diagram expands the Gem recovery path without making it look like general browser
automation or autonomous web search.

```mermaid
flowchart TD
  URL["User pastes public HTTPS URL and clicks Fetch page"]
  API["Server: POST /api/jobs/fetch; access and URL validation"]
  DNS["Resolve public addresses; pin connection; validate every redirect"]
  FETCH["Bounded page read: no scripts, cookies or embedded resources"]
  TEXT["Single JSON-LD JobPosting or readable main/article/HTML text"]
  INSPECT["Browser memory: user inspects and edits text"]
  PASTE["User pastes JD text instead"]
  EXTRACT["User: Extract job details"]
  MODEL["Server: guarded /api/jobs/extract; one structured model call"]
  REVIEW["Browser memory: edit company, role and complete JD"]
  MANUAL["User: Enter details manually without model inference"]
  CONFIRM["User: Confirm and save application"]
  SAVE{"Browser or account storage?"}
  LOCAL[("Browser: persist application with stable ID")]
  DB[("Supabase via /api/workspace: owned application")]
  URL --> API --> DNS --> FETCH --> TEXT
  TEXT -->|"Readable and within limits"| INSPECT
  TEXT -->|"Insufficient Gem HTML"| GEM["Try matching Gem public job data"] -->|"Exact usable match"| INSPECT
  API -->|"Invalid, blocked, unavailable or unsupported"| PASTE
  FETCH -->|"Fetch/content failure"| PASTE
  TEXT -->|"Other insufficient text"| PASTE
  PASTE --> INSPECT --> EXTRACT --> MODEL --> REVIEW
  INSPECT --> MANUAL --> REVIEW
  REVIEW --> CONFIRM --> SAVE
  SAVE -->|Browser| LOCAL
  SAVE -->|Account| DB
  GEM -->|"No usable exact match"| PASTE
```

```mermaid
flowchart LR
  SHELL["Insufficient text from jobs.gem.com board/job URL"]
  DETAIL["GET fixed public API individual posting"]
  LIST["Only after HTTP 404: GET board list"]
  MATCH{"One exact job ID or listing-URL match with usable description?"}
  RESULT["Return readable job text; keep original listing URL"]
  FAIL["Explain limitation; offer pasted text"]
  SHELL --> DETAIL
  DETAIL -->|"JSON response"| MATCH
  DETAIL -->|404| LIST --> MATCH
  DETAIL -->|"Other failure"| FAIL
  MATCH -->|Yes| RESULT
  MATCH -->|No| FAIL
```

## Fetch boundaries and limits

The server accepts public HTTPS on the default port, without URL credentials.
Private/reserved addresses and unsafe redirects are rejected. All resolved
addresses must pass the public-address check; the chosen address is pinned into
the socket lookup while normal TLS hostname verification is retained. Redirects
repeat validation rather than trusting a destination returned by the page.

The fetch budget is 15 seconds overall, three redirects per resource, 2 MB per
response, and 30,000 readable source characters. Gem reads share that same overall
deadline and response bounds. JSON responses are admitted only for the narrowly
recognized Gem API path; general URLs must return supported HTML/text content.
Compressed responses and unsupported types are rejected, not browser-rendered.

This is not Ollama web search: the model does not fetch URLs or discover jobs.
Login walls, anti-bot protection and JavaScript-only content can require manual
paste. Structured data and HTML cleanup are best effort and may omit or retain
unwanted content; users inspect the source before extraction. Gem response shapes
are supported conservatively and have mocked regression coverage, not universal
live-site certification.

## Review, persistence, and cancellation

Only inspected source text goes to the configured model; no experience-bank data
is included. Structured output is validated and kept as an editable draft. Manual
entry bypasses inference. Confirmation validates company, role and a 20–15,000
character JD, creates an application at Saved stage, and stores the listing URL in
notes when a successful fetched source URL is available. The pasted-input path
clears that source URL. Full fetched page text is not saved separately.

A stable creation ID prevents duplicate applications on confirmation retries.
Account retries check owned ID conflicts without overwriting the existing record;
a separate intentional import can still create another application. Failed saves
retain the review. Cancel/unmount aborts fetch/extraction through `AbortController`;
the confirmation callback does not consume that signal, so cancellation cannot
undo a database save. The current save handler also contains a browser
`console.log(fields)` debugging statement; this diagram does not imply a
log-free browser path.

## Implementation

- [Import UI and controller](../../components/job-import.tsx),
  [fetch route](../../app/api/jobs/fetch/route.ts), and
  [network/HTML/Gem handling](../../lib/job-page.ts).
- [Extraction route](../../app/api/jobs/extract/route.ts),
  [structured extraction](../../lib/job-extraction.ts),
  [confirmation and browser persistence](../../components/workspace.tsx), and
  [account creation retry handling](../../app/api/workspace/route.ts).
