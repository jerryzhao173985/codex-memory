# Codex History Harness Canonical Docs Map

[Back to docs index](./README.md)

This note says where each stable feature family should be documented, which code modules own it, and which runtime checkpoints keep it honest.

Use this when changing docs, not when looking for deep design detail. The goal here is to stop the same contract from being re-explained in the wrong file.

## Core Rule

Each stable feature family should have one primary documentation home.

Other docs may reference that home, but they should not silently redefine the contract from a different angle.

## Canonical Documentation Homes

| If the question is about... | Primary doc home | Why |
| --- | --- | --- |
| daily commands, flags, refs, and operator flows | `docs/codex-history-harness.md` | this is the user/operator contract |
| exact vs derived, search lanes, signal tiers, and source selection | `docs/codex-history-system-model.md` | this is the semantic model |
| upstream `codex app-server` behavior, normalized differences, and bridge boundary | `docs/codex-history-source-grounding.md` | this is the parity boundary |
| module ownership, invariants, test layers, and next worthwhile work | `docs/codex-history-maintenance.md` | this is the maintainer map |
| where docs belong, subsystem ownership by layer, and runtime checkpoints | `docs/codex-history-docs-map.md` | this is the docs-routing map |

## Stable Feature Families

| Feature family | Primary doc home | Owning code/modules | Verification home |
| --- | --- | --- | --- |
| `cmem` front door, session refs, `~/.cmem` config, native summaries | `docs/codex-history-harness.md` | `bin/cmem.js`, `cmem-config.js`, `history-store.js` | live `cmem status`, `cmem latest 3`, `cmem latest 3 --limit 2`, `cmem open latest`, `cmem open latest --timeline`, `cmem repo`, `cmem resume latest`; `test/cmem-cli.test.js` |
| `history.js` operator flows and human-readable browse surfaces | `docs/codex-history-harness.md` | `history.js`, `history-cli-*.js`, `history-store.js` | live `npm run history -- overview`; `test/history-cli.test.js` |
| broad text lane `q` and captured query lane `query` | `docs/codex-history-system-model.md` | `session-search.js`, `catalog-matchers.js`, `catalog-history-views.js`, `catalog-session-views.js`, `catalog-project-views.js` | live `cmem query AGNTS --fuzzy`; `test/catalog-matchers.test.js`, `test/catalog-history-views.test.js` |
| query signal tiers and low-signal fuzzy honesty | `docs/codex-history-system-model.md` | `session-search.js`, `catalog.js`, `history.js`, `bin/cmem.js` | live `cmem query AGNTS --fuzzy`; `test/session-search.test.js`, `test/history-cli.test.js`, `test/cmem-cli.test.js` |
| transcript, resume, and exact-vs-derived source selection | `docs/codex-history-system-model.md` | `catalog-history-policy.js`, `catalog-history-views.js`, `history-store-resolution.js` | `test/catalog-history-policy.test.js`, `test/catalog-history-views.test.js`, `test/history-store-resolution.test.js` |
| exact bridge thread list/read/name/metadata/memory/archive/fork/rollback | `docs/codex-history-source-grounding.md` | `app-server-transport.js`, `app-server-thread-contract.js`, `app-server-bridge.js`, `history-store-bridge.js`, `history-bridge-thread.js`, `history-bridge-prune.js` | live `node history.js threads --limit 3`; `test/app-server-thread-contract.test.js`, `test/history-bridge-view.test.js`, `test/history-store-bridge.test.js` |
| safe prune workflow | `docs/codex-history-harness.md` | `history-bridge-prune.js`, `history-store-bridge.js`, `history-cli-bridge-actions.js`, `history-cli-bridge-view.js` | `test/history-cli-bridge-actions.test.js`, `test/history-store.test.js` |
| rollout ingestion and normalized evidence | `docs/codex-history-system-model.md` | `parser.js`, `parser-shell-hints.js`, `parser-record-normalization.js`, `log-monitor.js` | `test/parser-shell-hints.test.js`, `test/parser-record-normalization.test.js`, `test/log-monitor.test.js` |
| persistent derived catalog build | `docs/codex-history-maintenance.md` | `catalog-rollout-build.js`, `catalog-session-state.js`, `catalog-build.js`, `catalog-session-summary.js`, `catalog-timeline-helpers.js`, `catalog-artifact-helpers.js`, `catalog-matchers.js`, `catalog-history-policy.js` | `test/catalog-*.test.js`, `test/history-store-index.test.js` |
| derived read models: sessions, events, transcript, resume, artifacts, project, area, family, workstream | `docs/codex-history-harness.md` for operator entry points; `docs/codex-history-system-model.md` for why they are distinct | `catalog-session-views.js`, `catalog-history-views.js`, `catalog-artifact-views.js`, `catalog-project-views.js`, `catalog-related-views.js` | live `cmem repo /Users/jerzha01/clawd-on-desk/codex`; `test/readme-smoke.test.js`, `test/catalog-history-views.test.js`, `test/catalog-artifact-views.test.js` |
| manual bookmarks, tags, and notes overlay | `docs/codex-history-system-model.md` | `history-store-annotations.js`, `history-store.js`, `bin/cmem.js`, `server.js` | `test/history-store-annotations.test.js`, `test/history-store.test.js`, `test/cmem-cli.test.js` |
| store/runtime/index composition | `docs/codex-history-maintenance.md` | `history-store.js`, `history-store-runtime.js`, `history-store-index.js`, `history-store-catalog.js`, `history-store-reporting.js`, `history-store-resolution.js` | `test/history-store-runtime.test.js`, `test/history-store-index.test.js`, `test/history-store-reporting.test.js` |
| standalone runtime bootstrap and HTTP surface | `docs/codex-history-maintenance.md` | `index.js`, `server.js`, `runtime-config.js` | `test/server.test.js`, `test/runtime-config.test.js` |

## Subsystem Ownership By Layer

| Layer | Primary modules | Canonical docs home | Notes |
| --- | --- | --- | --- |
| ingestion | `parser*.js`, `log-monitor.js` | `docs/codex-history-system-model.md` | keep close to rollout reality |
| derived catalog build | `catalog-rollout-build.js`, `catalog-session-state.js`, `catalog-build.js`, `catalog-*-helpers.js`, `catalog-history-policy.js` | `docs/codex-history-maintenance.md` | this is the main rebuildable evidence-to-memory layer |
| derived read models | `catalog-*-views.js` | `docs/codex-history-harness.md` and `docs/codex-history-system-model.md` | commands live in the guide; semantics live in the model |
| exact bridge | `app-server-*.js`, `history-bridge-*.js`, `history-store-bridge.js` | `docs/codex-history-source-grounding.md` | keep recovery-oriented, not execution-oriented |
| user surfaces | `history-store*.js`, `server.js`, `history-cli-*.js`, `bin/cmem.js` | `docs/codex-history-harness.md` and `docs/codex-history-maintenance.md` | operator contract plus ownership/testing map |

## Runtime Checkpoints

These are the read-only commands that should be used as the first live sanity check after structural work.

The exact counts vary with local history. What matters is the shape and meaning of the output.

### Front Door Health

Command:

```bash
node bin/cmem.js status
```

This should confirm:

- config/default state
- session dir and index dir
- generated stats and quality buckets
- bridge availability

### Latest Session Browse

Command:

```bash
node bin/cmem.js latest 3
```

This should confirm:

- latest-session ordering
- the positional count overrides the configured default limit
- concise cards with user and answer previews
- simple next commands
- latest-order ref note

### Front Door Transcript Inspect

Command:

```bash
node bin/cmem.js open latest
```

This should confirm:

- `cmem` resolves the latest-session ref correctly on real history
- the plain-text front door prints a concise native transcript summary instead of the backend-style transcript header
- recent transcript items are conversation-first by default instead of mirroring the raw tail of reasoning/tool churn
- the richer metadata-heavy raw timeline still lives behind `history.js transcript`

### Explicit Latest Limit Override

Command:

```bash
node bin/cmem.js latest 3 --limit 2
```

This should confirm:

- explicit `--limit` still overrides both the positional count and configured default limit
- the front door stays consistent with the documented precedence rule
- latest-session ordering still holds after the smaller explicit limit is applied

### Derived Catalog Overview

Command:

```bash
npm run history -- overview
```

This should confirm:

- derived quality buckets
- revisit candidates
- next recommended recovery commands

### Exact Bridge Thread Browse

Command:

```bash
node history.js threads --limit 3
```

This should confirm:

- explicit exact `source selection` note
- normalized exact thread metadata
- next cursor and exact next commands

### Query Lane Honesty

Command:

```bash
node bin/cmem.js query AGNTS --fuzzy
```

This should confirm:

- fuzzy captured-query matching
- low-signal labeling
- narrowing hints like `--exact`, `--cwd`, or `find`

### Repo Recovery Summary

Command:

```bash
node bin/cmem.js repo /path/to/repo
```

This should confirm:

- concise repo summary
- top models/tools/files/areas
- recent sessions and next actions

### Front Door Resume

Command:

```bash
node bin/cmem.js resume latest
```

This should confirm:

- `cmem` resolves the latest-session ref correctly on real history
- the delegated resume view still reports exact-vs-derived source selection clearly
- reload safety and quality guidance are visible when the exact app-server path is used

## Live Verification And Test-Backed Verification

During this docs audit, the live read-only checkpoints above were re-run against the current `~/.codex/sessions` surface:

- `node bin/cmem.js status`
- `node bin/cmem.js latest 3`
- `node bin/cmem.js latest 3 --limit 2`
- `node bin/cmem.js open latest`
- `npm run history -- overview`
- `node history.js threads --limit 3`
- `node bin/cmem.js query AGNTS --fuzzy`
- `node bin/cmem.js repo /Users/jerzha01/clawd-on-desk/codex`
- `node bin/cmem.js resume latest`

Deeper surfaces are intentionally verified by test layers rather than pretending a small live sample covers everything:

- executable command examples: `test/readme-smoke.test.js`
- direct seam tests: `test/catalog-*.test.js`, `test/history-bridge-view.test.js`, `test/history-store-*.test.js`
- public contract/docs drift: `test/docs-contract.test.js`

## Documentation Update Rules

When behavior changes:

- update the canonical home first
- update cross-links second
- add or adjust the nearest direct seam or smoke test
- only summarize the change elsewhere; do not redefine the contract from scratch in multiple docs

Good examples:

- wire parity change -> `docs/codex-history-source-grounding.md`
- new operator flag or command flow -> `docs/codex-history-harness.md`
- new search semantic or exact-vs-derived rule -> `docs/codex-history-system-model.md`
- new module split, ownership shift, or testing priority -> `docs/codex-history-maintenance.md`
