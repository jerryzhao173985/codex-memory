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

`cmem` is your Codex memory behind one front door. You type what you are thinking and it routes: a bare phrase searches, a bare number reuses the list you just saw, a date shows that day. Run `cmem --help` for the task-grouped cheat sheet. There are six things you actually do.

### 1. Look around — "what was I doing?"

```bash
cmem                          # latest sessions, numbered
cmem 20                       # the latest 20 instead of the default 10
cmem yesterday                # one day (also: cmem 2026-06-16, cmem today)
cmem repo                     # everything for the repo you are in
cmem repo "/Users/you/repo"   # or name one; repo names substring-match, so cmem repo pixelforge works
```

Every row is numbered and stamped with a relative time ("2h ago", "23d ago"), so yesterday's session and last month's are not two indistinguishable UUIDs.

### 2. Find — "that session about X"

Just type it. An unknown first word is treated as search text, never an error:

```bash
cmem mlir lowering            # search everything for "mlir lowering"
cmem AGNTS --fuzzy            # typo-tolerant; find also auto-falls back to fuzzy on 0 exact hits
cmem mlir --cwd ~/firedrake   # scope to one repo
```

`cmem find <text>` and `cmem search <text>` are the same command spelled out. For the captured-query lane (recorded search terms rather than session text) use `cmem query <text>` — see [Search Lanes](#search-lanes) below.

### 3. Read — "show me that one"

```bash
cmem open 2                   # read row #2 from the list you just printed
cmem open sox locomotion      # free text works too when it resolves to one session
cmem open codex:019d...       # or the exact id
```

`cmem open` prints a conversation-first transcript with `<system-reminder>` harness blocks stripped out, so you see the actual conversation instead of prompt scaffolding. Add `--timeline` for the raw tool/reasoning timeline, or `--q <text>` to filter inside the transcript.

### 4. Continue — "pick it back up in Codex"

```bash
cmem resume 2                 # paste-ready reload brief for that session
cmem continue 2               # reopen it live: runs `codex resume <uuid>`
cmem continue 2 "keep going on the bufferization fix"   # resume with an opening prompt
```

`cmem resume` shapes a bounded brief and prints the `codex resume <uuid>` handoff at the bottom. `cmem continue` skips the copy step and launches Codex for you. See [Continuing Into Codex](#continuing-into-codex) for the archived-thread caveat.

### 5. Keep — "remember this one"

```bash
cmem pin 2                    # bookmark it
cmem note 2 "why it matters"  # attach a note
cmem tag 2 important          # add a tag
cmem saved                    # list everything you kept
cmem open saved:1             # open the first saved session
```

Pins, notes, and tags live in a separate annotation overlay, never in the rollout files, so they survive an index rebuild.

### 6. Health — "is cmem OK?"

```bash
cmem status                   # config, index counts, live Codex connection
cmem doctor                   # index health verdict
cmem doctor --rebuild         # re-derive every session doc (pins/notes/tags always survive)
```

`cmem doctor` leads with a plain verdict ("index healthy — N sessions" or "index degraded — run: cmem doctor --rebuild") instead of a raw file listing.

## How Refs Work

Anywhere `cmem` wants one session (`open`, `resume`, `continue`, `pin`, `note`, `tag`, ...), the reference can be:

- a **number** — follows the list you just saw. Every list (`cmem`, `cmem <search>`, `cmem yesterday`, `cmem saved`, `cmem threads`) snapshots its order to `<indexDir>/cmem-last-list.json`, so `cmem open 2` always means "the second row I just looked at".
- `latest` or `latest:N` — always latest-session order, regardless of the last list. `latest` is the newest, `latest:3` the third newest.
- `saved` / `saved:N` — the Nth saved (annotated) session.
- `bookmark` / `bookmark:N` — the Nth bookmarked (pinned) session.
- `codex:<id>` — the exact Codex thread id.
- **free text** — resolved by search. A unique hit auto-resolves (with a note on stderr: `resolved "..." → codex:...`); an ambiguous phrase prints a numbered pick list and exits 1, so you rerun with `cmem open <number>`.

Unknown `--flags` are rejected loudly instead of silently swallowing their value, and empty search/date arguments are rejected with usage, so a typo never quietly changes what you get back.

## Continuing Into Codex

`cmem continue <ref|text> ["prompt"]` hands a session back to the live Codex CLI. It resolves the ref, then runs `codex resume <uuid>` (appending your prompt as the opening turn when you pass one). With `--print` or `--json` it prints the command instead of launching it, so you can wire it into your own flow:

```bash
cmem continue 2 --print       # prints: codex resume 019d...
cmem continue latest "resume where we left off"
```

One caveat, grounded in Codex itself: **archived threads do not resume.** The app-server rejects an archived resume with "session {id} is archived. Run `codex unarchive {id}` to unarchive it first." So if `cmem continue` fails on an archived thread, unarchive it first and retry:

```bash
cmem unarchive codex:019d...
cmem continue codex:019d...
```

### Priming: continue with the context already loaded

`cmem continue <ref> --prime` goes one step further than the handoff: before launching Codex it persists a "where you left off" block into the thread's history, so the model starts the next turn already knowing the state of the work — no prompt-pasting.

The block is exactly the reload-safety-governed resume text (if `cmem resume` would withhold it, priming refuses too), injected as a single developer-role message wrapped in `<cmem_resume_context>` markers. Developer role matters: Codex treats it as model-visible background, keeps it out of its auto-memory store, and hides it from transcript displays — the model sees it, the scaffold stays invisible.

Priming **forks by default**, so your original thread is never touched; you continue the primed fork. `--prime-in-place` is the explicit opt-in to inject into the original thread instead:

```bash
cmem continue 2 --prime                 # fork + inject + codex resume <fork>
cmem continue 2 --prime --print         # do the prime, print the handoff instead of launching
cmem continue 2 --prime-in-place       # inject into the original (persisted mutation)
```

Power-CLI equivalent: `node history.js prime <session_id> [--in-place]`.

## Power Users

Everything above is the friendly front door. The full surface — exact thread lists with all bridge metadata, artifacts, areas, family, workstream, raw source/history-mode overrides, and JSON on every command — lives in `history.js`:

```bash
node history.js --help
```

`cmem` composes the same store as `history.js`, so when you outgrow the six verbs you can drop down without losing anything.

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
