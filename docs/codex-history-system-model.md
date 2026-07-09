# Codex History Harness System Model

[Back to operator guide](./codex-history-harness.md)

For the canonical docs home for each stable feature family and the current runtime checkpoints, see [codex-history-docs-map.md](./codex-history-docs-map.md).
For the current code/module map and test-maintenance guidance, see [codex-history-maintenance.md](./codex-history-maintenance.md).

## Why This Exists

Raw Codex rollout files are durable, but they are not a good human interface.

They are:

- line-oriented JSONL or older flat rollout JSON
- physically append-only evidence
- richer than they first look
- easy to misread when rollback, forks, thin persistence, or subagents are involved

The harness exists to turn that raw history into trustworthy local memory without lying about what Codex actually stored.

## Core Rule

Do not replace source truth. Build read models on top of it.

That gives five layers:

1. raw rollout files stay intact
2. `codex app-server` stays the official exact read/mutation bridge
3. session docs become the persistent derived memory layer
4. transcript/resume/project/area/workstream/artifact surfaces become read models over that layer
5. manual bookmarks/tags/notes stay in a separate overlay

If a higher layer cannot point back to lower evidence, it should not exist.

## The Layers

### 1. Physical Source Layer

This is what Codex wrote under:

```text
~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
```

Important facts:

- it is the durable physical record
- rollback is marker-based, not file deletion
- forks and subagents create separate histories
- it can contain detail that exact `thread/read` does not surface cleanly

### 2. Official Bridge Layer

This is `codex app-server`.

Use it for:

- exact thread list/load/read
- official thread name, metadata, memory mode, archive state
- safe fork and rollback mutation

Important rule:

- prefer the bridge when it can satisfy the request
- fall back to rollout-derived views when you need deeper persisted evidence or richer filters

### 3. Persistent Derived Memory Layer

This is the rebuildable index under:

```text
~/.codex/memories/clawd-codex-history
```

It contains:

- session docs
- artifact ledgers
- project and area summaries
- stats and doctor metadata
- annotation overlay state

Its job is retrieval, not mutation.

### 4. Read Model Layer

These are the things humans and tools actually consume:

- `overview`
- `search`
- `turn-search`
- `events`
- `transcript`
- `resume`
- `artifacts`
- `project`
- `areas`
- `area`
- `family`
- `workstream`

Each one answers a different question. The harness works best when those questions stay distinct.

### 5. Manual Overlay Layer

Manual memory stays outside source truth:

- bookmarks
- tags
- notes

That matters because it preserves judgment without rewriting evidence.

## Exact vs Derived

This distinction matters everywhere.

### Exact

Exact means stored or reconstructed from strong evidence.

Examples:

- exact thread reads from `codex app-server`
- rollout event streams
- literal file/path matches
- explicit captured queries
- explicit command ops like `sed`, `rg`, `find`

### Derived

Derived means helpful organization built on strong evidence.

Examples:

- quality classes
- focus roots
- project and area summaries
- workstreams
- command-op signal tiers
- query signal tiers

Derived layers are good when they stay explainable and do not pretend to be canonical truth.

## The Main Search Lanes

The harness does not use one giant text blob. It keeps separate retrieval lanes.

### `q`

Broad free-text browse over the session/turn/event read model.

Use it for:

- prompt or answer text
- notes or commentary
- broad “find the session where we talked about X”

### `query`

Captured query lane from web search terms and harness search terms.

Use it for:

- “what exact thing was I searching for?”
- query-like fuzzy matching
- query artifact and query-driven drilldowns

This is intentionally separate from broad `q`.

## Query Signal Tiers

Captured queries are not all equally meaningful.

The harness classifies query matches as:

- `high`: likely semantic/code/search intent
- `medium`: useful but shorter or less structured semantic terms
- `low`: filename, glob, regex-like, or scoped filter terms such as `AGENTS.md`, `*.cmake`, or `^/repo/app/`

Why this exists:

- low-signal query terms are real evidence, but they should not outrank semantic intent
- fuzzy captured-query browse should not make `AGENTS.md` look like a rich topic match
- stats and artifact browse become much more useful when semantic queries and low-signal filters are separated

This powers:

- `signalTier` on query artifacts
- `match.signalTier` on query session matches
- `querySignalSummary` for fuzzy captured-query session browse when the visible page is entirely low-signal

## Source Resolution

Transcript and resume have a fidelity-aware `source=auto` model.

That means:

- `source=app-server`: exact bridge only
- `source=rollout`: derived rollout view only
- `source=auto`: prefer app-server, but fall back to rollout when the bridge fails, raw history is required, or structured filters miss in the exact bridge view

Responses expose:

- `source.selectionReason`
- `source.selectionNote`

So the system explains why it used exact bridge state or derived rollout state instead of hiding the decision.

## Bridge Boundary

This repo is a history harness, not a second Codex client.

That means:

- bridge state stays narrow and recovery-oriented
- derived catalog state stays rebuildable
- local annotations do not become fake thread truth
- app-server controls are wrapped when they help recovery and inspection
- app-server execution APIs are not wrapped just because they exist upstream
