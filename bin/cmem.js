#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { createHistoryStore } = require("../history-store");
const { prefixedSessionId } = require("../history-session-id");
const { createArgReaders, readValidatedInteger } = require("../input-validation");
const {
  readCmemConfig,
  initCmemConfig,
  updateCmemConfig,
  resolveCmemConfigPath,
  createDefaultCmemConfig,
} = require("../cmem-config");
const {
  BRIDGE_CANONICAL_THREAD_SORT_KEYS,
  BRIDGE_CANONICAL_THREAD_SOURCE_KINDS,
} = require("../app-server-thread-contract");

const BRIDGE_THREAD_SORT_HELP_TEXT = `${BRIDGE_CANONICAL_THREAD_SORT_KEYS[0]} or ${BRIDGE_CANONICAL_THREAD_SORT_KEYS[1]}`;
const BRIDGE_THREAD_SOURCE_KIND_HELP_TEXT = BRIDGE_CANONICAL_THREAD_SOURCE_KINDS.join(", ");

const DEFAULT_LIMIT = 10;
const REF_LOOKUP_LIMIT = 100000;

function createCmemError(message, code = "HISTORY_INVALID_ARGUMENT") {
  const err = new Error(message);
  err.code = code;
  return err;
}

const {
  readRequiredOptionValue,
  readPositiveIntegerOptionValue,
} = createArgReaders({ errorFactory: createCmemError });

function isCmemUserError(err) {
  const code = err && typeof err.code === "string" ? err.code : "";
  return code === "HISTORY_INVALID_ARGUMENT" || code.startsWith("APP_SERVER_INVALID_");
}

function formatCmemError(err) {
  if (isCmemUserError(err) && err && typeof err.message === "string") return err.message;
  if (err && typeof err.stack === "string" && err.stack) return err.stack;
  if (err && typeof err.message === "string" && err.message) return err.message;
  return String(err);
}

// --- Argument parsing -------------------------------------------------------

function parseArgs(argv) {
  const args = {
    json: false,
    pretty: false,
    positionals: [],
    modelProviders: [],
    sourceKinds: [],
  };
  let command = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--pretty") args.pretty = true;
    else if (arg === "--no-config") args.noConfig = true;
    else if (arg === "--timeline") args.timeline = true;
    else if (arg === "--exact") args.exact = true;
    else if (arg === "--fuzzy") args.fuzzy = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--session-dir") { args.sessionDir = readRequiredOptionValue(argv, index, "--session-dir"); index += 1; }
    else if (arg === "--index-dir") { args.indexDir = readRequiredOptionValue(argv, index, "--index-dir"); index += 1; }
    else if (arg === "--config") { args.config = readRequiredOptionValue(argv, index, "--config"); index += 1; }
    else if (arg === "--quality" || arg === "--quality-class") { args.qualityClass = readRequiredOptionValue(argv, index, arg); index += 1; }
    else if (arg === "--source") { args.source = readRequiredOptionValue(argv, index, "--source"); index += 1; }
    else if (arg === "--history-mode") { args.historyMode = readRequiredOptionValue(argv, index, "--history-mode"); index += 1; }
    else if (arg === "--reload-policy") { args.reloadPolicy = readRequiredOptionValue(argv, index, "--reload-policy"); index += 1; }
    else if (arg === "--cwd") { args.cwd = readRequiredOptionValue(argv, index, "--cwd"); index += 1; }
    else if (arg === "--q") { args.q = readRequiredOptionValue(argv, index, "--q"); index += 1; }
    else if (arg === "--cursor") { args.cursor = readRequiredOptionValue(argv, index, "--cursor"); index += 1; }
    else if (arg === "--sort" || arg === "--sort-key") { args.sortKey = readRequiredOptionValue(argv, index, "--sort"); index += 1; }
    else if (arg === "--model-provider") { args.modelProviders.push(readRequiredOptionValue(argv, index, "--model-provider")); index += 1; }
    else if (arg === "--source-kind") { args.sourceKinds.push(readRequiredOptionValue(argv, index, "--source-kind")); index += 1; }
    else if (arg === "--limit") {
      args.limit = readPositiveIntegerOptionValue(argv, index, "--limit");
      args.limitExplicit = args.limit;
      index += 1;
    } else if (arg === "--archived") {
      const next = argv[index + 1];
      if (typeof next === "string" && next && !next.startsWith("--")) {
        args.archived = next;
        index += 1;
      } else {
        args.archived = true;
      }
    } else if (arg.startsWith("--")) {
      // Unknown flag: ignore it AND swallow its value token so stray
      // harness-forwarded options never leak into positionals (ref/text).
      const next = argv[index + 1];
      if (typeof next === "string" && next && !next.startsWith("--")) index += 1;
    } else if (command === null) {
      command = arg;
    } else {
      args.positionals.push(arg);
    }
  }

  args.command = command || "overview";
  return args;
}

// --- Shared helpers ---------------------------------------------------------

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function archivedIsTrue(value) {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const text = value.trim().toLowerCase();
  return text === "true" || text === "1" || text === "yes";
}

function pluralize(count, singular) {
  return count === 1 ? singular : `${singular}s`;
}

function formatMatchSummary(match) {
  if (!match || typeof match !== "object") return "";
  const text = typeof match.text === "string" ? match.text : "";
  if (!text) return "";
  const suffix = match.signalTier === "low" ? " [low-signal]" : "";
  return match.kind ? `${match.kind}=${text}${suffix}` : `${text}${suffix}`;
}

function formatShortTimestamp(value) {
  if (typeof value !== "string" || !value) return "";
  return value.replace("T", " ").slice(0, 16);
}

function buildSessionCard(session, options = {}) {
  const card = {
    sessionId: session.sessionId,
    cwd: session.cwd,
    answerPreview: session.finalAnswerPreview || "",
  };
  if (options.annotations) {
    const annotation = session.annotation || {};
    card.bookmarked = annotation.bookmarked === true;
    card.note = typeof annotation.note === "string" ? annotation.note : "";
    card.tags = Array.isArray(annotation.tags) ? annotation.tags : [];
  }
  if (options.match) {
    card.match = session.match || null;
  }
  return card;
}

function compareAnnotatedSessions(left, right) {
  const leftAnn = left.annotation || {};
  const rightAnn = right.annotation || {};
  const leftBookmark = leftAnn.bookmarked === true ? 1 : 0;
  const rightBookmark = rightAnn.bookmarked === true ? 1 : 0;
  if (rightBookmark !== leftBookmark) return rightBookmark - leftBookmark;
  const leftTime = Date.parse(leftAnn.updatedAt || "") || 0;
  const rightTime = Date.parse(rightAnn.updatedAt || "") || 0;
  if (rightTime !== leftTime) return rightTime - leftTime;
  return String(left.sessionId || "").localeCompare(String(right.sessionId || ""));
}

function collectAnnotatedSessions(store, filters) {
  const result = store.listSessions({
    shape: "compact",
    limit: REF_LOOKUP_LIMIT,
    cwd: filters.cwd,
  });
  const annotated = (result.sessions || []).filter((session) => session.annotation);
  annotated.sort(compareAnnotatedSessions);
  return annotated;
}

function listLatestSessions(store, filters, limit) {
  const result = store.listSessions({
    shape: "compact",
    limit,
    cwd: filters.cwd,
  });
  return result.sessions || [];
}

function resolveSessionRef(store, ref, filters) {
  const raw = typeof ref === "string" ? ref.trim() : "";
  if (!raw) throw createCmemError("a session reference is required");

  if (raw.startsWith("codex:")) return raw;

  const savedMatch = /^saved(?::(\d+))?$/i.exec(raw);
  const bookmarkMatch = /^bookmarks?(?::(\d+))?$/i.exec(raw);
  if (savedMatch || bookmarkMatch) {
    const annotated = collectAnnotatedSessions(store, filters);
    const list = bookmarkMatch
      ? annotated.filter((session) => session.annotation && session.annotation.bookmarked === true)
      : annotated;
    const label = bookmarkMatch ? "bookmark" : "saved";
    const position = (bookmarkMatch || savedMatch)[1] ? parseInt((bookmarkMatch || savedMatch)[1], 10) : 1;
    const entry = list[position - 1];
    if (!entry) throw createCmemError(`no ${label} session at position ${position}`);
    return entry.sessionId;
  }

  const latestMatch = /^latest(?::(\d+))?$/i.exec(raw);
  if (latestMatch || /^\d+$/.test(raw)) {
    const position = latestMatch
      ? (latestMatch[1] ? parseInt(latestMatch[1], 10) : 1)
      : parseInt(raw, 10);
    if (!(position > 0)) throw createCmemError("session index must be a positive integer");
    const sessions = listLatestSessions(store, filters, Math.max(position, REF_LOOKUP_LIMIT));
    const entry = sessions[position - 1];
    if (!entry) throw createCmemError(`no session at latest position ${position}`);
    return entry.sessionId;
  }

  return prefixedSessionId(raw) || raw;
}

// --- Session browse commands ------------------------------------------------

function runOverviewCommand(store, filters, limit) {
  const sessions = listLatestSessions(store, filters, limit);
  return {
    command: "overview",
    latest: sessions.map((session) => buildSessionCard(session, { annotations: true })),
  };
}

function runLatestCommand(store, filters, limit) {
  const sessions = listLatestSessions(store, filters, limit);
  return {
    command: "latest",
    sessions: sessions.map((session) => buildSessionCard(session)),
  };
}

function normalizeDay(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (raw === "today") return new Date().toISOString().slice(0, 10);
  if (raw === "yesterday") return new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  return raw;
}

function sessionDay(session) {
  const value = session.startedAt || session.updatedAt || "";
  return typeof value === "string" ? value.slice(0, 10) : "";
}

function runDateCommand(store, args, filters) {
  const day = normalizeDay(args.positionals[0]);
  const result = store.listSessions({ shape: "compact", limit: REF_LOOKUP_LIMIT, cwd: filters.cwd });
  const matched = (result.sessions || []).filter((session) => sessionDay(session) === day);
  return {
    command: "date",
    day,
    total: matched.length,
    sessions: matched.map((session) => buildSessionCard(session)),
  };
}

function runAllCommand(store, filters) {
  const result = store.listSessions({ shape: "compact", limit: REF_LOOKUP_LIMIT, cwd: filters.cwd });
  return {
    command: "all",
    total: result.total,
    sessions: (result.sessions || []).map((session) => buildSessionCard(session)),
  };
}

function runFindCommand(store, args, filters, limit) {
  const text = args.positionals.join(" ");
  const qMode = args.fuzzy ? "fuzzy" : "substring";
  const result = store.listSessions({
    q: text,
    qMode,
    cwd: filters.cwd,
    shape: "compact",
    limit,
  });
  const title = qMode === "fuzzy" ? `Fuzzy search for "${text}"` : `Search for "${text}"`;
  return {
    command: "find",
    matchMode: qMode,
    title,
    total: result.total,
    sessions: (result.sessions || []).map((session) => buildSessionCard(session, { match: true })),
  };
}

function runQueryCommand(store, args, filters, limit) {
  const text = args.positionals.join(" ");
  const queryMode = args.exact ? "exact" : args.fuzzy ? "fuzzy" : "substring";
  const result = store.listSessions({
    query: text,
    queryMode,
    cwd: filters.cwd,
    shape: "compact",
    limit,
  });
  const title = queryMode === "exact"
    ? `Exact captured query "${text}"`
    : queryMode === "fuzzy"
      ? `Fuzzy captured query "${text}"`
      : `Captured query match for "${text}"`;
  const envelope = {
    command: "query",
    matchMode: queryMode,
    title,
    total: result.total,
    sessions: (result.sessions || []).map((session) => buildSessionCard(session, { match: true })),
  };
  if (queryMode === "fuzzy") {
    envelope.querySignalSummary = result.querySignalSummary || { onlyLowSignal: false, examples: [] };
  }
  return envelope;
}

// --- Saved / bookmark commands ----------------------------------------------

function buildSavedCard(session, mode) {
  const annotation = session.annotation || {};
  const card = {
    sessionId: session.sessionId,
    bookmarked: annotation.bookmarked === true,
    note: typeof annotation.note === "string" ? annotation.note : "",
    tags: Array.isArray(annotation.tags) ? annotation.tags : [],
    manualUpdatedAt: typeof annotation.updatedAt === "string" ? annotation.updatedAt : null,
  };
  if (mode === "saved") card.saved = true;
  return card;
}

function runSavedListCommand(store, filters, mode) {
  const annotated = collectAnnotatedSessions(store, filters);
  const list = mode === "bookmarks"
    ? annotated.filter((session) => session.annotation && session.annotation.bookmarked === true)
    : annotated;
  const sessions = list.map((session) => buildSavedCard(session, mode === "bookmarks" ? "bookmarks" : "saved"));
  return { command: mode, total: sessions.length, sessions };
}

// --- Annotation mutation commands -------------------------------------------

function buildAnnotationPatch(command, args) {
  if (command === "pin") return { bookmarked: true };
  if (command === "unpin") return { bookmarked: false };
  if (command === "note") return { note: args.positionals.slice(1).join(" ") };
  if (command === "clear-note") return { clearNote: true };
  if (command === "tag") return { addTags: args.positionals.slice(1) };
  if (command === "untag") return { removeTags: args.positionals.slice(1) };
  return {};
}

function runAnnotationCommand(store, args, filters, command) {
  const sessionId = resolveSessionRef(store, args.positionals[0], filters);
  const patch = buildAnnotationPatch(command, args);
  const result = store.setSessionAnnotation(sessionId, patch, { refresh: true });
  if (!result) throw createCmemError(`session not found: ${args.positionals[0]}`);
  const annotation = result.annotation || {};
  return {
    command,
    session: {
      sessionId: result.sessionId,
      bookmarked: annotation.bookmarked === true,
      note: typeof annotation.note === "string" ? annotation.note : "",
      tags: Array.isArray(annotation.tags) ? annotation.tags : [],
    },
  };
}

// --- open / resume ----------------------------------------------------------

function isConversationItem(item) {
  return item && (item.type === "user" || item.type === "assistant" || item.type === "commentary" || item.type === "reasoning");
}

async function runOpenCommand(store, args, filters) {
  const ref = args.positionals[0];
  const sessionId = resolveSessionRef(store, ref, filters);
  const useTimeline = args.timeline === true || (typeof args.q === "string" && args.q.trim().length > 0);
  const result = await store.getTranscriptResolved(sessionId, {
    source: filters.source,
    historyMode: filters.historyMode,
    q: args.q,
    refresh: true,
  });
  if (!result) throw createCmemError(`transcript not found: ${ref}`);
  return {
    result,
    render: () => renderOpenText(result, { timeline: useTimeline, q: args.q }),
  };
}

async function runResumeCommand(store, args, filters) {
  const ref = args.positionals[0];
  const sessionId = resolveSessionRef(store, ref, filters);
  const result = await store.getResumeResolved(sessionId, {
    reloadPolicy: filters.reloadPolicy || "strict",
    source: filters.source,
    historyMode: filters.historyMode,
    q: args.q,
    refresh: true,
  });
  if (!result) throw createCmemError(`resume not found: ${ref}`);
  const blocked = Boolean(result.reloadSafety && result.reloadSafety.allowed === false);
  return {
    result,
    exitCode: blocked ? 2 : 0,
    render: () => renderResumeText(result, { blocked, q: args.q }),
  };
}

// --- repo -------------------------------------------------------------------

function runRepoCommand(store, args, filters) {
  const cwd = args.positionals.join(" ") || filters.cwd || "";
  const project = store.getProject(cwd, { historyMode: filters.historyMode });
  if (!project) throw createCmemError(`no history found for repo: ${cwd}`);
  return project;
}

// --- threads / archive / unarchive ------------------------------------------

async function runThreadsCommand(store, args, filters) {
  return store.listBridgeThreads({
    limit: args.limitExplicit,
    cursor: args.cursor,
    sortKey: args.sortKey,
    q: args.q,
    cwd: args.cwd,
    archived: args.archived,
    modelProviders: args.modelProviders.length ? args.modelProviders : undefined,
    sourceKinds: args.sourceKinds.length ? args.sourceKinds : undefined,
  });
}

function resolveThreadId(ref) {
  const raw = typeof ref === "string" ? ref.trim() : "";
  if (!raw) throw createCmemError("a thread id is required");
  return raw.startsWith("codex:") ? raw : prefixedSessionId(raw) || raw;
}

async function runArchiveCommand(store, args) {
  const threadId = resolveThreadId(args.positionals[0]);
  const result = await store.archiveBridgeThread(threadId);
  if (!result) throw createCmemError(`thread not found: ${args.positionals[0]}`);
  return result;
}

async function runUnarchiveCommand(store, args) {
  const threadId = resolveThreadId(args.positionals[0]);
  const result = await store.unarchiveBridgeThread(threadId);
  if (!result) throw createCmemError(`thread not found: ${args.positionals[0]}`);
  return result;
}

// --- status / doctor --------------------------------------------------------

async function probeBridge(store) {
  try {
    await store.listBridgeThreads({ limit: 1 });
    return true;
  } catch {
    return false;
  }
}

async function runStatusCommand(store, args, runtime, effective) {
  const stats = store.getStats(true);
  const configLoaded = Boolean(!args.noConfig && runtime && runtime.exists);
  const bridgeOk = await probeBridge(store);
  return {
    command: "status",
    config: { loaded: configLoaded },
    paths: {
      sessionDir: effective.sessionDir || "",
      indexDir: effective.indexDir || "",
    },
    index: {
      sessionCount: stats.sessionCount,
      annotatedSessions: stats.annotatedSessions,
      bookmarkedSessions: stats.bookmarkedSessions,
      reusedFiles: stats.reusedFiles,
      rebuiltFiles: stats.rebuiltFiles,
      reuseFailures: stats.reuseFailures,
      persistenceDegraded: stats.persistenceDegraded === true,
    },
    health: {
      sessionDirExists: Boolean(effective.sessionDir && fs.existsSync(effective.sessionDir)),
      indexDirExists: Boolean(effective.indexDir && fs.existsSync(effective.indexDir)),
    },
    bridge: { ok: bridgeOk },
  };
}

function runDoctorCommand(store, filters) {
  return store.getDoctor({ historyMode: filters.historyMode, refresh: true });
}

// --- config / use -----------------------------------------------------------

const CONFIG_KEY_MAP = {
  "session-dir": ["paths", "sessionDir"],
  "index-dir": ["paths", "indexDir"],
  cwd: ["defaults", "cwd"],
  limit: ["defaults", "limit"],
  source: ["defaults", "source"],
  "history-mode": ["defaults", "historyMode"],
  "reload-policy": ["defaults", "reloadPolicy"],
  quality: ["defaults", "qualityClass"],
};

function applyConfigSet(key, value, options) {
  const mapping = CONFIG_KEY_MAP[key];
  if (!mapping) throw createCmemError(`unknown config key: ${key}`);
  let resolvedValue = value;
  if (key === "limit") {
    resolvedValue = readValidatedInteger(value, {
      label: "limit",
      positive: true,
      errorFactory: createCmemError,
    });
  }
  if (key === "cwd" && typeof resolvedValue === "string" && resolvedValue) {
    resolvedValue = path.resolve(resolvedValue);
  }
  return updateCmemConfig((config) => {
    config[mapping[0]] = config[mapping[0]] || {};
    config[mapping[0]][mapping[1]] = resolvedValue;
    return config;
  }, options);
}

function applyConfigUnset(key, options) {
  const mapping = CONFIG_KEY_MAP[key];
  if (!mapping) throw createCmemError(`unknown config key: ${key}`);
  const defaults = createDefaultCmemConfig();
  const defaultValue = defaults[mapping[0]][mapping[1]];
  return updateCmemConfig((config) => {
    config[mapping[0]] = config[mapping[0]] || {};
    config[mapping[0]][mapping[1]] = defaultValue;
    return config;
  }, options);
}

function emit(args, payload, renderText) {
  if (args.json) {
    console.log(JSON.stringify(payload, null, args.pretty ? 2 : 0));
    return;
  }
  renderText();
}

function runConfigCommand(args) {
  const sub = args.positionals[0];
  const options = { configPath: args.config };

  if (sub === "init") {
    const result = initCmemConfig({ ...options, force: args.force === true });
    emit(args, result, () => renderConfigResult(result, "init"));
    return;
  }
  if (sub === "show") {
    const result = readCmemConfig(options);
    emit(args, result, () => renderConfigResult(result, "show"));
    return;
  }
  if (sub === "set") {
    const key = args.positionals[1];
    const value = args.positionals.slice(2).join(" ");
    if (!key) throw createCmemError("config set requires a key and value");
    const result = applyConfigSet(key, value, options);
    emit(args, result, () => renderConfigResult(result, "set"));
    return;
  }
  if (sub === "unset") {
    const key = args.positionals[1];
    if (!key) throw createCmemError("config unset requires a key");
    const result = applyConfigUnset(key, options);
    emit(args, result, () => renderConfigResult(result, "unset"));
    return;
  }
  if (sub === "path") {
    const configPath = resolveCmemConfigPath(options);
    emit(args, { configPath }, () => console.log(configPath));
    return;
  }
  throw createCmemError(`unknown config subcommand: ${sub || ""}`);
}

function runUseCommand(args) {
  const cwd = path.resolve(args.positionals.join(" ") || process.cwd());
  const result = updateCmemConfig((config) => {
    config.defaults = config.defaults || {};
    config.defaults.cwd = cwd;
    return config;
  }, { configPath: args.config });
  const payload = { cwd, resolved: { cwd: result.resolved.cwd } };
  emit(args, payload, () => console.log(`cmem use ${cwd}`));
}

// --- Text renderers ---------------------------------------------------------

function renderLatestText(result) {
  const sessions = result.latest || result.sessions || [];
  for (let index = 0; index < sessions.length; index += 1) {
    const session = sessions[index];
    const position = index + 1;
    console.log(`${position}. ${session.sessionId}${session.cwd ? `  ${session.cwd}` : ""}`);
    if (session.answerPreview) console.log(`answer: ${session.answerPreview}`);
    if (session.bookmarked) console.log("bookmarked");
    if (session.note) console.log(`note: ${session.note}`);
    console.log("Try:");
    console.log(`  cmem open ${position}`);
    console.log(`  cmem resume ${position}`);
    console.log(`  cmem pin ${position}`);
    console.log("");
  }
  console.log("Tip: Bare numbers like 1 and 2 follow latest-session order.");
}

function renderFilteredList(result) {
  console.log(`${result.title} (${result.total})`);
  console.log("");
  for (const session of result.sessions) {
    console.log(session.sessionId);
    if (session.cwd) console.log(`cwd: ${session.cwd}`);
    if (session.answerPreview) console.log(`answer: ${session.answerPreview}`);
    const matchSummary = formatMatchSummary(session.match);
    if (matchSummary) console.log(`match: ${matchSummary}`);
    console.log("Try:");
    console.log(`  cmem open ${session.sessionId}`);
    console.log(`  cmem resume ${session.sessionId}`);
    console.log(`  cmem pin ${session.sessionId}`);
    console.log("");
  }
  console.log("Tip: Use the printed session id for filtered lists.");

  const distinctCwds = [...new Set(result.sessions.map((session) => session.cwd).filter(Boolean))];
  if (distinctCwds.length > 1) {
    console.log(`Add --cwd ${result.sessions[0].cwd} to narrow to one repo.`);
  }

  if (result.querySignalSummary && result.querySignalSummary.onlyLowSignal) {
    console.log("Note: these fuzzy captured-query hits are only low-signal filename/glob filters.");
    console.log("Try: cmem query <text> --exact for a literal captured query, or cmem find <text> --fuzzy for broader session text.");
  }
}

function renderSimpleList(result) {
  console.log(`Sessions (${result.total})`);
  console.log("");
  for (const session of result.sessions) {
    console.log(session.sessionId);
    if (session.cwd) console.log(`cwd: ${session.cwd}`);
    if (session.answerPreview) console.log(`answer: ${session.answerPreview}`);
    console.log("Try:");
    console.log(`  cmem open ${session.sessionId}`);
    console.log(`  cmem resume ${session.sessionId}`);
    console.log("");
  }
}

function renderSavedListText(result) {
  const header = result.command === "bookmarks" ? "Bookmarked sessions" : "Saved sessions";
  console.log(`${header} (${result.total})`);
  if (!result.sessions.length) {
    console.log("No sessions found.");
    console.log("Try:");
    if (result.command === "bookmarks") {
      console.log("  cmem pin latest");
      console.log("  cmem saved");
    } else {
      console.log("  cmem pin latest");
      console.log('  cmem note latest "resume from here"');
      console.log("  cmem tag latest important");
    }
    return;
  }
  for (const session of result.sessions) {
    const parts = [];
    if (session.bookmarked) parts.push("bookmarked");
    if (session.tags.length) parts.push(`tags=${session.tags.join(",")}`);
    if (session.note) parts.push(`note=${session.note}`);
    console.log(`${session.sessionId}${parts.length ? `  ${parts.join("  ")}` : ""}`);
  }
}

function renderAnnotationText(result) {
  const session = result.session;
  const parts = [];
  if (session.bookmarked) parts.push("bookmarked");
  if (session.tags.length) parts.push(`tags=${session.tags.join(",")}`);
  if (session.note) parts.push(`note=${session.note}`);
  console.log(`${result.command}: ${session.sessionId}${parts.length ? `  ${parts.join("  ")}` : ""}`);
}

function renderOpenText(result, options) {
  const session = result.session;
  const sessionId = session.sessionId;
  const source = (result.source && result.source.used) || "rollout";
  console.log("cmem open");
  console.log([sessionId, session.cwd || "", session.model ? `model=${session.model}` : ""].filter(Boolean).join(" | "));
  console.log(`source=${source}`);
  if (options.timeline) {
    console.log("view=timeline");
    if (options.q) {
      const matched = result.matchedItems || 0;
      console.log(`filter: q="${options.q}" matched ${matched} ${pluralize(matched, "transcript item")}; timeline view keeps the matching raw activity visible.`);
    }
    console.log("");
    for (const item of result.items || []) {
      const header = [
        item.timestamp || `#${item.index}`,
        item.type,
        item.toolName ? `tool=${item.toolName}` : "",
        item.exitCode != null ? `exit=${item.exitCode}` : "",
      ].filter(Boolean).join(" | ");
      console.log(header);
      if (item.command) console.log(`command: ${item.command}`);
      if (item.text && item.type !== "tool") console.log(`text: ${item.text}`);
      console.log("");
    }
  } else {
    console.log("view=conversation-first");
    console.log("");
    for (const item of result.items || []) {
      if (!isConversationItem(item)) continue;
      const text = item.text || item.detail || item.preview;
      if (!text) continue;
      console.log(`${item.type}: ${text}`);
    }
    console.log("");
  }
  console.log("Try:");
  console.log(`  cmem resume ${sessionId}`);
  console.log(`  cmem pin ${sessionId}`);
  console.log(`  node history.js transcript ${sessionId} --source ${source}`);
}

function renderResumeText(result, options) {
  const session = result.session;
  const sessionId = session.sessionId;
  const source = (result.source && result.source.used) || "rollout";
  console.log("cmem resume");
  console.log([sessionId, session.cwd || "", session.model ? `model=${session.model}` : ""].filter(Boolean).join(" | "));
  console.log(`source=${source}`);
  if (options.q) {
    const turns = result.turnCount || 0;
    console.log(`filter: q="${options.q}" narrowed the resume to ${turns} ${pluralize(turns, "turn")}.`);
  }
  if (options.blocked) {
    console.log("Resume text withheld by reload safety policy.");
  } else {
    console.log("Resume text:");
    console.log(result.text);
  }
  console.log("");
  console.log("Try:");
  console.log(`  cmem open ${sessionId}`);
  console.log(`  cmem note ${sessionId} "resume from here"`);
  console.log(`  cmem pin ${sessionId}`);
}

function renderRepoText(project) {
  console.log("cmem repo");
  console.log(project.cwd);
  console.log([
    `updated=${formatShortTimestamp(project.updatedAt)}`,
    `history=${project.historyMode}`,
    `sessions=${project.sessionCount}`,
    `turns=${project.turnCount}`,
  ].join("  "));
  if (Array.isArray(project.models) && project.models.length) {
    console.log(`models: ${project.models.map((item) => `${item.model} (${item.count})`).join(", ")}`);
  }
  if (Array.isArray(project.topTools) && project.topTools.length) {
    console.log(`tools: ${project.topTools.map((item) => `${item.tool} (${item.count})`).join(", ")}`);
  }
  if (Array.isArray(project.topFiles) && project.topFiles.length) {
    console.log(`files: ${project.topFiles.map((item) => `${item.displayFile || item.file} (${item.count})`).join(", ")}`);
  }
  if (Array.isArray(project.areas) && project.areas.length) {
    console.log(`areas: ${project.areas.map((area) => `${area.root} (turns=${area.turnCount}, search=${area.counts.searches})`).join(", ")}`);
  }
  const recentSessions = project.recentSessions || [];
  console.log(`Recent sessions (${recentSessions.length})`);
  for (const session of recentSessions) {
    console.log(`  cmem open ${session.sessionId}`);
  }
  console.log("Next:");
  console.log(`  cmem latest --cwd ${project.cwd}`);
  console.log(`  cmem all --cwd ${project.cwd}`);
}

function buildThreadsBaseCommand(args) {
  const parts = ["cmem threads"];
  if (args.limitExplicit) parts.push(`--limit ${args.limitExplicit}`);
  if (args.q) parts.push(`--q ${args.q}`);
  if (args.sortKey) parts.push(`--sort ${args.sortKey}`);
  for (const provider of args.modelProviders) parts.push(`--model-provider ${provider}`);
  for (const kind of args.sourceKinds) parts.push(`--source-kind ${kind}`);
  if (args.cwd) parts.push(`--cwd ${args.cwd}`);
  return parts.join(" ");
}

function renderThreadsText(result, args) {
  const threads = result.threads || [];
  const archivedPage = archivedIsTrue(args.archived);
  console.log(`cmem threads (${threads.length})`);
  console.log("source: exact app-server thread list");

  const filterParts = [];
  if (args.q) filterParts.push(`q=${args.q}`);
  if (args.sortKey) filterParts.push(`sort=${args.sortKey}`);
  if (args.modelProviders.length) filterParts.push(`provider=${args.modelProviders.join(",")}`);
  if (args.sourceKinds.length) filterParts.push(`source=${args.sourceKinds.join(",")}`);
  if (args.cwd) filterParts.push(`cwd=${args.cwd}`);
  if (args.cursor) filterParts.push(`cursor=${args.cursor}`);
  if (archivedIsTrue(args.archived)) filterParts.push("archived=true");
  if (filterParts.length) console.log(`filters: ${filterParts.join("  ")}`);
  console.log("");

  for (let index = 0; index < threads.length; index += 1) {
    const thread = threads[index];
    const position = index + 1;
    console.log(`${position}. ${thread.sessionId}  updated=${thread.updatedAt || ""}  status=${thread.status.type}`);
    console.log(`provider=${thread.modelProvider || ""}  source=${thread.source || ""}  cli=${thread.cliVersion || ""}`);
    if (thread.preview) console.log(`preview: ${thread.preview}`);
    if (thread.gitInfo && (thread.gitInfo.branch || thread.gitInfo.sha)) {
      console.log(`git: ${thread.gitInfo.branch || ""} @ ${(thread.gitInfo.sha || "").slice(0, 12)}`);
    }
    if (thread.name) console.log(`name: ${thread.name}`);
    console.log("Try:");
    console.log(`  cmem open ${thread.sessionId}`);
    console.log(`  cmem resume ${thread.sessionId}`);
    console.log(`  node history.js thread ${thread.sessionId}`);
    console.log(`  cmem ${archivedPage ? "unarchive" : "archive"} ${thread.sessionId}`);
    console.log("");
  }

  const distinctCwds = [...new Set(threads.map((thread) => thread.cwd).filter(Boolean))];
  if (distinctCwds.length > 1) {
    console.log(`Tip: Add --cwd ${distinctCwds[0]} to narrow to one repo.`);
  }

  if (result.nextCursor) {
    const base = buildThreadsBaseCommand(args);
    console.log("Next:");
    console.log(`  ${base} --cursor ${result.nextCursor}`);
    console.log(`  ${base} --archived`);
  }
}

function renderArchiveText(result) {
  console.log("Archived thread");
  console.log(`${result.sessionId} | archived=${result.archived === true}`);
  console.log("Next:");
  console.log("  cmem threads --archived");
  console.log(`  cmem unarchive ${result.sessionId}`);
  console.log(`  node history.js thread ${result.sessionId}`);
}

function renderUnarchiveText(result) {
  const thread = result.thread;
  console.log("Unarchived thread");
  console.log(`${thread.sessionId}  updated=${thread.updatedAt || ""}  status=${thread.status.type}`);
  if (thread.name) console.log(`name: ${thread.name}`);
  console.log("Try:");
  console.log(`  cmem open ${thread.sessionId}`);
  console.log(`  cmem resume ${thread.sessionId}`);
  console.log(`  cmem archive ${thread.sessionId}`);
  console.log(`  node history.js thread ${thread.sessionId}`);
  console.log("Next:");
  console.log(`  cmem threads --cwd ${thread.cwd}`);
  console.log("  cmem threads");
  console.log("  cmem threads --archived");
}

function renderStatusText(result, args, runtime) {
  console.log("cmem status");
  if (result.config.loaded) {
    console.log(`config: loaded from ${runtime.configPath}`);
  } else {
    const configPath = runtime ? runtime.configPath : resolveCmemConfigPath({ configPath: args.config });
    console.log(`config: default-only (${configPath} not created yet)`);
  }
  console.log(`paths: session=${result.paths.sessionDir}  index=${result.paths.indexDir}`);
  console.log(`index: sessions=${result.index.sessionCount}  annotated=${result.index.annotatedSessions}  bookmarked=${result.index.bookmarkedSessions}`);
  console.log(`bridge: ${result.bridge.ok ? "ok" : "unavailable"}`);
  if (!result.config.loaded) {
    const defaults = createDefaultCmemConfig().defaults;
    console.log(`defaults: limit=${defaults.limit}  source=${defaults.source}  history=${defaults.historyMode}  reload=${defaults.reloadPolicy}`);
    console.log("Next:");
    console.log("  cmem config init");
  }
}

function renderDoctorText(result) {
  console.log("cmem doctor");
  console.log(`sessions=${result.sessionCount}  files=${result.total}`);
  for (const file of (result.files || []).slice(0, 10)) {
    console.log(`  ${file.sessionId} | ${file.buildStatus} | ${file.filePath}`);
  }
}

function renderConfigResult(result, action) {
  if (action === "init") {
    console.log(`config ${result.created ? "created" : "exists"}: ${result.configPath}`);
  } else if (action === "show") {
    console.log(`config: ${result.configPath}${result.exists ? "" : " (not created yet)"}`);
  } else {
    console.log(`config updated: ${result.configPath}`);
  }
  const resolved = result.resolved || {};
  console.log(`session=${resolved.sessionDir || ""}`);
  console.log(`index=${resolved.indexDir || ""}`);
  console.log(`cwd=${resolved.cwd || ""}  limit=${resolved.limit}  source=${resolved.source}  history=${resolved.historyMode}  reload=${resolved.reloadPolicy}`);
}

// --- Help -------------------------------------------------------------------

function printHelp() {
  console.log(`cmem — native front door for Codex history

Install:
  npm install -g .

Exact thread commands still require a working codex CLI on PATH.

Usage:
  cmem [overview]
  cmem latest [N]
  cmem date 2026-04-09        (alias: on; also today / yesterday)
  cmem all
  cmem find <text> [--fuzzy]  (alias: search; all matches unless --limit)
  cmem query <text> [--exact | --fuzzy]
  cmem open <id | latest[:N] | N> [--timeline] [--q <text>]
  cmem resume <id | latest[:N] | N> [--q <text>]
  cmem repo <cwd>             (alias: project)
  cmem threads [--limit <n>] [--cursor <c>] [--sort <k>] [--q <text>] [--archived]
  cmem archive <id>
  cmem unarchive <id>
  cmem status
  cmem doctor
  cmem saved
  cmem bookmarks
  cmem pin | unpin | note | clear-note | tag | untag <id | latest[:N] | N | saved[:N] | bookmark[:N]>
  cmem use [cwd]
  cmem config init | show | set <key> <value> | unset <key> | path

Options:
  --timeline         For cmem open, force the raw recent timeline in plain text
  --fuzzy            Lightweight typo-tolerant search for cmem find/query
  --exact            Exact captured query match for cmem query
  --cursor <c>       Bridge pagination cursor for cmem threads
  --q <text>         Search/filter term for cmem open/resume, or exact thread search for cmem threads
  --sort <k>         Bridge thread sort: ${BRIDGE_THREAD_SORT_HELP_TEXT}
  --model-provider <id>  Exact bridge thread provider filter for cmem threads
  --source-kind <k>  Exact bridge thread source filter for cmem threads
                     canonical kinds: ${BRIDGE_THREAD_SOURCE_KIND_HELP_TEXT}
  --cwd <text>       Narrow browse/thread results to one repo
  --session-dir <p>  Override the Codex sessions directory
  --index-dir <p>    Override the shared history index directory
  --config <p>       Use an explicit cmem config path
  --no-config        Ignore the ~/.cmem config defaults
  --limit <n>        Limit result count (> 0)
  --json             Emit JSON
  --pretty           Pretty-print JSON
  --help             Show this message

Notes:
  bare numbers like 1 and 2 only follow latest-session order; use the printed session id for filtered lists.
`);
}

// --- Command routing --------------------------------------------------------

async function routeCommand(store, args, context) {
  const { runtime, effective, filters, limit } = context;
  const command = args.command;

  switch (command) {
    case "overview":
      return { result: runOverviewCommand(store, filters, limit), render: renderLatestTextForOverview };
    case "latest": {
      const result = runLatestCommand(store, filters, limit);
      return { result, render: () => renderLatestText(result) };
    }
    case "date":
    case "on": {
      const result = runDateCommand(store, args, filters);
      if (Number.isInteger(args.limitExplicit)) result.sessions = result.sessions.slice(0, args.limitExplicit);
      return { result, render: () => renderSimpleList(result) };
    }
    case "all": {
      const result = runAllCommand(store, filters);
      if (Number.isInteger(args.limitExplicit)) result.sessions = result.sessions.slice(0, args.limitExplicit);
      return { result, render: () => renderSimpleList(result) };
    }
    case "find":
    case "search": {
      // Search is a recovery surface: never silently cap hits unless the user
      // asked for a limit.
      const result = runFindCommand(store, args, filters, args.limitExplicit ?? REF_LOOKUP_LIMIT);
      return { result, render: () => renderFilteredList(result) };
    }
    case "query": {
      const result = runQueryCommand(store, args, filters, args.limitExplicit ?? REF_LOOKUP_LIMIT);
      return { result, render: () => renderFilteredList(result) };
    }
    case "open":
      return runOpenCommand(store, args, filters);
    case "resume":
      return runResumeCommand(store, args, filters);
    case "repo":
    case "project": {
      const result = runRepoCommand(store, args, filters);
      return { result, render: () => renderRepoText(result) };
    }
    case "threads": {
      const result = await runThreadsCommand(store, args, filters);
      return { result, render: () => renderThreadsText(result, args) };
    }
    case "archive": {
      const result = await runArchiveCommand(store, args);
      return { result, render: () => renderArchiveText(result) };
    }
    case "unarchive": {
      const result = await runUnarchiveCommand(store, args);
      return { result, render: () => renderUnarchiveText(result) };
    }
    case "status": {
      const result = await runStatusCommand(store, args, runtime, effective);
      return { result, render: () => renderStatusText(result, args, runtime) };
    }
    case "doctor": {
      const result = runDoctorCommand(store, filters);
      return { result, render: () => renderDoctorText(result) };
    }
    case "saved": {
      const result = runSavedListCommand(store, filters, "saved");
      return { result, render: () => renderSavedListText(result) };
    }
    case "bookmarks": {
      const result = runSavedListCommand(store, filters, "bookmarks");
      return { result, render: () => renderSavedListText(result) };
    }
    case "pin":
    case "unpin":
    case "note":
    case "clear-note":
    case "tag":
    case "untag": {
      const result = runAnnotationCommand(store, args, filters, command);
      return { result, render: () => renderAnnotationText(result) };
    }
    default:
      throw createCmemError(`unknown command: ${command}`);
  }
}

function renderLatestTextForOverview(result) {
  renderLatestText(result);
}

// --- Entry point ------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.command === "help") {
    printHelp();
    return;
  }

  if (args.command === "config") {
    runConfigCommand(args);
    return;
  }
  if (args.command === "use") {
    runUseCommand(args);
    return;
  }

  const runtime = args.noConfig ? null : readCmemConfig({ configPath: args.config });
  if (runtime && runtime.error) {
    throw createCmemError(
      `invalid cmem config: ${runtime.error.message} (${runtime.configPath}) — fix it or run: cmem config init --force`
    );
  }
  const resolved = runtime ? runtime.resolved : {};

  const effective = {
    sessionDir: firstDefined(args.sessionDir, resolved.sessionDir),
    indexDir: firstDefined(args.indexDir, resolved.indexDir),
    cwd: firstDefined(args.cwd, resolved.cwd),
    qualityClass: firstDefined(args.qualityClass, resolved.qualityClass),
    source: firstDefined(args.source, resolved.source),
    historyMode: firstDefined(args.historyMode, resolved.historyMode),
    reloadPolicy: firstDefined(args.reloadPolicy, resolved.reloadPolicy, "strict"),
  };

  let positionalLimit;
  if (args.command === "latest" && args.positionals.length && /^\d+$/.test(args.positionals[0])) {
    const parsed = parseInt(args.positionals[0], 10);
    if (parsed > 0) positionalLimit = parsed;
  }
  const configLimit = Number.isInteger(resolved.limit) && resolved.limit > 0 ? resolved.limit : undefined;
  const limit = args.limitExplicit ?? positionalLimit ?? configLimit ?? DEFAULT_LIMIT;

  const filters = {
    cwd: effective.cwd,
    qualityClass: effective.qualityClass,
    source: effective.source,
    historyMode: effective.historyMode,
    reloadPolicy: effective.reloadPolicy,
  };

  const store = createHistoryStore({
    sessionDir: effective.sessionDir,
    indexRoot: effective.indexDir,
    refreshMs: 0,
  });

  try {
    const { result, render, exitCode } = await routeCommand(store, args, {
      runtime,
      effective,
      filters,
      limit,
    });

    if (args.json) {
      console.log(JSON.stringify(result, null, args.pretty ? 2 : 0));
    } else if (typeof render === "function") {
      render(result);
    }

    if (Number.isInteger(exitCode) && exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } finally {
    if (store && typeof store.close === "function") await Promise.resolve(store.close());
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(formatCmemError(err));
    process.exit(1);
  });
}

module.exports = { parseArgs };
