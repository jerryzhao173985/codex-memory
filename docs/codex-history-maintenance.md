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

## Best Investigation Lanes

These are the most promising source-code investigations if behavior changes or new features are needed.

### Upstream App-Server

Read these first when exact thread behavior changes:

- `codex/codex-rs/app-server/README.md`
- `codex/codex-rs/app-server/src/filters.rs`
- `codex/codex-rs/app-server/src/codex_message_processor.rs`
- `codex/codex-rs/app-server-protocol/src/protocol/v2.rs`
- `codex/codex-rs/app-server-protocol/src/protocol/thread_history.rs`

### Upstream Rollout Format

Read these first when rollout structure changes:

- `codex/codex-rs/protocol/src/protocol.rs`
- `codex/codex-rs/rollout/src/recorder.rs`

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

The current parity guardrails around thread sort keys, source kinds, and session sources are good.

The next useful parity work is around exact thread/read item shape, not wider API coverage.

## What Not To Do Next

- do not widen the bridge into start/resume/turn execution just because upstream has those APIs
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
