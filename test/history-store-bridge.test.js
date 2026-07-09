const { describe, it } = require("node:test");
const assert = require("node:assert");

const { createHistoryStoreBridge } = require("../history-store-bridge");

describe("history store bridge", () => {
  it("can skip rollout session context for exact thread views when fallback data is not needed", async () => {
    let sessionContextCalls = 0;
    const bridge = createHistoryStoreBridge({
      getSessionContext() {
        sessionContextCalls += 1;
        return {
          generatedAt: "2026-04-10T00:00:00.000Z",
          session: {
            sessionId: "codex:019d-thread",
            model: "gpt-5.4",
          },
        };
      },
      appServer: {
        async readThread() {
          return {
            thread: {
              id: "019d-thread",
              preview: "exact bridge thread",
              cwd: "/repo",
              status: { type: "completed", activeFlags: [] },
              turns: [
                {
                  id: "turn-1",
                  status: "completed",
                  startedAt: 1710000000,
                  completedAt: 1710000010,
                  items: [
                    {
                      id: "item-1",
                      type: "userMessage",
                      content: [{ type: "input_text", text: "inspect exact thread" }],
                    },
                  ],
                },
              ],
            },
          };
        },
        close() {},
      },
    });

    const built = await bridge.buildAppServerView("codex:019d-thread", {}, {
      includeSessionContext: false,
    });

    assert.ok(built);
    assert.strictEqual(sessionContextCalls, 0);
    assert.strictEqual(built.view.session.sessionId, "codex:019d-thread");
    assert.strictEqual(built.view.session.model, null);
  });

  it("hydrates rollout session context when exact views need annotation-aware fallback data", async () => {
    let sessionContextCalls = 0;
    const bridge = createHistoryStoreBridge({
      getSessionContext() {
        sessionContextCalls += 1;
        return {
          generatedAt: "2026-04-10T00:00:00.000Z",
          session: {
            sessionId: "codex:019d-thread",
            model: "gpt-5.4",
            annotation: {
              bookmarked: true,
              tags: ["important"],
              note: "",
              updatedAt: "2026-04-10T00:00:00.000Z",
            },
            turns: [],
          },
        };
      },
      appServer: {
        async readThread() {
          return {
            thread: {
              id: "019d-thread",
              preview: "exact bridge thread",
              cwd: "/repo",
              status: { type: "completed", activeFlags: [] },
              turns: [],
            },
          };
        },
        close() {},
      },
    });

    const built = await bridge.buildAppServerView("codex:019d-thread");

    assert.ok(built);
    assert.strictEqual(sessionContextCalls, 1);
    assert.strictEqual(built.generatedAt, "2026-04-10T00:00:00.000Z");
    assert.strictEqual(built.view.session.model, "gpt-5.4");
    assert.deepStrictEqual(built.view.session.annotation.tags, ["important"]);
  });

  it("keeps prune operations on exact thread/read data without hydrating rollout session context", async () => {
    let sessionContextCalls = 0;
    const threads = new Map();

    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function makeTurn(id, userText, answerText, startedAt) {
      return {
        id,
        status: "completed",
        error: null,
        startedAt,
        completedAt: startedAt + 10,
        items: [
          {
            id: `${id}-user`,
            type: "userMessage",
            content: [{ type: "input_text", text: userText }],
          },
          {
            id: `${id}-answer`,
            type: "agentMessage",
            text: answerText,
            phase: "final_answer",
            memoryCitation: null,
          },
        ],
      };
    }

    threads.set("019d-thread-prune", {
      id: "019d-thread-prune",
      preview: "exact prune thread",
      cwd: "/repo",
      status: { type: "completed", activeFlags: [] },
      turns: [
        makeTurn("turn-1", "keep this turn", "first answer", 1710000000),
        makeTurn("turn-2", "drop this turn", "second answer", 1710000100),
      ],
    });

    const bridge = createHistoryStoreBridge({
      getSessionContext() {
        sessionContextCalls += 1;
        return {
          generatedAt: "2026-04-10T00:00:00.000Z",
          session: {
            sessionId: "codex:019d-thread-prune",
            annotation: {
              bookmarked: true,
              tags: ["important"],
              note: "",
              updatedAt: "2026-04-10T00:00:00.000Z",
            },
            turns: [
              {
                turnId: "turn-1",
                annotation: {
                  bookmarked: true,
                  tags: ["turn-tag"],
                  note: "",
                  updatedAt: "2026-04-10T00:00:00.000Z",
                },
              },
            ],
          },
        };
      },
      appServer: {
        async readThread(sessionId) {
          const id = String(sessionId).replace(/^codex:/, "");
          return { thread: clone(threads.get(id)) };
        },
        async forkThread(sessionId) {
          const id = String(sessionId).replace(/^codex:/, "");
          const source = clone(threads.get(id));
          const forkId = `${id}-fork`;
          const forked = {
            ...source,
            id: forkId,
            forkedFromId: id,
          };
          threads.set(forkId, forked);
          return { thread: clone(forked) };
        },
        async rollbackThread(sessionId, numTurns) {
          const id = String(sessionId).replace(/^codex:/, "");
          const thread = clone(threads.get(id));
          thread.turns = thread.turns.slice(0, Math.max(0, thread.turns.length - numTurns));
          threads.set(id, thread);
          return { thread: clone(thread) };
        },
        async setThreadName(sessionId, name) {
          const id = String(sessionId).replace(/^codex:/, "");
          const thread = clone(threads.get(id));
          thread.name = name;
          threads.set(id, thread);
          return { thread: clone(thread) };
        },
        close() {},
      },
    });

    const candidates = await bridge.listPruneCandidates("codex:019d-thread-prune", {
      limit: 2,
    });
    const preview = await bridge.getPrunePreview("codex:019d-thread-prune", {
      throughTurn: "turn-1",
      turnLimit: 1,
    });
    const forked = await bridge.forkPruneThread("codex:019d-thread-prune", {
      throughTurn: "turn-1",
      name: "Trimmed exact thread",
      turnLimit: 1,
    });

    assert.strictEqual(sessionContextCalls, 0);
    assert.ok(candidates);
    assert.strictEqual(candidates.quality.mode, "app_server_thread_view");
    assert.ok(preview);
    assert.strictEqual(preview.resume.session.annotation, null);
    assert.ok(forked);
    assert.strictEqual(forked.resume.session.annotation, null);
    assert.strictEqual(forked.thread.name, "Trimmed exact thread");
  });
});
