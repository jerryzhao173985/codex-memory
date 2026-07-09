"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createCatalogHistoryViews } = require("../catalog-history-views");

function createHistoryViews(overrides = {}) {
  return createCatalogHistoryViews({
    prefixedSessionId(value) {
      if (typeof value !== "string" || !value.trim()) return "";
      const text = value.trim();
      return text.startsWith("codex:") ? text : `codex:${text}`;
    },
    getCatalogSessionMatches(catalog, sessionRef) {
      const raw = typeof sessionRef === "string" ? sessionRef.trim() : "";
      if (!raw) return [];
      const needle = raw.startsWith("codex:") ? raw : `codex:${raw}`;
      return catalog.sessions.filter((item) => item.sessionId === needle);
    },
    resolveCatalogForHistoryMode(catalog) {
      return { catalog };
    },
    getRequestedQueryMode(filters) {
      return typeof filters.queryMode === "string" ? filters.queryMode : "substring";
    },
    matchesAnnotationFilters() {
      return false;
    },
    hasAnnotationScopedFilters(filters) {
      return Boolean(filters.bookmarked || filters.manual_tag || filters.manualTag || (Array.isArray(filters.manualTags) && filters.manualTags.length));
    },
    clearAnnotationScopedFilters(filters) {
      const next = { ...filters };
      delete next.bookmarked;
      delete next.manual_tag;
      delete next.manualTag;
      delete next.manualTags;
      return next;
    },
    hasTurnScopedFilters(filters) {
      return Boolean(
        filters.file ||
        filters.path ||
        filters.pathRole ||
        filters.path_role ||
        filters.pathPattern ||
        filters.path_pattern ||
        filters.commandOp ||
        filters.command_op ||
        filters.commandOpSignal ||
        filters.command_op_signal ||
        filters.query ||
        filters.error ||
        filters.tool ||
        filters.kind ||
        filters.commandType
      );
    },
    turnMatches(turn, filters) {
      if (turn && turn.turnId === "turn-1" && filters.query) {
        return {
          score: 42,
          reasons: ["query"],
          matchedCommandOps: ["rg"],
          matchedFiles: ["/repo/AGENTS.md"],
          matchedPaths: ["/repo/AGENTS.md"],
          matchedPathPatterns: [],
          matchedQueries: ["AGENTS.md"],
        };
      }
      return null;
    },
    summarizeSession(session) {
      return {
        sessionId: session.sessionId,
        cwd: session.cwd || "",
      };
    },
    buildHistoryQuality(_session, _filters, source, kind) {
      return {
        kind,
        mode: "effective",
        sourceUsed: source && source.used ? source.used : "",
      };
    },
    normalizeHistoryMode(value) {
      return String(value || "").trim().toLowerCase() === "raw" ? "raw" : "effective";
    },
    buildHistoryViewSource(requested, used, extras = {}) {
      return {
        requested,
        used,
        bridgeError: null,
        selectionReason: extras.rolloutOnly ? "rollout_only_view" : "requested_rollout",
        selectionNote: extras.rolloutOnly ? "used the rollout-only derived history view." : "used the requested source.",
      };
    },
    resolveRequestedPathRole(filters) {
      return typeof (filters.pathRole || filters.path_role) === "string"
        ? (filters.pathRole || filters.path_role).trim().toLowerCase()
        : "";
    },
    getRequestedPathPattern(filters) {
      return typeof (filters.pathPattern || filters.path_pattern) === "string"
        ? (filters.pathPattern || filters.path_pattern)
        : "";
    },
    getRequestedQuery(filters) {
      return typeof filters.query === "string" ? filters.query : "";
    },
    getMatchingTranscriptItemFileValues(item, filters) {
      const needle = String(filters.file || "").toLowerCase();
      return (Array.isArray(item.filesTouched) ? item.filesTouched : []).filter((value) => value.toLowerCase().includes(needle));
    },
    getMatchingPathValues(_item, filters, candidates) {
      const list = Array.isArray(candidates) ? candidates : [];
      const needle = String(filters.path || "").toLowerCase();
      if (!needle && (filters.pathRole || filters.path_role)) return list.slice();
      return list.filter((value) => String(value).toLowerCase().includes(needle));
    },
    getTranscriptItemMemoryCitationPaths(item) {
      return Array.isArray(item.memoryCitationPaths) ? item.memoryCitationPaths : [];
    },
    getMatchingPathPatternValues(_item, filters, candidates) {
      const list = Array.isArray(candidates) ? candidates : [];
      const needle = String(filters.pathPattern || filters.path_pattern || "").toLowerCase();
      if (!needle && (filters.pathRole || filters.path_role)) return list.slice();
      return list.filter((value) => String(value).toLowerCase().includes(needle));
    },
    getMatchingCommandOps(values, filters) {
      const list = Array.isArray(values) ? values : [];
      const needle = String(filters.commandOp || filters.command_op || "").toLowerCase();
      return list.filter((value) => String(value).toLowerCase().includes(needle));
    },
    sortCommandOpValues(values) {
      return Array.from(new Set(Array.isArray(values) ? values : [])).sort();
    },
    getMatchingQueryValues(candidates, filters) {
      const needle = String(filters.query || "").toLowerCase();
      return (Array.isArray(candidates) ? candidates : []).filter((value) => String(value).toLowerCase().includes(needle));
    },
    getTranscriptItemQueryCandidates(item) {
      return [
        item.query,
        ...(Array.isArray(item.queries) ? item.queries : []),
        ...(Array.isArray(item.commandQueries) ? item.commandQueries : []),
      ].filter(Boolean);
    },
    getTranscriptItemErrorSearchValues(item) {
      return Array.isArray(item.errorSearchValues) ? item.errorSearchValues : [];
    },
    getTranscriptItemMemoryCitationSearchValues(item) {
      return Array.isArray(item.memoryCitationSearchValues) ? item.memoryCitationSearchValues : [];
    },
    readNormalizedSessionEvents() {
      return [];
    },
    selectNormalizedEvents(events) {
      return events;
    },
    buildTranscriptItem() {
      return null;
    },
    canDeduplicateTranscriptMessagePair() {
      return false;
    },
    mergeTranscriptMessageItem(previous) {
      return previous;
    },
    mergeTranscriptToolItem(previous) {
      return previous;
    },
    normalizeTrimStrategy(value) {
      return typeof value === "string" && value.trim() ? value.trim() : "middle";
    },
    shapeText(value, options = {}) {
      if (typeof value !== "string") return "";
      const text = value.trim();
      const limit = Number.isInteger(options.maxChars) && options.maxChars > 0 ? options.maxChars : text.length;
      return text.slice(0, limit);
    },
    normalizePositiveInt(value, fallback) {
      const parsed = Number.parseInt(value, 10);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
    },
    normalizeArtifactValue(value) {
      return typeof value === "string" ? value.trim().toLowerCase() : "";
    },
    clonePathRoleBuckets(value) {
      return value ? JSON.parse(JSON.stringify(value)) : null;
    },
    normalizeCwdValue(value) {
      return typeof value === "string" ? value.trim() : "";
    },
    normalizePathRole(value) {
      const text = typeof value === "string" ? value.trim().toLowerCase() : "";
      return ["read", "write", "search_scope", "list_scope"].includes(text) ? text : "";
    },
    getPathRoleValues(pathRoles, role) {
      return pathRoles && Array.isArray(pathRoles[role]) ? pathRoles[role] : [];
    },
    summarizeTurn(turn) {
      return turn && turn.summary ? turn.summary : "";
    },
    buildResumeReloadSafety() {
      return {
        allowed: true,
        decision: "ready",
        reasons: [],
        suggestedFlags: [],
      };
    },
    toTimestampMs(value) {
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : 0;
    },
    isLowSignalRelatedCommand(command) {
      return typeof command === "string" && command.includes("git status");
    },
    DEFAULT_EVENT_LIMIT: 20,
    DEFAULT_RESUME_TOTAL_CHARS: 12000,
    DEFAULT_RESUME_ITEM_CHARS: 400,
    DEFAULT_RESUME_TOOL_CHARS: 300,
    DEFAULT_RESUME_LINE_LIMIT: 8,
    DEFAULT_RESUME_TURN_LIMIT: 6,
    DEFAULT_RESUME_ITEM_LIMIT: 6,
    DEFAULT_RESUME_HIGHLIGHT_LIMIT: 4,
    DEFAULT_RESUME_TOOL_TEXT_MODE: "salient",
    PATH_ROLE_ORDER: ["read", "search_scope", "list_scope", "write"],
    RESUME_PATH_ROLE_ORDER: ["write", "read", "search_scope", "list_scope"],
    ...overrides,
  });
}

test("catalog history views keep transcript filters scoped to real matching items", () => {
  const views = createHistoryViews();
  const session = {
    sessionId: "codex:test",
    historyMode: "effective",
    cwd: "/repo",
    turnCount: 1,
    turns: [{ turnId: "turn-1" }],
  };
  const built = {
    transcript: [
      {
        index: 1,
        turnId: "turn-1",
        type: "assistant",
        text: "Plain assistant text mentioning ENOENT without real error metadata.",
        filesTouched: ["/repo/AGENTS.md"],
        commandPaths: ["/repo/AGENTS.md"],
        shellCommands: ["rg"],
        commandQueries: ["AGENTS.md"],
        errorSearchValues: [],
      },
      {
        index: 2,
        turnId: "turn-1",
        type: "tool",
        text: "Search failed with ENOENT.",
        filesTouched: ["/repo/AGENTS.md"],
        commandPaths: ["/repo/AGENTS.md"],
        shellCommands: ["rg"],
        commandQueries: ["AGENTS.md"],
        errorSearchValues: ["ENOENT: no such file or directory"],
      },
    ],
  };

  const result = views.buildTranscriptResultFromSessionData(session, built, "2026-04-23T10:00:00.000Z", {
    file: "AGENTS.md",
    path: "/repo/AGENTS.md",
    pathRole: "read",
    commandOp: "rg",
    query: "AGENTS",
    queryMode: "fuzzy",
    error: "enoent",
  }, {
    requested: "rollout",
    used: "rollout",
    selectionReason: "rollout_only_view",
    selectionNote: "used the rollout-only derived history view.",
  });

  assert.strictEqual(result.queryMode, "fuzzy");
  assert.strictEqual(result.matchedItems, 1);
  assert.strictEqual(result.items.length, 1);
  assert.strictEqual(result.items[0].type, "tool");
  assert.deepStrictEqual(result.items[0].matchedFiles, ["/repo/AGENTS.md"]);
  assert.deepStrictEqual(Array.from(new Set(result.items[0].matchedPaths)), ["/repo/AGENTS.md"]);
  assert.deepStrictEqual(result.items[0].matchedCommandOps, ["rg"]);
  assert.deepStrictEqual(result.items[0].matchedQueries, ["AGENTS.md"]);
});

test("catalog history views shape resume items with reload safety and tool text policy", () => {
  const views = createHistoryViews();
  const session = {
    sessionId: "codex:test",
    historyMode: "effective",
    cwd: "/repo",
    turnCount: 1,
    turns: [
      {
        turnId: "turn-1",
        startedAt: "2026-04-23T09:00:00.000Z",
        endedAt: "2026-04-23T09:05:00.000Z",
        status: "completed",
        summary: "Searched AGENTS guidance.",
        userPromptPreview: "Find AGENTS guidance.",
        commentaryPreview: "",
        finalAnswerPreview: "Found the right doc.",
        filesTouched: ["/repo/AGENTS.md"],
        pathsReferenced: ["/repo/AGENTS.md"],
        pathRoles: { read: ["/repo/AGENTS.md"] },
        queries: [{ query: "AGENTS.md" }],
        errors: [{ detail: "ENOENT from earlier probe" }],
        commands: [{ command: "rg AGENTS.md", commandQueries: ["AGENTS.md"] }],
        toolsUsed: ["exec_command", "web_search"],
      },
    ],
  };
  const built = {
    transcript: [
      {
        index: 1,
        turnId: "turn-1",
        type: "user",
        text: "Find AGENTS guidance.",
      },
      {
        index: 2,
        turnId: "turn-1",
        type: "tool",
        toolName: "exec_command",
        command: "cat AGENTS.md",
        commandTypes: ["read"],
        text: "Very long file contents that should be omitted in salient mode.",
      },
      {
        index: 3,
        turnId: "turn-1",
        type: "tool",
        toolName: "web_search",
        text: "Found AGENTS references on disk.",
        query: "AGENTS.md",
      },
      {
        index: 4,
        turnId: "turn-1",
        type: "assistant",
        text: "Found the right doc.",
      },
    ],
    compactions: [],
  };

  const result = views.buildResumeResultFromSessionData(session, built, "2026-04-23T10:00:00.000Z", {
    query: "AGENTS",
    queryMode: "fuzzy",
    turnLimit: 1,
    itemLimit: 5,
    highlightLimit: 3,
  }, {
    requested: "auto",
    used: "rollout",
    selectionReason: "rollout_only_view",
    selectionNote: "used the rollout-only derived history view.",
  });

  assert.strictEqual(result.queryMode, "fuzzy");
  assert.strictEqual(result.reloadSafety.decision, "ready");
  assert.strictEqual(result.reloadSafety.allowed, true);
  assert.strictEqual(result.turns.length, 1);
  assert.deepStrictEqual(result.turns[0].matchedQueries, ["AGENTS.md"]);

  const readTool = result.turns[0].items.find((item) => item.command === "cat AGENTS.md");
  const webSearchTool = result.turns[0].items.find((item) => item.toolName === "web_search");

  assert.ok(readTool);
  assert.strictEqual(readTool.textMode, "omitted");
  assert.strictEqual(readTool.omissionReason, "read_output");
  assert.strictEqual(readTool.text, "");

  assert.ok(webSearchTool);
  assert.strictEqual(webSearchTool.textMode, "salient");
  assert.strictEqual(webSearchTool.text, "Found AGENTS references on disk.");
});

test("catalog history views build transcript results from rollout events with rollout-only source metadata", () => {
  const readCalls = [];
  const views = createHistoryViews({
    matchesAnnotationFilters(entity, filters) {
      if (!filters.bookmarked) return false;
      return Boolean(entity && entity.annotation && entity.annotation.bookmarked);
    },
    readNormalizedSessionEvents(filePath) {
      readCalls.push(filePath);
      return [
        {
          record: {
            kind: "message",
            transcriptItem: {
              type: "assistant",
              text: "Bookmarked turn match.",
              commandQueries: ["AGENTS.md"],
              shellCommands: ["rg"],
            },
          },
          lineNumber: 1,
          resolvedTurnId: "turn-1",
          resolvedCwd: "/repo",
          includedInFinalHistory: true,
        },
        {
          record: {
            kind: "message",
            transcriptItem: {
              type: "assistant",
              text: "Unbookmarked turn match.",
              commandQueries: ["AGENTS.md"],
              shellCommands: ["rg"],
            },
          },
          lineNumber: 2,
          resolvedTurnId: "turn-2",
          resolvedCwd: "/repo",
          includedInFinalHistory: true,
        },
      ];
    },
    buildTranscriptItem(record, _lineNumber, index, resolvedTurnId, resolvedCwd) {
      if (!record || !record.transcriptItem) return null;
      return {
        ...record.transcriptItem,
        index,
        turnId: resolvedTurnId,
        cwd: resolvedCwd,
      };
    },
  });

  const catalog = {
    generatedAt: "2026-04-23T10:00:00.000Z",
    sessions: [
      {
        sessionId: "codex:test",
        filePath: "/sessions/test.jsonl",
        historyMode: "effective",
        cwd: "/repo",
        turnCount: 2,
        turns: [
          {
            turnId: "turn-1",
            annotation: { bookmarked: true },
          },
          {
            turnId: "turn-2",
            annotation: { bookmarked: false },
          },
        ],
      },
    ],
  };

  const result = views.getCatalogTranscript(catalog, "test", {
    source: "auto",
    bookmarked: "1",
    query: "AGENTS",
    queryMode: "fuzzy",
  });

  assert.deepStrictEqual(readCalls, ["/sessions/test.jsonl"]);
  assert.strictEqual(result.source.requested, "auto");
  assert.strictEqual(result.source.used, "rollout");
  assert.strictEqual(result.source.selectionReason, "rollout_only_view");
  assert.strictEqual(result.queryMode, "fuzzy");
  assert.strictEqual(result.matchedItems, 1);
  assert.strictEqual(result.items[0].turnId, "turn-1");
  assert.deepStrictEqual(result.items[0].matchedQueries, ["AGENTS.md"]);
});

test("catalog history views build resume results from rollout events with annotation-scoped turn filtering", () => {
  const views = createHistoryViews({
    matchesAnnotationFilters(entity, filters) {
      if (!filters.bookmarked) return false;
      return Boolean(entity && entity.annotation && entity.annotation.bookmarked);
    },
    turnMatches(turn, filters) {
      if (!turn || !filters.query) return null;
      return {
        score: turn.turnId === "turn-1" ? 50 : 25,
        reasons: ["query"],
        matchedCommandOps: ["rg"],
        matchedFiles: [],
        matchedPaths: [],
        matchedPathPatterns: [],
        matchedQueries: ["AGENTS.md"],
      };
    },
    readNormalizedSessionEvents() {
      return [
        {
          record: {
            kind: "message",
            transcriptItem: {
              type: "user",
              text: "Find AGENTS guidance.",
            },
          },
          lineNumber: 1,
          resolvedTurnId: "turn-1",
          resolvedCwd: "/repo",
          includedInFinalHistory: true,
        },
        {
          record: {
            kind: "message",
            transcriptItem: {
              type: "assistant",
              text: "Bookmarked turn answer.",
            },
          },
          lineNumber: 2,
          resolvedTurnId: "turn-1",
          resolvedCwd: "/repo",
          includedInFinalHistory: true,
        },
        {
          record: {
            kind: "message",
            transcriptItem: {
              type: "user",
              text: "Other turn prompt.",
            },
          },
          lineNumber: 3,
          resolvedTurnId: "turn-2",
          resolvedCwd: "/repo",
          includedInFinalHistory: true,
        },
        {
          record: {
            kind: "message",
            transcriptItem: {
              type: "assistant",
              text: "Unbookmarked turn answer.",
            },
          },
          lineNumber: 4,
          resolvedTurnId: "turn-2",
          resolvedCwd: "/repo",
          includedInFinalHistory: true,
        },
      ];
    },
    buildTranscriptItem(record, _lineNumber, index, resolvedTurnId, resolvedCwd) {
      if (!record || !record.transcriptItem) return null;
      return {
        ...record.transcriptItem,
        index,
        turnId: resolvedTurnId,
        cwd: resolvedCwd,
      };
    },
  });

  const catalog = {
    generatedAt: "2026-04-23T10:00:00.000Z",
    sessions: [
      {
        sessionId: "codex:test",
        filePath: "/sessions/test.jsonl",
        historyMode: "effective",
        cwd: "/repo",
        turnCount: 2,
        turns: [
          {
            turnId: "turn-1",
            startedAt: "2026-04-23T09:00:00.000Z",
            endedAt: "2026-04-23T09:05:00.000Z",
            status: "completed",
            annotation: { bookmarked: true },
            summary: "Bookmarked turn.",
            userPromptPreview: "Find AGENTS guidance.",
            commentaryPreview: "",
            finalAnswerPreview: "Bookmarked turn answer.",
            filesTouched: ["/repo/AGENTS.md"],
            pathsReferenced: ["/repo/AGENTS.md"],
            pathRoles: { read: ["/repo/AGENTS.md"] },
            queries: [{ query: "AGENTS.md" }],
            errors: [],
            commands: [{ command: "rg AGENTS.md", commandQueries: ["AGENTS.md"] }],
            toolsUsed: ["exec_command"],
          },
          {
            turnId: "turn-2",
            startedAt: "2026-04-23T09:06:00.000Z",
            endedAt: "2026-04-23T09:07:00.000Z",
            status: "completed",
            annotation: { bookmarked: false },
            summary: "Unbookmarked turn.",
            userPromptPreview: "Other turn prompt.",
            commentaryPreview: "",
            finalAnswerPreview: "Unbookmarked turn answer.",
            filesTouched: ["/repo/README.md"],
            pathsReferenced: ["/repo/README.md"],
            pathRoles: { read: ["/repo/README.md"] },
            queries: [{ query: "AGENTS.md" }],
            errors: [],
            commands: [{ command: "rg AGENTS.md", commandQueries: ["AGENTS.md"] }],
            toolsUsed: ["exec_command"],
          },
        ],
      },
    ],
  };

  const result = views.getCatalogResume(catalog, "test", {
    source: "auto",
    bookmarked: "1",
    query: "AGENTS",
    queryMode: "fuzzy",
    turnLimit: 4,
  });

  assert.strictEqual(result.source.requested, "auto");
  assert.strictEqual(result.source.used, "rollout");
  assert.strictEqual(result.source.selectionReason, "rollout_only_view");
  assert.strictEqual(result.queryMode, "fuzzy");
  assert.strictEqual(result.turnCount, 1);
  assert.strictEqual(result.turns.length, 1);
  assert.strictEqual(result.turns[0].turnId, "turn-1");
  assert.deepStrictEqual(result.turns[0].matchedQueries, ["AGENTS.md"]);
  assert.strictEqual(result.overview.latestTurnId, "turn-1");
});

test("catalog history views collapse duplicate assistant and tool transcript items from rollout events", () => {
  const views = createHistoryViews({
    readNormalizedSessionEvents() {
      return [
        {
          record: {
            kind: "message",
            transcriptItem: {
              type: "assistant",
              text: "Started work.",
            },
          },
          lineNumber: 1,
          resolvedTurnId: "turn-1",
          resolvedCwd: "/repo",
          includedInFinalHistory: true,
        },
        {
          record: {
            kind: "message",
            transcriptItem: {
              type: "assistant",
              text: "Started work.",
            },
          },
          lineNumber: 2,
          resolvedTurnId: "turn-1",
          resolvedCwd: "/repo",
          includedInFinalHistory: true,
        },
        {
          record: {
            kind: "status",
            transcriptItem: {
              type: "status",
              text: "Started work.",
            },
          },
          lineNumber: 3,
          resolvedTurnId: "turn-1",
          resolvedCwd: "/repo",
          includedInFinalHistory: true,
        },
        {
          record: {
            kind: "tool_call",
            transcriptItem: {
              type: "tool",
              callId: "call-1",
              stage: "call",
              toolName: "exec_command",
              command: "rg AGENTS",
            },
          },
          lineNumber: 4,
          resolvedTurnId: "turn-1",
          resolvedCwd: "/repo",
          includedInFinalHistory: true,
        },
        {
          record: {
            kind: "tool_output",
            transcriptItem: {
              type: "tool",
              callId: "call-1",
              stage: "output",
              toolName: "exec_command",
              text: "matched AGENTS",
            },
          },
          lineNumber: 5,
          resolvedTurnId: "turn-1",
          resolvedCwd: "/repo",
          includedInFinalHistory: true,
        },
      ];
    },
    buildTranscriptItem(record, _lineNumber, index, resolvedTurnId, resolvedCwd) {
      if (!record || !record.transcriptItem) return null;
      return {
        ...record.transcriptItem,
        index,
        turnId: resolvedTurnId,
        cwd: resolvedCwd,
      };
    },
    canDeduplicateTranscriptMessagePair(left, right) {
      return Boolean(
        left &&
        right &&
        left.type === "assistant" &&
        right.type === "assistant" &&
        left.turnId === right.turnId &&
        left.text === right.text
      );
    },
    mergeTranscriptMessageItem(existing, incoming) {
      return {
        ...existing,
        mergedMessageCount: (existing.mergedMessageCount || 1) + (incoming.mergedMessageCount || 1),
      };
    },
    mergeTranscriptToolItem(existing, incoming) {
      return {
        ...existing,
        stage: "merged",
        text: incoming.text || existing.text || "",
        mergedStages: [existing.stage, incoming.stage],
      };
    },
  });

  const catalog = {
    generatedAt: "2026-04-23T10:00:00.000Z",
    sessions: [
      {
        sessionId: "codex:test",
        filePath: "/sessions/test.jsonl",
        historyMode: "effective",
        cwd: "/repo",
        turnCount: 1,
        turns: [{ turnId: "turn-1" }],
      },
    ],
  };

  const result = views.getCatalogTranscript(catalog, "test", {
    source: "rollout",
  });

  assert.strictEqual(result.totalItems, 2);
  assert.strictEqual(result.items.length, 2);
  assert.strictEqual(result.items[0].type, "assistant");
  assert.strictEqual(result.items[0].mergedMessageCount, 2);
  assert.strictEqual(result.items[1].type, "tool");
  assert.strictEqual(result.items[1].stage, "merged");
  assert.deepStrictEqual(result.items[1].mergedStages, ["call", "output"]);
  assert.strictEqual(result.items[1].text, "matched AGENTS");
});

test("catalog history views keep only active-turn compactions in annotation-scoped resume results", () => {
  const views = createHistoryViews({
    matchesAnnotationFilters(entity, filters) {
      if (!filters.bookmarked) return false;
      return Boolean(entity && entity.annotation && entity.annotation.bookmarked);
    },
    turnMatches(turn, filters) {
      if (!turn || !filters.query) return null;
      return {
        score: turn.turnId === "turn-1" ? 50 : 25,
        reasons: ["query"],
        matchedCommandOps: [],
        matchedFiles: [],
        matchedPaths: [],
        matchedPathPatterns: [],
        matchedQueries: ["AGENTS.md"],
      };
    },
    readNormalizedSessionEvents() {
      return [
        {
          record: {
            kind: "compaction",
            timestamp: "2026-04-23T09:01:00.000Z",
            compaction: {
              replacementCount: 2,
              preview: "Bookmarked compaction preview.",
            },
          },
          lineNumber: 1,
          resolvedTurnId: "turn-1",
          resolvedCwd: "/repo",
          includedInFinalHistory: true,
        },
        {
          record: {
            kind: "message",
            transcriptItem: {
              type: "assistant",
              text: "Bookmarked turn answer.",
            },
          },
          lineNumber: 2,
          resolvedTurnId: "turn-1",
          resolvedCwd: "/repo",
          includedInFinalHistory: true,
        },
        {
          record: {
            kind: "compaction",
            timestamp: "2026-04-23T09:06:00.000Z",
            compaction: {
              replacementCount: 3,
              preview: "Unbookmarked compaction preview.",
            },
          },
          lineNumber: 3,
          resolvedTurnId: "turn-2",
          resolvedCwd: "/repo",
          includedInFinalHistory: true,
        },
        {
          record: {
            kind: "message",
            transcriptItem: {
              type: "assistant",
              text: "Unbookmarked turn answer.",
            },
          },
          lineNumber: 4,
          resolvedTurnId: "turn-2",
          resolvedCwd: "/repo",
          includedInFinalHistory: true,
        },
      ];
    },
    buildTranscriptItem(record, _lineNumber, index, resolvedTurnId, resolvedCwd) {
      if (!record || !record.transcriptItem) return null;
      return {
        ...record.transcriptItem,
        index,
        turnId: resolvedTurnId,
        cwd: resolvedCwd,
      };
    },
  });

  const catalog = {
    generatedAt: "2026-04-23T10:00:00.000Z",
    sessions: [
      {
        sessionId: "codex:test",
        filePath: "/sessions/test.jsonl",
        historyMode: "effective",
        cwd: "/repo",
        turnCount: 2,
        turns: [
          {
            turnId: "turn-1",
            startedAt: "2026-04-23T09:00:00.000Z",
            endedAt: "2026-04-23T09:05:00.000Z",
            status: "completed",
            annotation: { bookmarked: true },
            summary: "Bookmarked turn.",
            userPromptPreview: "Find AGENTS guidance.",
            commentaryPreview: "",
            finalAnswerPreview: "Bookmarked turn answer.",
            filesTouched: [],
            pathsReferenced: [],
            pathRoles: {},
            queries: [{ query: "AGENTS.md" }],
            errors: [],
            commands: [{ command: "rg AGENTS.md", commandQueries: ["AGENTS.md"] }],
            toolsUsed: ["exec_command"],
          },
          {
            turnId: "turn-2",
            startedAt: "2026-04-23T09:06:00.000Z",
            endedAt: "2026-04-23T09:07:00.000Z",
            status: "completed",
            annotation: { bookmarked: false },
            summary: "Unbookmarked turn.",
            userPromptPreview: "Other turn prompt.",
            commentaryPreview: "",
            finalAnswerPreview: "Unbookmarked turn answer.",
            filesTouched: [],
            pathsReferenced: [],
            pathRoles: {},
            queries: [{ query: "AGENTS.md" }],
            errors: [],
            commands: [{ command: "rg AGENTS.md", commandQueries: ["AGENTS.md"] }],
            toolsUsed: ["exec_command"],
          },
        ],
      },
    ],
  };

  const result = views.getCatalogResume(catalog, "test", {
    source: "auto",
    bookmarked: "1",
    query: "AGENTS",
    queryMode: "fuzzy",
    turnLimit: 4,
  });

  assert.strictEqual(result.turnCount, 1);
  assert.strictEqual(result.turns.length, 1);
  assert.strictEqual(result.turns[0].turnId, "turn-1");
  assert.strictEqual(result.compactions.count, 1);
  assert.strictEqual(result.compactions.lastTimestamp, "2026-04-23T09:01:00.000Z");
  assert.strictEqual(result.compactions.lastPreview, "Bookmarked compaction preview.");
});
