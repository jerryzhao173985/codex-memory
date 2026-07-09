const { describe, it } = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const { createAppServerBridge } = require("../app-server-bridge");

function createFakeChild(onMessage) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};

  let buffer = "";
  child.stdin = {
    write(chunk) {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
        if (!line) continue;
        onMessage(JSON.parse(line), child);
      }
      return true;
    },
    end() {},
  };
  child.kill = () => {
    child.emit("exit", 0, null);
    return true;
  };

  return child;
}

describe("CodexAppServerBridge", () => {
  it("initializes and reads a thread over the app-server stdio bridge", async () => {
    const seenMethods = [];
    const child = createFakeChild((message, currentChild) => {
      seenMethods.push(message.method);

      if (message.method === "initialize") {
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {
            userAgent: "test/0.0.0",
            codexHome: "/tmp/.codex",
            platformFamily: "unix",
            platformOs: "macos",
          },
        })}\n`);
        currentChild.stdout.emit("data", `${JSON.stringify({
          method: "configWarning",
          params: {
            summary: "deprecated config key",
            details: null,
          },
        })}\n`);
        return;
      }

      if (message.method === "thread/read") {
        assert.strictEqual(message.params.threadId, "019d-thread");
        assert.strictEqual(message.params.includeTurns, true);
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {
            thread: {
              id: "019d-thread",
              preview: "Find the command history",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1776171492,
              updatedAt: 1776171510,
              status: { type: "notLoaded" },
              path: "/tmp/rollout-019d-thread.jsonl",
              cwd: "/repo/a",
              cliVersion: "0.119.0-alpha.5",
              source: "cli",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: null,
              turns: [],
            },
          },
        })}\n`);
      }
    });

    const bridge = createAppServerBridge({
      spawnImpl: () => child,
      clientInfo: {
        name: "bridge_test",
        title: "Bridge Test",
        version: "0.0.0",
      },
    });

    const response = await bridge.readThread("codex:019d-thread");
    assert.strictEqual(response.thread.id, "019d-thread");
    assert.deepStrictEqual(seenMethods, ["initialize", "initialized", "thread/read"]);

    bridge.close();
  });

  it("lists loaded threads and renames a thread over the app-server bridge", async () => {
    let threadName = null;

    const child = createFakeChild((message, currentChild) => {
      if (message.method === "initialize") {
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {
            userAgent: "test/0.0.0",
            codexHome: "/tmp/.codex",
            platformFamily: "unix",
            platformOs: "macos",
          },
        })}\n`);
        return;
      }

      if (message.method === "thread/loaded/list") {
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {
            data: ["019d-thread", "019d-other"],
            nextCursor: null,
          },
        })}\n`);
        return;
      }

      if (message.method === "thread/name/set") {
        threadName = message.params.name;
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {},
        })}\n`);
        return;
      }

      if (message.method === "thread/read") {
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {
            thread: {
              id: "019d-thread",
              preview: "Find the command history",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1776171492,
              updatedAt: 1776171510,
              status: { type: "notLoaded" },
              path: "/tmp/rollout-019d-thread.jsonl",
              cwd: "/repo/a",
              cliVersion: "0.119.0-alpha.5",
              source: "cli",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: threadName,
              turns: [],
            },
          },
        })}\n`);
      }
    });

    const bridge = createAppServerBridge({
      spawnImpl: () => child,
    });

    const loaded = await bridge.call("thread/loaded/list", { limit: 2 });
    assert.deepStrictEqual(loaded.data, ["019d-thread", "019d-other"]);

    const renamed = await bridge.setThreadName("codex:019d-thread", "Backend parser work");
    assert.strictEqual(renamed.thread.name, "Backend parser work");

    await bridge.close();
  });

  it("normalizes exact thread-list filters before forwarding them", async () => {
    const child = createFakeChild((message, currentChild) => {
      if (message.method === "initialize") {
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {
            userAgent: "test/0.0.0",
            codexHome: "/tmp/.codex",
            platformFamily: "unix",
            platformOs: "macos",
          },
        })}\n`);
        return;
      }

      if (message.method === "thread/list") {
        assert.deepStrictEqual(message.params, {
          cursor: "cursor-2",
          limit: 3,
          sortKey: "updated_at",
          modelProviders: ["openai", "anthropic"],
          sourceKinds: ["subAgentThreadSpawn", "cli"],
          archived: false,
          cwd: "/repo/a",
          searchTerm: "backend",
        });
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {
            data: [],
            nextCursor: null,
          },
        })}\n`);
      }
    });

    const bridge = createAppServerBridge({
      spawnImpl: () => child,
    });

    const listed = await bridge.listThreads({
      cursor: " cursor-2 ",
      limit: "3",
      sort: "updated_at",
      modelProviders: [" openai ", "anthropic"],
      sourceKinds: ["sub-agent-thread-spawn", "cli"],
      archived: "false",
      cwd: " /repo/a ",
      q: " backend ",
    });
    assert.deepStrictEqual(listed, {
      data: [],
      nextCursor: null,
    });

    await bridge.close();
  });

  it("archives and unarchives a thread over the app-server bridge", async () => {
    const child = createFakeChild((message, currentChild) => {
      if (message.method === "initialize") {
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {
            userAgent: "test/0.0.0",
            codexHome: "/tmp/.codex",
            platformFamily: "unix",
            platformOs: "macos",
          },
        })}\n`);
        return;
      }

      if (message.method === "thread/archive") {
        assert.strictEqual(message.params.threadId, "019d-thread");
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {},
        })}\n`);
        return;
      }

      if (message.method === "thread/unarchive") {
        assert.strictEqual(message.params.threadId, "019d-thread");
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {
            thread: {
              id: "019d-thread",
              preview: "restored thread",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1776171492,
              updatedAt: 1776171510,
              status: { type: "notLoaded" },
              path: "/tmp/rollout-019d-thread.jsonl",
              cwd: "/repo/a",
              cliVersion: "0.119.0-alpha.5",
              source: "cli",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: "Restored thread",
              turns: [],
            },
          },
        })}\n`);
      }
    });

    const bridge = createAppServerBridge({
      spawnImpl: () => child,
    });

    const archived = await bridge.archiveThread("codex:019d-thread");
    assert.strictEqual(archived.sessionId, "codex:019d-thread");
    assert.strictEqual(archived.archived, true);

    const unarchived = await bridge.unarchiveThread("codex:019d-thread");
    assert.strictEqual(unarchived.thread.id, "019d-thread");
    assert.strictEqual(unarchived.thread.name, "Restored thread");

    await bridge.close();
  });

  it("updates persisted git metadata over the app-server bridge", async () => {
    const child = createFakeChild((message, currentChild) => {
      if (message.method === "initialize") {
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {
            userAgent: "test/0.0.0",
            codexHome: "/tmp/.codex",
            platformFamily: "unix",
            platformOs: "macos",
          },
        })}\n`);
        return;
      }

      if (message.method === "thread/metadata/update") {
        assert.strictEqual(message.params.threadId, "019d-thread");
        assert.deepStrictEqual(message.params.gitInfo, {
          branch: "release/main",
          sha: null,
          originUrl: "https://example.test/repo.git",
        });
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {
            thread: {
              id: "019d-thread",
              preview: "metadata updated thread",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1776171492,
              updatedAt: 1776171510,
              status: { type: "notLoaded" },
              path: "/tmp/rollout-019d-thread.jsonl",
              cwd: "/repo/a",
              cliVersion: "0.119.0-alpha.5",
              source: "cli",
              agentNickname: null,
              agentRole: null,
              gitInfo: {
                branch: "release/main",
                sha: null,
                originUrl: "https://example.test/repo.git",
              },
              name: "Metadata updated thread",
              turns: [],
            },
          },
        })}\n`);
      }
    });

    const bridge = createAppServerBridge({
      spawnImpl: () => child,
    });

    const updated = await bridge.updateThreadMetadata("codex:019d-thread", {
      gitInfo: {
        branch: "release/main",
        sha: null,
        originUrl: "https://example.test/repo.git",
      },
    });
    assert.strictEqual(updated.thread.id, "019d-thread");
    assert.strictEqual(updated.thread.gitInfo.branch, "release/main");
    assert.strictEqual(updated.thread.gitInfo.sha, null);
    assert.strictEqual(updated.thread.gitInfo.originUrl, "https://example.test/repo.git");

    await bridge.close();
  });

  it("sets persisted thread memory mode over the app-server bridge", async () => {
    const child = createFakeChild((message, currentChild) => {
      if (message.method === "initialize") {
        assert.strictEqual(message.params.capabilities.experimentalApi, true);
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {
            userAgent: "test/0.0.0",
            codexHome: "/tmp/.codex",
            platformFamily: "unix",
            platformOs: "macos",
          },
        })}\n`);
        return;
      }

      if (message.method === "thread/memoryMode/set") {
        assert.strictEqual(message.params.threadId, "019d-thread");
        assert.strictEqual(message.params.mode, "disabled");
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {},
        })}\n`);
      }
    });

    const bridge = createAppServerBridge({
      spawnImpl: () => child,
    });

    const updated = await bridge.setThreadMemoryMode("codex:019d-thread", "disabled");
    assert.deepStrictEqual(updated, {
      threadId: "019d-thread",
      sessionId: "codex:019d-thread",
      memoryMode: "disabled",
    });

    await bridge.close();
  });

  it("forks and rolls back a thread over the app-server bridge", async () => {
    const child = createFakeChild((message, currentChild) => {
      if (message.method === "initialize") {
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {
            userAgent: "test/0.0.0",
            codexHome: "/tmp/.codex",
            platformFamily: "unix",
            platformOs: "macos",
          },
        })}\n`);
        return;
      }

      if (message.method === "thread/fork") {
        assert.strictEqual(message.params.threadId, "019d-thread");
        assert.strictEqual(message.params.lastTurnId, "turn-2");
        assert.strictEqual("persistExtendedHistory" in message.params, false);
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {
            thread: {
              id: "019d-thread-fork",
              forkedFromId: "019d-thread",
              preview: "forked thread",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1776171492,
              updatedAt: 1776171510,
              status: { type: "notLoaded" },
              path: "/tmp/rollout-019d-thread-fork.jsonl",
              cwd: "/repo/a",
              cliVersion: "0.119.0-alpha.5",
              source: "cli",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: null,
              turns: [],
            },
          },
        })}\n`);
        return;
      }

      if (message.method === "thread/rollback") {
        assert.strictEqual(message.params.threadId, "019d-thread-fork");
        assert.strictEqual(message.params.numTurns, 2);
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {
            thread: {
              id: "019d-thread-fork",
              preview: "forked thread",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1776171492,
              updatedAt: 1776171510,
              status: { type: "idle" },
              path: "/tmp/rollout-019d-thread-fork.jsonl",
              cwd: "/repo/a",
              cliVersion: "0.119.0-alpha.5",
              source: "cli",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: null,
              turns: [],
            },
          },
        })}\n`);
      }
    });

    const bridge = createAppServerBridge({
      spawnImpl: () => child,
    });

    const forked = await bridge.forkThread("codex:019d-thread", {
      lastTurnId: "turn-2",
    });
    assert.strictEqual(forked.thread.id, "019d-thread-fork");

    const rolledBack = await bridge.rollbackThread("codex:019d-thread-fork", 2);
    assert.strictEqual(rolledBack.thread.id, "019d-thread-fork");

    await bridge.close();
  });
});
