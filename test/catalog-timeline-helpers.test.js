const { describe, it } = require("node:test");
const assert = require("node:assert");
const { createCatalogTimelineHelpers } = require("../catalog-timeline-helpers");

function createHelpers() {
  const PATH_ROLE_ORDER = ["read", "search_scope", "list_scope", "write"];
  const createPathRoleBuckets = () => ({
    read: [],
    search_scope: [],
    list_scope: [],
    write: [],
  });
  const addUnique = (list, value, limit = 50) => {
    if (!value) return;
    if (list.includes(value)) return;
    if (list.length >= limit) return;
    list.push(value);
  };
  const mergeUniqueTextValues = (left, right, limit = 50) => {
    const values = [];
    for (const list of [left, right]) {
      for (const value of Array.isArray(list) ? list : []) addUnique(values, value, limit);
    }
    return values;
  };

  return createCatalogTimelineHelpers({
    summarizeText(value, limit = 4000) {
      const text = typeof value === "string" ? value : String(value || "");
      return text.length > limit ? text.slice(0, limit) : text;
    },
    mergeUniqueTextValues,
    createPathRoleBuckets,
    PATH_ROLE_ORDER,
    MAX_PATH_ARTIFACTS: 160,
    toTimestampMs(value) {
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : null;
    },
    normalizeCwdValue(value) {
      return typeof value === "string" ? value.trim().toLowerCase() : "";
    },
    normalizeReferencedPath(cwd, value) {
      if (typeof value !== "string" || !value.trim()) return "";
      const trimmed = value.trim();
      if (trimmed.startsWith("/")) return trimmed;
      return `${cwd.replace(/\/$/, "")}/${trimmed}`.replace(/\/+/g, "/");
    },
    addUnique,
  });
}

describe("catalog timeline helpers", () => {
  it("normalizes structured app-server turn errors into searchable detail", () => {
    const helpers = createHelpers();

    const error = helpers.normalizeAppServerTurnError({
      message: "Request failed",
      codexErrorInfo: {
        auth_error: {
          httpStatusCode: 401,
        },
      },
      additionalDetails: {
        requestId: "req_123",
      },
    });

    assert.deepStrictEqual(error.errorCode, "auth_error");
    assert.deepStrictEqual(error.statusCode, 401);
    assert.match(error.detail, /errorCode=auth_error/);
    assert.match(error.detail, /statusCode=401/);

    const searchValues = helpers.buildNormalizedErrorSearchValues(error);
    assert.ok(searchValues.includes("Request failed"));
    assert.ok(searchValues.includes("auth_error"));
    assert.ok(searchValues.includes("401"));
  });

  it("deduplicates merged transcript memory citations while preserving searchable values", () => {
    const helpers = createHelpers();
    const left = {
      index: 4,
      lineNumber: 20,
      timestamp: "2026-04-20T10:00:00.000Z",
      turnId: "turn-1",
      type: "assistant",
      phase: "final_answer",
      text: "Use AGENTS.md",
      detail: "Use AGENTS.md",
      preview: "Use AGENTS.md",
      includedInFinalHistory: true,
      commandTypes: ["read"],
      pathRoles: { read: ["/repo/AGENTS.md"], search_scope: [], list_scope: [], write: [] },
      pathPatternRoles: { read: [], search_scope: [], list_scope: [], write: [] },
      commandPaths: ["/repo/AGENTS.md"],
      commandPathPatterns: [],
      commandQueries: [],
      queries: [],
      filesTouched: [],
      memoryCitation: {
        entries: [
          {
            path: "AGENTS.md",
            lineStart: 1,
            lineEnd: 2,
            note: "policy",
          },
        ],
        threadIds: ["codex:a"],
      },
      memoryCitationPaths: ["/repo/AGENTS.md"],
    };
    const right = {
      index: 5,
      lineNumber: 21,
      timestamp: "2026-04-20T10:00:00.100Z",
      turnId: "turn-1",
      type: "assistant",
      phase: "final_answer",
      text: "use agents.md",
      detail: "use agents.md",
      preview: "use agents.md",
      includedInFinalHistory: true,
      commandTypes: ["search"],
      pathRoles: { read: [], search_scope: ["/repo"], list_scope: [], write: [] },
      pathPatternRoles: { read: [], search_scope: [], list_scope: [], write: [] },
      commandPaths: ["/repo/README.md"],
      commandPathPatterns: [],
      commandQueries: ["AGENTS"],
      queries: ["AGENTS"],
      filesTouched: [],
      memoryCitation: {
        entries: [
          {
            path: "AGENTS.md",
            lineStart: 1,
            lineEnd: 2,
            note: "policy",
          },
        ],
        threadIds: ["codex:a", "codex:b"],
      },
      memoryCitationPaths: ["/repo/AGENTS.md", "/repo/README.md"],
    };

    assert.strictEqual(helpers.canDeduplicateTranscriptMessagePair(left, right), true);

    const merged = helpers.mergeTranscriptMessageItem(left, right);
    assert.deepStrictEqual(merged.commandTypes, ["read", "search"]);
    assert.deepStrictEqual(merged.commandPaths, ["/repo/AGENTS.md", "/repo/README.md"]);
    assert.deepStrictEqual(merged.memoryCitation.threadIds, ["codex:a", "codex:b"]);
    assert.strictEqual(merged.memoryCitation.entries.length, 1);
    assert.deepStrictEqual(
      helpers.getTranscriptItemMemoryCitationSearchValues(merged),
      ["AGENTS.md", "policy", "1-2", "/repo/AGENTS.md", "/repo/README.md", "codex:a", "codex:b"]
    );
  });
});
