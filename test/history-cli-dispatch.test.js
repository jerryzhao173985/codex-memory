const { describe, it } = require("node:test");
const assert = require("node:assert");

const { createHistoryCliDispatch } = require("../history-cli-dispatch");

function createTestError(message) {
  const error = new Error(message);
  error.code = "HISTORY_INVALID_ARGUMENT";
  return error;
}

describe("history CLI dispatch", () => {
  it("throws structured CLI errors for missing required command targets", async () => {
    const dispatch = createHistoryCliDispatch({
      createHistoryCliError: createTestError,
      async runHistoryBridgeCommand() {
        return undefined;
      },
      buildOverviewResult() {
        return {};
      },
      buildCatalogQueryFilters() {
        return {};
      },
      buildCatalogArtifactContextFilters() {
        return {};
      },
      buildStructuredMatchFilters() {
        return {};
      },
      buildAnnotationPatchFromArgs() {
        return {};
      },
      hasAnnotationPatch() {
        return false;
      },
      printOverview() {},
      printSessionList() {},
      printAreaList() {},
      printAreaDetail() {},
      printSchemaProfile() {},
      printBridgeThreadList() {},
      printBridgeLoadedThreads() {},
      printBridgeThread() {},
      printBridgeThreadLifecycle() {},
      printPruneCandidates() {},
      printPrunePreview() {},
      printForkPrune() {},
      printTranscript() {},
      printResume() {},
      printTurnDetail() {},
      printTurnSearch() {},
      printArtifactTurnList() {},
      printPathThread() {},
      printRelatedSessions() {},
      printFamilyDetail() {},
      printWorkstreamDetail() {},
      printProjectList() {},
      printProjectDetail() {},
      printArtifactList() {},
      printArtifactDetail() {},
      printSessionDetail() {},
      printAnnotationUpdate() {},
      printTurnList() {},
      printEventList() {},
      printStats() {},
      printDoctor() {},
    });

    await assert.rejects(
      dispatch.runHistoryCliCommand({}, {
        command: "project",
        json: false,
        pretty: false,
      }),
      /project cwd is required/
    );
  });

  it("returns blocked resume exit codes through the render path", () => {
    const calls = [];
    const dispatch = createHistoryCliDispatch({
      createHistoryCliError: createTestError,
      async runHistoryBridgeCommand() {
        return undefined;
      },
      buildOverviewResult() {
        return {};
      },
      buildCatalogQueryFilters() {
        return {};
      },
      buildCatalogArtifactContextFilters() {
        return {};
      },
      buildStructuredMatchFilters() {
        return {};
      },
      buildAnnotationPatchFromArgs() {
        return {};
      },
      hasAnnotationPatch() {
        return false;
      },
      printOverview() {},
      printSessionList() {},
      printAreaList() {},
      printAreaDetail() {},
      printSchemaProfile() {},
      printBridgeThreadList() {},
      printBridgeLoadedThreads() {},
      printBridgeThread() {},
      printBridgeThreadLifecycle() {},
      printPruneCandidates() {},
      printPrunePreview() {},
      printForkPrune() {},
      printTranscript() {},
      printResume(output, options) {
        calls.push({ output, options });
      },
      printTurnDetail() {},
      printTurnSearch() {},
      printArtifactTurnList() {},
      printPathThread() {},
      printRelatedSessions() {},
      printFamilyDetail() {},
      printWorkstreamDetail() {},
      printProjectList() {},
      printProjectDetail() {},
      printArtifactList() {},
      printArtifactDetail() {},
      printSessionDetail() {},
      printAnnotationUpdate() {},
      printTurnList() {},
      printEventList() {},
      printStats() {},
      printDoctor() {},
    });

    const result = dispatch.renderHistoryCliCommandResult(
      { command: "resume" },
      { reloadSafety: { allowed: false } },
      {}
    );

    assert.deepStrictEqual(result, { exitCode: 2 });
    assert.deepStrictEqual(calls, [{
      output: { reloadSafety: { allowed: false } },
      options: { includeText: false },
    }]);
  });
});
