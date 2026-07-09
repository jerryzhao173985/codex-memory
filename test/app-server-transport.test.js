const { describe, it } = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");

const { createAppServerTransport } = require("../app-server-transport");

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

describe("CodexAppServerTransport", () => {
  it("initializes, sends initialized, and buffers notifications", async () => {
    const seenMethods = [];
    const child = createFakeChild((message, currentChild) => {
      if (typeof message.method === "string") seenMethods.push(message.method);

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
          },
        })}\n`);
        return;
      }

      if (message.method === "thread/list") {
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {
            data: [{ id: "019d-thread" }],
            nextCursor: null,
          },
        })}\n`);
      }
    });

    const transport = createAppServerTransport({
      spawnImpl: () => child,
      clientInfo: {
        name: "transport_test",
        title: "Transport Test",
        version: "0.0.0",
      },
    });

    const result = await transport.request("thread/list", { limit: 1 });
    assert.deepStrictEqual(result, {
      data: [{ id: "019d-thread" }],
      nextCursor: null,
    });
    assert.deepStrictEqual(seenMethods, ["initialize", "initialized", "thread/list"]);
    assert.strictEqual(transport.notifications.length, 1);
    assert.strictEqual(transport.notifications[0].method, "configWarning");

    await transport.close();
  });

  it("replies to unsupported server requests with a JSON-RPC method-not-found error", async () => {
    const seenMessages = [];
    const child = createFakeChild((message, currentChild) => {
      seenMessages.push(message);

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

      if (message.method === "initialized") {
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: "server-1",
          method: "workspace/showToast",
          params: {
            message: "unsupported",
          },
        })}\n`);
        return;
      }

      if (message.method === "thread/loaded/list") {
        currentChild.stdout.emit("data", `${JSON.stringify({
          id: message.id,
          result: {
            data: [],
            nextCursor: null,
          },
        })}\n`);
      }
    });

    const transport = createAppServerTransport({
      spawnImpl: () => child,
    });

    await transport.request("thread/loaded/list", {});

    const unsupportedReply = seenMessages.find((message) => message.id === "server-1" && message.error);
    assert.ok(unsupportedReply);
    assert.strictEqual(unsupportedReply.error.code, -32601);
    assert.match(unsupportedReply.error.message, /unsupported server request/i);

    await transport.close();
  });

  it("times out if initialize never responds", async () => {
    const child = createFakeChild(() => {});
    const transport = createAppServerTransport({
      spawnImpl: () => child,
      startTimeoutMs: 10,
    });

    await assert.rejects(
      transport.ensureStarted(),
      (error) => error && error.code === "APP_SERVER_TIMEOUT"
    );
  });

  it("times out a request the server accepts but never answers", async () => {
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
      }
      // never answer anything else
    });
    const transport = createAppServerTransport({
      spawnImpl: () => child,
      requestTimeoutMs: 15,
    });

    await assert.rejects(
      transport.request("thread/list", {}),
      (error) => error && error.code === "APP_SERVER_TIMEOUT" && /thread\/list/.test(error.message)
    );

    await transport.close();
  });

  it("rejects pending requests when the app-server exits unexpectedly", async () => {
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

      if (message.method === "thread/read") {
        process.nextTick(() => {
          currentChild.emit("exit", 9, null);
        });
      }
    });

    const transport = createAppServerTransport({
      spawnImpl: () => child,
    });

    await assert.rejects(
      transport.request("thread/read", { threadId: "019d-thread", includeTurns: true }),
      (error) => error && error.code === "APP_SERVER_EXITED"
    );
  });
});
