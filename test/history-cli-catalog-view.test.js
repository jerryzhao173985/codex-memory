const { describe, it } = require("node:test");
const assert = require("node:assert");

const { createHistoryCliCatalogView } = require("../history-cli-catalog-view");

describe("history CLI catalog view", () => {
  it("prints scored focus roots and area recent-session focus hints", () => {
    const lines = [];
    const originalLog = console.log;
    console.log = (...args) => lines.push(args.join(" "));

    try {
      const view = createHistoryCliCatalogView({
        formatPathPatternKindLabel(value) {
          return value;
        },
        formatCommandOpSignalLabel(value) {
          return value;
        },
        formatQuerySignalLabel(value) {
          return value;
        },
        formatPathRoleLabel(value) {
          return value;
        },
        formatPathRoleSummary() {
          return "";
        },
        formatPathRoleList(values) {
          return values.join(", ");
        },
        formatValueList(values) {
          return values.join(", ");
        },
        formatPathValueList(values) {
          return values.join(", ");
        },
        formatQueryValueList(values) {
          return values.join(", ");
        },
        printAnnotationLines() {},
        getEntityCommandOps() {
          return [];
        },
        getMatchedCommandOps() {
          return [];
        },
        getMatchedFiles() {
          return [];
        },
        getMatchedPaths() {
          return [];
        },
        getMatchedPathPatterns() {
          return [];
        },
        getMatchedQueries() {
          return [];
        },
      });

      view.printProjectList({
        historyMode: "effective",
        queryMode: "fuzzy",
        projects: [{
          cwd: "/repo",
          updatedAt: "2026-04-20T10:00:00.000Z",
          startedAt: "",
          sessionCount: 2,
          turnCount: 5,
          counts: {
            commands: 1,
            searches: 0,
            patches: 0,
            errors: 0,
          },
          tags: [],
          topTools: [],
          topFiles: [],
          topFocusRoots: [{ root: "src/app", score: 5, count: 3 }],
          topProjectPaths: [{ displayPath: "src/app/index.js", path: "src/app/index.js", count: 2 }],
          topPaths: [],
          topExternalPaths: [],
          manualCounts: null,
          matchedManualCounts: null,
          matchReasons: [],
        }],
      });

      view.printAreaList({
        queryMode: "substring",
        areas: [{
          cwd: "/repo",
          root: "src/app",
          updatedAt: "2026-04-20T10:00:00.000Z",
          sessionCount: 1,
          turnCount: 2,
          counts: {
            commands: 1,
            writes: 0,
            searches: 0,
            errors: 0,
          },
          matchReasons: [],
          topTools: [],
          topFiles: [],
          topPaths: [],
          recentSessions: [{
            sessionId: "codex:019d-thread",
            sessionFocusRoot: "src/lib",
          }],
          manualCounts: null,
        }],
      });
    } finally {
      console.log = originalLog;
    }

    assert(lines.some((line) => line.includes("focus-roots: src/app (score=5, hits=3)")));
    assert(lines.some((line) => line.includes("recent: codex:019d-thread [session-focus=src/lib]")));
  });
});
