# Standalone Codex Backend

This directory extracts the Codex-only backend path out of the Electron app.

What is included:

- `config.js`: Codex CLI event mapping from `agents/codex.js`
- `parser.js`: normalized Codex JSONL parser for richer event extraction
- `log-monitor.js`: JSONL tailer from `agents/codex-log-monitor.js`
- `state-machine.js`: session aggregation distilled from `src/state.js`
- `catalog.js`: historical session catalog, workspace/project views, turn ledger, and event timeline builder
- `history-store.js`: persistent materialized history index, workspace/artifact read models, and incremental reuse layer
- `server.js`: standalone HTTP API and history surface distilled from `src/server.js`
- `remote-monitor.js`: SSH/remote polling helper adapted from `hooks/codex-remote-monitor.js`
- `analytics.js`: derived intent/focus/stats layer built on normalized records
- `schema-profile.js`: raw rollout schema profiler for event-key and field coverage audits
- `text-shaper.js`: bounded text shaping utilities for resume-oriented session views
- `app-server-bridge.js`: stdio JSON-RPC bridge to `codex app-server` for exact thread reads and narrow official thread-control mutations
- `inspect.js`: CLI to inspect and normalize a rollout file
- `history.js`: CLI to browse session history without raw JSONL grep
- `index.js`: standalone entrypoint that wires the pieces together

What is intentionally not included:

- Electron
- renderer code
- SVG/theme logic
- tray/menu/window code
- permission bubble UI

## Product Boundary

This backend is a **Codex history harness**, not a general Codex client.

Its job is:

- keep rollout JSONL as physical source truth
- use `codex app-server` as the official exact read/mutation bridge
- build rebuildable derived session docs and read models on top
- keep manual bookmarks/tags/notes in a separate overlay

Its job is **not**:

- replace Codex as the main thread/turn execution client
- invent local source-of-truth metadata that Codex itself does not own
- mutate raw rollout JSONL directly
- blur exact bridge state together with derived catalog state

That means the bridge surface here should stay narrow and recovery-oriented:

- exact thread discovery and inspection
- official persisted thread controls like name, git metadata, memory eligibility, archive/unarchive
- safe history-preserving prune flows built from `thread/read`, `thread/fork`, and `thread/rollback`

If a new feature mainly helps retrieval, recovery, or trustworthy thread curation, it belongs here.
If it mainly turns this repo into a second full Codex execution client, it probably does not.

## Local Usage

Run the standalone backend:

```bash
npm start
```

By default it:

- watches `~/.codex/sessions`
- exposes an HTTP API on `127.0.0.1:24633-24637`
- writes the chosen port to `~/.clawd-codex/runtime.json`
- materializes a reusable history index under `~/.codex/memories/clawd-codex-history`
- prints state transitions as JSON lines on stdout
- keeps structured recent event history, token usage, messages, commands, patches, searches, MCP calls, and errors per session
- derives per-session analytics like intent, focus, command/search/patch stats, and token-window pressure
- backfills recent context from existing rollout files on startup so active sessions are not invisible until the next line arrives
- ignores duplicate replayed records so remote monitor restarts do not inflate session metrics
- builds a historical catalog so old sessions can be searched by text, file path, tool, error, and tags instead of raw `grep`
- reconstructs turns and exposes a normalized per-session event timeline for deeper inspection
- distinguishes effective history from raw rollout history, so rollback-trimmed tails can be hidden by default or inspected explicitly in forensic mode
- exposes a readable transcript view so one session can be inspected as user/assistant/tool history instead of raw JSONL blocks
- exposes a resume view that trims and omits low-signal tool output under tunable budgets, so old work can be safely loaded back into Codex
- makes resume path memory role-aware, so compact reload context shows recent path focus like `read`, `search`, `list`, and `write` instead of one flat path bucket
- preserves low-confidence shell structure from multiline harness commands as cleaned `shellCommands` plus `commandTypeHints`, so complex shell snippets stay readable without widening exact path memory
- indexes those cleaned shell operations as exact `command_op` artifacts, so cross-session `sed` / `rg` / `awk` / `python3` usage can be found without raw-grepping giant command strings
- classifies `command_op` artifacts into derived `high`, `medium`, and `low` signal tiers so browsing favors task-specific ops like `sed`, `rg`, `find`, and `awk` ahead of lower-signal shell habits like `ls`, `cat`, and `echo`
- exposes rollout persistence coverage per session, so missing detail is explained in terms of Codex persistence policy instead of looking like parser failure
- classifies sessions into derived quality buckets like `rich_extended`, `useful_limited`, `partial_investigation`, and `aborted_empty`, so archive browsing can separate strong revisit candidates from thin or interrupted sessions
- uses `codex app-server` when available for exact `thread/read`-backed transcript and resume views, with rollout fallback when the bridge is unavailable
- exposes official bridge-backed thread discovery and naming, so exact session metadata can be managed without opening raw rollout files
- recognizes persisted `thread_rolled_back` markers so rollout-derived sessions, turns, transcripts, and event timelines follow the same surviving history Codex will resume
- exposes safe prune tooling around the official bridge: inspect exact cutoff turns, preview a suffix trim from exact `thread/read`, then create a persisted fork and apply `thread/rollback` there instead of mutating raw JSONL
- exposes a cross-session turn ledger so prompts, answers, commands, and failures are searchable at turn granularity
- builds workspace/project views so `cwd` becomes a first-class retrieval path
- builds harness-aware path memory so files Codex inspected are searchable separately from files it changed
- splits harness path memory into exact roles: `read`, `search_scope`, `list_scope`, and `write`, so retrieval can distinguish inspected files from changed files
- indexes harness search terms from `parsed_cmd.query`, so old grep/find/search intent is recoverable as query memory
- builds cross-session artifact ledgers for files, paths, tools, commands, queries, and errors
- derives fork/subagent lineage and exposes family drilldown, so one Codex work thread can be recovered across the root session plus later forks and subagents
- builds workstreams on top of lineage, so one root family plus same-project related sessions can be recovered as one broader problem thread
- rolls manual bookmarks/tags/notes up into workstreams, so important sessions and turns are surfaced as explicit recovery highlights instead of passive per-item metadata
- links related sessions inside a workspace by exact shared files, paths, queries, and commands
- reuses unchanged rollout files when rebuilding the history index, instead of reparsing everything every time
- automatically rebuilds cached session docs when the stored schema or inferred harness metadata is stale
- stores manual bookmarks, tags, and notes in a separate annotation layer, so sessions and turns can be marked as important without mutating rollout JSONL or session docs
- profiles raw rollout keys and normalized field coverage so parser drift is visible when Codex log structure changes

Useful flags:

```bash
node index.js --port 24635
node index.js --session-dir /tmp/codex-sessions
node index.js --index-dir /tmp/codex-history-index
node index.js --no-server
node index.js --no-monitor
node index.js --backfill-ms 900000
node index.js --tail-kb 512
node index.js --quiet
```

Browse history directly:

```bash
npm run history -- overview
npm run history -- list --limit 10
npm run history -- search --q "401 Unauthorized"
npm run history -- search --query "feature-toggle"
npm run history -- search --query "feature-toggle" --json --pretty --compact
npm run history -- search --limit 20 --offset 20
npm run history -- search --has has_extended_events
npm run history -- search --event-mode extended --limit 5
npm run history -- list --quality-class rich_extended --limit 5
npm run history -- list --quality-class partial_investigation --limit 10
npm run history -- schema --q "exec_command_end" --limit 5
npm run history -- threads --limit 20
npm run history -- threads --sort updated_at --model-provider openai --source-kind sub-agent-thread-spawn
npm run history -- loaded
npm run history -- thread codex:019d...
npm run history -- name codex:019d... --value "Codex backend parser work"
npm run history -- metadata codex:019d... --git-branch main --clear-git-sha
npm run history -- memory-mode codex:019d... --mode disabled
npm run history -- archive codex:019d...
npm run history -- unarchive codex:019d...
npm run history -- prune-turns codex:019d... --limit 8
npm run history -- prune-preview codex:019d... --drop-last 1
npm run history -- prune-preview codex:019d... --through-turn turn-17
npm run history -- fork-prune codex:019d... --through-turn turn-17 --name "Trimmed fork"
npm run history -- turn-search --q "npm test"
npm run history -- turn-search --event-mode extended --has memory_disabled --limit 10
npm run history -- turn-search --path "codex/catalog.js" --command-type read
npm run history -- turn-search --cwd "/Users/jerzha01/clawd-on-desk" --command-op sed --limit 10
npm run history -- turn-search --path "codex/catalog.js" --path-role read --limit 10
npm run history -- search --cwd "/Users/jerzha01/clawd-on-desk" --command-op sed --limit 5
npm run history -- search --query "dokcer" --query-mode fuzzy --limit 5
npm run history -- search --q "implemnt feature toggle" --q-mode fuzzy --limit 5
npm run history -- search --lineage-root codex:019d... --limit 20
npm run history -- transcript codex:019d... --source app-server --limit 20
npm run history -- transcript codex:019d... --path "codex/history.js" --command-type read --limit 20
npm run history -- transcript codex:019d... --command-op sed --source rollout --limit 20
npm run history -- resume codex:019d... --source app-server --turn-limit 3 --budget-chars 12000 --tool-text salient
npm run history -- resume codex:019d... --reload-policy strict
npm run history -- resume codex:019d... --history-mode raw --source rollout --reload-policy allow
npm run history -- resume codex:019d... --turn-limit 3 --budget-chars 12000 --tool-text salient
npm run history -- annotate-session codex:019d... --bookmark --tag important --note "resume from here"
npm run history -- annotate-turn codex:019d... --turn turn-17 --tag fix --note "approval flow"
npm run history -- list --bookmarked
npm run history -- turn-search --manual-tag fix
npm run history -- turn codex:019d... --turn turn-1
npm run history -- path-thread --value "/Users/jerzha01/clawd-on-desk/codex/catalog.js" --cwd "/Users/jerzha01/clawd-on-desk" --path-role read --event-limit 20
npm run history -- related codex:019d...
npm run history -- related codex:019d... --json --pretty --compact
npm run history -- family codex:019d... --limit 5 --turn-limit 5
npm run history -- workstream codex:019d... --family-limit 5 --limit 5 --turn-limit 8
npm run history -- workstream codex:019d... --area "codex" --family-limit 5 --limit 5 --turn-limit 8
npm run history -- workstream codex:019d... --family-limit 3 --limit 3 --turn-limit 6 --json --pretty --compact
npm run history -- artifact-turns --kind command --value "git status --short" --cwd "/Users/jerzha01/clawd-on-desk"
npm run history -- artifact-turns --kind path --value "/Users/jerzha01/clawd-on-desk/codex/catalog.js" --path-role read --json --pretty --compact
npm run history -- artifact-turns --kind command_op --value "sed" --cwd "/Users/jerzha01/clawd-on-desk"
npm run history -- artifact-turns --kind path_pattern --value "codex/test/*.test.js" --cwd "/Users/jerzha01/clawd-on-desk" --path-role search_scope
npm run history -- projects --limit 20
npm run history -- areas --cwd "/Users/jerzha01" --limit 20
npm run history -- area --cwd "/Users/jerzha01" --area "docker_audit_2026-04-09.md"
npm run history -- project --cwd "/Users/jerzha01/clawd-on-desk"
npm run history -- project --cwd "/Users/jerzha01" --area "docker_audit_2026-04-09.md"
npm run history -- artifacts --kind path --q "codex/catalog.js" --path-role read --limit 20
npm run history -- artifacts --kind path_pattern --q "*.test.js" --cwd "/Users/jerzha01/clawd-on-desk" --limit 20
npm run history -- artifacts --kind command_op --q "sed" --limit 20
npm run history -- artifacts --kind command_op --command-op-signal high --limit 20
npm run history -- artifacts --kind command_op --limit 20
npm run history -- artifacts --kind query --q "feature-toggle" --json --pretty --compact
npm run history -- artifact --kind command --value "git status --short"
npm run history -- artifact --kind command --value "git status --short" --json --pretty --compact
npm run history -- doctor --status rebuilt --limit 20
npm run history -- session codex:019d...
npm run history -- session rollout-2026-04-09T15-10-51-019d23d4-f1a9-7633-b9c7-758327137228
npm run history -- session codex:019d... --history-mode raw
npm run history -- turns codex:019d...
npm run history -- events codex:019d... --tool exec_command --path "codex/catalog.js" --limit 50
npm run history -- stats
```

Simple daily CLI:

```bash
npm install -g .

cmem
cmem status
cmem latest
cmem latest 3
cmem 20
cmem date today
cmem date 2026-04-09
cmem yesterday
cmem all
cmem "mlir lowering"
cmem find "AGENTS.md"
cmem query "feature-toggle"
cmem open latest
cmem open saved
cmem resume bookmark
cmem resume latest
cmem continue latest
cmem saved
cmem pin latest
cmem tag latest important
cmem note latest "resume from here"
cmem clear-note latest
cmem bookmarks
cmem repo "/Users/you/repo"
cmem use .
cmem doctor
cmem config init
cmem config show
cmem config set cwd "/Users/you/repo"
cmem config set limit 20
cmem config unset cwd
```

This global package is intentionally harness-only: it installs the local history tools, not the nested upstream `codex/` checkout or the test suite.
Exact thread workflows such as `cmem threads`, `archive`, and `unarchive` still require a working `codex` CLI on `PATH`, because the harness shells out to `codex app-server`.

Use `cmem` as the simple front door. You type what you are thinking and it routes: a bare phrase searches, a bare number is the latest N, a date like `yesterday` or `2026-06-16` is that day, and an unknown first word is treated as search text rather than an error.

- `cmem`: overview + latest sessions
- `cmem <anything>`: search all history, e.g. `cmem mlir lowering` (typos tolerated; add `--cwd <path>` to scope to one repo)
- `cmem status`: config + index + bridge health, plus saved/bookmarked counts when present
- `cmem latest [n]`: latest sessions. The positional `n` overrides the configured default limit for this command; explicit `--limit` still overrides both.
- `cmem date <day>`: sessions on one date
- `cmem all`: all sessions
- `cmem find <text>`: broad search across sessions
- `cmem query <text>`: captured query search by substring; add `--exact` for exact matching or `--fuzzy` for typo-tolerant matching, with a `match:` line showing the captured query that hit. When fuzzy results only come from low-signal filename/glob filters like `AGENTS.md`, `cmem` now says so explicitly and suggests `--exact`, `--cwd`, or broad `cmem find`. `--json` also exposes `match.signalTier` on query matches plus a top-level `querySignalSummary` for the current result page.
- `cmem open <id|latest|n>`: concise conversation-first transcript view. The simple plain-text path prints a native session summary plus recent user/assistant transcript items; add `--timeline` when you want the recent raw tool/reasoning timeline in the same front door, or use `--q <text>` to narrow the transcript and get an explicit native filter summary. Use `history.js transcript` when you want the richer metadata-heavy raw timeline.
- `cmem resume <id|latest|n>`: safe resume, `strict` by default. The simple front door now prints a concise native summary first, then the bounded resume text. `--q <text>` narrows the resume and says how many turns remain. It still uses the same exact-vs-derived resume surface as `history.js resume`, so app-server source-selection and reload-safety notes can appear when `auto` chooses exact `thread/read`. The resume output also prints the `codex resume <uuid>` handoff.
- `cmem continue <id|latest|n> ["prompt"]`: reopen one session live in Codex by running `codex resume <uuid>` (append a quoted prompt as the opening turn). `--print` or `--json` prints the command instead of launching it. Archived threads must be `cmem unarchive`d first, because Codex refuses to resume an archived thread.
- `cmem saved`: bookmark-first view of all saved sessions (bookmarks, tags, or notes)
- `cmem pin <id|latest|n>`: bookmark one session
- `cmem tag <id|latest|n> <tag...>`: add one or more session tags
- `cmem note <id|latest|n> <text>`: add one short session note
- `cmem clear-note <id|latest|n>`: clear one session note
- `cmem bookmarks`: strict bookmark list, ordered by your latest manual touch on those sessions
- `cmem repo <cwd>`: concise repo summary with hot files/areas and recent sessions
- `cmem threads`: concise exact app-server thread list with open/resume/archive next steps
- `cmem archive <id|latest|n>` / `cmem unarchive <id|latest|n>`: native exact thread lifecycle actions
- `cmem threads --sort updated_at --model-provider openai --source-kind cli`: native exact thread filtering without dropping into the power-user view
- `cmem threads --q backend`: native exact thread search term filtering
- `cmem find <text> --fuzzy`: lightweight typo-tolerant session search, with a `match:` line showing the field that matched
- `cmem use [cwd]`: save one default repo into `~/.cmem/config.json`
- `cmem doctor`: deeper rollout/index diagnostics

Every `cmem` list is numbered and timestamped, and the `Try:` footer shows the next commands, so you can move from browse -> open -> resume by row number instead of copying ids.

Session refs work anywhere `cmem` expects one session:

- a bare number follows the list you just saw: every `cmem` list (overview, search, day, `saved`, `threads`) snapshots its order to `<indexDir>/cmem-last-list.json`, so `cmem open 2` means "the second row I just looked at"
- `latest` / `latest:2`: latest-session order, regardless of the last list
- `saved` / `saved:2`: the Nth saved (annotated) session
- `bookmark` / `bookmark:2`: the Nth bookmarked session
- `codex:<id>`: the exact Codex thread id
- free text: resolved by search; a unique hit auto-resolves (with a stderr note), an ambiguous one prints a numbered pick list and exits 1

Unknown `--flags` are rejected instead of silently swallowing their value, and empty `find`/`date` arguments are rejected with usage, so a typo never quietly changes the result.

Keep `history.js` for the deeper power-user surfaces like `events`, `artifacts`, `areas`, `area`, `family`, and `workstream`.

For the power-user search surfaces:

- `--q-mode substring|exact|fuzzy` or `q_mode=...` only applies to session browse (`history.js search` / `list` and `GET /catalog`)
- `--query-mode substring|exact|fuzzy` or `query_mode=...` applies anywhere the captured-query lane is filterable, including `history.js search`, `turn-search`, `turn`, `events`, `transcript`, `resume`, `projects`, `project`, `areas`, `area`, `family`, `workstream`, and the matching `GET /catalog*` endpoints

Session browse rows carry a `match` object when a non-default mode finds a session, and the human CLI prints it as `match: kind=value`. Query matches now also carry `match.signalTier` (`high`, `medium`, `low`) in JSON/API output, and fuzzy captured-query session browse returns `querySignalSummary` when the current result page is entirely low-signal query matches. Low-signal captured query matches are labeled as such in human output, so `AGENTS.md`-style filename/glob hits do not masquerade as semantic query matches. Deeper project/area/family/workstream and turn/transcript/resume/event responses now also report the active `queryMode`, so fuzzy query matching stays explicit outside the session list too.

`cmem` also has a native config home:

```text
~/.cmem/config.json
```

This is intentionally a **config layer**, not a second source of truth.

- By default, `cmem` still reads sessions from `~/.codex/sessions`
- By default, it still uses the shared history index at `~/.codex/memories/clawd-codex-history`
- `~/.cmem/config.json` is where you set your own defaults like `cwd`, `limit`, `source`, `reloadPolicy`, or an explicit custom `indexDir`

Example:

```json
{
  "version": 1,
  "paths": {
    "sessionDir": "~/.codex/sessions",
    "indexDir": "~/.codex/memories/clawd-codex-history"
  },
  "defaults": {
    "cwd": "/Users/you/repo",
    "limit": 10,
    "source": "auto",
    "historyMode": "effective",
    "reloadPolicy": "strict"
  }
}
```

If you want `cmem` to keep its own separate index, point it there explicitly:

```json
{
  "paths": {
    "indexDir": "~/.cmem/index"
  }
}
```

Simplest flow:

```bash
# 1. See what is worth revisiting right now
npm run history -- overview

# 2. Open a strong session as a readable conversation
npm run history -- transcript codex:019d...

# 3. Build a safe bounded resume for loading back into Codex
npm run history -- resume codex:019d... --reload-policy strict

# 4. Narrow to one repo when the archive is large
npm run history -- project --cwd "/Users/you/repo"
```

For a shorter operator guide focused on daily usage, see [docs/codex-history-harness.md](./docs/codex-history-harness.md).
For the deeper design model behind the harness, see [docs/codex-history-system-model.md](./docs/codex-history-system-model.md).
For upstream bridge parity and current intentionally unsupported methods, see [docs/codex-history-source-grounding.md](./docs/codex-history-source-grounding.md).
For the canonical docs home for each stable feature family plus subsystem ownership and runtime checkpoints, see [docs/codex-history-docs-map.md](./docs/codex-history-docs-map.md).
For the current maintainer map, test layers, and next worthwhile investigation lanes, see [docs/codex-history-maintenance.md](./docs/codex-history-maintenance.md).

Path lookup notes:
- `--path`, path artifacts, and path-thread lookups accept relative inputs like `codex/catalog.js` or `./codex/catalog.js`; add `--cwd` when you want exact project-scoped resolution.
- Exact artifact lookups stay conservative: if a relative path like `src/history.js` could match multiple workspaces and you do not provide `--cwd`, the lookup stays unresolved instead of picking one arbitrarily.
- Exact path artifacts stay literal: wildcard scopes like `codex/test/*.test.js` are not stored as exact path matches.
- `sessionId` is the Codex thread id, but `sessionKey` is the unique rollout-history id. When multiple rollout files share the same `sessionId`, use `--session-key` or the rollout basename for exact historical lookup.
- Forked or subagent rollouts keep their own `sessionId`. If a rollout replays parent history, the harness records that as lineage (`forkedFromId`, `parentThreadId`, `replayedSessionIds`) instead of overwriting the rollout's own identity.
- `--forked-from` narrows to direct forks of one thread id, `--parent-thread` narrows to direct subagent children, and `--lineage-root` narrows to the whole derived family rooted at one thread id.
- `history.js family <session_id>` opens the derived lineage family for one session, with the root session, sibling/child sessions, and recent turns in one view.
- `history.js workstream <session_id>` opens the broader recoverable thread for one session: the root session, paged lineage-family peer sessions, and same-project non-lineage context sessions linked by shared artifacts.
- Non-literal search/list scopes are preserved separately as `path_pattern` artifacts, with the same path-role labels (`search_scope`, `list_scope`, etc.) when Codex provides enough signal.
- `--path-role` / `path_role=` applies to path evidence overall. If you only specify the role, results may match either exact `path` entries or `path_pattern` scopes. Add `--path` or `--path-pattern` when you want to force one lane.
- `path_pattern` keeps both wildcard scopes like `codex/test/*.test.js` and basename-style filters like `AGENTS.md` or `files.cmake`, without mixing them into exact `path` artifacts.
- `path_pattern` artifacts are also classified for readability and ordering as `basename_filter`, `glob_scope`, `scoped_filter`, or `exclude_pattern`, so basename lookups like `files.cmake` prefer the plain filter before broader glob scopes.
- multiline shell scripts now also keep a cleaned exact `command_op` lane for meaningful operations like `sed`, `rg`, `awk`, `python3`, and `basename`; shell scaffolding like `cd`, `set`, `do`, `then`, heredoc bodies, and fake exact shell-command paths are intentionally filtered out.
- `--command-op` and `command_op=` filter the cleaned shell-op lane directly, so `sed` / `rg` / `python3` lookups work across sessions, turns, transcript, project, and event views without depending on raw command-text substring matches.
- `command_op` artifacts also carry a derived `signalTier` (`high`, `medium`, `low`). This only affects browsing order and stats clarity; the underlying exact artifact values are unchanged.
- `--command-op-signal` and `command_op_signal=` make that signal tier queryable too. When you combine them with `--command-op`, both constraints bind to the same extracted op, so `--command-op sed --command-op-signal low` correctly returns no matches.
- `--query` / `query=` filters the captured query lane directly. Use it for harness/web-search intent such as `feature-toggle` or `ENABLE_EXPERIMENTAL_DASHBOARD`; keep `--q` for broader full-text search across previews, answers, commands, and errors.
- `--bookmarked` and `--manual-tag` filter the manual annotation layer. Session browse views match either session annotations or annotated turns inside that session; turn, transcript, and event views narrow directly to the matching annotated turns.
- Exclude scopes keep their filter semantics too: patterns like `!build/**` stay as `exclude_pattern` values instead of being rewritten into path-like forms.
- `--compact` is meant for browse/card views. It now trims long prompt/answer/commentary previews in compact session, turn, related, artifact, and artifact-turn lists, while the default rich views keep fuller previews for drilldown.
- `--offset` pages the main browse/list surfaces (`search`, `turn-search`, `projects`, `artifacts`, `related`, `artifact`, `artifact-turns`) without changing their sort order, so large result sets are navigable beyond the first page.

## HTTP API

- `GET /health`
- `GET /state`
- `GET /sessions`
- `GET /events`
- `GET /analytics`
- `GET /bridge/threads`
- `GET /bridge/loaded`
- `GET /bridge/thread`
- `GET /bridge/prune-turns`
- `POST /bridge/thread/name`
- `POST /bridge/thread/metadata`
- `POST /bridge/thread/memory-mode`
- `POST /bridge/thread/archive`
- `POST /bridge/thread/unarchive`
- `GET /bridge/prune-preview`
- `POST /bridge/thread/fork-prune`
- `GET /catalog`
- `GET /catalog/schema`
- `GET /catalog/turn-search`
- `GET /catalog/transcript`
- `GET /catalog/resume`
- `GET /catalog/turn`
- `GET /catalog/artifact-turns`
- `GET /catalog/path-thread`
- `GET /catalog/related`
- `GET /catalog/family`
- `GET /catalog/workstream`
- `GET /catalog/projects`
- `GET /catalog/areas`
- `GET /catalog/area`
- `GET /catalog/project`
- `GET /catalog/artifacts`
- `GET /catalog/artifact`
- `GET /catalog/session`
- `GET /catalog/turns`
- `GET /catalog/events`
- `GET /catalog/stats`
- `POST /catalog/annotate/session`
- `POST /catalog/annotate/turn`
- `POST /state`

Example:

```bash
curl http://127.0.0.1:24633/state
curl "http://127.0.0.1:24633/catalog?cwd=/Users/jerzha01/clawd-on-desk&command_op=sed"
curl "http://127.0.0.1:24633/catalog?cwd=/Users/jerzha01/clawd-on-desk&command_op_signal=high"
curl "http://127.0.0.1:24633/catalog/transcript?session_id=codex:019d...&command_op=sed&source=rollout"
curl -X POST "http://127.0.0.1:24633/catalog/annotate/session" -H "Content-Type: application/json" -d '{"session_id":"codex:019d...","bookmarked":true,"tags":["important"],"note":"resume from here"}'
curl -X POST "http://127.0.0.1:24633/catalog/annotate/turn" -H "Content-Type: application/json" -d '{"session_id":"codex:019d...","turn_id":"turn-17","tags":["fix"],"note":"approval flow"}'
```

Manual event injection:

```bash
curl -X POST http://127.0.0.1:24633/state \
  -H "Content-Type: application/json" \
  -d '{"state":"working","session_id":"codex:test","event":"response_item:function_call","cwd":"/tmp"}'
```

Record-only injection:

```bash
curl -X POST http://127.0.0.1:24633/state \
  -H "Content-Type: application/json" \
  -d '{"session_id":"codex:test","record":{"timestamp":"2026-01-01T00:00:00.000Z","key":"event_msg:token_count","kind":"token_count","preview":"token count 123","tokenUsage":{"total":{"total_tokens":123},"last":null,"modelContextWindow":258400},"rateLimits":{"limit_id":"codex"}}}'
```

## Parser Coverage

The parser now normalizes more than coarse status transitions. It understands:

- `session_meta`
- `turn_context`
- `task_started`, `task_complete`, `turn_aborted`
- `user_message`, `agent_message`, assistant `response_item:message`
- `agent_reasoning`, `response_item:reasoning`
- `function_call`, `function_call_output`
- `custom_tool_call`, `custom_tool_call_output`
- `web_search_call`, `web_search_end`
- `patch_apply_end`
- `mcp_tool_call_end`
- `token_count`
- `error`
- `compacted`, `context_compacted`
- `thread_rolled_back`

It also summarizes:

- shell commands and approval heuristics
- structured `exec_command_end` payloads, including parsed command text, harness source, command type, exact referenced path, non-literal scope pattern, cwd, exit code, and duration
- structured `error` payloads, including extracted status code, request id, URL, and `cf-ray` when present
- web search action/query details, including multi-query search batches when present
- patch targets and change counts
- command output metadata like exit code and duration when present
- turn model/sandbox/approval context
- session metadata such as CLI version, provider, subagent depth, and agent role

`GET /events` returns compact event summaries with keys like `toolClass`, `toolStatus`, `query`, `actionType`, and `exitCode`, so the backend is useful for inspection and downstream automation, not just state polling.

`GET /analytics` returns derived backend summaries across sessions:

- session intent like `researching`, `implementing`, `testing`, `editing`, `awaiting-approval`, `blocked`
- current focus text
- current and recent activity categories, derived from the latest normalized records instead of only whole-session totals
- activity-category counts
- command success/failure counts
- patch/search/MCP totals
- token window pressure using `last_token_usage` when that is the only context-safe comparison

`GET /catalog` and `history.js` add the first real memory layer on top of the parser:

- schema profile: raw rollout key coverage and normalized field coverage, so parser assumptions can be checked against live history
- session catalog: one document per rollout/session
- turn ledger: reconstructed turn-level summaries with prompt/answer/tool context
- transcript view: readable user/assistant/tool history for one session, with paired tool call/result items where possible
- resume view: bounded session brief with explicit shaping operations, tuned for safe reloading into Codex without dumping full read outputs
- resume path focus: recent non-file path activity is compacted into role-annotated entries like `path [read, search]`, so inspected files stand out without repeating the same path across multiple lines
- turn search: cross-session retrieval over reconstructed turns
- exact turn trace: one turn with its reconstructed timeline, so you can inspect what actually happened after finding it
- artifact-to-turn history: exact file/path/tool/command/query/error values flattened directly to matching turns
- path thread: grouped per-path turn threads that keep the important harness read/search/patch/output/answer chain together
- related sessions: exact cross-session links based on shared workspace artifacts, so old work stops feeling isolated
- family view: one derived lineage family rooted at the original session, with sibling/child forks and subagents grouped into one recoverable work thread
- workstream view: the lineage family plus same-project related sessions merged into one broader recovery surface, so a multi-session problem does not stop at fork boundaries
- workstream manual summary: bookmarked/annotated sessions and turns are counted and surfaced as dedicated highlight cards, so explicit human memory stands out before you scan the whole timeline
- project manual summary: workspace drilldown also rolls bookmarked/annotated sessions and turns up into a separate highlight lane, so important repo history is visible without reordering the normal project timeline
- project browse manual counts: workspace list cards now expose overall manual session/turn counts plus top manual tags, and when filters narrow the match they also expose a separate matched-manual slice, so annotated repos stand out without hiding scope differences
- manual annotations: bookmarks, tags, and notes persisted separately from rollout history, but applied across session, turn, transcript, and event read views
- compact browse shape: JSON browse/list surfaces can return card-style results without embedded heavy session detail, so automation and quick scanning do not need the full session document
- event timeline: normalized per-session event stream, filterable by text, tool, kind, and turn id
- workspace/project views: `cwd` becomes a first-class summary and drilldown surface across many sessions
- artifact lookup: changed files, referenced paths, tools, commands, queries, and errors stay searchable without opening raw JSONL
- path-role filters: path retrieval can now answer “where was this file read?”, “where was it searched?”, “where was it listed?”, and “where was it written?” as separate questions
- persistent index: session docs, workspace summaries, and artifact ledgers are materialized on disk and reused across runs

Artifact meaning stays strict:

- `file`: files changed or touched by patch/apply operations
- `path`: any harness-referenced path, including reads, searches, directory listings, and changed files when available
- `query`: explicit web search queries plus harness search terms from `parsed_cmd.query`

The mental model is:

- raw rollout JSONL stays the source of truth
- `effective` history means the surviving thread history Codex will actually resume after rollback markers are applied
- `raw` history means the physical rollout stream on disk, including rolled-back suffixes kept for forensic inspection
- `codex app-server` is the authoritative exact-read bridge for thread objects and official thread metadata
- schema profile is the raw-shape audit surface over those rollout files
- session docs are the persistent materialized view
- lineage is derived across those session docs from `forkedFromId`, `parentThreadId`, and replayed parent history markers; it is not treated as the rollout's raw identity
- workstreams are derived on top of lineage: lineage sessions are the anchor, and related same-project sessions are secondary context linked by exact shared artifacts
- project/workspace views and artifact ledgers are cross-session lookup tables
- query surfaces (`history.js`, `/catalog/*`, `/bridge/*`) are read views over those materialized structures

Session summaries also expose `rolloutPersistence`:

- `memoryMode` comes from persisted `session_meta.memory_mode`; when it is absent, Codex rollout backfill treats that as `enabled`
- `eventMode=extended_observed` means the rollout includes `event_msg` variants that Codex only persists in Extended mode
- `eventMode=limited_or_unknown` means no extended-only `event_msg` variants were observed in that selected history view; it does not prove the session ran in Limited mode
- supported `ResponseItem` history is persisted independently of the event persistence mode, so tool/message history can still be present even when `eventMode=limited_or_unknown`
- `source`, `sourceKind`, and `sourceDetail` normalize `session_meta.source` into the same shape used by exact app-server thread views, so rollout-derived sessions and exact bridge threads describe `vscode`, `appServer`, and sub-agent sources consistently
- tag filters now include `has_extended_events`, `memory_disabled`, and `memory_polluted`
- query surfaces also accept `memory_mode` / `memoryMode` and `event_mode` / `eventMode`, so rollout coverage becomes directly searchable instead of only visible after opening one session

The materialized index under `~/.codex/memories/clawd-codex-history` is structured as:

- `manifest.json`: build metadata and reuse stats
- `manifest.json` also records the current session-doc schema version used for compatibility checks
- `sessions/*.json`: one normalized session document per rollout file
- `projects.json`: workspace/project summaries keyed by `cwd`
- `artifacts.json`: cross-session artifact ledgers
- `annotations.json`: manual bookmarks, tags, and notes for sessions and turns

`GET /catalog/projects` returns workspace/project summaries:

- `q` filters by project text
- `query` filters the captured query lane directly, and `query_mode=substring|exact|fuzzy` controls how that matching works
- `cwd` filters by project path
- `tool`, `file`, `path`, `path_pattern`, `path_role`, `command_op`, `command_op_signal`, `command_type`, `error`, `has`, `memory_mode`, `event_mode`, `bookmarked`, and `manual_tag` narrow by observed project activity, manual memory, and rollout persistence coverage
- `session_id` or `sessionId` narrows to projects containing one session
- `forked_from`, `parent_thread`, and `lineage_root` also narrow the project view by direct or derived lineage
- `topTools`, `topFiles`, and `topPaths` on project cards are counted by matched turn activity, not just by whether a session touched them once
- `topFocusRoots` exposes the most active in-project roots under the project `cwd`, so broad working directories like `/Users/you` still show the main local work areas separately
- those `topFocusRoots` are intentionally a project-card summary, not a new storage bucket
- `topFiles[*].displayFile` and `topPaths[*].displayPath` provide repo-relative display labels when the exact file/path is inside the project `cwd`
- each returned project card includes overall `manualCounts` and `topManualTags` for the whole matched workspace
- when the current filters narrow the visible project slice, the card also includes `matchedManualCounts` and `matchedTopManualTags` for that filtered subset
- `limit` returns the top matching projects

`GET /catalog/areas` returns derived in-project area cards for one matched parent project/workspace bucket:

- `cwd` selects the exact parent project/workspace path
- `area` narrows to one exact derived area root
- the same structured filters as project browse (`q`, `query`, `tool`, `file`, `path`, `path_pattern`, `path_role`, `command_op`, `command_op_signal`, `command_type`, `error`, `has`, `memory_mode`, `event_mode`, `bookmarked`, `manual_tag`, lineage filters) narrow the matched slice before area cards are derived
- `query_mode=substring|exact|fuzzy` controls how area-card `query` matching works when `query` is set
- each area card includes `cwd`, `root`, `sessionCount`, `turnCount`, top tools/files/paths, recent sessions, and matched manual-memory density (`manualCounts`, `topManualTags`)
- `areas[*].recentSessions[*].focusRoot` is area-scoped for that card; `sessionFocusRoot` preserves the session's broader headline when they differ
- this is a read-model only surface over the matched project slice; it does not create new canonical projects on disk
- `limit` returns the top matching areas

`GET /catalog/area` drills one derived in-project area into matching sessions and turns:

- `cwd` is required
- `area` is required
- the same structured filters as `GET /catalog/project` narrow the matched slice before the direct area view is built
- `query_mode=substring|exact|fuzzy` controls how area-detail `query` matching works when `query` is set
- the response includes `areaMatched`, the matched `area` summary object when one exists, plus matched sessions/turns and the same manual rollup used by project detail
- `areaMatched=false` means the requested area root does not exist in the current filtered slice, but the parent project still does
- this is still a read-model over the parent project slice; it does not create new canonical projects on disk

`GET /catalog/turn-search` returns matching turns across all sessions:

- `q` filters by prompt/answer/commentary/summary text
- `query` filters the captured query lane directly, and `query_mode=substring|exact|fuzzy` controls how that matching works
- `cwd` narrows by workspace path
- `session_id` or `sessionId` narrows to one session
- `forked_from`, `parent_thread`, and `lineage_root` narrow to one direct fork relation or one whole lineage family
- `tool`, `file`, `path`, `command_type`, `error`, `has`, `memory_mode`, and `event_mode` narrow by observed turn activity plus the parent session's rollout coverage
- `turn` narrows by turn id
- `status` narrows by turn status
- `history_mode=effective|raw` switches between Codex-visible surviving history and physical rollout history
- `limit` returns the top matching turns

`GET /catalog/transcript` returns one readable session transcript:

- `session_id` or `sessionId` is required
- `source=auto|app-server|rollout` selects the exact bridge or the derived rollout view
- `history_mode=effective|raw` selects surviving history vs raw rollout history; raw mode is rollout-only
- `q` filters across user/assistant/tool text
- `query` filters the captured harness/web-search query lane directly
- `query_mode=substring|exact|fuzzy` controls how transcript `query` matching works
- `tool`, `kind`, `turn`, `file`, `path`, `command_type`, and `error` narrow transcript items
- `error` is scoped to actual error metadata, not arbitrary assistant/tool text that happens to mention the same words
- tool call/result pairs are merged when they share a `call_id`
- duplicate `task_complete` status text is suppressed when it only repeats the preceding assistant answer
- `limit` returns the last N matching transcript items
- `auto` prefers `codex app-server thread/read` and falls back to rollout parsing when the bridge is unavailable
- for structured transcript filters like `query`, `path`, `file`, `command_type`, `command_op`, or `error`, `auto` will also fall back to rollout when the bridge view returns no matches
- exact bridge reads can work even when the rollout-backed session doc is not currently indexed
- exact assistant items preserve app-server `memoryCitation` data, and transcript `q` / `file` / `path` matching can see citation notes and cited paths
- transcript error items preserve richer metadata across both sources: rollout-derived errors keep fields like `requestId` and `url`, while exact app-server turn errors keep `codexErrorInfo` and `additionalDetails`; both flows derive harness-level `errorCode` / `statusCode` when possible
- transcript responses include `source.selectionReason` and `source.selectionNote`, so `auto` decisions explain whether app-server satisfied the request, the bridge failed, structured transcript filters missed, or raw history forced rollout
- transcript responses now include `quality`, which explains whether the view is `app_server_thread_view`, `derived_extended_rollout`, `derived_limited_rollout`, or `raw_rollout_forensic`
- `quality.warnings` and `quality.recommendations` are meant to guide inspection and reload decisions without mutating the resume/transcript text itself

`GET /catalog/resume` returns a bounded resume-oriented session brief:

- `session_id` or `sessionId` is required
- `source=auto|app-server|rollout` selects the exact bridge or the derived rollout view
- `history_mode=effective|raw` selects surviving history vs raw rollout history; raw mode is rollout-only
- `budget_chars`, `item_chars`, `tool_chars`, `line_limit`, `turn_limit`, `item_limit`, and `highlight_limit` tune shaping budgets
- `trim_strategy=head|tail|middle` controls how long text is trimmed
- `tool_text=salient|full|none` controls tool-output retention
- `reload_policy=warn|strict|allow` controls how the harness evaluates whether the shaped resume text should be loaded back into Codex
- `query_mode=substring|exact|fuzzy` controls how resume `query` matching works when `query` is set
- `salient` keeps high-signal search/error output but omits successful read/listing dumps by default
- the response includes both structured resume data and one assembled `text` block for loading back into Codex
- when resume filters narrow the session, `turnCount` reports the matched slice and `totalTurnCount` preserves the full session size
- filtered resume turns keep contextual turn content, but they also expose exact `matchedQueries`, `matchedFiles`, `matchedPaths`, `matchedPathPatterns`, and `matchedCommandOps` so you can see why each turn matched without dropping the rest of that turn's context
- resume responses include `source.selectionReason` and `source.selectionNote`, so `auto` decisions explain whether app-server satisfied the request, the bridge failed, resume filters missed, or raw history forced rollout
- resume responses also include `quality`, so low-coverage rollout history can be treated differently from richer rollout or app-server-backed history before you paste it back into Codex
- resume responses also include `reloadSafety`, which reports `decision`, `policy`, `allowed`, `reasons`, and suggested flags such as `--history-mode effective` or `--source app-server`
- the CLI `history.js resume` command withholds blocked resume text by default; use `--reload-policy allow` when you intentionally want the raw shaped text anyway

`GET /bridge/threads` returns the official app-server thread list:

- `q` maps to app-server `searchTerm`
- `cwd` narrows to one exact workspace path
- `archived=true|false` filters archived threads
- `sort=created_at|updated_at|recency_at` selects the upstream thread sort key
- `sort_direction=asc|desc` selects the upstream sort direction
- `use_state_db_only=true` lists from the upstream state DB only (skips the JSONL repair scan)
- repeated `model_provider` values filter exact app-server model providers
- repeated `source_kind` values filter exact app-server source kinds such as `cli`, `vscode`, `appServer`, `subAgentReview`, or `subAgentThreadSpawn`; common hyphen/underscore aliases are normalized by the harness
- `cursor` continues bridge pagination
- `limit` limits returned threads
- when omitted, upstream `sourceKinds` still default to interactive thread sources only
- the response includes `source.selectionReason` and `source.selectionNote`, marking the thread list as an exact bridge-only result

`GET /bridge/loaded` returns the thread ids currently loaded in app-server memory:

- `cursor` continues bridge pagination
- `limit` limits returned thread ids
- the response includes `source.selectionReason` and `source.selectionNote`, marking the loaded-thread list as an exact bridge-only result

`GET /bridge/thread` returns one exact app-server thread summary:

- `session_id` or `sessionId` is required
- `include_turns=0` disables exact turn loading; by default turn counts and item types are computed from `thread/read`
- the response includes `source.selectionReason` and `source.selectionNote`, so exact bridge reads stay explicitly separate from rollout-derived catalog views

`GET /catalog/family` returns one derived lineage family:

- `session_id` or `sessionId` is required
- the response includes the resolved `lineageRootId`, the root session summary, matching family sessions, and recent family turns
- `limit` caps returned family sessions
- `turn_limit` / `turnLimit` caps returned family turns
- the same structured filters (`q`, `query`, `tool`, `file`, `path`, `path_pattern`, `path_role`, `command_op`, `command_op_signal`, `command_type`, `error`, `has`, `memory_mode`, `event_mode`) can narrow the family detail view without losing the root context
- `query_mode=substring|exact|fuzzy` controls how family `query` matching works when `query` is set

`GET /catalog/workstream` returns one broader recoverable work thread:

- `session_id` or `sessionId` is required
- the response includes the resolved `lineageRootId`, the root session, paged lineage-family peer sessions, same-project context sessions linked by shared artifacts, and one merged turn timeline
- the response also includes a `manual` rollup with annotated/bookmarked counts, top manual tags, and small session/turn highlight lists ordered by explicit bookmark/tag/note priority
- `limit` and `offset` page the context-session slice
- `family_limit` / `familyLimit` and `family_offset` / `familyOffset` page the lineage-family peer slice; if `family_limit` is omitted it falls back to `limit`
- `turn_limit` / `turnLimit` caps the merged workstream timeline
- `shape=compact` or `compact=1` returns a card-style workstream view with compact root/session/turn summaries and `sharedCounts` instead of full shared artifact lists
- the same structured filters (`q`, `query`, `tool`, `file`, `path`, `path_pattern`, `path_role`, `command_op`, `command_op_signal`, `command_type`, `error`, `has`, `memory_mode`, `event_mode`) narrow the family/context timeline without changing the anchored root session
- `query_mode=substring|exact|fuzzy` controls how workstream `query` matching works when `query` is set

`POST /bridge/thread/name` sets the official user-facing name on one thread:

- body must include `session_id` or `sessionId`
- body must include `name`
- this updates Codex's own persisted thread metadata rather than the rollout-derived index
- the response includes `source.selectionReason` and `source.selectionNote`, marking the renamed thread as an exact bridge-only result

`POST /bridge/thread/metadata` patches the official persisted Git metadata on one thread:

- body must include `session_id` or `sessionId`
- provide `gitInfo.branch`, `gitInfo.sha`, and/or `gitInfo.originUrl` to replace stored values
- or use flat aliases `git_branch`, `git_sha`, `git_origin_url`
- set `clear_git_branch`, `clear_git_sha`, and/or `clear_git_origin_url` to clear stored fields
- omitted fields stay unchanged, while explicit `null` clears a field
- the response returns the refreshed official app-server thread view
- the response includes `source.selectionReason` and `source.selectionNote`, marking the refreshed thread as an exact bridge-only result

`POST /bridge/thread/memory-mode` sets the official persisted memory eligibility on one thread:

- body must include `session_id` or `sessionId`
- body must include `mode` (`enabled` or `disabled`); `memory_mode`, `memoryMode`, and `value` are also accepted aliases
- this uses Codex's experimental `thread/memoryMode/set` mutation path, so it requires an app-server build that supports that method
- Codex currently returns `{}` for the upstream RPC, so this endpoint echoes the accepted `threadId`, `sessionId`, and `memoryMode` instead of pretending `thread/read` can read the mode back
- the local history-store cache is invalidated on success so derived `memory_mode` filters and stats can reflect the updated rollout metadata immediately on the next catalog read
- the response includes `source.selectionReason` and `source.selectionNote`, marking the mutation acknowledgement as an exact bridge-only result

`GET /bridge/prune-turns` lists exact cutoff candidates for safe rollback:

- `session_id` or `sessionId` is required
- optional `limit` caps how many trailing turns are returned
- each candidate represents "keep history through this turn, drop anything newer"
- use this before `prune-preview` or `thread/fork-prune` when choosing a manual cutoff
- the response includes `source.selectionReason` and `source.selectionNote`, marking prune planning as an exact bridge-only operation

`GET /bridge/prune-preview` previews a safe suffix trim using exact app-server thread state:

- `session_id` or `sessionId` is required
- either `drop_last` / `dropLast` or `through_turn` / `throughTurn` is required
- shaping options from `/catalog/resume` are accepted so the previewed resume can be tuned before saving
- this does not mutate the original thread
- the response includes the dropped-turn summaries, the remaining tail, and a bounded resume preview
- prune previews also include `quality`, so thread fidelity warnings stay visible next to the cutoff decision instead of being buried in rollout details
- the response includes `source.selectionReason` and `source.selectionNote`, marking prune previews as exact bridge-only views

`POST /bridge/thread/fork-prune` creates a persisted pruned fork using Codex's own mutation path:

- body must include `session_id` or `sessionId`
- body must include either `drop_last` / `dropLast` or `through_turn` / `throughTurn`
- optional `name` sets the new fork's official thread title after forking
- this uses `thread/fork` with `lastTurnId` (fork through the kept turn in one step); when the server ignores `lastTurnId` (older Codex) it falls back to `thread/rollback` on the new fork, and the result reports which path ran via `prunedVia`
- the original thread is left unchanged
- rollback only changes Codex conversation history; it does not revert file changes in the workspace
- the result includes `quality` plus a resume preview, so the new fork can be judged as a thread object and as reloadable context in the same response
- the response includes `source.selectionReason` and `source.selectionNote`, marking the saved fork as an exact bridge-only result

`GET /catalog/turn` returns one exact reconstructed turn:

- `session_id` or `sessionId` is required
- `turn` is required
- `q`, `query`, `tool`, `path`, `command_type`, and `kind` narrow the returned turn timeline
- `query_mode=substring|exact|fuzzy` controls how turn `query` matching works when `query` is set
- `limit` returns the last N matching timeline events within the turn

`GET /catalog/artifact-turns` returns flat turn history for one exact artifact value:

- `kind=file|path|tool|command|query|error` is required
- `value` is the exact artifact value
- `cwd` and `session_id`/`sessionId` narrow the result
- `status` narrows by turn status
- `limit` returns the top matching turns

`GET /catalog/path-thread` returns grouped path lineage across matching turns:

- `value` is required and may be an absolute path or a path relative to `cwd`
- `cwd` narrows the workspace and resolves relative path values
- `session_id` or `sessionId` narrows to one session
- `turn` narrows to one turn id
- `status` narrows by turn status
- `limit` returns the top matching turn threads
- `event_limit` or `eventLimit` returns the last N compacted events per thread

`GET /catalog/related` returns sessions related to one source session:

- `session_id` or `sessionId` is required
- default scope is the source session's exact `cwd`
- `cwd` can narrow the candidate workspace set further
- boilerplate shell overlap like plain `git status`, `git diff --stat`, `git diff --name-only`, `pwd`, and bare `ls` is ignored
- `limit` returns the top related sessions

`GET /catalog/project` drills one workspace into matching sessions and turns:

- `cwd` is required
- `area` optionally narrows the matched project view to one derived in-project area/focus root
- the same structured filters (`q`, `query`, `tool`, `file`, `path`, `path_pattern`, `path_role`, `command_op`, `command_op_signal`, `command_type`, `error`, `has`, `memory_mode`, `event_mode`, `bookmarked`, `manual_tag`) narrow the project sessions and turns
- `query_mode=substring|exact|fuzzy` controls how project-detail `query` matching works when `query` is set
- `session_id` or `sessionId` narrows to one session within the project
- project sessions include a derived `focusRoot` headline chosen from touched-file roots first, then stronger exact local reads/writes, then weaker local scope signals, so the one-line session label stays useful even when the `cwd` was broad
- project `topFocusRoots` use the same weighted ordering, so broad buckets rank stronger local anchors ahead of incidental search/list roots
- the response includes derived `areas` for the current matched slice, plus `unscopedAreaCounts` for sessions/turns that do not resolve to a local in-project area
- `unscopedAreaReasons` and `unscopedAreaSamples` explain why part of the matched slice stayed unscoped, instead of only returning counts
- `selectedAreaMatched=false` means the requested area does not exist in the current filtered project slice
- the response also includes a `manual` rollup with annotated/bookmarked counts, top manual tags, and small session/turn highlight lists scoped to the matched project view
- `limit` limits returned sessions
- `turn_limit` limits returned turns

`GET /catalog/workstream` opens the recoverable multi-session thread for one session:

- `session_id` or `sessionId` is required
- `cwd` optionally narrows same-project context discovery
- `area` optionally narrows the recovery slice to one derived in-project area while keeping the root/source anchor visible
- the response includes `selectedArea` and `selectedAreaMatched` when an area filter was requested
- `familySessionCount` remains the structural lineage size, while `familySessions`, `contextSessions`, and `turns` are the filtered recovery slice

`GET /catalog/events` returns a condensed event timeline for a single session:

- `session_id` or `sessionId` selects the session
- `q` filters by normalized text
- `query` filters the captured harness/web-search query lane directly
- `query_mode=substring|exact|fuzzy` controls how event `query` matching works
- `tool` filters by tool name
- `path` filters by referenced path
- `command_type` filters by harness command type
- `kind` filters by normalized event kind
- `turn` filters by turn id
- `limit` returns the last N matching events

`GET /catalog/artifacts` returns the cross-session artifact ledgers:

- `kind=file|path|tool|command|query|error` narrows the ledger
- `q` filters by artifact text
- `kind=query` artifacts also carry a derived `signalTier` (`high`, `medium`, `low`), and default browse order prefers higher-signal semantic query terms ahead of low-signal filename/glob filters
- for `kind=error`, `q` can also match richer indexed error metadata like request ids, status codes, and URLs while the visible artifact value stays the human error message
- `cwd` filters by referenced project path
- `session_id` or `sessionId` narrows to one session
- `has`, `memory_mode`, and `event_mode` narrow the referenced sessions by rollout coverage
- `limit` returns the top matching artifacts

`GET /catalog/artifact` drills one artifact value into matching sessions and turns:

- `kind=file|path|tool|command|query|error` is required
- `value` is the exact artifact value to resolve
- for `kind=error`, exact lookup can also resolve through one unambiguous indexed error token such as a request id
- `cwd`, `session_id`/`sessionId`, `has`, `memory_mode`, and `event_mode` narrow the result
- `limit` limits matched sessions
- `turn_limit` limits matched turns per session

`GET /catalog/stats` returns index-materialization stats:

- indexed session/file counts
- reused vs rebuilt rollout files for the current build
- reuse-candidate, reuse-failure, and rebuild-reason counts for the current build
- session-doc schema version for the current materialized index
- indexed project count
- artifact counts by kind
- count of effective-history sessions where extended-only rollout events were actually observed
- memory-mode counts across indexed sessions
- event-mode counts across indexed sessions
- derived session-quality counts across indexed sessions
- top semantic queries plus a separate low-signal query-filter bucket
- top files, paths, tools, and projects by session coverage
- top active files, active paths, active tools, and active projects by turn activity
- manual annotation counts, top manual tags, and top manual projects with per-project session/turn bookmark counts

`GET /catalog/doctor` returns rollout-file health for the current materialized index:

- file-level build status (`reused` vs `rebuilt`)
- per-file build reason when reuse was not possible
- duplicate `sessionId` groups across multiple rollout files
- fork/subagent lineage groups rooted at the parent thread id
- degraded persistence state when the materialized index could not be fully written
- live-candidate rollout files updated within the configured doctor window
- unique `sessionKey` values you can use for exact historical lookup
- `rebuild=1` (CLI: `doctor --rebuild`) re-derives every session doc from its rollout, ignoring mtime/size reuse; manual annotations live in a separate overlay file and always survive

`GET /catalog/schema` returns the raw rollout schema profile:

- `q` filters by event key, field path, or sample text
- `limit` limits returned event keys
- raw fields show what was present in the JSONL payload
- normalized fields show what the parser extracted from those payloads
- use this to spot parser drift or newly appearing harness metadata without opening raw rollout files

Example:

```bash
curl "http://127.0.0.1:24633/catalog?q=feature%20toggle&has=patch"
curl "http://127.0.0.1:24633/catalog?q=implemnt%20feature%20toggle&q_mode=fuzzy"
curl "http://127.0.0.1:24633/catalog?query=dokcer&query_mode=fuzzy"
curl "http://127.0.0.1:24633/catalog?event_mode=extended_observed&limit=10"
curl "http://127.0.0.1:24633/catalog/schema?q=exec_command_end"
curl "http://127.0.0.1:24633/bridge/threads?q=backend&cwd=/Users/jerzha01/clawd-on-desk"
curl "http://127.0.0.1:24633/bridge/threads?q=backend&sort=updated_at&model_provider=openai&source_kind=sub-agent-thread-spawn"
curl "http://127.0.0.1:24633/bridge/thread?session_id=codex:019d..."
curl "http://127.0.0.1:24633/bridge/prune-turns?session_id=codex:019d...&limit=8"
curl "http://127.0.0.1:24633/bridge/prune-preview?session_id=codex:019d...&drop_last=1"
curl "http://127.0.0.1:24633/bridge/prune-preview?session_id=codex:019d...&through_turn=turn-17"
curl -X POST http://127.0.0.1:24633/bridge/thread/fork-prune -H "Content-Type: application/json" -d '{"session_id":"codex:019d...","through_turn":"turn-17","name":"Trimmed fork"}'
curl "http://127.0.0.1:24633/catalog/turn-search?q=npm%20test&cwd=/Users/jerzha01/clawd-on-desk"
curl "http://127.0.0.1:24633/catalog/turn-search?event_mode=extended&has=memory_disabled&limit=10"
curl "http://127.0.0.1:24633/catalog/turn-search?q=patch&history_mode=raw"
curl "http://127.0.0.1:24633/catalog/transcript?session_id=codex:019d...&source=app-server&limit=20"
curl "http://127.0.0.1:24633/catalog/transcript?session_id=codex:019d...&history_mode=raw&source=rollout&limit=20"
curl "http://127.0.0.1:24633/catalog/transcript?session_id=codex:019d...&path=codex/history.js&command_type=read"
curl "http://127.0.0.1:24633/catalog/resume?session_id=codex:019d...&source=app-server&turn_limit=3&budget_chars=12000&tool_text=salient"
curl "http://127.0.0.1:24633/catalog/resume?session_id=codex:019d...&reload_policy=strict"
curl "http://127.0.0.1:24633/catalog/resume?session_id=codex:019d...&history_mode=raw&source=rollout&turn_limit=3"
curl "http://127.0.0.1:24633/catalog/resume?session_id=codex:019d...&turn_limit=3&budget_chars=12000&tool_text=salient"
curl "http://127.0.0.1:24633/catalog/turn?session_id=codex:019d...&turn=turn-1"
curl "http://127.0.0.1:24633/catalog/artifact-turns?kind=file&value=/Users/jerzha01/clawd-on-desk/codex/catalog.js&cwd=/Users/jerzha01/clawd-on-desk"
curl "http://127.0.0.1:24633/catalog/projects?q=clawd-on-desk"
curl "http://127.0.0.1:24633/catalog/project?cwd=/Users/jerzha01/clawd-on-desk"
curl "http://127.0.0.1:24633/catalog/artifacts?kind=command&q=git%20status"
curl "http://127.0.0.1:24633/catalog/artifacts?kind=file&memory_mode=disabled&limit=20"
curl "http://127.0.0.1:24633/catalog/artifact?kind=command&value=git%20status%20--short"
curl "http://127.0.0.1:24633/catalog/session?session_id=codex:019d..."
curl "http://127.0.0.1:24633/catalog/session?session_id=codex:019d...&history_mode=raw"
curl "http://127.0.0.1:24633/catalog/events?session_id=codex:019d...&tool=exec_command&limit=20"
curl "http://127.0.0.1:24633/catalog/stats"
```

## Inspecting A Rollout File

Quick summary:

```bash
node inspect.js ~/.codex/sessions/2026/04/09/rollout-....jsonl
```

Full normalized JSON:

```bash
node inspect.js ~/.codex/sessions/2026/04/09/rollout-....jsonl --json --pretty
```

## Remote Usage

Run the receiver locally:

```bash
npm start
```

Run the remote poller on the remote host:

```bash
node remote-monitor.js --port 24633
```

`remote-monitor.js` posts normalized state updates to the standalone HTTP server. `codex-permission` is sent as `notification` plus `permission_detail`.

## Tests

```bash
npm test
```
