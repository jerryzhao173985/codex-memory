const { describe, it } = require("node:test");
const assert = require("node:assert");

const { getQueryMatchSignalTier } = require("../session-search");
const { createCatalogSessionSummary } = require("../catalog-session-summary");

function createSummaryHelpers() {
  return createCatalogSessionSummary({
    normalizeHistoryMode(value) {
      return String(value || "").trim().toLowerCase() === "raw" ? "raw" : "effective";
    },
    getQueryMatchSignalTier,
    getSessionKey(session) {
      return session && typeof session.sessionKey === "string" ? session.sessionKey : "";
    },
    getEntityPathArtifacts(entity) {
      return Array.isArray(entity && entity.pathArtifacts) ? entity.pathArtifacts : [];
    },
    sortCommandOpValues(values) {
      return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean))).sort();
    },
    clonePathRoleBuckets(value) {
      return value ? JSON.parse(JSON.stringify(value)) : null;
    },
    shapeCompactPreview(value) {
      return typeof value === "string" ? value.trim() : "";
    },
    toTimestampMs(value) {
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : 0;
    },
    MAX_MANUAL_HIGHLIGHTS: 5,
  });
}

describe("catalog session summary", () => {
  it("classifies quality and shapes compact session summaries with query signal tiers", () => {
    const summary = createSummaryHelpers();
    const session = {
      historyMode: "effective",
      sessionId: "codex:1",
      sessionKey: "rollout-1",
      startedAt: "2026-04-21T09:00:00.000Z",
      updatedAt: "2026-04-21T09:05:00.000Z",
      cwd: "/repo",
      model: "gpt-5.4",
      modelProvider: "openai",
      rolloutPersistence: {
        memoryMode: "polluted",
        eventMode: "extended_observed",
      },
      finalAnswerPreview: "Finished the update.",
      lastUserPreview: "Please update the harness.",
      toolsUsed: ["exec_command"],
      turnCount: 1,
      userMessageCount: 1,
      assistantMessageCount: 1,
      reasoningCount: 0,
      commandCount: 1,
      patchCount: 0,
      searchCount: 1,
      mcpCount: 0,
      errorCount: 0,
      focusRoot: "src",
      commandTypes: ["search"],
      commandOpArtifacts: ["rg"],
      pathArtifacts: ["/repo/src/index.js"],
      pathRoles: { read: ["/repo/src/index.js"] },
      pathPatternRoles: { search_scope: ["src/**/*.js"] },
      pathPatternArtifacts: ["src/**/*.js"],
      recentCommands: ["rg TODO src"],
      recentQueries: ["AGENTS.md"],
      recentErrors: [],
      commandArtifacts: ["rg TODO src"],
      queryArtifacts: ["AGENTS.md"],
      errorArtifacts: [],
      annotation: {
        bookmarked: true,
        tags: ["important"],
        note: "Keep this session handy.",
        updatedAt: "2026-04-21T09:06:00.000Z",
      },
      tags: ["has_answer", "has_command"],
    };

    assert.strictEqual(summary.classifySessionQuality(session), "rich_extended");

    const compact = summary.summarizeSessionCompact(session, {
      match: {
        kind: "query",
        text: "AGENTS.md",
      },
    });

    assert.strictEqual(compact.qualityClass, "rich_extended");
    assert.strictEqual(compact.memoryMode, "polluted");
    assert.strictEqual(compact.eventMode, "extended_observed");
    assert.strictEqual(compact.match.signalTier, "low");
    assert.deepStrictEqual(compact.commandOps, ["rg"]);
    assert.strictEqual(compact.annotation.bookmarked, true);
  });

  it("builds manual browse summaries from annotated sessions and turns", () => {
    const summary = createSummaryHelpers();
    const sessions = [
      {
        sessionId: "codex:1",
        sessionKey: "rollout-1",
        updatedAt: "2026-04-21T09:05:00.000Z",
        annotation: {
          bookmarked: true,
          tags: ["important", "docs"],
          note: "Primary session.",
        },
        turns: [
          {
            turnId: "turn-1",
            sessionKey: "rollout-1",
            endedAt: "2026-04-21T09:04:00.000Z",
            annotation: {
              bookmarked: false,
              tags: ["docs"],
              note: "Useful turn.",
            },
          },
        ],
      },
      {
        sessionId: "codex:2",
        sessionKey: "rollout-2",
        updatedAt: "2026-04-21T08:00:00.000Z",
        annotation: {
          bookmarked: false,
          tags: ["secondary"],
          note: "",
        },
      },
    ];

    const browse = summary.buildProjectManualBrowseSummary(sessions);

    assert.deepStrictEqual(browse.manualCounts, {
      annotatedSessions: 2,
      bookmarkedSessions: 1,
      annotatedTurns: 1,
      bookmarkedTurns: 0,
    });
    assert.deepStrictEqual(
      browse.topManualTags.map((item) => item.tag),
      ["docs", "important", "secondary"]
    );

    const projectManual = summary.buildProjectManualSummary(sessions, sessions[0].turns);
    assert.strictEqual(projectManual.sessionHighlights[0].sessionId, "codex:1");
    assert.strictEqual(projectManual.turnHighlights[0].turnId, "turn-1");
  });
});
