const { describe, it } = require("node:test");
const assert = require("node:assert");

const { createHistoryCliMetaView } = require("../history-cli-meta-view");

describe("history CLI meta view", () => {
  it("builds overview recommendations from the strongest available session", () => {
    const calls = [];
    const view = createHistoryCliMetaView({
      buildCatalogCommonFilters(args) {
        return {
          has: args.has,
        };
      },
      getHistoryCliInvocationCommand() {
        return "node history.js";
      },
      formatPathPatternKindLabel(value) {
        return value;
      },
      formatCommandOpSignalLabel(value) {
        return value;
      },
      formatQuerySignalLabel(value) {
        return value;
      },
      formatQueryDisplayValue(value) {
        return value;
      },
      printAnnotationLines() {},
    });

    const store = {
      getStats() {
        return {
          generatedAt: "2026-04-20T10:00:00.000Z",
          sessionCount: 3,
          projectCount: 2,
          extendedEventSessions: 1,
          qualityClassCounts: {
            rich_extended: 1,
          },
        };
      },
      listSessions(options) {
        calls.push(options);
        if (options.qualityClass === "rich_extended") {
          return {
            total: 1,
            sessions: [{
              sessionId: "codex:019d-thread",
              cwd: "/repo/a",
            }],
          };
        }
        return { total: 0, sessions: [] };
      },
    };

    const result = view.buildOverviewResult(store, {
      q: "feature toggle",
      has: ["bookmarked"],
      historyMode: "effective",
    });

    assert.strictEqual(result.summary.sessionCount, 3);
    assert.deepStrictEqual(result.scope, {
      q: "feature toggle",
      has: ["bookmarked"],
    });
    assert.deepStrictEqual(result.recommendedCommands, [
      "node history.js transcript codex:019d-thread",
      "node history.js resume codex:019d-thread --reload-policy strict",
      "node history.js project --cwd \"/repo/a\"",
    ]);
    assert.strictEqual(calls.length, 5);
    assert.ok(calls.every((options) => options.shape === "compact"));
    assert.ok(calls.every((options) => options.refresh === false));
  });

  it("prints cleared annotation updates explicitly", () => {
    const lines = [];
    const originalLog = console.log;
    console.log = (...args) => lines.push(args.join(" "));

    try {
      const view = createHistoryCliMetaView({
        buildCatalogCommonFilters() {
          return {};
        },
        getHistoryCliInvocationCommand() {
          return "node history.js";
        },
        formatPathPatternKindLabel(value) {
          return value;
        },
        formatCommandOpSignalLabel(value) {
          return value;
        },
        formatQuerySignalLabel(value) {
          return value;
        },
        formatQueryDisplayValue(value) {
          return value;
        },
        printAnnotationLines() {},
      });

      view.printAnnotationUpdate({
        sessionId: "codex:019d-thread",
        turnId: "turn-1",
        sessionKey: "rollout-019d-thread",
        annotation: null,
      });
    } finally {
      console.log = originalLog;
    }

    assert.deepStrictEqual(lines, [
      "codex:019d-thread | turn-1 | rollout=rollout-019d-thread",
      "annotation cleared",
    ]);
  });
});
