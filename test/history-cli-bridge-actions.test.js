const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  buildBridgeMetadataPatchFromArgs,
  normalizeBridgeThreadMemoryModeArgument,
  runHistoryBridgeCommand,
} = require("../history-cli-bridge-actions");

function createCliError(message) {
  const err = new Error(message);
  err.code = "HISTORY_INVALID_ARGUMENT";
  return err;
}

describe("history CLI bridge actions", () => {
  it("returns undefined for non-bridge commands", async () => {
    const result = await runHistoryBridgeCommand({}, { command: "search" }, {
      errorFactory: createCliError,
    });
    assert.strictEqual(result, undefined);
  });

  it("routes exact thread-list filters through the bridge store", async () => {
    const calls = [];
    const store = {
      async listBridgeThreads(options) {
        calls.push(options);
        return { threads: [] };
      },
    };

    const output = await runHistoryBridgeCommand(store, {
      command: "threads",
      limit: 5,
      cursor: "next-cursor",
      sortKey: "updated_at",
      sortDirection: "asc",
      useStateDbOnly: true,
      q: "codex",
      cwd: "/repo",
      archived: true,
      modelProviders: ["openai"],
      sourceKinds: ["cli"],
    }, {
      errorFactory: createCliError,
    });

    assert.deepStrictEqual(output, { threads: [] });
    assert.deepStrictEqual(calls, [{
      limit: 5,
      cursor: "next-cursor",
      sortKey: "updated_at",
      sortDirection: "asc",
      useStateDbOnly: true,
      q: "codex",
      cwd: "/repo",
      archived: true,
      modelProviders: ["openai"],
      sourceKinds: ["cli"],
    }]);
  });

  it("builds metadata patches and rejects empty metadata updates", async () => {
    assert.deepStrictEqual(
      buildBridgeMetadataPatchFromArgs({
        gitBranch: "release/main",
        clearGitSha: true,
      }),
      {
        gitInfo: {
          branch: "release/main",
          sha: null,
        },
      }
    );

    await assert.rejects(
      () => runHistoryBridgeCommand({
        updateBridgeThreadMetadata() {
          throw new Error("should not be called");
        },
      }, {
        command: "metadata",
        target: "codex:019d-thread",
      }, {
        errorFactory: createCliError,
      }),
      /metadata patch is required/
    );
  });

  it("normalizes memory mode and validates prune selection", async () => {
    assert.strictEqual(normalizeBridgeThreadMemoryModeArgument(" ENABLED "), "enabled");

    await assert.rejects(
      () => runHistoryBridgeCommand({
        getPrunePreview() {
          throw new Error("should not be called");
        },
      }, {
        command: "prune-preview",
        target: "codex:019d-thread",
      }, {
        errorFactory: createCliError,
      }),
      /either drop_last or through_turn is required/
    );
  });

  it("builds prune and fork-prune store options consistently", async () => {
    const previewCalls = [];
    const forkCalls = [];
    const store = {
      async getPrunePreview(sessionId, options) {
        previewCalls.push({ sessionId, options });
        return { ok: true };
      },
      async forkPruneThread(sessionId, options) {
        forkCalls.push({ sessionId, options });
        return { ok: true };
      },
    };

    await runHistoryBridgeCommand(store, {
      command: "prune-preview",
      target: "codex:019d-thread",
      dropLast: 2,
      budgetChars: 1000,
      trimStrategy: "tail",
      reloadPolicy: "strict",
    }, {
      errorFactory: createCliError,
    });

    await runHistoryBridgeCommand(store, {
      command: "fork-prune",
      target: "codex:019d-thread",
      throughTurn: "turn-002",
      name: "trimmed thread",
      itemLimit: 4,
    }, {
      errorFactory: createCliError,
    });

    assert.deepStrictEqual(previewCalls, [{
      sessionId: "codex:019d-thread",
      options: {
        dropLastTurns: 2,
        throughTurn: undefined,
        budgetChars: 1000,
        itemChars: undefined,
        toolChars: undefined,
        lineLimit: undefined,
        turnLimit: undefined,
        itemLimit: undefined,
        highlightLimit: undefined,
        trimStrategy: "tail",
        toolText: undefined,
        reloadPolicy: "strict",
        refresh: true,
      },
    }]);

    assert.deepStrictEqual(forkCalls, [{
      sessionId: "codex:019d-thread",
      options: {
        dropLastTurns: undefined,
        throughTurn: "turn-002",
        budgetChars: undefined,
        itemChars: undefined,
        toolChars: undefined,
        lineLimit: undefined,
        turnLimit: undefined,
        itemLimit: 4,
        highlightLimit: undefined,
        trimStrategy: undefined,
        toolText: undefined,
        reloadPolicy: undefined,
        refresh: true,
        name: "trimmed thread",
      },
    }]);
  });
});
