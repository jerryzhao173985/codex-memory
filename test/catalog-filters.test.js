const { describe, it } = require("node:test");
const assert = require("node:assert");
const {
  readCatalogFilterQuerySource,
  buildCatalogCommonFilters,
  buildCatalogQueryFilters,
  buildCatalogArtifactContextFilters,
  buildStructuredMatchFilters,
} = require("../catalog-filters");

describe("catalog filter helpers", () => {
  it("normalizes shared query params and repeated aliases into a canonical source object", () => {
    const params = new URLSearchParams(
      "q=hello" +
      "&q_mode=fuzzy" +
      "&query=AGENTS.md" +
      "&query_mode=exact" +
      "&compact=1" +
      "&cwd=%2Frepo" +
      "&area=docs" +
      "&kind=message" +
      "&turn=turn-1" +
      "&status=completed" +
      "&reason=rebuild" +
      "&source=auto" +
      "&session_id=codex%3As1" +
      "&session_key=rollout-1" +
      "&forked_from=codex%3Aparent" +
      "&parent_thread=thread-1" +
      "&lineage_root=codex%3Aroot" +
      "&tool=exec_command" +
      "&file=README.md" +
      "&path=src%2Fapp.js" +
      "&path_pattern=*.md" +
      "&path_role=read" +
      "&command_op=sed" +
      "&command_op_signal=high" +
      "&command_type=read" +
      "&memory_mode=enabled" +
      "&event_mode=extended" +
      "&quality_class=useful_limited" +
      "&error=ENOENT" +
      "&bookmarked=1" +
      "&manual_tag=fix" +
      "&manualTag=docs" +
      "&has=errors" +
      "&has=patches" +
      "&history_mode=raw" +
      "&refresh=1"
    );

    const source = readCatalogFilterQuerySource(params);
    assert.deepStrictEqual(source, {
      q: "hello",
      qMode: "fuzzy",
      query: "AGENTS.md",
      queryMode: "exact",
      shape: "compact",
      cwd: "/repo",
      area: "docs",
      kind: "message",
      turn: "turn-1",
      status: "completed",
      reason: "rebuild",
      source: "auto",
      sessionId: "codex:s1",
      sessionKey: "rollout-1",
      forkedFrom: "codex:parent",
      parentThread: "thread-1",
      lineageRoot: "codex:root",
      tool: "exec_command",
      file: "README.md",
      path: "src/app.js",
      pathPattern: "*.md",
      pathRole: "read",
      commandOp: "sed",
      commandOpSignal: "high",
      commandType: "read",
      memoryMode: "enabled",
      eventMode: "extended",
      qualityClass: "useful_limited",
      error: "ENOENT",
      bookmarked: "1",
      manualTags: ["fix", "docs"],
      has: ["errors", "patches"],
      historyMode: "raw",
      refresh: true,
    });
  });

  it("falls back to singular string values when repeated alias params are not present", () => {
    const source = readCatalogFilterQuerySource(
      new URLSearchParams("manual_tag=keep&has=errors&qMode=exact&shape=compact")
    );

    assert.deepStrictEqual(source.manualTags, ["keep"]);
    assert.deepStrictEqual(source.has, ["errors"]);
    assert.strictEqual(source.qMode, "exact");
    assert.strictEqual(source.shape, "compact");
  });

  it("builds shared common and structured filter objects without adding unsupported keys", () => {
    const source = {
      cwd: "/repo",
      sessionId: "codex:s1",
      sessionKey: "rollout-1",
      forkedFrom: "codex:parent",
      parentThread: "thread-1",
      lineageRoot: "codex:root",
      bookmarked: "1",
      manualTags: ["fix"],
      tool: "exec_command",
      file: "README.md",
      path: "src/app.js",
      pathPattern: "*.md",
      pathRole: "read",
      commandOp: "sed",
      commandOpSignal: "high",
      commandType: "read",
      memoryMode: "enabled",
      eventMode: "extended",
      qualityClass: "useful_limited",
      error: "ENOENT",
      has: ["errors"],
      historyMode: "raw",
      q: "hello",
      qMode: "fuzzy",
      query: "AGENTS.md",
      queryMode: "exact",
      shape: "compact",
      area: "docs",
      kind: "message",
      turn: "turn-1",
      status: "completed",
    };

    assert.deepStrictEqual(buildCatalogCommonFilters(source), {
      cwd: "/repo",
      sessionId: "codex:s1",
      sessionKey: "rollout-1",
      forkedFrom: "codex:parent",
      parentThread: "thread-1",
      lineageRoot: "codex:root",
      bookmarked: "1",
      manualTags: ["fix"],
      tool: "exec_command",
      file: "README.md",
      path: "src/app.js",
      pathPattern: "*.md",
      pathRole: "read",
      commandOp: "sed",
      commandOpSignal: "high",
      commandType: "read",
      memoryMode: "enabled",
      eventMode: "extended",
      qualityClass: "useful_limited",
      error: "ENOENT",
      has: ["errors"],
      historyMode: "raw",
    });

    assert.deepStrictEqual(
      buildStructuredMatchFilters(source, {
        includeKind: true,
        includeTurn: true,
        includeStatus: true,
      }),
      {
        q: "hello",
        query: "AGENTS.md",
        queryMode: "exact",
        tool: "exec_command",
        file: "README.md",
        path: "src/app.js",
        pathPattern: "*.md",
        pathRole: "read",
        commandOp: "sed",
        commandOpSignal: "high",
        commandType: "read",
        qualityClass: "useful_limited",
        error: "ENOENT",
        bookmarked: "1",
        manualTags: ["fix"],
        kind: "message",
        turn: "turn-1",
        status: "completed",
      }
    );

    assert.deepStrictEqual(
      buildCatalogQueryFilters(source, {
        includeQMode: true,
        includeShape: true,
        includeArea: true,
        includeKind: true,
        includeTurn: true,
        includeStatus: true,
      }),
      {
        q: "hello",
        qMode: "fuzzy",
        query: "AGENTS.md",
        queryMode: "exact",
        cwd: "/repo",
        sessionId: "codex:s1",
        sessionKey: "rollout-1",
        forkedFrom: "codex:parent",
        parentThread: "thread-1",
        lineageRoot: "codex:root",
        bookmarked: "1",
        manualTags: ["fix"],
        tool: "exec_command",
        file: "README.md",
        path: "src/app.js",
        pathPattern: "*.md",
        pathRole: "read",
        commandOp: "sed",
        commandOpSignal: "high",
        commandType: "read",
        memoryMode: "enabled",
        eventMode: "extended",
        qualityClass: "useful_limited",
        error: "ENOENT",
        has: ["errors"],
        historyMode: "raw",
        shape: "compact",
        area: "docs",
        kind: "message",
        turn: "turn-1",
        status: "completed",
      }
    );

    assert.deepStrictEqual(
      buildCatalogArtifactContextFilters(source, {
        includeQ: true,
        includeShape: true,
        includeKind: true,
        includeStatus: true,
        includeTurn: true,
        includeSessionKey: true,
        includePathPattern: true,
        includePathRole: true,
        includeCommandOpSignal: true,
      }),
      {
        q: "hello",
        shape: "compact",
        kind: "message",
        status: "completed",
        turn: "turn-1",
        cwd: "/repo",
        sessionId: "codex:s1",
        sessionKey: "rollout-1",
        forkedFrom: "codex:parent",
        parentThread: "thread-1",
        lineageRoot: "codex:root",
        pathPattern: "*.md",
        pathRole: "read",
        commandOpSignal: "high",
        memoryMode: "enabled",
        eventMode: "extended",
        qualityClass: "useful_limited",
        bookmarked: "1",
        manualTags: ["fix"],
        has: ["errors"],
        historyMode: "raw",
      }
    );
  });
});
