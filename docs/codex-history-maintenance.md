# Codex History Harness Maintenance Map

[Back to docs index](./README.md)

For the canonical docs home for each stable feature family and the current runtime checkpoints, see [codex-history-docs-map.md](./codex-history-docs-map.md).

This note is for maintainers.

It records the current module shape, the invariants that matter, the test layers that protect them, and the next work that is actually worth doing.

## Current High-Level Picture

The harness has five stable layers.

### 1. Ingestion

These modules turn raw rollout files into normalized evidence:

- `parser.js`
- `parser-shell-hints.js`
- `parser-record-normalization.js`
- `log-monitor.js`

This layer should stay close to Codex rollout reality.

### 2. Derived Catalog Build

These modules build rebuildable historical memory:

- `catalog-rollout-build.js`
- `catalog-session-state.js`
- `catalog-session-summary.js`
- `catalog-matchers.js`
- `catalog-build.js`
- `catalog-history-policy.js`
- `catalog-artifact-helpers.js`
- `catalog-timeline-helpers.js`

This layer owns derived structure, but it must stay explainable from stored evidence.

### 3. Derived Read Models

These modules answer human retrieval questions:

- `catalog-session-views.js`
- `catalog-history-views.js`
- `catalog-project-views.js`
- `catalog-related-views.js`
- `catalog-artifact-views.js`

Each one should stay narrow and question-oriented rather than collapsing into one giant browse surface.

### 4. Exact Bridge

These modules expose Codex-owned exact thread state:

- `app-server-transport.js`
- `app-server-thread-contract.js`
- `app-server-bridge.js`
- `history-bridge-thread.js`
- `history-bridge-prune.js`
- `history-store-bridge.js`

This layer should stay recovery-oriented, not turn into a full execution client.

### 5. User Surfaces

These modules present the harness:

- `history-store.js` plus `history-store-*.js`
- `server.js`
- `history.js` plus `history-cli-*.js`
- `bin/cmem.js`

The store and CLI/server layers should mostly compose lower layers now, not hide new business logic inline.

## Invariants To Protect

These are the rules that matter most.

### Source Truth

- rollout JSONL and legacy rollout JSON stay immutable evidence
- manual bookmarks, tags, and notes stay outside source truth
- exact thread mutation goes through `codex app-server`, not direct file edits

### Exact vs Derived

- exact bridge state must stay visibly exact
- derived catalog state must stay visibly derived
- transcript and resume source selection must keep `source.selectionReason` and `source.selectionNote`

### Canonical Signals

- query signal tiers are `high`, `medium`, `low`
- command-op signal tiers are `high`, `medium`, `low`
- accepted aliases may exist at the boundary, but internal contracts should normalize to the canonical values

### Product Boundary

- this repo is a history/recovery harness
- `thread/read`, `thread/list`, metadata, memory-mode, archive, fork, rollback fit
- `thread/start`, `thread/resume`, `turn/start`, realtime execution, and general Codex client behavior do not belong here unless the product boundary intentionally changes

## Current Test Layers

The test layout is now more useful than it was earlier in the extraction work.

### Direct Seam Tests

These protect extracted subsystems without needing full integration setup.

Examples:

- `test/parser-shell-hints.test.js`
- `test/parser-record-normalization.test.js`
- `test/catalog-session-state.test.js`
- `test/catalog-session-summary.test.js`
- `test/catalog-history-policy.test.js`
- `test/catalog-history-views.test.js`
- `test/catalog-artifact-helpers.test.js`
- `test/catalog-artifact-views.test.js`
- `test/catalog-matchers.test.js`
- `test/catalog-rollout-build.test.js`
- `test/catalog-build.test.js`
- `test/history-bridge-view.test.js`

These are the cheapest place to catch drift after refactors.

### Integration Tests

These prove the layers still work together.

Examples:

- `test/catalog.test.js`
- `test/history-store.test.js`
- `test/server.test.js`
- `test/history-cli.test.js`
- `test/cmem-cli.test.js`

These are the right place to validate user-visible behavior and cross-module contracts.

### Docs And Contract Tests

These keep the docs and public contracts honest.

Examples:

- `test/docs-contract.test.js`
- `test/readme-smoke.test.js`
- `test/package-contract.test.js`
- `test/app-server-thread-contract.test.js`

These are important because this harness now has a real user-facing contract, not just internal scripts.

## Best Next Tests To Add

These are the highest-value remaining harness tests.

### Broaden `catalog-history-views` Direct Tests

That module now has direct seam coverage, but the next worthwhile additions are still there.

Best next cases:

- bounded resume shaping around omitted tool output and highlight limits across multiple turns
- edge-case transcript item filtering with combined `path_role`, memory citations, and structured error metadata
- rollout transcript shaping when compactions, duplicate tool-call/output pairs, and repeated assistant/status items all interact

### Broaden `catalog-artifact-views` Direct Tests

That module now has direct seam coverage too.

Best next cases:

- exact file/path/path-pattern artifact resolution
- ambiguous artifact disambiguation
- grouped path-thread reconstruction behavior
- error artifact alias resolution through direct seam tests

### Upstream Exact Thread Fixtures

The next precision gain is to build more fixtures from the checked-in local upstream `codex app-server` source rather than only hand-shaped exact thread mocks.

Current direct coverage now includes:

- `thread/read` summary-only and unmaterialized thread states
- exact fork lineage and sub-agent spawn metadata on reconstructed session views
- structured `SessionSource`
- upstream `systemError` thread status shape
- exact turn error payload shape
- memory citation preservation

Best remaining targets:

- `thread/read` item lossiness and partial fields
- memory citation edge cases
- additional exact turn error variants beyond the current structured coverage

### Tests That Follow The Next-Stage Roadmap

Each new bridge capability from the roadmap in Best Investigation Lanes should land with two cheap protections, not a broad integration harness:

- a direct seam test against a fake app-server, mirroring the fake-`codex` stdio script already used in `test/history-bridge-view.test.js`, `test/cmem-cli.test.js`, and `test/readme-smoke.test.js` — assert the request shape (including `experimentalApi` in `initialize` for experimental methods) and the parsed response
- a feature-detect guard test: an experimental-gated method with no capability, or a stubbed method like `thread/items/list` returning `-32601`, must degrade cleanly (fall back to local search, or cache the unsupported result) instead of throwing

The highest-value first target here is a `thread/search` compose test: a session that hits both the local index and the server-side ripgrep search must appear once, with its snippet preserved.

## Best Investigation Lanes

This is the grounded next-stage roadmap for widening how cmem uses the `codex app-server`. It is priority-ordered from the capability audit against the checked-in upstream (`codex/codex-rs`) and the installed `codex-cli 0.144.0`. Each lane names the upstream source to read first and the part of cmem it touches.

The bridge today sends: `initialize`, `thread/read`, `thread/list`, `thread/search`, `thread/turns/list`, `thread/goal/set|get|clear`, `thread/loaded/list`, `thread/metadata/update`, `thread/memoryMode/set`, `thread/archive`, `thread/unarchive`, `thread/fork`, `thread/rollback`, `thread/name/set`. Experimental methods (marked `#[experimental]` in the registry) are rejected unless the bridge sets `initialize.params.capabilities.experimentalApi = true` (it does by default); enforcement is in `codex/codex-rs/app-server/src/message_processor.rs`. Stable methods need no opt-in. Lanes 1, 3, 4, and 5 below shipped on 2026-07-10 (`history.js thread-search / thread-turns / goal`, `/bridge/thread-search` + `/bridge/thread-turns` + `/bridge/thread/goal`, `backwardsCursor` on thread lists, and the `cmem find` zero-hit fallthrough to the exact full-text lane); their text stays as the design record. The `codex/` reference checkout is pinned at the latest upstream `main`; the transcript schema (`RolloutItem`, `EventMsg`, `TurnItem`) is unchanged from the prior pin, so the parser has zero drift and the contract drift-detector tests stay green — re-run `git -C codex fetch && node --test test/app-server-thread-contract.test.js test/history-session-source.test.js` after any future pin bump, then `node history.js schema` over real data to catch new `kind=unknown` records.

### 1. `thread/search` — server-side full-text search with snippets (experimental)

The single biggest gap versus cmem's own session search. `thread/search` (`#[experimental("thread/search")]`, registry in `codex/codex-rs/app-server-protocol/src/protocol/common.rs`) is backed by `LocalThreadStore::search_threads` (`codex/codex-rs/thread-store/src/local/search_threads.rs`), which runs **ripgrep over rollout JSONL contents** — true full-text search of conversation bodies, not just titles — and returns the first content-match snippet per thread, newest first, including archived history via `archived: true`. Params take `searchTerm`, `cursor`, `limit`, `sortKey`, `sortDirection`, `sourceKinds`, `archived`; the response is `{ data: [{ thread, snippet }], nextCursor, backwardsCursor }` (`.../protocol/v2/thread.rs`); the handler lives in `codex/codex-rs/app-server/src/request_processors/thread_processor.rs`. Touches: `app-server-bridge.js` (add the request and set `experimentalApi` in `initialize`), `history-store-bridge.js`, and the `cmem find`/`search` lane — dedupe and compose the rg-backed snippets with the existing local substring/fuzzy index hits so one `cmem find` blends both without double-listing a session. Ship it as an experimental opt-in so a bridge without the capability still falls back to local search.

### 2. `thread/inject_items` — context-priming on resume/fork (stable)

The highest-leverage method for cmem-as-memory-tool — **SHIPPED 2026-07-10**. `thread/inject_items` (`common.rs`, handler `thread_inject_items` at `codex/codex-rs/app-server/src/request_processors/turn_processor.rs:175,802`) appends raw Responses API items to a loaded thread's model-visible history without starting a user turn (`{ threadId, items }` → `{}`).

Shipped shape: `cmem continue <ref> --prime` (and `history.js prime <id>`, `POST /bridge/thread/prime`) runs fork → `thread/resume(fork)` → `thread/inject_items(fork)` → `codex resume <fork-uuid>` handoff. The injected block IS the reload-safety-governed resume text (a blocked resume refuses to prime, `HISTORY_RELOAD_BLOCKED`), wrapped in `<cmem_resume_context>` markers as a single **developer-role** message — developer role is model-visible background that codex's own memory policy excludes from auto-memory and its display views hide as scaffold. Fork-by-default means the source thread is never mutated; `--prime-in-place` / `--in-place` is the explicit opt-in to inject into the original. Fake-app-server tests pin the call order, the payload shape, the safety gate, and the fork default; the one live E2E ran against a fork only (injection confirmed persisted in the fork's rollout, source confirmed untouched, fork archived afterwards).

Still open in this lane: cross-thread priming (inject knowledge recovered from thread A into a fresh thread B) and richer distillation (annotations/pins folded into the block) — both compose on the shipped primitives.

### 3. `thread/turns/list` — lazy paging for large threads incl. archived (experimental) — SHIPPED 2026-07-10

cmem's thread viewer previously pulled whole rollouts (`thread/read` with `includeTurns`), which is brutal for 10 MB threads. `thread/turns/list` (`common.rs`; handler `thread_processor.rs`) gives a lazy, newest-first timeline: default `sortDirection: desc`, `itemsView` of `notLoaded|summary|full`, and it reads append-only rollout storage with `include_archived: true`, so it works identically for archived threads without a resume. Known in-source caveat: it replays the entire rollout on every request until turn metadata is indexed, and it rejects not-yet-materialized/ephemeral threads. Shipped as `history.js thread-turns <id>` + `GET /bridge/thread-turns`: a page is `Turn[]` with the same item shape as `thread/read`, so `history-store-bridge.js listBridgeThreadTurns` feeds the page straight through the existing `buildBridgeThreadSessionView` mapper (no new item mapping) to get rich per-turn summaries — prompts, answers, command types, files touched — while preserving the server's page order for cursor coherence. Still open: a `cmem open --page`/detail-pane surface that uses `full` items on demand.

### 4. `backwardsCursor` — live catalog refresh (cross-cutting, no new method)

A free win already present on `thread/list`, `thread/search`, and `thread/turns/list` (`.../protocol/v2/thread.rs`). The contract: `backwardsCursor` is only populated on a non-empty page; pass it back as `cursor` with the **opposite** `sortDirection`, and for timestamp sorts it anchors at the page-start timestamp so same-second updates are not skipped. cmem currently pages `thread/list` forward-only. Touches: `app-server-bridge.js` `listBridgeThreads` and `cmem threads` — after rendering a page, poll backwards to pick up threads updated since the snapshot without a full rescan, which is exactly the "what changed while I reviewed" primitive a history tool wants.

### 5. `thread/goal/*` — Codex-native objectives surfaced in the catalog (stable)

`thread/goal/set|get|clear` (`common.rs`; processor `codex/codex-rs/app-server/src/request_processors/thread_goal_processor.rs`) is stable and gated on `Feature::Goals` (stage Stable, `default_enabled: true`, `codex/codex-rs/features/src/lib.rs`); it needs a materialized thread and the sqlite state db, but works on stored threads without resuming. A goal carries `objective`, `status` (`active|paused|blocked|usageLimited|budgetLimited|complete`), `tokenBudget`, `tokensUsed`, and `timeUsedSeconds`. Touches: the cmem annotation and catalog surface — attach a durable objective Codex itself understands ("finish the WAL-recovery refactor; budget 200k tokens"), mark recovered threads `blocked`/`complete`, and surface budget burn plus a "what was I still trying to finish" filter in the `threads`/`repo` views. This is first-class thread annotation that survives outside cmem's own overlay.

### 6. `thread/delete` — purge lane guarded by cmem annotations (stable, destructive)

`thread/delete` (`common.rs`; dedicated module `codex/codex-rs/app-server/src/request_processors/thread_delete.rs`) resolves the spawn subtree from the state db and hard-deletes descendants deepest-first then the root, for active **or** archived threads; missing rollout files count as already deleted. CLI parity exists (`codex delete <id|name>`). Touches: a new `cmem rm`/bulk-purge lane for the hundreds of dead one-shot threads (failed runs, subagent noise) a review workflow surfaces — with cmem's own annotations/archive acting as the safety gate before an irreversible hard delete. Keep it confirm-gated.

### 7. `thread/compact/start` — compact-then-resume for oversized threads (stable)

The practical companion to resume-into-Codex. An old 400k-token thread will not fit the model context, so cmem can offer "compact then resume": resume the thread via the bridge, fire `thread/compact/start` (`common.rs`; handler `thread_processor.rs` issues core `Op::Compact`, same path as the TUI `/compact`), wait for the `thread/compacted` notification, then print the `codex resume <id>` handoff. Requires a loaded thread. Combined with cmem's token-usage stats it can even suggest which recovered threads need compaction. Touches: the `cmem continue` lane and `app-server-bridge.js`.

### 8. `memory/reset` — confirm-gated global memory wipe (experimental)

`memory/reset` (`common.rs`; handler `thread_processor.rs`) takes no params and clears the memories db plus wipes `CODEX_HOME/memories`, while preserving per-thread memory modes. Since cmem already exposes `thread/memoryMode/set` per thread, this completes the memory-hygiene story: opt threads out individually, or factory-reset Codex's derived-memory store wholesale while cmem's own recovered-history knowledge stays intact. It is destructive and global, so it belongs behind an explicit confirm. Touches: a new cmem memory-hygiene command plus `app-server-bridge.js`.

### 9. `thread/items/list` — feature-detect only, do not build yet (experimental, stubbed)

`thread/items/list` (`common.rs`; handler `thread_processor.rs`) delegates to `ThreadStore::list_items`, whose trait default returns `Unsupported` (`codex/codex-rs/thread-store/src/store.rs`) with no local-store override, so every call against the default filesystem store returns JSON-RPC `-32601` ("thread/items/list is not supported yet"). Touches: nothing to build now — cmem should feature-detect by issuing one call, caching the `-32601`, and re-probing per codex release. Prefer `thread/turns/list` (lane 3) for item-level paging today.

### Where To Read First

- exact thread behavior: `codex/codex-rs/app-server/README.md`, `codex/codex-rs/app-server/src/message_processor.rs`, `codex/codex-rs/app-server/src/request_processors/thread_processor.rs`, `codex/codex-rs/app-server-protocol/src/protocol/common.rs`, `codex/codex-rs/app-server-protocol/src/protocol/v2/thread.rs`
- rollout structure: `codex/codex-rs/protocol/src/protocol.rs`, `codex/codex-rs/rollout/src/recorder.rs`
- resume/handoff CLI contract: `codex/codex-rs/cli/src/main.rs` (`ResumeCommand`); note that the app-server **rejects resuming an archived thread** ("Run `codex unarchive {id}` to unarchive it first"), so any resume/continue lane must `thread/unarchive` first

## Best Practical Next Work

If continuing from the current state, these are the most defensible next moves.

### 1. Broaden Direct Tests For `catalog-history-views.js`

This is still the best next test investment.

It protects:

- source selection
- transcript filtering
- resume safety
- bounded reload shaping

Direct seam coverage already exists. The remaining value is in harder edge cases, not first-time extraction coverage.

### 2. Broaden Direct Tests For `catalog-artifact-views.js`

This is still the second-best test investment.

It protects:

- artifact browse ordering
- drilldown behavior
- path-thread reconstruction
- command-op signal filtering

Direct seam coverage already exists here too. The next gain is in exact-path disambiguation, grouped path-thread edge cases, and error alias resolution.

### 3. Keep The Read-Only Live Smoke Checklist Current

The live checklist is now documented in `docs/codex-history-docs-map.md`. Keep using it after structural work against real `~/.codex/sessions`.

Current high-value commands:

- `cmem status`
- `cmem latest 3`
- `cmem latest 3 --limit 2`
- `cmem resume latest`
- `cmem query ... --fuzzy`
- `cmem repo /path/to/repo`
- `npm run history -- overview`
- `npm run history -- threads`

This should stay read-only and optional.

### 4. Keep Watching Upstream Parity

The current parity guardrails around thread sort keys, source kinds, and session sources are good, and they still bind anything shipped from the roadmap.

Broader app-server capability adoption is now tracked as the priority-ordered roadmap in Best Investigation Lanes; the near-term parity precision work outside that roadmap is around exact `thread/read` item shape.

## What Not To Do Next

- do not move turn execution into cmem: `thread/inject_items`, `thread/compact/start`, and `thread/settings/update` all require a loaded thread, so use them only inside a resume/continue lane that still hands off to `codex resume`; cmem stays a recovery front door, not a turn runner
- do not widen the bridge into `thread/start` / `turn/start` / realtime execution just because upstream has those APIs
- do not build `thread/items/list` support yet — the local filesystem store returns JSON-RPC `-32601` ("not supported yet"); feature-detect and wait, re-probing per codex release, and use `thread/turns/list` for item paging in the meantime
- keep `thread/delete` and `memory/reset` behind an explicit confirm; both are destructive (a hard delete of a spawn subtree, a global memory wipe) with cmem's annotations/archive as the only safety gate
- do not add fuzzy behavior to every surface without a real ranking model
- do not keep extracting tiny helpers from `catalog.js` just to reduce line count
- do not let docs drift back into stale path guidance or old wire names

## Current State Summary

As of the current extraction work:

- `catalog.js` is now mostly composition and a smaller set of shared utilities
- `history.js` is mostly orchestration plus shared formatting
- `parser.js` is now a thin public surface over parser subsystems
- direct seam coverage now exists for the main history and artifact view modules
- the strongest remaining value is broader direct seam cases and tighter upstream parity fixtures, not broader feature sprawl
