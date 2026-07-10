"use strict";

const path = require("path");
const { createHistoryStore } = require("./history-store");
const { quoteShellArg, formatChoiceList } = require("./cli-text");
const {
  buildBridgeMetadataPatchFromArgs,
  normalizeBridgeThreadMemoryModeArgument,
  runHistoryBridgeCommand,
} = require("./history-cli-bridge-actions");
const { createHistoryCliBridgeView } = require("./history-cli-bridge-view");
const { createHistoryCliCatalogView } = require("./history-cli-catalog-view");
const { createHistoryCliDispatch } = require("./history-cli-dispatch");
const { createHistoryCliHistoryView } = require("./history-cli-history-view");
const { createHistoryCliMetaView } = require("./history-cli-meta-view");
const {
  buildCatalogCommonFilters,
  buildCatalogQueryFilters,
  buildCatalogArtifactContextFilters,
  buildStructuredMatchFilters,
} = require("./catalog-filters");
const {
  BRIDGE_CANONICAL_THREAD_SORT_KEYS,
  BRIDGE_CANONICAL_THREAD_SOURCE_KINDS,
} = require("./app-server-thread-contract");
const { createArgReaders } = require("./input-validation");
const {
  getQueryMatchSignalTier,
  classifyQuerySignal,
  summarizeLowSignalQueryMatches,
} = require("./session-search");
const PATH_ROLE_ORDER = ["read", "search_scope", "list_scope", "write"];
const BRIDGE_THREAD_SORT_HELP_TEXT = formatChoiceList(BRIDGE_CANONICAL_THREAD_SORT_KEYS);
const BRIDGE_THREAD_SOURCE_KIND_HELP_TEXT = BRIDGE_CANONICAL_THREAD_SOURCE_KINDS.join(", ");

function createHistoryCliError(message, code = "HISTORY_INVALID_ARGUMENT") {
  const err = new Error(message);
  err.code = code;
  return err;
}

const {
  readRequiredOptionValue,
  readRequiredIntegerOptionValue,
  readPositiveIntegerOptionValue,
  readNonNegativeIntegerOptionValue,
} = createArgReaders({ errorFactory: createHistoryCliError });

function isHistoryCliUserError(err) {
  const code = err && typeof err.code === "string" ? err.code : "";
  return code === "HISTORY_INVALID_ARGUMENT" || code.startsWith("APP_SERVER_INVALID_");
}

function formatHistoryCliError(err) {
  if (isHistoryCliUserError(err) && err && typeof err.message === "string") {
    return err.message;
  }
  if (err && typeof err.stack === "string" && err.stack) return err.stack;
  if (err && typeof err.message === "string" && err.message) return err.message;
  return String(err);
}

function getHistoryCliScriptDisplayPath(options = {}) {
  const rawScriptPath = typeof options.scriptPath === "string"
    ? options.scriptPath.trim()
    : (typeof process.argv[1] === "string" ? process.argv[1].trim() : "");
  if (!rawScriptPath) return "history.js";

  const cwd = typeof options.cwd === "string" && options.cwd
    ? path.resolve(options.cwd)
    : process.cwd();
  const absoluteScriptPath = path.isAbsolute(rawScriptPath)
    ? rawScriptPath
    : path.resolve(cwd, rawScriptPath);
  const relativePath = path.relative(cwd, absoluteScriptPath).replace(/\\/g, "/");

  if (!relativePath || relativePath.startsWith("..")) {
    return path.basename(absoluteScriptPath) || "history.js";
  }
  return relativePath;
}

function getHistoryCliInvocationCommand(options = {}) {
  const npmLifecycleEvent = typeof options.npmLifecycleEvent === "string"
    ? options.npmLifecycleEvent
    : process.env.npm_lifecycle_event;
  if (npmLifecycleEvent === "history") return "npm run history --";
  return `node ${quoteShellArg(getHistoryCliScriptDisplayPath(options))}`;
}

function parseArgs(argv) {
  const args = {
    command: "list",
    json: false,
    pretty: false,
  };

  let index = 0;
  if (argv[0] && !argv[0].startsWith("--")) {
    args.command = argv[0];
    index = 1;
  }

  for (; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--pretty") args.pretty = true;
    else if (arg === "--compact") args.compact = true;
    else if (arg === "--session-dir") args.sessionDir = readRequiredOptionValue(argv, index, "--session-dir"), index += 1;
    else if (arg === "--index-dir") args.indexDir = readRequiredOptionValue(argv, index, "--index-dir"), index += 1;
    else if (arg === "--limit") args.limit = readPositiveIntegerOptionValue(argv, index, "--limit"), index += 1;
    else if (arg === "--offset") args.offset = readNonNegativeIntegerOptionValue(argv, index, "--offset"), index += 1;
    else if (arg === "--family-limit") args.familyLimit = readPositiveIntegerOptionValue(argv, index, "--family-limit"), index += 1;
    else if (arg === "--family-offset") args.familyOffset = readNonNegativeIntegerOptionValue(argv, index, "--family-offset"), index += 1;
    else if (arg === "--turn-limit") args.turnLimit = readPositiveIntegerOptionValue(argv, index, "--turn-limit"), index += 1;
    else if (arg === "--event-limit") args.eventLimit = readPositiveIntegerOptionValue(argv, index, "--event-limit"), index += 1;
    else if (arg === "--live-window-ms") args.liveWindowMs = readPositiveIntegerOptionValue(argv, index, "--live-window-ms"), index += 1;
    else if (arg === "--budget-chars") args.budgetChars = readPositiveIntegerOptionValue(argv, index, "--budget-chars"), index += 1;
    else if (arg === "--item-chars") args.itemChars = readPositiveIntegerOptionValue(argv, index, "--item-chars"), index += 1;
    else if (arg === "--tool-chars") args.toolChars = readPositiveIntegerOptionValue(argv, index, "--tool-chars"), index += 1;
    else if (arg === "--line-limit") args.lineLimit = readPositiveIntegerOptionValue(argv, index, "--line-limit"), index += 1;
    else if (arg === "--item-limit") args.itemLimit = readPositiveIntegerOptionValue(argv, index, "--item-limit"), index += 1;
    else if (arg === "--highlight-limit") args.highlightLimit = readPositiveIntegerOptionValue(argv, index, "--highlight-limit"), index += 1;
    else if (arg === "--trim-strategy") args.trimStrategy = readRequiredOptionValue(argv, index, "--trim-strategy"), index += 1;
    else if (arg === "--tool-text") args.toolText = readRequiredOptionValue(argv, index, "--tool-text"), index += 1;
    else if (arg === "--reload-policy") args.reloadPolicy = readRequiredOptionValue(argv, index, "--reload-policy"), index += 1;
    else if (arg === "--source") args.source = readRequiredOptionValue(argv, index, "--source"), index += 1;
    else if (arg === "--history-mode") args.historyMode = readRequiredOptionValue(argv, index, "--history-mode"), index += 1;
    else if (arg === "--cursor") args.cursor = readRequiredOptionValue(argv, index, "--cursor"), index += 1;
    else if (arg === "--drop-last") args.dropLast = readPositiveIntegerOptionValue(argv, index, "--drop-last"), index += 1;
    else if (arg === "--through-turn" || arg === "--keep-through-turn") args.throughTurn = readRequiredOptionValue(argv, index, arg), index += 1;
    else if (arg === "--name") args.name = readRequiredOptionValue(argv, index, "--name"), index += 1;
    else if (arg === "--mode") args.mode = readRequiredOptionValue(argv, index, "--mode"), index += 1;
    else if (arg === "--sort" || arg === "--sort-key") args.sortKey = readRequiredOptionValue(argv, index, "--sort"), index += 1;
    else if (arg === "--sort-direction") args.sortDirection = readRequiredOptionValue(argv, index, "--sort-direction"), index += 1;
    else if (arg === "--state-db-only") args.useStateDbOnly = true;
    else if (arg === "--rebuild") args.rebuild = true;
    else if (arg === "--items-view") args.itemsView = readRequiredOptionValue(argv, index, "--items-view"), index += 1;
    else if (arg === "--objective") args.objective = readRequiredOptionValue(argv, index, "--objective"), index += 1;
    else if (arg === "--goal-status") args.goalStatus = readRequiredOptionValue(argv, index, "--goal-status"), index += 1;
    else if (arg === "--token-budget") args.tokenBudget = readPositiveIntegerOptionValue(argv, index, "--token-budget"), index += 1;
    else if (arg === "--clear-token-budget") args.clearTokenBudget = true;
    else if (arg === "--clear") args.clearGoal = true;
    else if (arg === "--git-branch") args.gitBranch = readRequiredOptionValue(argv, index, "--git-branch"), index += 1;
    else if (arg === "--git-sha") args.gitSha = readRequiredOptionValue(argv, index, "--git-sha"), index += 1;
    else if (arg === "--git-origin-url") args.gitOriginUrl = readRequiredOptionValue(argv, index, "--git-origin-url"), index += 1;
    else if (arg === "--clear-git-branch") args.clearGitBranch = true;
    else if (arg === "--clear-git-sha") args.clearGitSha = true;
    else if (arg === "--clear-git-origin-url") args.clearGitOriginUrl = true;
    else if (arg === "--archived") {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        args.archived = next;
        index += 1;
      } else {
        args.archived = true;
      }
    }
    else if (arg === "--q") args.q = readRequiredOptionValue(argv, index, "--q"), index += 1;
    else if (arg === "--query") args.query = readRequiredOptionValue(argv, index, "--query"), index += 1;
    else if (arg === "--model-provider") {
      if (!Array.isArray(args.modelProviders)) args.modelProviders = [];
      args.modelProviders.push(readRequiredOptionValue(argv, index, "--model-provider"));
      index += 1;
    }
    else if (arg === "--source-kind") {
      if (!Array.isArray(args.sourceKinds)) args.sourceKinds = [];
      args.sourceKinds.push(readRequiredOptionValue(argv, index, "--source-kind"));
      index += 1;
    }
    else if (arg === "--q-mode") args.qMode = readRequiredOptionValue(argv, index, "--q-mode"), index += 1;
    else if (arg === "--query-mode") args.queryMode = readRequiredOptionValue(argv, index, "--query-mode"), index += 1;
    else if (arg === "--value") args.value = readRequiredOptionValue(argv, index, "--value"), index += 1;
    else if (arg === "--cwd") args.cwd = readRequiredOptionValue(argv, index, "--cwd"), index += 1;
    else if (arg === "--area") args.area = readRequiredOptionValue(argv, index, "--area"), index += 1;
    else if (arg === "--session-id") args.sessionId = readRequiredOptionValue(argv, index, "--session-id"), index += 1;
    else if (arg === "--session-key") args.sessionKey = readRequiredOptionValue(argv, index, "--session-key"), index += 1;
    else if (arg === "--forked-from") args.forkedFrom = readRequiredOptionValue(argv, index, "--forked-from"), index += 1;
    else if (arg === "--parent-thread") args.parentThread = readRequiredOptionValue(argv, index, "--parent-thread"), index += 1;
    else if (arg === "--lineage-root" || arg === "--root-session") args.lineageRoot = readRequiredOptionValue(argv, index, arg), index += 1;
    else if (arg === "--bookmarked") args.bookmarked = true;
    else if (arg === "--manual-tag") {
      if (!Array.isArray(args.manualTags)) args.manualTags = [];
      args.manualTags.push(readRequiredOptionValue(argv, index, "--manual-tag"));
      index += 1;
    }
    else if (arg === "--tool") args.tool = readRequiredOptionValue(argv, index, "--tool"), index += 1;
    else if (arg === "--kind") args.kind = readRequiredOptionValue(argv, index, "--kind"), index += 1;
    else if (arg === "--reason") args.reason = readRequiredOptionValue(argv, index, "--reason"), index += 1;
    else if (arg === "--status") args.status = readRequiredOptionValue(argv, index, "--status"), index += 1;
    else if (arg === "--turn") args.turn = readRequiredOptionValue(argv, index, "--turn"), index += 1;
    else if (arg === "--file") args.file = readRequiredOptionValue(argv, index, "--file"), index += 1;
    else if (arg === "--path") args.path = readRequiredOptionValue(argv, index, "--path"), index += 1;
    else if (arg === "--path-pattern") args.pathPattern = readRequiredOptionValue(argv, index, "--path-pattern"), index += 1;
    else if (arg === "--path-role") args.pathRole = readRequiredOptionValue(argv, index, "--path-role"), index += 1;
    else if (arg === "--command-op") args.commandOp = readRequiredOptionValue(argv, index, "--command-op"), index += 1;
    else if (arg === "--command-op-signal") args.commandOpSignal = readRequiredOptionValue(argv, index, "--command-op-signal"), index += 1;
    else if (arg === "--command-type") args.commandType = readRequiredOptionValue(argv, index, "--command-type"), index += 1;
    else if (arg === "--memory-mode") args.memoryMode = readRequiredOptionValue(argv, index, "--memory-mode"), index += 1;
    else if (arg === "--event-mode") args.eventMode = readRequiredOptionValue(argv, index, "--event-mode"), index += 1;
    else if (arg === "--quality-class") args.qualityClass = readRequiredOptionValue(argv, index, "--quality-class"), index += 1;
    else if (arg === "--error") args.error = readRequiredOptionValue(argv, index, "--error"), index += 1;
    else if (arg === "--bookmark") args.bookmark = true;
    else if (arg === "--unbookmark") args.bookmark = false;
    else if (arg === "--tag") {
      if (!Array.isArray(args.tags)) args.tags = [];
      args.tags.push(readRequiredOptionValue(argv, index, "--tag"));
      index += 1;
    }
    else if (arg === "--remove-tag") {
      if (!Array.isArray(args.removeTags)) args.removeTags = [];
      args.removeTags.push(readRequiredOptionValue(argv, index, "--remove-tag"));
      index += 1;
    }
    else if (arg === "--note") args.note = readRequiredOptionValue(argv, index, "--note"), index += 1;
    else if (arg === "--clear-note") args.clearNote = true;
    else if (arg === "--clear-tags") args.clearTags = true;
    else if (arg === "--has") {
      if (!Array.isArray(args.has)) args.has = [];
      args.has.push(readRequiredOptionValue(argv, index, "--has"));
      index += 1;
    }
    else if (!args.target && !arg.startsWith("--")) args.target = arg;
    else if (!args.target2 && !arg.startsWith("--")) args.target2 = arg;
  }

  return args;
}

function printHelp(invocationCommand = getHistoryCliInvocationCommand()) {
  console.log(`Browse historical Codex rollout history

Usage:
  ${invocationCommand} overview [options]
  ${invocationCommand} list [options]
  ${invocationCommand} search --q <text> [options]
  ${invocationCommand} schema [options]
  ${invocationCommand} threads [options]
  ${invocationCommand} thread-search --q <text> [--limit <n>] [--cursor <c>] [--sort <k>] [--sort-direction <d>] [--source-kind <k>] [--archived]
  ${invocationCommand} thread-turns <session_id> [--cursor <c>] [--limit <n>] [--sort-direction <d>] [--items-view <notLoaded|summary|full>]
  ${invocationCommand} goal <session_id> [--objective <text>] [--goal-status <s>] [--token-budget <n>] [--clear-token-budget] [--clear]
  ${invocationCommand} loaded [options]
  ${invocationCommand} thread <session_id> [options]
  ${invocationCommand} name <session_id> --value <text>
  ${invocationCommand} metadata <session_id> [--git-branch <text>] [--git-sha <text>] [--git-origin-url <text>] [--clear-git-branch] [--clear-git-sha] [--clear-git-origin-url]
  ${invocationCommand} memory-mode <session_id> --mode <enabled|disabled>
  ${invocationCommand} archive <session_id>
  ${invocationCommand} unarchive <session_id>
  ${invocationCommand} prune-turns <session_id> [options]
  ${invocationCommand} prune-preview <session_id> (--drop-last <n> | --through-turn <id>) [options]
  ${invocationCommand} fork-prune <session_id> (--drop-last <n> | --through-turn <id>) [--name <text>] [options]
  ${invocationCommand} turn-search [options]
  ${invocationCommand} transcript <session_id> [options]
  ${invocationCommand} resume <session_id> [options]
  ${invocationCommand} turn <session_id> --turn <turn_id> [options]
  ${invocationCommand} artifact-turns --kind <kind> --value <text> [options]
  ${invocationCommand} path-thread --value <path> [options]
  ${invocationCommand} related <session_id> [options]
  ${invocationCommand} family <session_id> [options]
  ${invocationCommand} workstream <session_id> [options]
  ${invocationCommand} annotate-session <session_id> [annotation-options]
  ${invocationCommand} annotate-turn <session_id> --turn <turn_id> [annotation-options]
  ${invocationCommand} projects [options]
  ${invocationCommand} areas [options]
  ${invocationCommand} area --cwd <path> --area <root> [options]
  ${invocationCommand} project --cwd <path> [options]
  ${invocationCommand} artifacts [options]
  ${invocationCommand} artifact --kind <kind> --value <text> [options]
  ${invocationCommand} session <session_id> [options]
  ${invocationCommand} turns <session_id> [options]
  ${invocationCommand} events <session_id> [options]
  ${invocationCommand} stats [options]
  ${invocationCommand} doctor [options]

Options:
  --session-dir <p>  Override ~/.codex/sessions
  --index-dir <p>    Override ~/.codex/memories/clawd-codex-history
  --limit <n>        Limit result count (> 0)
  --offset <n>       Skip the first N browse results before returning a page (>= 0)
  --family-limit <n> Limit returned lineage-family peer sessions in workstream views (> 0)
  --family-offset <n> Skip the first N lineage-family peer sessions in workstream views (>= 0)
  --turn-limit <n>   Limit matched turns per artifact detail (> 0)
  --event-limit <n>  Limit per-thread timeline events (> 0)
  --live-window-ms <n> Consider rollout files updated within N ms as live candidates in doctor (> 0)
  --rebuild         Doctor only: re-derive every session doc from its rollout (annotations kept)
  --budget-chars <n> Total output budget for resume text (> 0)
  --item-chars <n>   Per-message trim budget for resume shaping (> 0)
  --tool-chars <n>   Per-tool-output trim budget for resume shaping (> 0)
  --line-limit <n>   Per-item line limit for resume shaping (> 0)
  --item-limit <n>   Max shaped items per resumed turn (> 0)
  --highlight-limit <n> Limit file/path/query/error lists in resume (> 0)
  --trim-strategy <s> head, tail, or middle
  --tool-text <m>   Resume tool text mode: salient, full, or none
  --reload-policy <p> Resume reload safety: warn (default), strict, or allow
  --source <s>      transcript/resume source: auto, app-server, or rollout
  --history-mode <m> effective (default) or raw rollout history
  --cursor <c>      Bridge pagination cursor for threads/loaded
  --sort <k>        Bridge thread sort: ${BRIDGE_THREAD_SORT_HELP_TEXT}
  --sort-direction <d> Bridge thread sort direction: asc or desc
  --state-db-only   Bridge thread list from the state DB only (skip JSONL repair scan)
  --items-view <v>  thread-turns detail level: notLoaded, summary (default), or full
  --objective <t>   Goal objective text for goal set
  --goal-status <s> Goal status: active, paused, blocked, usageLimited, budgetLimited, complete
  --token-budget <n> Goal token budget (> 0); --clear-token-budget removes it
  --clear           Goal only: clear the thread goal
  --through-turn <id> Keep history through this turn and drop newer turns
  --drop-last <n>   Drop the last N turns in prune preview / fork-prune (> 0)
  --name <text>     Name to apply to a newly forked pruned thread
  --mode <text>     Set exact app-server thread memory mode (enabled or disabled)
  --git-branch <text> Set persisted app-server git branch metadata for one thread
  --git-sha <text>  Set persisted app-server git sha metadata for one thread
  --git-origin-url <text> Set persisted app-server git origin URL metadata for one thread
  --clear-git-branch Clear persisted app-server git branch metadata
  --clear-git-sha   Clear persisted app-server git sha metadata
  --clear-git-origin-url Clear persisted app-server git origin URL metadata
  --archived [b]    Bridge thread filter; default true when flag is present
  --model-provider <id> Exact bridge thread provider filter; repeat for multiple providers
  --source-kind <k> Exact bridge thread source filter; repeat for multiple kinds
                    canonical kinds: ${BRIDGE_THREAD_SOURCE_KIND_HELP_TEXT}
  --q <text>         Full-text query
  --q-mode <m>       Session browse q matching for search/list: substring (default), exact, or fuzzy
  --query <text>     Captured harness/web search query filter
  --query-mode <m>   Captured query matching where --query is supported: substring (default), exact, or fuzzy
  --value <text>     Exact artifact value for artifact detail
  --cwd <text>       Filter or select a project cwd
  --area <root>      Narrow project detail to one derived project area/focus root
  --session-id <id>  Filter by session id
  --session-key <k>  Filter by unique rollout key (usually the rollout file basename)
  --forked-from <id> Filter by direct fork parent thread id
  --parent-thread <id> Filter by direct subagent parent thread id
  --lineage-root <id> Filter by derived lineage root thread id
  --bookmarked       Filter to manually bookmarked sessions or turns
  --manual-tag <t>   Require a manual annotation tag; repeat to require multiple tags
  --tool <name>      Filter by tool
  --kind <name>      Filter timeline events by kind or artifact kind
  --reason <text>    Filter doctor output by build/reuse reason text
  --status <name>    Filter turn status
  --turn <id>        Filter by turn id
  --file <path>      Filter by touched file path
  --path <path>      Filter by referenced path (read/search/write)
  --path-pattern <p> Filter by referenced non-literal path scope (AGENTS.md, *.test.js, !build/**)
  --path-role <r>    Filter path memory by role: read, search_scope, list_scope, write
  --command-op <op>  Filter by extracted shell operation (sed, rg, python3, ...)
  --command-op-signal <tier> Filter command-op signal tier: high, medium, low
                     artifact kinds: file, path, path_pattern, tool, command, command_op, query, error
  --command-type <t> Filter by harness command type (read, search, list_files, ...)
  --memory-mode <m>  Filter by rollout memory mode (enabled, disabled, polluted)
  --event-mode <m>   Filter by rollout event mode (extended_observed, limited_or_unknown)
  --quality-class <c> Filter derived session quality (rich_extended, useful_limited, partial_investigation, error_only, aborted_empty, answer_only, other_low_signal)
  --error <text>     Filter by error text
  --bookmark         Set manual bookmark=true for annotate-session / annotate-turn
  --unbookmark       Set manual bookmark=false for annotate-session / annotate-turn
  --tag <text>       Add a manual annotation tag; repeat for multiple tags
  --remove-tag <t>   Remove a manual annotation tag; repeat for multiple tags
  --note <text>      Set a manual annotation note
  --clear-note       Clear the manual annotation note
  --clear-tags       Clear all manual annotation tags
  --has <tag>        Filter by tag; repeat to require multiple tags
                     common tags: has_extended_events, memory_disabled, memory_polluted
  --json             Emit JSON
  --pretty           Pretty-print JSON
  --compact          Use compact JSON shape for browse/list commands like search, turn-search, projects, artifacts, artifact, artifact-turns, related, and workstream
  --help             Show this message
`);
  console.log(`
Start Here:
  ${invocationCommand} overview
  ${invocationCommand} list --quality-class rich_extended --limit 5
  ${invocationCommand} list --quality-class partial_investigation --limit 10
  ${invocationCommand} transcript <session_id>
  ${invocationCommand} resume <session_id> --reload-policy strict
`);
}

function formatCommandSummary(entry) {
  if (!entry || !entry.command) return "";
  const annotations = [];
  if (Array.isArray(entry.commandTypes) && entry.commandTypes.length) {
    annotations.push(entry.commandTypes.join(","));
  }
  if (Array.isArray(entry.commandTypeHints) && entry.commandTypeHints.length) {
    annotations.push(`hints=${entry.commandTypeHints.join(", ")}`);
  }
  if (Array.isArray(entry.commandPaths) && entry.commandPaths.length) {
    annotations.push(entry.commandPaths.slice(0, 2).join(", "));
  }
  if (Array.isArray(entry.commandPathPatterns) && entry.commandPathPatterns.length) {
    annotations.push(`patterns=${entry.commandPathPatterns.slice(0, 2).join(", ")}`);
  }
  if (Array.isArray(entry.commandQueries) && entry.commandQueries.length) {
    annotations.push(`q=${formatQueryValueList(entry.commandQueries, 2, 48)}`);
  }
  if (Array.isArray(entry.shellCommands) && entry.shellCommands.length) {
    annotations.push(`ops=${entry.shellCommands.slice(0, 4).join(", ")}`);
  }
  return annotations.length ? `${entry.command} [${annotations.join(" | ")}]` : entry.command;
}

function formatQuerySummary(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return formatQueryDisplayValue(entry);
  if (typeof entry.query !== "string") return "";
  const query = formatQueryDisplayValue(entry.query);
  return entry.actionType ? `${query} (${entry.actionType})` : query;
}

function formatValueList(values, max = 6) {
  if (!Array.isArray(values) || !values.length) return "";
  const shown = values.slice(0, max).join(", ");
  return values.length > max ? `${shown} (+${values.length - max} more)` : shown;
}

function formatQueryDisplayValue(value, max = 96) {
  const text = typeof value === "string"
    ? value.replace(/\s+/g, " ").trim()
    : "";
  if (!text) return "";
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

function formatQueryValueList(values, max = 6, itemMax = 96) {
  if (!Array.isArray(values) || !values.length) return "";
  const displayed = [];
  const seen = new Set();
  for (const value of values) {
    const text = formatQueryDisplayValue(value, itemMax);
    if (!text) continue;
    const normalized = text.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    displayed.push(text);
  }
  return formatValueList(displayed, max);
}

function toDisplayPath(value, cwd = "") {
  const base = typeof cwd === "string" ? cwd.trim() : "";
  const target = typeof value === "string" ? value.trim() : "";
  if (!base || !target || !path.isAbsolute(base) || !path.isAbsolute(target)) return target;
  const relative = path.relative(base, target);
  if (!relative || relative === "") return ".";
  if (relative.startsWith("..") || path.isAbsolute(relative)) return target;
  return relative.split(path.sep).join("/");
}

function formatPathValueList(values, cwd = "", max = 6) {
  if (!Array.isArray(values) || !values.length) return "";
  const displayed = values.map((value) => toDisplayPath(value, cwd));
  return formatValueList(displayed, max);
}

function formatAnnotationSummary(annotation) {
  if (!annotation || typeof annotation !== "object") return "";
  const parts = [];
  if (annotation.bookmarked) parts.push("bookmarked");
  if (Array.isArray(annotation.tags) && annotation.tags.length) {
    parts.push(`tags=${annotation.tags.join(",")}`);
  }
  if (typeof annotation.note === "string" && annotation.note) {
    parts.push(`note=${annotation.note}`);
  }
  return parts.join(" | ");
}

function printAnnotationLines(annotation, label = "manual") {
  const summary = formatAnnotationSummary(annotation);
  if (!summary) return;
  console.log(`${label}: ${summary}`);
}

function buildAnnotationPatchFromArgs(args) {
  return {
    bookmarked: args.bookmark,
    addTags: Array.isArray(args.tags) ? args.tags : [],
    removeTags: Array.isArray(args.removeTags) ? args.removeTags : [],
    note: typeof args.note === "string" ? args.note : undefined,
    clearNote: args.clearNote === true,
    clearTags: args.clearTags === true,
  };
}

function hasAnnotationPatch(patch) {
  return (
    patch.bookmarked === true ||
    patch.bookmarked === false ||
    patch.clearNote === true ||
    patch.clearTags === true ||
    (typeof patch.note === "string") ||
    (Array.isArray(patch.addTags) && patch.addTags.length > 0) ||
    (Array.isArray(patch.removeTags) && patch.removeTags.length > 0)
  );
}

function getEntityCommandOps(entity) {
  if (!entity || typeof entity !== "object") return [];
  if (Array.isArray(entity.commandOps) && entity.commandOps.length) return entity.commandOps;
  if (Array.isArray(entity.commandOpArtifacts) && entity.commandOpArtifacts.length) return entity.commandOpArtifacts;
  return [];
}

function getMatchedCommandOps(entity) {
  if (!entity || typeof entity !== "object") return [];
  return Array.isArray(entity.matchedCommandOps) ? entity.matchedCommandOps : [];
}

function getMatchedFiles(entity) {
  if (!entity || typeof entity !== "object") return [];
  return Array.isArray(entity.matchedFiles) ? entity.matchedFiles : [];
}

function getMatchedPaths(entity) {
  if (!entity || typeof entity !== "object") return [];
  return Array.isArray(entity.matchedPaths) ? entity.matchedPaths : [];
}

function getMatchedPathPatterns(entity) {
  if (!entity || typeof entity !== "object") return [];
  return Array.isArray(entity.matchedPathPatterns) ? entity.matchedPathPatterns : [];
}

function normalizeMatchedQueryValue(value) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").toLowerCase()
    : "";
}

function getMatchedQueries(entity) {
  if (!entity || typeof entity !== "object") return [];
  const values = Array.isArray(entity.matchedQueries) ? entity.matchedQueries : [];
  if (!values.length) return [];

  const hidden = new Set();
  if (entity.match && entity.match.kind === "query" && typeof entity.match.text === "string") {
    const matchKey = normalizeMatchedQueryValue(entity.match.text);
    if (matchKey) hidden.add(matchKey);
  }
  if (typeof entity.query === "string") {
    const queryKey = normalizeMatchedQueryValue(entity.query);
    if (queryKey) hidden.add(queryKey);
  }

  const result = [];
  const seen = new Set();
  for (const value of values) {
    const key = normalizeMatchedQueryValue(value);
    if (!key || hidden.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function formatPathPatternKindLabel(value) {
  switch (value) {
    case "basename_filter":
      return "basename filter";
    case "glob_scope":
      return "glob scope";
    case "scoped_filter":
      return "scoped filter";
    case "exclude_pattern":
      return "exclude pattern";
    case "pattern":
      return "pattern";
    default:
      return "";
  }
}

function formatCommandOpSignalLabel(value) {
  switch (value) {
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
    default:
      return "";
  }
}

function formatQuerySignalLabel(value) {
  switch (value) {
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
    default:
      return "";
  }
}

function formatRolloutPersistenceSummary(persistence) {
  if (!persistence || typeof persistence !== "object") return "";
  return [
    "rollout",
    persistence.memoryMode ? `memory=${persistence.memoryMode}` : "",
    persistence.eventMode ? `events=${persistence.eventMode}` : "",
  ].filter(Boolean).join("  ");
}

function printRolloutPersistenceDetails(persistence) {
  if (!persistence || typeof persistence !== "object") return;
  const summary = formatRolloutPersistenceSummary(persistence);
  if (summary) console.log(summary);
  if (Array.isArray(persistence.observedEventKeys) && persistence.observedEventKeys.length) {
    console.log(`extended-events: ${persistence.observedEventKeys.join(", ")}`);
  }
  if (typeof persistence.note === "string" && persistence.note) {
    console.log(`rollout note: ${persistence.note}`);
  }
}

function printHistoryQualityDetails(quality) {
  if (!quality || typeof quality !== "object") return;
  const summary = [
    `quality=${quality.mode || "unknown"}`,
    quality.sourceUsed ? `source=${quality.sourceUsed}` : "",
    quality.historyMode ? `history=${quality.historyMode}` : "",
    quality.memoryMode ? `memory=${quality.memoryMode}` : "",
    quality.eventMode ? `events=${quality.eventMode}` : "",
  ].filter(Boolean).join("  ");
  if (summary) console.log(summary);
  for (const warning of Array.isArray(quality.warnings) ? quality.warnings : []) {
    console.log(`quality warning: ${warning}`);
  }
  for (const recommendation of Array.isArray(quality.recommendations) ? quality.recommendations : []) {
    console.log(`quality recommendation: ${recommendation}`);
  }
}

function shouldPrintSourceSelection(source) {
  if (!source || typeof source !== "object") return false;
  if (!(typeof source.selectionNote === "string" && source.selectionNote.trim())) return false;
  if (source.selectionReason === "app_server_only_operation") return true;
  return source.requested === "auto" ||
    source.requested !== source.used ||
    source.selectionReason === "raw_history_requires_rollout";
}

function printSourceSelectionDetails(source) {
  if (!shouldPrintSourceSelection(source)) return;
  console.log(`source selection: ${source.selectionNote}`);
}

function printReloadSafetyDetails(reloadSafety) {
  if (!reloadSafety || typeof reloadSafety !== "object") return;
  const summary = [
    `reload=${reloadSafety.decision || "unknown"}`,
    reloadSafety.policy ? `policy=${reloadSafety.policy}` : "",
    reloadSafety.severity ? `severity=${reloadSafety.severity}` : "",
    reloadSafety.recommendedSource ? `best_source=${reloadSafety.recommendedSource}` : "",
  ].filter(Boolean).join("  ");
  if (summary) console.log(summary);
  for (const reason of Array.isArray(reloadSafety.reasons) ? reloadSafety.reasons : []) {
    console.log(`reload note: ${reason}`);
  }
  for (const recommendation of Array.isArray(reloadSafety.recommendations) ? reloadSafety.recommendations : []) {
    console.log(`reload recommendation: ${recommendation}`);
  }
  if (Array.isArray(reloadSafety.suggestedFlags) && reloadSafety.suggestedFlags.length) {
    console.log(`reload flags: ${reloadSafety.suggestedFlags.join(" ")}`);
  }
}

function formatPathRoleLabel(role) {
  if (role === "search_scope") return "search";
  if (role === "list_scope") return "list";
  return role;
}

function formatPathRoleSummary(pathRoles, max = 2, cwd = "") {
  if (!pathRoles || typeof pathRoles !== "object") return "";
  const parts = [];
  for (const role of PATH_ROLE_ORDER) {
    const values = Array.isArray(pathRoles[role]) ? pathRoles[role] : [];
    if (!values.length) continue;
    const shown = formatPathValueList(values, cwd, max);
    parts.push(`${formatPathRoleLabel(role)}=${shown}`);
  }
  return parts.join(" | ");
}

function formatPathRoleList(roles) {
  return (Array.isArray(roles) ? roles : [])
    .map(formatPathRoleLabel)
    .join(", ");
}

const {
  printSessionList,
  printSessionDetail,
  printTurnList,
  printTurnDetail,
  printTranscript,
  printResume,
  printEventList,
} = createHistoryCliHistoryView({
  getQueryMatchSignalTier,
  classifyQuerySignal,
  summarizeLowSignalQueryMatches,
  formatCommandSummary,
  formatQuerySummary,
  formatValueList,
  formatQueryDisplayValue,
  formatQueryValueList,
  formatPathValueList,
  printAnnotationLines,
  formatRolloutPersistenceSummary,
  printSourceSelectionDetails,
  printRolloutPersistenceDetails,
  printHistoryQualityDetails,
  printReloadSafetyDetails,
  formatPathRoleSummary,
  getEntityCommandOps,
  getMatchedCommandOps,
  getMatchedFiles,
  getMatchedPaths,
  getMatchedPathPatterns,
  getMatchedQueries,
});

const {
  printArtifactList,
  printArtifactDetail,
  printArtifactTurnList,
  printPathThread,
  printRelatedSessions,
  printProjectList,
  printAreaList,
  printAreaDetail,
  printProjectDetail,
  printTurnSearch,
  printFamilyDetail,
  printWorkstreamDetail,
} = createHistoryCliCatalogView({
  path,
  formatPathPatternKindLabel,
  formatCommandOpSignalLabel,
  formatQuerySignalLabel,
  formatPathRoleLabel,
  formatPathRoleSummary,
  formatPathRoleList,
  formatValueList,
  formatPathValueList,
  formatQueryValueList,
  printAnnotationLines,
  getEntityCommandOps,
  getMatchedCommandOps,
  getMatchedFiles,
  getMatchedPaths,
  getMatchedPathPatterns,
  getMatchedQueries,
});

const {
  buildBridgeThreadListHints,
  printBridgeThreadList,
  printBridgeThreadSearch,
  printBridgeThreadTurns,
  printBridgeGoal,
  printBridgeLoadedThreads,
  printBridgeThread,
  printPruneCandidates,
  printPrunePreview,
  printForkPrune,
  printBridgeThreadLifecycle,
} = createHistoryCliBridgeView({
  quoteShellArg,
  getHistoryCliInvocationCommand,
  shouldPrintSourceSelection,
  printSourceSelectionDetails,
  printHistoryQualityDetails,
  formatValueList,
});

const {
  buildOverviewResult,
  printSchemaProfile,
  printStats,
  printDoctor,
  printOverview,
  printAnnotationUpdate,
} = createHistoryCliMetaView({
  buildCatalogCommonFilters,
  getHistoryCliInvocationCommand,
  formatPathPatternKindLabel,
  formatCommandOpSignalLabel,
  formatQuerySignalLabel,
  formatQueryDisplayValue,
  printAnnotationLines,
});

const {
  runHistoryCliCommand,
  renderHistoryCliCommandResult,
} = createHistoryCliDispatch({
  createHistoryCliError,
  runHistoryBridgeCommand,
  buildOverviewResult,
  buildCatalogQueryFilters,
  buildCatalogArtifactContextFilters,
  buildStructuredMatchFilters,
  buildAnnotationPatchFromArgs,
  hasAnnotationPatch,
  printOverview,
  printSessionList,
  printAreaList,
  printAreaDetail,
  printSchemaProfile,
  printBridgeThreadList,
  printBridgeThreadSearch,
  printBridgeThreadTurns,
  printBridgeGoal,
  printBridgeLoadedThreads,
  printBridgeThread,
  printBridgeThreadLifecycle,
  printPruneCandidates,
  printPrunePreview,
  printForkPrune,
  printTranscript,
  printResume,
  printTurnDetail,
  printTurnSearch,
  printArtifactTurnList,
  printPathThread,
  printRelatedSessions,
  printFamilyDetail,
  printWorkstreamDetail,
  printProjectList,
  printProjectDetail,
  printArtifactList,
  printArtifactDetail,
  printSessionDetail,
  printAnnotationUpdate,
  printTurnList,
  printEventList,
  printStats,
  printDoctor,
});

async function main() {
  const invocationCommand = getHistoryCliInvocationCommand();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp(invocationCommand);
    return;
  }

  const store = createHistoryStore({
    sessionDir: args.sessionDir,
    indexRoot: args.indexDir,
    refreshMs: 0,
  });

  try {
    const output = await runHistoryCliCommand(store, args, { invocationCommand });

    if (args.json) {
      console.log(JSON.stringify(output, null, args.pretty ? 2 : 0));
      return;
    }

    const renderResult = renderHistoryCliCommandResult(args, output, { invocationCommand });
    if (renderResult && Number.isInteger(renderResult.exitCode) && renderResult.exitCode !== 0) {
      process.exitCode = renderResult.exitCode;
    }
  } finally {
    if (store && typeof store.close === "function") await Promise.resolve(store.close());
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(formatHistoryCliError(err));
    process.exit(1);
  });
}

module.exports = {
  buildBridgeMetadataPatchFromArgs,
  buildBridgeThreadListHints,
  formatQueryDisplayValue,
  formatQueryValueList,
  normalizeBridgeThreadMemoryModeArgument,
  parseArgs,
  getHistoryCliScriptDisplayPath,
  getHistoryCliInvocationCommand,
  shouldPrintSourceSelection,
};
