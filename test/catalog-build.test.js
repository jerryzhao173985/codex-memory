const { describe, it } = require("node:test");
const assert = require("node:assert");
const { createCatalogBuild } = require("../catalog-build");

function createBuild(overrides = {}) {
  const build = createCatalogBuild({
    prefixedSessionId(value) {
      if (typeof value !== "string" || !value.trim()) return "";
      const text = value.trim();
      return text.startsWith("codex:") ? text : `codex:${text}`;
    },
    toTimestampMs(value) {
      if (typeof value === "number") return value;
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : 0;
    },
    getEntityPathArtifacts(entity) {
      return Array.isArray(entity && entity.pathArtifacts) ? entity.pathArtifacts : [];
    },
    getEntityPathPatternArtifacts(entity) {
      return Array.isArray(entity && entity.pathPatternArtifacts) ? entity.pathPatternArtifacts : [];
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
    getSessionRolloutMemoryMode(session) {
      return session && session.memoryMode ? session.memoryMode : "enabled";
    },
    getSessionRolloutEventMode(session) {
      return session && session.eventMode ? session.eventMode : "limited_or_unknown";
    },
    getSessionTags(session) {
      return Array.isArray(session && session.tags) ? session.tags : [];
    },
    classifySessionQuality(session) {
      return session && session.qualityClass ? session.qualityClass : "useful";
    },
    classifyPathPatternValue(value) {
      return String(value || "").includes("*") ? "glob" : "literal";
    },
    classifyCommandOpSignal(value) {
      return String(value || "") === "rg" ? "high" : "medium";
    },
    classifyQuerySignal(value) {
      return String(value || "").endsWith(".md") ? "low" : "high";
    },
    getQuerySignalRank(value) {
      return String(value || "").endsWith(".md") ? 10 : 1;
    },
    buildNormalizedErrorSearchValues(entry) {
      return typeof entry === "string"
        ? [entry]
        : (entry && entry.message ? [entry.message] : []);
    },
    normalizeArtifactValue(value) {
      return typeof value === "string" ? value.trim().toLowerCase() : "";
    },
    isPathWithinProject(cwd, value) {
      if (typeof cwd !== "string" || typeof value !== "string") return false;
      return value === cwd || value.startsWith(`${cwd}/`);
    },
    deriveProjectDisplayPath(cwd, value) {
      if (typeof cwd !== "string" || typeof value !== "string") return value || "";
      return value.startsWith(`${cwd}/`) ? value.slice(cwd.length + 1) : value;
    },
    deriveRelativeDisplayPath(cwd, value) {
      if (typeof cwd !== "string" || typeof value !== "string") return value || "";
      return value.startsWith(`${cwd}/`) ? value.slice(cwd.length + 1) : value;
    },
    collectEntityFocusRootStats(entity) {
      return entity && entity.focusRoots ? { ...entity.focusRoots } : {};
    },
    mergeFocusRootStats(target, source) {
      for (const [key, count] of Object.entries(source || {})) {
        target[key] = (target[key] || 0) + count;
      }
    },
    sortFocusRootStats(stats, limit = 10) {
      return Object.entries(stats || {})
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, limit)
        .map(([path, count]) => ({ path, count }));
    },
    normalizeHistoryMode(value) {
      return String(value || "").trim().toLowerCase() === "raw" ? "raw" : "effective";
    },
    resolveSessionDir(value) {
      return typeof value === "string" && value ? value : "/sessions";
    },
    listRolloutFiles() {
      return [];
    },
    buildSessionDocumentFromFile() {
      return null;
    },
    PATH_ROLE_ORDER: ["read", "search_scope", "list_scope", "write"],
    MAX_ARTIFACT_SESSION_REFS: 12,
    MAX_PROJECT_SESSION_REFS: 12,
    MAX_PROJECT_SEARCH_TEXT_CHARS: 65536,
    MAX_ERROR_ARTIFACTS: 120,
    ...overrides,
  });

  return build;
}

describe("catalog build", () => {
  it("annotates lineage roots and family counts on prefixed session ids", () => {
    const build = createBuild();
    const sessions = [
      {
        sessionId: "codex:root",
        updatedAt: "2026-04-20T10:00:00.000Z",
        searchText: "root session",
      },
      {
        sessionId: "codex:child",
        parentThreadId: "codex:root",
        updatedAt: "2026-04-20T11:00:00.000Z",
        searchText: "child session",
      },
      {
        sessionId: "codex:fork",
        forkedFromId: "codex:root",
        updatedAt: "2026-04-20T12:00:00.000Z",
        searchText: "fork session",
      },
    ];

    build.buildSessionLineageMetadata(sessions);

    assert.strictEqual(sessions[0].lineageRootId, "codex:root");
    assert.strictEqual(sessions[1].lineageRootId, "codex:root");
    assert.strictEqual(sessions[2].lineageRootId, "codex:root");
    assert.strictEqual(sessions[0].lineageFamilyCount, 3);
    assert.strictEqual(sessions[1].lineageDepth, 1);
    assert.match(sessions[2].searchText, /codex:root/);
  });

  it("builds a historical catalog from rollout session documents", () => {
    const calls = [];
    const sessionsByFile = {
      "/sessions/first.jsonl": {
        sessionId: "codex:first",
        filePath: "/sessions/first.jsonl",
        startedAt: "2026-04-20T09:00:00.000Z",
        updatedAt: "2026-04-20T10:00:00.000Z",
        cwd: "/repo",
        model: "gpt-5.4",
        toolsUsed: ["shell"],
        filesTouched: ["/repo/src/app.js"],
        pathArtifacts: ["/repo/src/app.js"],
        pathPatternArtifacts: ["/repo/src/*.js"],
        pathRolesByValue: { "/repo/src/app.js": ["write"] },
        pathPatternRolesByValue: { "/repo/src/*.js": ["search_scope"] },
        commandArtifacts: ["sed -n '1,20p' src/app.js"],
        commandOpArtifacts: ["sed"],
        queryArtifacts: ["feature-toggle"],
        errorArtifacts: [],
        recentErrors: [],
        turns: [],
        tags: ["has_command"],
        focusRoots: { "/repo/src": 3 },
        turnCount: 1,
        commandCount: 1,
        patchCount: 1,
        searchCount: 1,
        mcpCount: 0,
        errorCount: 0,
        qualityClass: "useful",
      },
      "/sessions/second.jsonl": {
        sessionId: "codex:second",
        filePath: "/sessions/second.jsonl",
        startedAt: "2026-04-20T11:00:00.000Z",
        updatedAt: "2026-04-20T12:00:00.000Z",
        cwd: "/repo",
        model: "gpt-5.4",
        toolsUsed: ["apply_patch"],
        filesTouched: ["/repo/src/other.js"],
        pathArtifacts: ["/repo/src/other.js"],
        pathPatternArtifacts: [],
        pathRolesByValue: { "/repo/src/other.js": ["read"] },
        pathPatternRolesByValue: {},
        commandArtifacts: ["rg feature-toggle"],
        commandOpArtifacts: ["rg"],
        queryArtifacts: ["AGENTS.md"],
        errorArtifacts: ["ENOENT"],
        recentErrors: [{ message: "ENOENT" }],
        turns: [],
        tags: ["has_error"],
        focusRoots: { "/repo/src": 2 },
        turnCount: 1,
        commandCount: 1,
        patchCount: 0,
        searchCount: 1,
        mcpCount: 0,
        errorCount: 1,
        qualityClass: "partial_investigation",
      },
      "/sessions/skip.jsonl": null,
    };

    const build = createBuild({
      listRolloutFiles() {
        return ["/sessions/first.jsonl", "/sessions/skip.jsonl", "/sessions/second.jsonl"];
      },
      buildSessionDocumentFromFile(filePath, options = {}) {
        calls.push({ filePath, historyMode: options.historyMode });
        return sessionsByFile[filePath] || null;
      },
    });

    const result = build.buildHistoricalCatalog({
      sessionDir: "/sessions",
      historyMode: "raw",
    });

    assert.deepStrictEqual(
      calls.map((entry) => entry.historyMode),
      ["raw", "raw", "raw"]
    );
    assert.deepStrictEqual(
      result.sessions.map((session) => session.sessionId),
      ["codex:second", "codex:first"]
    );
    assert.strictEqual(result.historyMode, "raw");
    assert.strictEqual(result.sessionDir, "/sessions");
    assert.strictEqual(result.sessionCount, 2);
    assert.strictEqual(result.facets.topProjects[0].cwd, "/repo");
    assert.strictEqual(result.artifacts.counts.query, 2);
    assert.strictEqual(result.projects.length, 1);
    assert.strictEqual(result.projects[0].cwd, "/repo");
    assert.strictEqual(result.projects[0].topTools[0].tool, "apply_patch");
  });
});
