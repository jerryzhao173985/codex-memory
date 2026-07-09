"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createCatalogArtifactViews } = require("../catalog-artifact-views");

function createArtifactViews(overrides = {}) {
  const classifyCommandOpSignal = (value) => {
    const text = String(value || "").toLowerCase();
    if (text === "rg") return "high";
    if (text === "python") return "medium";
    return "low";
  };
  const classifyQuerySignal = (value) => {
    const text = String(value || "");
    if (text.endsWith(".md")) return "low";
    if (text.startsWith("/api/")) return "medium";
    return "high";
  };
  return createCatalogArtifactViews({
    path: require("node:path"),
    summarizeText(value) {
      return typeof value === "string" ? value.trim() : "";
    },
    prefixedSessionId(value) {
      if (typeof value !== "string" || !value.trim()) return "";
      const text = value.trim();
      return text.startsWith("codex:") ? text : `codex:${text}`;
    },
    normalizeHistoryMode(value) {
      return String(value || "").trim().toLowerCase() === "raw" ? "raw" : "effective";
    },
    resolveCatalogForHistoryMode(catalog) {
      return { catalog };
    },
    normalizeArtifactKind(value) {
      const text = typeof value === "string" ? value.trim().toLowerCase() : "";
      return ["file", "path", "path_pattern", "tool", "command", "command_op", "query", "error"].includes(text)
        ? text
        : "";
    },
    normalizeArtifactValue(value) {
      return typeof value === "string" ? value.trim().toLowerCase() : "";
    },
    matchesArtifactValue(left, right) {
      return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
    },
    normalizeOffset(value) {
      return Number.isInteger(value) ? value : 0;
    },
    normalizeResultShape() {
      return "full";
    },
    normalizeCwdValue(value) {
      return typeof value === "string" ? value.trim() : "";
    },
    normalizeReferencedPath(_cwd, value) {
      return typeof value === "string" ? value.trim() : "";
    },
    matchesPathValue(left, right) {
      return String(left || "").trim() === String(right || "").trim();
    },
    matchesPathNeedle(value, needle) {
      return String(value || "").toLowerCase().includes(String(needle || "").toLowerCase());
    },
    normalizePathRole(value) {
      const text = typeof value === "string" ? value.trim().toLowerCase() : "";
      return ["read", "write", "search_scope", "list_scope"].includes(text) ? text : "";
    },
    getPathRoleValues(pathRoles, role) {
      return pathRoles && Array.isArray(pathRoles[role]) ? pathRoles[role] : [];
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
    getRequestedCommandOpSignal(filters) {
      return typeof (filters.commandOpSignal || filters.command_op_signal) === "string"
        ? (filters.commandOpSignal || filters.command_op_signal).trim().toLowerCase()
        : "";
    },
    getCommandOpSignalRank(value) {
      return { high: 0, medium: 1, low: 2 }[classifyCommandOpSignal(value)] ?? 99;
    },
    getQuerySignalRank(value) {
      return { high: 0, medium: 1, low: 2 }[classifyQuerySignal(value)] ?? 99;
    },
    getPathPatternQuerySortScore() {
      return 0;
    },
    getQueryArtifactSortScore() {
      return 0;
    },
    classifyCommandOpSignal,
    classifyPathPatternValue(value) {
      return String(value || "").includes("*") ? "glob" : "literal";
    },
    classifyQuerySignal,
    matchesSessionFilters() {
      return true;
    },
    matchesEntityPathFilters() {
      return true;
    },
    hasSessionScopeFilters() {
      return false;
    },
    getEntityPathArtifacts(entity) {
      return Array.isArray(entity && entity.pathArtifacts) ? entity.pathArtifacts : [];
    },
    getEntityPathPatternArtifacts(entity) {
      return Array.isArray(entity && entity.pathPatternArtifacts) ? entity.pathPatternArtifacts : [];
    },
    getEntityPathCandidates(_entity, _filters, values) {
      return Array.isArray(values) ? values : [];
    },
    getEntityPathPatternCandidates(_entity, _filters, values) {
      return Array.isArray(values) ? values : [];
    },
    getEntityPathValueRoles(entity, value) {
      return Array.isArray(entity && entity.pathRolesByValue && entity.pathRolesByValue[value])
        ? entity.pathRolesByValue[value]
        : [];
    },
    getEntityPathPatternValueRoles(entity, value) {
      return Array.isArray(entity && entity.pathPatternRolesByValue && entity.pathPatternRolesByValue[value])
        ? entity.pathPatternRolesByValue[value]
        : [];
    },
    getEntityErrorArtifactCandidates(entity) {
      return Array.isArray(entity && entity.errorArtifacts) ? entity.errorArtifacts : [];
    },
    getMatchingCommandOps(values, filters) {
      const requested = typeof (filters.commandOp || filters.command_op) === "string"
        ? (filters.commandOp || filters.command_op).trim().toLowerCase()
        : "";
      const list = Array.isArray(values) ? values : [];
      const filtered = requested
        ? list.filter((value) => String(value).toLowerCase().includes(requested))
        : list.slice();
      const requestedSignal = typeof (filters.commandOpSignal || filters.command_op_signal) === "string"
        ? (filters.commandOpSignal || filters.command_op_signal).trim().toLowerCase()
        : "";
      return requestedSignal
        ? filtered.filter((value) => classifyCommandOpSignal(value) === requestedSignal)
        : filtered;
    },
    getEntityAnnotation(entity) {
      return entity && entity.annotation ? entity.annotation : null;
    },
    summarizeProjectTurnCompact(_session, turn) {
      return {
        turnId: turn.turnId,
        status: turn.status,
      };
    },
    summarizeSessionCompact(session) {
      return {
        sessionId: session.sessionId,
        updatedAt: session.updatedAt,
      };
    },
    getSessionKey(session) {
      return session && session.sessionId ? session.sessionId : "";
    },
    readNormalizedSessionEvents() {
      return [];
    },
    selectNormalizedEvents(events) {
      return events;
    },
    summarizeCatalogEvent(record) {
      return record;
    },
    compactCatalogEvents(events) {
      return events;
    },
    getRecordReferencedPaths() {
      return { allPaths: [], pathRoles: {} };
    },
    toTimestampMs(value) {
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : 0;
    },
    DEFAULT_RESULT_LIMIT: 20,
    DEFAULT_THREAD_EVENT_LIMIT: 10,
    MAX_ARTIFACT_SESSION_REFS: 12,
    MAX_TURN_ITEMS: 6,
    ...overrides,
  });
}

function createArtifactCatalog() {
  return {
    generatedAt: "2026-04-23T10:00:00.000Z",
    historyMode: "effective",
    artifacts: {
      counts: {
        command_op: 3,
        query: 2,
      },
      byKind: {
        command_op: [
          {
            kind: "command_op",
            value: "rg",
            sessions: [{ sessionId: "codex:one", updatedAt: "2026-04-23T09:00:00.000Z" }],
            sessionCount: 1,
            lastSeenAt: "2026-04-23T09:00:00.000Z",
          },
          {
            kind: "command_op",
            value: "python",
            sessions: [{ sessionId: "codex:one", updatedAt: "2026-04-23T09:00:00.000Z" }],
            sessionCount: 1,
            lastSeenAt: "2026-04-23T09:00:00.000Z",
          },
          {
            kind: "command_op",
            value: "ls",
            sessions: [{ sessionId: "codex:two", updatedAt: "2026-04-23T08:00:00.000Z" }],
            sessionCount: 1,
            lastSeenAt: "2026-04-23T08:00:00.000Z",
          },
        ],
        query: [
          {
            kind: "query",
            value: "AGENTS.md",
            sessions: [{ sessionId: "codex:one", updatedAt: "2026-04-23T09:00:00.000Z" }],
            sessionCount: 1,
            lastSeenAt: "2026-04-23T09:00:00.000Z",
          },
          {
            kind: "query",
            value: "/api/ai/analyze",
            sessions: [{ sessionId: "codex:two", updatedAt: "2026-04-23T08:30:00.000Z" }],
            sessionCount: 1,
            lastSeenAt: "2026-04-23T08:30:00.000Z",
          },
        ],
      },
    },
    sessions: [
      {
        sessionId: "codex:one",
        updatedAt: "2026-04-23T09:00:00.000Z",
        queryArtifacts: ["AGENTS.md"],
        turns: [
          {
            turnId: "turn-1",
            status: "completed",
            queryArtifacts: ["AGENTS.md"],
          },
        ],
      },
      {
        sessionId: "codex:two",
        updatedAt: "2026-04-23T08:30:00.000Z",
        queryArtifacts: ["/api/ai/analyze"],
        turns: [
          {
            turnId: "turn-2",
            status: "completed",
            queryArtifacts: ["/api/ai/analyze"],
          },
        ],
      },
    ],
  };
}

test("catalog artifact views keep query signal tier on artifact detail and turn drilldown", () => {
  const views = createArtifactViews();
  const catalog = createArtifactCatalog();

  const artifact = views.getCatalogArtifact(catalog, "query", "AGENTS.md");
  const turns = views.getCatalogArtifactTurns(catalog, "query", "AGENTS.md");

  assert.ok(artifact);
  assert.strictEqual(artifact.kind, "query");
  assert.strictEqual(artifact.signalTier, "low");
  assert.strictEqual(artifact.turnCount, 1);

  assert.ok(turns);
  assert.strictEqual(turns.kind, "query");
  assert.strictEqual(turns.signalTier, "low");
  assert.strictEqual(turns.turnCount, 1);
});

test("catalog artifact views filter command-op browse by canonical signal tier", () => {
  const views = createArtifactViews();
  const catalog = createArtifactCatalog();

  const result = views.listCatalogArtifacts(catalog, {
    kind: "command_op",
    commandOpSignal: "medium",
  });

  assert.strictEqual(result.total, 1);
  assert.deepStrictEqual(
    result.artifacts.map((item) => ({ value: item.value, signalTier: item.signalTier })),
    [{ value: "python", signalTier: "medium" }]
  );
});
