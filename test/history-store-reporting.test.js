const { describe, it } = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");

const { buildHistoryStats, buildHistoryDoctor } = require("../history-store-reporting");

function makeBuiltFixture() {
  return {
    catalog: {
      generatedAt: "2026-04-09T16:00:00.000Z",
      sessionDir: "/sessions",
      sessionCount: 3,
      sessions: [
        {
          sessionId: "codex:dup",
          filePath: "/sessions/2026/04/09/rollout-a.jsonl",
          updatedAt: "2026-04-09T15:59:30.000Z",
          startedAt: "2026-04-09T15:59:00.000Z",
          cwd: "/repo/a",
          turnCount: 2,
          eventCount: 5,
          rolloutPersistence: {
            memoryMode: "disabled",
            eventMode: "extended",
            extendedObserved: true,
          },
        },
        {
          sessionId: "codex:dup",
          filePath: "/sessions/2026/04/09/rollout-b.jsonl",
          updatedAt: "2026-04-09T15:58:00.000Z",
          startedAt: "2026-04-09T15:57:00.000Z",
          cwd: "/repo/b",
          turnCount: 1,
          eventCount: 2,
          rolloutPersistence: {
            memoryMode: "enabled",
          },
        },
        {
          sessionId: "codex:child",
          filePath: "/sessions/2026/04/09/rollout-c.jsonl",
          updatedAt: "2026-04-09T15:59:45.000Z",
          startedAt: "2026-04-09T15:59:15.000Z",
          cwd: "/repo/a",
          turnCount: 1,
          eventCount: 3,
          forkedFromId: "codex:dup",
          parentThreadId: "codex:dup",
          subagentDepth: 1,
          agentRole: "explorer",
          agentNickname: "Helmholtz",
          rolloutPersistence: {
            memoryMode: "disabled",
            eventMode: "limited",
          },
        },
      ],
      facets: {
        topFiles: [{ file: "src/index.js", count: 3 }],
        topPaths: [{ path: "src/index.js", count: 3 }],
        topActiveFiles: [{ file: "src/index.js", count: 2 }],
        topActivePaths: [{ path: "src/index.js", count: 2 }],
        topPathPatterns: [{ pattern: "src/*.js", count: 1 }],
        topCommandOps: [{ op: "rg", count: 2 }],
        topHighSignalCommandOps: [{ op: "apply_patch", count: 1 }],
        topQueries: [{ query: "fix bug", count: 1, signalTier: "high" }],
        topLowSignalQueries: [{ query: "AGENTS.md", count: 2, signalTier: "low" }],
        topTools: [{ tool: "exec_command", count: 3 }],
        topActiveTools: [{ tool: "exec_command", count: 2 }],
        topProjects: [{ cwd: "/repo/a", count: 2 }],
        topActiveProjects: [{ cwd: "/repo/a", count: 2 }],
        topMemoryModes: [{ memoryMode: "disabled", count: 2 }],
        topEventModes: [{ eventMode: "extended", count: 1 }],
        topQualityClasses: [{ qualityClass: "rich", count: 2 }],
      },
      artifacts: {
        counts: {
          file: 1,
          tool: 1,
        },
      },
      projects: [{ cwd: "/repo/a" }, { cwd: "/repo/b" }],
    },
    manifest: {
      generatedAt: "2026-04-09T16:00:00.000Z",
      sessionDir: "/sessions",
      indexRoot: "/index",
      sessionDocSchemaVersion: 99,
      fileCount: 3,
      stats: {
        reusedFiles: 2,
        reuseCandidates: 2,
        reuseFailures: 0,
        reuseFailureCounts: {},
        reuseFailureSamples: {},
        persistenceDegraded: false,
        persistenceErrors: [],
        rebuiltFiles: 1,
        skippedFiles: 0,
        removedFiles: 0,
        projectCount: 2,
        artifactCounts: {
          file: 1,
          tool: 1,
        },
        memoryModeCounts: {
          disabled: 2,
          enabled: 1,
        },
        eventModeCounts: {
          extended: 1,
          limited: 1,
          limited_or_unknown: 1,
        },
        extendedEventSessions: 1,
      },
      files: {
        "/sessions/2026/04/09/rollout-a.jsonl": {
          docPath: "sessions/rollout-a.json",
          buildStatus: "reused",
          buildReason: "",
          mtimeMs: Date.parse("2026-04-09T15:59:30.000Z"),
          size: 100,
        },
        "/sessions/2026/04/09/rollout-b.jsonl": {
          docPath: "sessions/rollout-b.json",
          buildStatus: "rebuilt",
          buildReason: "rollout_changed",
          mtimeMs: Date.parse("2026-04-09T15:58:00.000Z"),
          size: 90,
        },
        "/sessions/2026/04/09/rollout-c.jsonl": {
          docPath: "sessions/rollout-c.json",
          buildStatus: "reused",
          buildReason: "",
          mtimeMs: Date.parse("2026-04-09T15:59:45.000Z"),
          size: 110,
        },
      },
    },
  };
}

describe("history store reporting", () => {
  it("builds aggregated history stats from catalog and manifest state", () => {
    const stats = buildHistoryStats({
      built: makeBuiltFixture(),
      indexRoot: "~/codex-history-index",
      annotationStats: {
        annotatedSessions: 1,
        bookmarkedSessions: 1,
        annotatedTurns: 2,
        bookmarkedTurns: 1,
        orphanSessionAnnotations: 1,
        orphanTurnAnnotations: 0,
        topManualTags: [{ tag: "important", count: 1 }],
      },
      manualProjectStats: {
        manualProjectCount: 1,
        bookmarkedProjectCount: 1,
        topManualProjects: [{ cwd: "/repo/a", annotatedSessions: 1 }],
      },
    });

    assert.strictEqual(stats.sessionCount, 3);
    assert.strictEqual(stats.fileCount, 3);
    assert.strictEqual(stats.reusedFiles, 2);
    assert.strictEqual(stats.rebuiltFiles, 1);
    assert.strictEqual(stats.duplicateSessionIds, 1);
    assert.strictEqual(stats.duplicateRolloutFiles, 2);
    assert.strictEqual(stats.forkFamilies, 1);
    assert.strictEqual(stats.forkedSessions, 1);
    assert.strictEqual(stats.subagentSessions, 1);
    assert.strictEqual(stats.liveCandidates, 3);
    assert.deepStrictEqual(stats.memoryModeCounts, {
      disabled: 2,
      enabled: 1,
    });
    assert.deepStrictEqual(stats.eventModeCounts, {
      extended: 1,
      limited: 1,
      limited_or_unknown: 1,
    });
    assert.deepStrictEqual(stats.topManualTags, [{ tag: "important", count: 1 }]);
    assert.deepStrictEqual(stats.topManualProjects, [{ cwd: "/repo/a", annotatedSessions: 1 }]);
    assert.deepStrictEqual(stats.topLowSignalQueries, [{ query: "AGENTS.md", count: 2, signalTier: "low" }]);
    assert.strictEqual(stats.indexRoot, "/index");
    assert.strictEqual(stats.sessionDocSchemaVersion, 99);

    const fallbackStats = buildHistoryStats({
      built: {
        ...makeBuiltFixture(),
        manifest: null,
      },
      indexRoot: "~/codex-history-index",
    });

    assert.strictEqual(
      fallbackStats.indexRoot,
      path.join(os.homedir(), "codex-history-index")
    );
    assert.strictEqual(fallbackStats.sessionDocSchemaVersion > 0, true);
    assert.deepStrictEqual(fallbackStats.memoryModeCounts, {
      disabled: 2,
      enabled: 1,
    });
  });

  it("builds doctor views with duplicate and subagent filtering", () => {
    const built = makeBuiltFixture();

    const duplicateDoctor = buildHistoryDoctor({
      built,
      indexRoot: "/index",
      filters: {
        status: "duplicate",
      },
    });

    assert.strictEqual(duplicateDoctor.total, 2);
    assert.strictEqual(duplicateDoctor.counts.duplicates, 2);
    assert.strictEqual(duplicateDoctor.duplicates.length, 1);
    assert.strictEqual(duplicateDoctor.duplicates[0].sessionId, "codex:dup");
    assert.strictEqual(duplicateDoctor.duplicates[0].count, 2);
    assert.ok(duplicateDoctor.files.every((item) => item.duplicateSessionId === true));

    const subagentDoctor = buildHistoryDoctor({
      built,
      indexRoot: "/index",
      filters: {
        status: "subagent",
        q: "codex:child",
      },
    });

    assert.strictEqual(subagentDoctor.total, 1);
    assert.strictEqual(subagentDoctor.counts.subagent, 1);
    assert.strictEqual(subagentDoctor.files[0].sessionId, "codex:child");
    assert.strictEqual(subagentDoctor.files[0].buildStatus, "reused");
    assert.strictEqual(subagentDoctor.forkFamilies.length, 1);
    assert.strictEqual(subagentDoctor.forkFamilies[0].rootSessionId, "codex:dup");
  });
});
