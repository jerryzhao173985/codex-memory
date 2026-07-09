const { describe, it } = require("node:test");
const assert = require("node:assert");

const { createHistoryCliBridgeView } = require("../history-cli-bridge-view");

describe("history CLI bridge view", () => {
  it("builds exact thread next-command hints from the first thread and cursor", () => {
    const view = createHistoryCliBridgeView({
      quoteShellArg(value) {
        return JSON.stringify(value);
      },
      getHistoryCliInvocationCommand() {
        return "node history.js";
      },
      shouldPrintSourceSelection() {
        return false;
      },
      printSourceSelectionDetails() {},
      printHistoryQualityDetails() {},
      formatValueList(values) {
        return values.join(", ");
      },
    });

    assert.deepStrictEqual(
      view.buildBridgeThreadListHints({
        threads: [{ sessionId: "codex:019d-thread" }],
        nextCursor: "page-2",
      }),
      [
        'node history.js thread "codex:019d-thread"',
        'node history.js transcript "codex:019d-thread" --source app-server',
        'node history.js resume "codex:019d-thread" --source app-server --reload-policy strict',
        'node history.js threads --cursor "page-2"',
      ]
    );
  });
});
