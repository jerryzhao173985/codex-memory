const { describe, it } = require("node:test");
const assert = require("node:assert");
const { createCatalogMatchers } = require("../catalog-matchers");

function createMatchers() {
  return createCatalogMatchers({
    prefixedSessionId(value) {
      if (typeof value !== "string" || !value.trim()) return "";
      const text = value.trim();
      return text.startsWith("codex:") ? text : `codex:${text}`;
    },
    normalizeRolloutMemoryMode(value) {
      return typeof value === "string" ? value.trim().toLowerCase() : "";
    },
    normalizeRolloutEventMode(value) {
      return typeof value === "string" ? value.trim().toLowerCase() : "";
    },
    getSessionRolloutMemoryMode(session) {
      return session && session.memoryMode ? session.memoryMode : "";
    },
    getSessionRolloutEventMode(session) {
      return session && session.eventMode ? session.eventMode : "";
    },
    normalizeSessionQualityClass(value) {
      return typeof value === "string" ? value.trim().toLowerCase() : "";
    },
    classifySessionQuality(session) {
      return session && session.qualityClass ? session.qualityClass : "useful";
    },
    getSessionTags(session) {
      return Array.isArray(session && session.tags) ? session.tags : [];
    },
    resolveRequestedSessionTag(_session, tag) {
      return typeof tag === "string" ? tag.trim().toLowerCase() : "";
    },
    getEntityAnnotation(entity) {
      return entity && entity.annotation ? entity.annotation : null;
    },
    matchesPathNeedle(candidate, needle) {
      return String(candidate || "").toLowerCase().includes(String(needle || "").toLowerCase());
    },
    normalizeSearchMode(value, fallback = "substring") {
      const text = typeof value === "string" ? value.trim().toLowerCase() : "";
      return text || fallback;
    },
    buildQuerySearchCandidates(values) {
      return (Array.isArray(values) ? values : []).map((value) => ({ value }));
    },
    findSearchCandidateMatches(candidates, requested, mode) {
      const needle = String(requested || "").toLowerCase();
      const matches = [];
      for (const candidate of Array.isArray(candidates) ? candidates : []) {
        const text = typeof candidate.value === "string"
          ? candidate.value
          : (candidate.value && typeof candidate.value.query === "string" ? candidate.value.query : "");
        const haystack = text.toLowerCase();
        const matched = mode === "exact"
          ? haystack === needle
          : haystack.includes(needle) || haystack.includes("agents");
        if (!matched) continue;
        matches.push({
          kind: "query",
          text,
          score: mode === "fuzzy" ? 77 : 55,
        });
      }
      return {
        matches,
        bestMatch: matches[0] || null,
        bestScore: matches[0] ? matches[0].score : 0,
      };
    },
    getSessionQuerySearchCandidates(session) {
      return (Array.isArray(session && session.queryArtifacts) ? session.queryArtifacts : []).map((value) => ({ value }));
    },
    getSessionFindSearchCandidates(session) {
      return (Array.isArray(session && session.queryArtifacts) ? session.queryArtifacts : []).map((value) => ({
        kind: "query",
        text: value,
        value,
      }));
    },
    getSessionKey(session) {
      return session && session.sessionKey ? session.sessionKey : "";
    },
    normalizeCwdValue(value) {
      return typeof value === "string" ? value.trim().toLowerCase() : "";
    },
    normalizePathRole(value) {
      const text = typeof value === "string" ? value.trim().toLowerCase() : "";
      return ["read", "search_scope", "list_scope", "write"].includes(text) ? text : "";
    },
    getPathRoleValues(pathRoles, role) {
      return pathRoles && Array.isArray(pathRoles[role]) ? pathRoles[role] : [];
    },
    getEntityPathArtifacts(entity) {
      return Array.isArray(entity && entity.pathArtifacts) ? entity.pathArtifacts : [];
    },
    getEntityPathPatternArtifacts(entity) {
      return Array.isArray(entity && entity.pathPatternArtifacts) ? entity.pathPatternArtifacts : [];
    },
    getEntityCommandOpArtifacts(entity) {
      return Array.isArray(entity && entity.commandOpArtifacts) ? entity.commandOpArtifacts : [];
    },
    getTranscriptItemMemoryCitationPaths(item) {
      return Array.isArray(item && item.memoryCitationPaths) ? item.memoryCitationPaths : [];
    },
    sortCommandOpValues(values) {
      return (Array.isArray(values) ? values : []).slice().sort();
    },
    classifyCommandOpSignal(value) {
      return String(value || "").toLowerCase().includes("rg") ? "high" : "medium";
    },
    getRecordReferencedPaths(record) {
      return {
        patchPaths: Array.isArray(record && record.patchPaths) ? record.patchPaths : [],
        allPaths: Array.isArray(record && record.paths) ? record.paths : [],
        pathRoles: record && record.pathRoles ? record.pathRoles : { read: [], search_scope: [], list_scope: [], write: [] },
      };
    },
    getRecordReferencedPathPatterns(record) {
      return {
        commandPathPatterns: Array.isArray(record && record.pathPatterns) ? record.pathPatterns : [],
        pathPatternRoles: record && record.pathPatternRoles ? record.pathPatternRoles : { read: [], search_scope: [], list_scope: [], write: [] },
      };
    },
    getRecordErrorSearchValues(record) {
      return record && record.error && record.error.message ? [record.error.message] : [];
    },
    errorEntryMatchesNeedle(entry, needle) {
      return String(entry && entry.message || "").toLowerCase().includes(String(needle || "").toLowerCase());
    },
    normalizeReferencedPath(_cwd, value) {
      return typeof value === "string" ? value : "";
    },
    normalizeReferencedPathPattern(_cwd, value) {
      return typeof value === "string" ? value : "";
    },
    toTimestampMs(value) {
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : 0;
    },
  });
}

describe("catalog matchers", () => {
  it("applies and clears annotation-scoped filters consistently", () => {
    const matchers = createMatchers();
    const entity = {
      annotation: {
        bookmarked: true,
        tags: ["docs", "saved"],
      },
    };

    assert.strictEqual(
      matchers.matchesAnnotationFilters(entity, { bookmarked: "1", manualTags: ["docs"] }),
      true
    );
    assert.strictEqual(
      matchers.matchesAnnotationFilters(entity, { bookmarked: "0" }),
      false
    );
    assert.deepStrictEqual(
      matchers.clearAnnotationScopedFilters({
        bookmarked: "1",
        manual_tag: "docs",
        manualTags: ["saved"],
        q: "agents",
      }),
      { q: "agents" }
    );
  });

  it("returns structured query matches for session browse filters", () => {
    const matchers = createMatchers();
    const session = {
      sessionId: "codex:s-1",
      sessionKey: "rollout-1",
      updatedAt: "2026-04-20T10:00:00.000Z",
      queryArtifacts: ["AGENTS.md"],
      recentQueries: [{ query: "AGENTS.md" }],
      filesTouched: [],
      pathArtifacts: [],
      pathPatternArtifacts: [],
      commandOpArtifacts: [],
      recentErrors: [],
      toolsUsed: [],
      commandTypes: [],
      annotation: null,
      qualityClass: "useful",
    };

    const match = matchers.sessionMatches(session, {
      query: "AGENTS",
      queryMode: "substring",
    });

    assert.ok(match);
    assert.ok(match.matchedQueries.includes("AGENTS.md"));
    assert.deepStrictEqual(match.match, { kind: "query", text: "AGENTS.md" });
    assert.deepStrictEqual(match.reasons, ["query"]);
  });

  it("keeps event error filters scoped to real error metadata", () => {
    const matchers = createMatchers();
    const plainRecord = {
      kind: "message",
      preview: "ENOENT happened in plain text",
      text: "ENOENT happened in plain text",
      role: "assistant",
      phase: "final_answer",
    };
    const errorRecord = {
      kind: "error",
      preview: "Request failed",
      text: "Request failed",
      error: { message: "ENOENT: no such file" },
    };

    assert.strictEqual(
      matchers.eventMatches(plainRecord, { error: "enoent" }),
      null
    );
    assert.ok(
      matchers.eventMatches(errorRecord, { error: "enoent" })
    );
  });

  it("normalizes medium command-op signal filters to the canonical medium tier", () => {
    const matchers = createMatchers();
    const session = {
      sessionId: "codex:s-2",
      sessionKey: "rollout-2",
      updatedAt: "2026-04-20T10:00:00.000Z",
      queryArtifacts: [],
      recentQueries: [],
      filesTouched: [],
      pathArtifacts: [],
      pathPatternArtifacts: [],
      commandOpArtifacts: ["python"],
      recentErrors: [],
      toolsUsed: [],
      commandTypes: [],
      annotation: null,
      qualityClass: "useful",
    };

    const mediumMatch = matchers.sessionMatches(session, {
      commandOpSignal: "medium",
    });
    const normalAliasMatch = matchers.sessionMatches(session, {
      commandOpSignal: "normal",
    });

    assert.ok(mediumMatch);
    assert.deepStrictEqual(mediumMatch.matchedCommandOps, ["python"]);
    assert.ok(normalAliasMatch);
    assert.deepStrictEqual(normalAliasMatch.matchedCommandOps, ["python"]);
  });
});
