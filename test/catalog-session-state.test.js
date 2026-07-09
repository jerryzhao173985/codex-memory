const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const os = require("os");
const { createCatalogSessionState } = require("../catalog-session-state");

function createState() {
  return createCatalogSessionState({
    path,
    os,
    prefixedSessionId(value) {
      if (typeof value !== "string" || !value.trim()) return "";
      const text = value.trim();
      return text.startsWith("codex:") ? text : `codex:${text}`;
    },
    extractSessionIdFromFilePath(filePath) {
      const base = path.basename(String(filePath || ""));
      const stripped = base.endsWith(".jsonl")
        ? base.slice(0, -".jsonl".length)
        : (base.endsWith(".json") ? base.slice(0, -".json".length) : base);
      return stripped.startsWith("rollout-") ? stripped.slice("rollout-".length) : "";
    },
    extractRolloutKeyFromFilePath(filePath) {
      const base = path.basename(String(filePath || ""));
      return base.endsWith(".jsonl")
        ? base.slice(0, -".jsonl".length)
        : (base.endsWith(".json") ? base.slice(0, -".json".length) : base);
    },
    normalizeHistoryMode(value) {
      return String(value || "").trim().toLowerCase() === "raw" ? "raw" : "effective";
    },
    normalizeRolloutMemoryMode(value) {
      const text = typeof value === "string" ? value.trim().toLowerCase() : "";
      return text || "";
    },
    summarizeText(value, limit = 4000) {
      const text = typeof value === "string" ? value : String(value || "");
      return text.length > limit ? text.slice(0, limit) : text;
    },
    addUnique(list, value, limit = 50) {
      if (!value || list.includes(value) || list.length >= limit) return;
      list.push(value);
    },
    looksLikeGlobPath(value) {
      return /[*?[\]{}]/.test(String(value || ""));
    },
    matchesPathValue(left, right) {
      const normalize = (value) => String(value || "").trim().replace(/\\/g, "/");
      const a = normalize(left);
      const b = normalize(right);
      return Boolean(a && b && (a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`)));
    },
    getEntityPathArtifacts(entity) {
      return Array.isArray(entity && entity.pathArtifacts) ? entity.pathArtifacts : [];
    },
    getEntityPathPatternArtifacts(entity) {
      return Array.isArray(entity && entity.pathPatternArtifacts) ? entity.pathPatternArtifacts : [];
    },
    toTimestampMs(value) {
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : 0;
    },
    SESSION_DOC_SCHEMA_VERSION: 22,
    PATH_ROLE_ORDER: ["read", "search_scope", "list_scope", "write"],
    COMMAND_TYPE_PATH_ROLE_MAP: {
      read: "read",
      search: "search_scope",
      list_files: "list_scope",
    },
    EXTENDED_EVENT_PERSISTENCE_KEYS: new Set(["event_msg:error"]),
    FOCUS_ROOT_SIGNAL_SCORES: {
      file: 12,
      write: 10,
      read: 7,
      search_scope: 3,
      list_scope: 2,
      path_pattern: 1,
      fallback: 2,
    },
    MAX_UNIQUE_VALUES: 50,
    MAX_TURN_ITEMS: 20,
    MAX_PATH_ARTIFACTS: 160,
    MAX_SEARCH_TEXT_CHARS: 32768,
  });
}

describe("catalog session state", () => {
  it("normalizes session ids, paths, and path-role buckets consistently", () => {
    const state = createState();
    const session = state.createSessionDocument("/tmp/rollout-123.jsonl");

    assert.strictEqual(session.sessionId, "codex:123");
    assert.strictEqual(session.sessionKey, "rollout-123");

    state.noteSessionPath(session, "/repo", "src/app.js", "write");
    state.noteSessionPathPattern(session, "/repo", "src/**/*.js", "search_scope");

    assert.deepStrictEqual(session.pathArtifacts, [path.normalize("/repo/src/app.js")]);
    assert.deepStrictEqual(session.pathRoles.write, [path.normalize("/repo/src/app.js")]);
    assert.deepStrictEqual(session.pathPatternRoles.search_scope, [path.normalize("/repo/src/**/*.js")]);
    assert.strictEqual(state.deriveRelativeDisplayPath("/repo", "/repo/src/app.js"), "src/app.js");
    assert.strictEqual(state.isPathWithinProject("/repo", "/repo/src/app.js"), true);
    assert.strictEqual(state.deriveProjectDisplayPath("/repo", "/repo/src/app.js"), "src/app.js");
  });

  it("finalizes sessions with file-preferred focus roots and rollout persistence tags", () => {
    const state = createState();
    const session = state.createSessionDocument("/tmp/rollout-focus.jsonl");

    session.startedAt = "2026-04-20T10:00:00.000Z";
    session.updatedAt = "2026-04-20T10:05:00.000Z";
    session.cwd = "/repo";
    session.model = "gpt-5.4";
    session.modelProvider = "openai";
    session.memoryMode = "disabled";
    session._rolloutPersistenceKnown = true;
    session._extendedEventPersistenceKeys.add("event_msg:error");
    session.commandCount = 1;
    session.searchCount = 1;
    session.finalAnswerPreview = "Finished the docs update.";
    session.lastUserPreview = "Update docs";
    session._replayedSessionIds.add("codex:parent");

    state.noteSearchBucket(session, "text", "AGENTS.md");
    state.noteSessionFile(session, "/repo", "docs/README.md");
    state.noteSessionPath(session, "/repo", "docs/README.md", "write");
    state.noteSessionPath(session, "/repo", "src/index.js", "search_scope");

    const finalized = state.finalizeSession(session);

    assert.strictEqual(finalized.focusRoot, "docs");
    assert.deepStrictEqual(finalized.topFocusRoots.map((item) => item.root), ["docs", "src"]);
    assert.strictEqual(finalized.rolloutPersistence.eventMode, "extended_observed");
    assert.ok(finalized.tags.includes("has_command"));
    assert.ok(finalized.tags.includes("has_search"));
    assert.ok(finalized.tags.includes("has_answer"));
    assert.ok(finalized.tags.includes("has_extended_events"));
    assert.ok(finalized.tags.includes("memory_disabled"));
    assert.ok(finalized.tags.includes("has_replayed_history"));
    assert.match(finalized.searchText, /agents\.md/);
    assert.deepStrictEqual(finalized.replayedSessionIds, ["codex:parent"]);
  });
});
