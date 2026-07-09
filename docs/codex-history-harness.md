# Codex History Harness Guide

[Back to Codex README](../README.md)

For the canonical docs home for each stable feature family and the current runtime checkpoints, see [codex-history-docs-map.md](./codex-history-docs-map.md).
For the deeper architecture and design model behind these commands, see [codex-history-system-model.md](./codex-history-system-model.md).
For upstream bridge parity and current intentionally unsupported methods, see [codex-history-source-grounding.md](./codex-history-source-grounding.md).
For current module boundaries, maintainer invariants, and the best next test work, see [codex-history-maintenance.md](./codex-history-maintenance.md).

## What This Is

The Codex history harness turns `~/.codex/sessions` rollout logs into a usable local memory system.

It combines three layers:

- source truth: raw rollout JSONL and older flat rollout JSON under `~/.codex/sessions`
- exact bridge: `codex app-server` for exact thread reads and narrow official thread mutations
- derived memory: persistent session docs, artifacts, projects, areas, workstreams, transcript, resume, and stats

The rule is:

- do not edit raw rollout files by hand
- use read models to inspect history
- use the app-server bridge for exact thread mutation

## Command Forms

From this repo root:

```bash
node history.js overview
```

Equivalent npm form:

```bash
npm run history -- overview
```

This guide uses the `npm run history -- ...` form.

## Simple Front Door

Install the short wrapper once from this repo root:

```bash
npm install -g .
```

This installs the harness itself, not the nested upstream `codex/` checkout or the test suite.
Exact thread workflows still require a working `codex` CLI on `PATH`, because the bridge shells out to `codex app-server`.

That gives you:

```bash
cmem
cmem status
cmem latest
cmem latest 3
cmem date today
cmem date 2026-04-09
cmem all
cmem find "AGENTS.md"
cmem query "feature-toggle"
cmem open latest
cmem resume latest
cmem saved
cmem pin latest
cmem tag latest important
cmem note latest "resume from here"
cmem clear-note latest
cmem bookmarks
cmem repo "/Users/you/repo"
cmem threads
cmem archive latest
cmem unarchive latest
cmem use .
cmem doctor
```

Use `cmem` for common flows:

- `cmem`: overview + latest sessions
- `cmem status`: config + index + bridge health
- `cmem latest [n]`: latest sessions. The positional `n` overrides the configured default limit for this command; explicit `--limit` still overrides both.
- `cmem date <day>`: one day of sessions
- `cmem all`: all sessions
- `cmem find <text>`: broad session search over previews, notes, tags, and captured signals
- `cmem query <text>`: captured query search; add `--exact` for literal matching or `--fuzzy` for typo-tolerant matching
- `cmem open <id|latest|n>`: concise conversation-first transcript view. The common plain-text path prints a native session summary plus recent user/assistant transcript items; add `--timeline` when you want the recent raw tool/reasoning timeline in the same front door, or use `--q <text>` to narrow the transcript and get an explicit native filter summary. Use `history.js transcript` when you want the richer metadata-heavy raw timeline.
- `cmem resume <id|latest|n>`: bounded reload brief. The common plain-text path prints a concise native summary first, then the bounded resume text. `--q <text>` narrows the resume and says how many turns remain. It still uses the same exact-vs-derived resume surface as `history.js resume`, so app-server source-selection and reload-safety notes can appear when `auto` chooses exact `thread/read`.
- `cmem repo <cwd>`: concise repo summary
- `cmem threads`: concise exact thread list from the app-server bridge
- `cmem archive <id|latest|n>` / `cmem unarchive <id|latest|n>`: exact thread lifecycle actions

Simple session refs work anywhere `cmem` expects one session:

- `latest`: newest session
- `2`: second latest session in latest-session order
- `saved`: first saved session
- `saved:2`: second saved session
- `bookmark`: first bookmarked session
- `bookmark:2`: second bookmarked session

Important ref note:

- bare numbers like `1` and `2` only follow latest-session order
- for filtered lists like `cmem find`, `cmem date`, `cmem all --cwd ...`, or `cmem query --fuzzy`, use the printed `codex:...` session id

## Search Lanes

The harness has two different search lanes.

### Broad Text Lane

Use `q` or `cmem find` when you mean:

- user prompt text
- answer or commentary text
- tags or notes
- paths, commands, or tools in a general search sense

Examples:

```bash
npm run history -- search --q "401 Unauthorized"
npm run history -- search --q "implemnt feature toggle" --q-mode fuzzy --limit 5
cmem find "401 Unauthorized"
cmem find "AGNTS" --fuzzy
```

### Captured Query Lane

Use `query` or `cmem query` when you mean:

- a captured web-search query
- a captured harness search term
- an exact or fuzzy query-like lookup, not general session text

Examples:

```bash
npm run history -- search --query "docker" --query-mode exact --limit 5
npm run history -- search --query "dokcer" --query-mode fuzzy --limit 5
cmem query "docker" --exact
cmem query "dokcer" --fuzzy
```

Important behavior:

- query matches now carry a derived signal tier: `high`, `medium`, or `low`
- `AGENTS.md`, `*.cmake`, and similar filename/glob filters are intentionally treated as low-signal query matches
- fuzzy captured-query browse returns a `querySignalSummary` when the current result page is entirely low-signal query matches
- the human CLI labels those as `[low-signal]` and tells you to try `--exact`, `--cwd`, or broad `find` instead

## Exact Bridge Workflows

Use the exact bridge when you need Codex-owned thread state rather than rollout-derived history.

Examples:

```bash
npm run history -- threads --limit 20
npm run history -- thread codex:019d...
npm run history -- metadata codex:019d... --git-branch main --clear-git-sha
npm run history -- memory-mode codex:019d... --mode disabled
npm run history -- archive codex:019d...
npm run history -- unarchive codex:019d...
cmem threads
cmem archive latest
cmem unarchive latest
```

The bridge surface here is deliberately narrow and recovery-oriented:

- exact thread list/load/read
- official thread name, git metadata, and memory-mode changes
- archive/unarchive
- safe fork + rollback prune workflows

It is not a full execution client for `thread/start`, `thread/resume`, `turn/start`, or realtime APIs.

## Safe Prune Flow

Use the exact bridge compose surfaces instead of editing rollout logs:

```bash
npm run history -- prune-turns codex:019d... --limit 8
npm run history -- prune-preview codex:019d... --through-turn turn-17
npm run history -- fork-prune codex:019d... --through-turn turn-17 --name "Trimmed fork"
```

This means:

- inspect exact cutoff turns
- preview the suffix trim from exact `thread/read`
- fork the thread
- apply `thread/rollback` on the new fork

The original thread stays unchanged.

## When To Use Which View

Use the smallest surface that answers the question:

| Goal | Command |
|---|---|
| See what is worth opening | `overview` / `cmem` |
| Read one session clearly | `transcript <session_id>` / `cmem open ...` |
| Build bounded reload context | `resume <session_id> --reload-policy strict` / `cmem resume ...` |
| Inspect exact event evidence | `events <session_id>` |
| Find matching turns across sessions | `turn-search ...` |
| Browse artifacts | `artifacts ...` |
| Recover one repo’s work | `project --cwd ...` / `cmem repo ...` |
| Recover one lineage/work thread | `family ...` / `workstream ...` |
| Inspect official thread state | `threads`, `thread`, `cmem threads` |

## Native `~/.cmem` Home

`cmem` has its own config home:

```text
~/.cmem/
  config.json
```

Use it like this:

```bash
cmem config init
cmem config show
cmem config path
cmem config set cwd "/Users/you/repo"
cmem config set limit 20
cmem config unset cwd
```

Important boundary:

- `~/.cmem/config.json` is for user defaults
- the shared history index still defaults to `~/.codex/memories/clawd-codex-history`
- if you want a separate `cmem`-owned index, set `paths.indexDir` explicitly
