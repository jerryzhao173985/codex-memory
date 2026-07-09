# Codex History Harness: Upstream Bridge Parity And Current Differences

[Back to system model](./codex-history-system-model.md)

For the canonical docs home for each stable feature family and the current runtime checkpoints, see [codex-history-docs-map.md](./codex-history-docs-map.md).
For the current maintainership map and testing priorities around these boundaries, see [codex-history-maintenance.md](./codex-history-maintenance.md).

This note is grounded in the local upstream source under:

- `codex/codex-rs/app-server/README.md`
- `codex/codex-rs/app-server-protocol/src/protocol/common.rs`
- `codex/codex-rs/app-server-protocol/src/protocol/v2.rs`
- `codex/codex-rs/app-server/src/filters.rs`
- `codex/codex-rs/app-server/src/codex_message_processor.rs`

## What Upstream Confirms

### Rollouts are real persisted history

The app-server reconstructs thread and turn views from rollout history, and rollback is marker-based rather than raw-file deletion.

That confirms the harness model:

- raw rollout stays immutable evidence
- effective history is reconstructed on top of it

### `thread/list` uses upstream wire values

Upstream `ThreadListParams` uses:

- `sortKey: "created_at" | "updated_at"`
- `modelProviders`
- `sourceKinds`
- `archived`
- `cwd`
- `searchTerm`

That means the old camelCase `createdAt` / `updatedAt` doc wording was wrong for the wire contract.

### Session source is structured

Upstream `SessionSource` is not just a string. It can be:

- built-in values like `cli`, `vscode`, `exec`, `appServer`
- structured sub-agent values
- custom sources

That is why the harness now exposes:

- `source`
- `sourceKind`
- `sourceDetail`

instead of flattening everything to one string.

### `thread/memoryMode/set` returns `{}` upstream

Upstream treats memory-mode mutation as an acknowledged write, not a readback response.

That is why the harness returns an explicit acknowledgement object for its own bridge wrapper instead of pretending `thread/read` returned the new mode.

## What The Harness Bridges Today

The current narrow bridge surface wraps these upstream methods directly:

- `thread/read`
- `thread/list`
- `thread/loaded/list`
- `thread/name/set`
- `thread/metadata/update`
- `thread/memoryMode/set`
- `thread/archive`
- `thread/unarchive`
- `thread/fork`
- `thread/rollback`

On top of those, the harness composes recovery-oriented helpers:

- `GET /bridge/prune-turns`
- `GET /bridge/prune-preview`
- `POST /bridge/thread/fork-prune`

Those compose exact `thread/read` plus official `thread/fork` and `thread/rollback`; they are harness helpers, not upstream methods.

## What The Harness Intentionally Does Not Bridge Yet

These upstream methods exist, but are not wrapped here as first-class history-harness features:

- `thread/start`
- `thread/resume`
- `thread/inject_items`
- `turn/start`
- `turn/steer`
- `turn/interrupt`
- realtime thread methods
- shell-command execution methods
- standalone filesystem or config APIs

This is intentional.

The harness is:

- an evidence layer
- a retrieval layer
- a recovery layer

It is not a full Codex execution client.

## Boundary Normalizations The Harness Adds

These are deliberate differences between upstream wire shapes and the harness read surface.

### Session id normalization

Upstream bridge methods use raw thread ids.

The harness accepts and returns prefixed session ids such as:

```text
codex:019d...
```

and strips/reapplies the prefix at the bridge boundary.

### Thread-list normalization

The harness accepts user-facing variants and normalizes them to upstream wire values.

Examples:

- sort aliases normalize to `created_at` or `updated_at`
- source-kind aliases such as `sub-agent-thread-spawn`, `sub_agent_thread_spawn`, and `subAgentThreadSpawn` normalize to upstream `subAgentThreadSpawn`

Canonical source kinds currently supported by the harness contract are:

- `cli`
- `vscode`
- `exec`
- `appServer`
- `subAgent`
- `subAgentReview`
- `subAgentCompact`
- `subAgentThreadSpawn`
- `subAgentOther`
- `unknown`

### Refreshed thread wrappers

Upstream `thread/name/set` returns `{}`.

The harness wraps that by re-reading the thread and returning the refreshed exact thread view, because that is the more useful contract for history tooling.

Upstream `thread/archive` also returns `{}`.

The harness returns an acknowledgement object with:

- `threadId`
- `sessionId`
- `archived`

### Exact-vs-derived source metadata

Bridge-owned responses are marked explicitly with:

- `source.selectionReason`
- `source.selectionNote`

This keeps exact bridge results visibly separate from rollout-derived catalog views.

## Search And Retrieval Differences

This is the other important difference from upstream.

Upstream app-server gives exact thread state. It does not provide the harness search model:

- `q` versus `query` as separate search lanes
- `signalTier` on query artifacts
- `match.signalTier` on fuzzy query session matches
- `querySignalSummary` for low-signal fuzzy captured-query session browse
- artifact ledgers
- projects, areas, workstreams, and quality classes

Those are harness-level derived retrieval features built on top of rollout evidence and exact thread reads.

## Current Useful Gaps

These are still real differences between upstream capability and the harness surface.

### Not wrapped because of product boundary

- start/resume/turn execution APIs
- raw item injection APIs
- realtime APIs

Those are only worth adding if this repo intentionally becomes a broader Codex client.

### Worth keeping precise

- bridge docs must continue to use upstream wire names like `created_at` and `updated_at`
- source-kind docs should keep the canonical upstream names and note accepted aliases
- exact bridge surfaces should keep machine-readable separation from derived catalog state
- local tests now compare the harness canonical thread sort keys, thread source kinds, and builtin session-source strings against the checked-in upstream TypeScript schema so bridge drift fails fast

## Current Best Mental Model

The harness should stay:

- rollout-first for durable evidence
- app-server-backed for exact thread truth
- explicit about normalization at the boundary
- honest about what is upstream exact versus harness derived

That is the defensible way to stay aligned with the latest local `codex app-server` behavior without turning this repo into a half-finished second client.
