const { describe, it } = require("node:test");
const assert = require("node:assert");

const { createHistoryCliHistoryView } = require("../history-cli-history-view");

describe("history CLI history view", () => {
  it("prints low-signal fuzzy query matches truthfully in session browse output", () => {
    const lines = [];
    const originalLog = console.log;
    console.log = (...args) => lines.push(args.join(" "));

    try {
      const view = createHistoryCliHistoryView({
        getQueryMatchSignalTier(match) {
          return match && match.signalTier ? match.signalTier : "";
        },
        classifyQuerySignal() {
          return "";
        },
        summarizeLowSignalQueryMatches() {
          return { onlyLowSignal: false, examples: [] };
        },
        formatCommandSummary() {
          return "";
        },
        formatQuerySummary(value) {
          return value;
        },
        formatValueList(values) {
          return values.join(", ");
        },
        formatQueryDisplayValue(value) {
          return value;
        },
        formatQueryValueList(values) {
          return values.join(", ");
        },
        formatPathValueList(values) {
          return values.join(", ");
        },
        printAnnotationLines() {},
        formatRolloutPersistenceSummary() {
          return "";
        },
        printSourceSelectionDetails() {},
        printRolloutPersistenceDetails() {},
        printHistoryQualityDetails() {},
        printReloadSafetyDetails() {},
        formatPathRoleSummary() {
          return "";
        },
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

      view.printSessionList({
        historyMode: "effective",
        queryMode: "fuzzy",
        querySignalSummary: {
          onlyLowSignal: true,
          examples: ["AGENTS.md"],
        },
        sessions: [{
          sessionId: "codex:019d-thread",
          updatedAt: "2026-04-20T10:00:00.000Z",
          startedAt: "",
          cwd: "/repo",
          sessionKey: "rollout-019d-thread",
          forkedFromId: null,
          parentThreadId: null,
          lineageRootId: "codex:019d-thread",
          lineageDepth: 0,
          lineageFamilyCount: 1,
          model: "gpt-5.2",
          qualityClass: "useful_limited",
          turnCount: 2,
          tags: [],
          counts: {
            commands: 1,
            searches: 0,
            patches: 0,
            errors: 0,
          },
          lastUserPreview: "find AGNTS",
          finalAnswerPreview: "Found AGENTS.md",
          commentaryPreview: "",
          annotation: null,
          rolloutPersistence: null,
          match: {
            kind: "query",
            text: "AGENTS.md",
            signalTier: "low",
          },
          matchReasons: ["query:fuzzy"],
          filesTouched: [],
          pathsReferenced: [],
        }],
      });
    } finally {
      console.log = originalLog;
    }

    assert(lines.some((line) => line.includes("match: query=AGENTS.md [low-signal]")));
    assert(lines.some((line) => line.includes("Note: these fuzzy query hits are low-signal filename/glob filters, for example AGENTS.md.")));
    assert(lines.some((line) => line.includes("use --query-mode exact")));
  });
});
