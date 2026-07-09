const { describe, it } = require("node:test");
const assert = require("node:assert");
const parser = require("../parser");
const codexConfig = require("../config");

describe("normalizeRecordObject", () => {
  it("parses session_meta with subagent details", () => {
    const record = parser.normalizeRecordObject({
      timestamp: "2026-03-26T11:12:38.558Z",
      type: "session_meta",
      payload: {
        id: "019d29d8-9346-7b33-813c-6f96304d11b8",
        cwd: "/repo",
        originator: "codex_cli_rs",
        cli_version: "0.117.0-alpha.22",
        model_provider: "openai",
        memory_mode: "polluted",
        agent_nickname: "Turing",
        agent_role: "explorer",
        agent_path: "workers/explorer",
        git: {
          branch: "main",
          commit_hash: "abc123",
          repository_url: "git@github.com:openai/codex.git",
        },
        instructions: "System instructions for the session.",
        dynamic_tools: [
          { name: "read_thread_terminal" },
          { name: "automation_update" },
        ],
        source: {
          subagent: {
            thread_spawn: {
              parent_thread_id: "parent-thread",
              depth: 1,
              agent_path: "/root/path",
              agent_nickname: "Turing",
              agent_role: "explorer",
            },
          },
        },
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "session_meta");
    assert.strictEqual(record.sessionMeta.cwd, "/repo");
    assert.strictEqual(record.sessionMeta.cliVersion, "0.117.0-alpha.22");
    assert.strictEqual(record.sessionMeta.memoryMode, "polluted");
    assert.strictEqual(record.sessionMeta.source, "subAgentThreadSpawn");
    assert.strictEqual(record.sessionMeta.sourceKind, "subAgentThreadSpawn");
    assert.deepStrictEqual(record.sessionMeta.sourceDetail, {
      type: "subAgent",
      variant: "threadSpawn",
      parentThreadId: "codex:parent-thread",
      depth: 1,
      agentPath: "/root/path",
      agentNickname: "Turing",
      agentRole: "explorer",
    });
    assert.strictEqual(record.sessionMeta.agentPath, "workers/explorer");
    assert.deepStrictEqual(record.sessionMeta.git, {
      branch: "main",
      sha: "abc123",
      originUrl: "git@github.com:openai/codex.git",
    });
    assert.match(record.sessionMeta.baseInstructionsPreview, /System instructions/);
    assert.deepStrictEqual(record.sessionMeta.dynamicToolNames, [
      "read_thread_terminal",
      "automation_update",
    ]);
    assert.strictEqual(record.sessionMeta.dynamicToolCount, 2);
    assert.strictEqual(record.sessionMeta.subagent.parentThreadId, "parent-thread");
  });

  it("parses turn_context metadata", () => {
    const record = parser.normalizeRecordObject({
      timestamp: "2026-04-09T16:02:10.601Z",
      type: "turn_context",
      payload: {
        turn_id: "turn-1",
        cwd: "/repo",
        approval_policy: "never",
        sandbox_policy: { mode: "workspace-write", network_access: true },
        model: "gpt-5.4",
        effort: "medium",
        summary: "auto",
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "turn_context");
    assert.strictEqual(record.turnContext.turnId, "turn-1");
    assert.strictEqual(record.turnContext.sandboxMode, "workspace-write");
    assert.strictEqual(record.turnContext.networkAccess, true);
    assert.strictEqual(record.turnContext.model, "gpt-5.4");
  });

  it("parses function_call commands and state signals", () => {
    const record = parser.normalizeRecordObject({
      timestamp: "2026-04-09T16:02:17.208Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: "{\"cmd\":\"git status\",\"workdir\":\"/repo\"}",
        call_id: "call_123",
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "tool_call");
    assert.strictEqual(record.command, "git status");
    assert.strictEqual(record.cwd, "/repo");
    assert.strictEqual(record.stateSignal, "working");
  });

  it("parses legacy function_call command arrays", () => {
    const record = parser.normalizeRecordObject({
      timestamp: "2025-04-28T16:19:19.416Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell",
        arguments: "{\"command\":[\"git\",\"status\"]}",
        call_id: "call_legacy",
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "tool_call");
    assert.strictEqual(record.command, "git status");
    assert.ok(Array.isArray(record.commandTypes));
  });

  it("infers command paths and queries from raw function_call commands", () => {
    const record = parser.normalizeRecordObject({
      timestamp: "2026-04-09T16:02:17.208Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: "{\"cmd\":\"rg -n \\\"history layer\\\" src/history.js\",\"workdir\":\"/repo\"}",
        call_id: "call_search",
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "tool_call");
    assert.strictEqual(record.command, "rg -n \"history layer\" src/history.js");
    assert.deepStrictEqual(record.commandTypes, ["search"]);
    assert.deepStrictEqual(record.commandPaths, ["src/history.js"]);
    assert.deepStrictEqual(record.commandQueries, ["history layer"]);
  });

  it("parses wrapped command output metadata", () => {
    const record = parser.normalizeRecordObject({
      timestamp: "2026-04-09T16:02:17.230Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call_123",
        output: "Chunk ID: abc123\nWall time: 0.0516 seconds\nProcess exited with code 0\nOriginal token count: 137\nOutput:\nhello\n",
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "tool_output");
    assert.strictEqual(record.output.exitCode, 0);
    assert.strictEqual(record.output.durationSeconds, 0.0516);
    assert.strictEqual(record.output.tokenCount, 137);
    assert.strictEqual(record.output.text, "hello");
  });

  it("parses structured exec_command_end payloads", () => {
    const record = parser.normalizeRecordObject({
      timestamp: "2026-04-14T13:00:14.924Z",
      type: "event_msg",
      payload: {
        type: "exec_command_end",
        call_id: "call_exec",
        turn_id: "turn_exec",
        command: ["/bin/zsh", "-lc", "git status --short"],
        cwd: "/repo",
        parsed_cmd: [{ type: "unknown", cmd: "git status --short" }],
        source: "unified_exec_startup",
        aggregated_output: "?? AGENTS.md\n",
        exit_code: 0,
        duration: { secs: 0, nanos: 341700000 },
        status: "completed",
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "tool_output");
    assert.strictEqual(record.command, "git status --short");
    assert.strictEqual(record.cwd, "/repo");
    assert.strictEqual(record.commandSource, "unified_exec_startup");
    assert.deepStrictEqual(record.commandTypes, ["unknown"]);
    assert.deepStrictEqual(record.commandPaths, []);
    assert.strictEqual(record.output.exitCode, 0);
    assert.strictEqual(record.output.durationSeconds, 0.342);
    assert.strictEqual(record.output.text, "?? AGENTS.md");
  });

  it("refines parsed_cmd paths when command text is more specific than Codex's friendly path", () => {
    const record = parser.normalizeRecordObject({
      timestamp: "2026-04-15T12:19:13.173Z",
      type: "event_msg",
      payload: {
        type: "exec_command_end",
        call_id: "call_exec",
        turn_id: "turn_exec",
        command: ["/bin/zsh", "-lc", "rg -n \"function addUnique\" -n codex/catalog.js && sed -n '1,90p' codex/catalog.js"],
        cwd: "/repo",
        parsed_cmd: [
          {
            type: "search",
            cmd: "rg -n 'function addUnique' -n codex/catalog.js",
            query: "function addUnique",
            path: "catalog.js",
          },
          {
            type: "read",
            cmd: "sed -n '1,90p' codex/catalog.js",
            name: "catalog.js",
            path: "codex/catalog.js",
          },
        ],
        source: "unified_exec_startup",
        aggregated_output: "133:function addUnique(list, value, limit = MAX_UNIQUE_VALUES) {\n",
        exit_code: 0,
        duration: { secs: 0, nanos: 3666 },
        status: "completed",
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "tool_output");
    assert.deepStrictEqual(record.commandTypes, ["search", "read"]);
    assert.deepStrictEqual(record.commandPaths, ["codex/catalog.js"]);
    assert.strictEqual(record.commandParts[0].path, "codex/catalog.js");
    assert.strictEqual(record.commandParts[1].path, "codex/catalog.js");
  });

  it("drops glob-like parsed_cmd paths while keeping exact literal command scopes", () => {
    const record = parser.normalizeRecordObject({
      timestamp: "2026-04-15T11:33:36.100Z",
      type: "event_msg",
      payload: {
        type: "exec_command_end",
        call_id: "call_exec",
        turn_id: "turn_exec",
        command: [
          "/bin/zsh",
          "-lc",
          "rg -n \"SESSION_DOC_SCHEMA_VERSION|session doc schema|schemaVersion\" codex/test/*.test.js codex/history-store.js codex/catalog.js",
        ],
        cwd: "/repo",
        parsed_cmd: [
          {
            type: "search",
            cmd: "rg -n 'SESSION_DOC_SCHEMA_VERSION|session doc schema|schemaVersion' 'codex/test/*.test.js' codex/history-store.js codex/catalog.js",
            query: "SESSION_DOC_SCHEMA_VERSION|session doc schema|schemaVersion",
            path: "*.test.js",
          },
        ],
        source: "unified_exec_startup",
        aggregated_output: "codex/history-store.js:8:  SESSION_DOC_SCHEMA_VERSION,\n",
        exit_code: 0,
        duration: { secs: 0, nanos: 917 },
        status: "completed",
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "tool_output");
    assert.deepStrictEqual(record.commandTypes, ["search"]);
    assert.deepStrictEqual(record.commandPaths, ["codex/history-store.js", "codex/catalog.js"]);
    assert.deepStrictEqual(record.commandPathPatterns, ["codex/test/*.test.js"]);
    assert.deepStrictEqual(record.commandQueries, ["SESSION_DOC_SCHEMA_VERSION|session doc schema|schemaVersion"]);
    assert.strictEqual(record.commandParts[0].path, null);
    assert.strictEqual(record.commandParts[0].pathPattern, "codex/test/*.test.js");
  });

  it("infers raw exec_command_end path hints when parsed_cmd is missing", () => {
    const record = parser.normalizeRecordObject({
      timestamp: "2026-04-14T13:00:14.924Z",
      type: "event_msg",
      payload: {
        type: "exec_command_end",
        call_id: "call_exec",
        turn_id: "turn_exec",
        command: ["/bin/zsh", "-lc", "git diff -- src/history.js && ls docs/journey.md"],
        cwd: "/repo",
        source: "unified_exec_startup",
        aggregated_output: "diff --git a/src/history.js b/src/history.js\n",
        exit_code: 0,
        duration: { secs: 0, nanos: 341700000 },
        status: "completed",
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "tool_output");
    assert.strictEqual(record.command, "git diff -- src/history.js && ls docs/journey.md");
    assert.deepStrictEqual(record.commandTypes, ["read", "list_files"]);
    assert.deepStrictEqual(record.commandPaths, ["src/history.js", "docs/journey.md"]);
    assert.deepStrictEqual(record.commandQueries, []);
  });

  it("does not treat numeric option values as inferred paths", () => {
    assert.deepStrictEqual(
      parser.inferCommandHints("tail -n 40 codex/catalog.js"),
      {
        types: ["read"],
        paths: ["codex/catalog.js"],
        patterns: [],
        queries: [],
      }
    );

    assert.deepStrictEqual(
      parser.inferCommandHints("ls -w 80 codex"),
      {
        types: ["list_files"],
        paths: ["codex"],
        patterns: [],
        queries: [],
      }
    );
  });

  it("does not treat shell builtins and follow-on commands as inferred paths in multiline scripts", () => {
    assert.deepStrictEqual(
      parser.inferCommandHints("tail -n 120\necho \"BUILD_STATUS=$status\"\nexit $status"),
      {
        types: [],
        paths: [],
        patterns: [],
        queries: [],
      }
    );

    assert.deepStrictEqual(
      parser.inferCommandHints("tail -n 80\nprintf '%s\\n' \"$value\"\nsort -u\nwc -l"),
      {
        types: [],
        paths: [],
        patterns: [],
        queries: [],
      }
    );
  });

  it("captures shell structure hints for multiline commands without promoting fake paths", () => {
    const record = parser.normalizeRecordObject({
      timestamp: "2026-04-15T16:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "exec_command_end",
        call_id: "call_exec",
        turn_id: "turn_exec",
        command: [
          "/bin/zsh",
          "-lc",
          "tail -n 120\n" +
          "echo \"BUILD_STATUS=$status\"\n" +
          "exit $status",
        ],
        cwd: "/repo",
        source: "unified_exec_startup",
        aggregated_output: "BUILD_STATUS=0\n",
        exit_code: 0,
        duration: { secs: 0, nanos: 1000 },
        status: "completed",
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "tool_output");
    assert.deepStrictEqual(record.commandTypes, []);
    assert.deepStrictEqual(record.commandPaths, []);
    assert.deepStrictEqual(record.commandTypeHints, ["read"]);
    assert.deepStrictEqual(record.shellCommands, ["tail", "echo", "exit"]);
  });

  it("filters shell scaffolding and heredoc bodies from low-confidence shell structure", () => {
    const structure = parser.inferShellCommandStructure(
      "set -euo pipefail\n" +
      "cd /repo\n" +
      "repo=\"$(pwd)\"\n" +
      "while IFS= read -r p; do\n" +
      "  if [ -z \"$p\" ]; then continue; fi\n" +
      "  if [ -e \"$p\" ]; then\n" +
      "    python3 - <<'PY' \"$repo\" \"$p\"\n" +
      "print(1)\n" +
      "PY\n" +
      "  fi\n" +
      "done < \"$existing\" | sort -u | sed -n '1,40p'"
    );

    assert.deepStrictEqual(structure.shellCommands, ["python3", "sort", "sed"]);
    assert.deepStrictEqual(structure.commandTypeHints, ["read"]);
  });

  it("captures simple command substitutions as shell structure without widening exact paths", () => {
    const structure = parser.inferShellCommandStructure(
      "b=$(basename \"$f\")\n" +
      "echo \"### $f\"\n" +
      "rg -n --fixed-strings \"$b\" app arch design cmake || true"
    );

    assert.deepStrictEqual(structure.shellCommands, ["basename", "echo", "rg"]);
    assert.deepStrictEqual(structure.commandTypeHints, ["search"]);
  });

  it("does not treat multiline quoted inline scripts as separate shell commands", () => {
    const structure = parser.inferShellCommandStructure(
      "python3 -c 'from pathlib import Path\\n" +
      "with Path(\"sessions.json\").open() as fh:\\n" +
      "    print(fh.read())\\n" +
      "try:\\n" +
      "    pass\\n" +
      "except:\\n" +
      "    pass'\n" +
      "rg -n \"session\" codex/history-store.js"
    );

    assert.deepStrictEqual(structure.shellCommands, ["python3", "rg"]);
    assert.deepStrictEqual(structure.commandTypeHints, ["search"]);
  });

  it("does not treat command-substitution assignment path operands as shell commands", () => {
    const structure = parser.inferShellCommandStructure(
      "latest=$(find \"$HOME/.codex/sessions\" -name 'rollout-*.jsonl' | sort | tail -n 1)\n" +
      "echo \"$latest\"\n" +
      "node codex/inspect.js \"$latest\" | head -n 8"
    );

    assert.deepStrictEqual(
      [...structure.shellCommands].sort(),
      ["echo", "find", "head", "node", "sort", "tail"]
    );
    assert.deepStrictEqual(structure.commandTypeHints, ["read", "search"]);
  });

  it("captures option-based search and list scopes from raw command families", () => {
    assert.deepStrictEqual(
      parser.inferCommandHints("find . -name 'AGENTS.md' -print"),
      {
        types: ["search"],
        paths: [],
        patterns: ["AGENTS.md"],
        queries: ["AGENTS.md"],
      }
    );

    assert.deepStrictEqual(
      parser.inferCommandHints("find . -type f \\( -name '*.md' -o -name '*.txt' \\) -not -path './build/*' -not -path './.git/*' | sort"),
      {
        types: ["search"],
        paths: [],
        patterns: ["*.md", "*.txt", "./build/*", "./.git/*"],
        queries: ["*.md", "*.txt", "./build/*", "./.git/*"],
      }
    );

    assert.deepStrictEqual(
      parser.inferCommandHints("rg --glob '*.test.js' --glob '!dist/*' foo src"),
      {
        types: ["search"],
        paths: ["src"],
        patterns: ["*.test.js", "!dist/*"],
        queries: ["foo"],
      }
    );

    assert.deepStrictEqual(
      parser.inferCommandHints("grep -R --include '*.ts' --exclude-dir node_modules TODO src"),
      {
        types: ["search"],
        paths: ["src"],
        patterns: ["*.ts", "node_modules"],
        queries: ["TODO"],
      }
    );

    assert.deepStrictEqual(
      parser.inferCommandHints("fd -t f src/"),
      {
        types: ["list_files"],
        paths: ["src/"],
        patterns: [],
        queries: [],
      }
    );

    assert.deepStrictEqual(
      parser.inferCommandHints("fd main src"),
      {
        types: ["search"],
        paths: ["src"],
        patterns: [],
        queries: ["main"],
      }
    );

    assert.deepStrictEqual(
      parser.inferCommandHints("ag TODO src"),
      {
        types: ["search"],
        paths: ["src"],
        patterns: [],
        queries: ["TODO"],
      }
    );

    assert.deepStrictEqual(
      parser.inferCommandHints("rga TODO docs"),
      {
        types: ["search"],
        paths: ["docs"],
        patterns: [],
        queries: ["TODO"],
      }
    );

    assert.deepStrictEqual(
      parser.inferCommandHints("git ls-files --exclude target src"),
      {
        types: ["list_files"],
        paths: ["src"],
        patterns: ["target"],
        queries: [],
      }
    );
  });

  it("parses patch_apply_end summaries", () => {
    const record = parser.normalizeRecordObject({
      timestamp: "2026-04-09T12:57:09.119Z",
      type: "event_msg",
      payload: {
        type: "patch_apply_end",
        call_id: "call_patch",
        turn_id: "turn_patch",
        success: true,
        stdout: "Success",
        stderr: "",
        changes: {
          "/repo/a.js": { type: "update", unified_diff: "@@ ..." },
          "/repo/b.js": { type: "add", unified_diff: "@@ ..." },
        },
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "patch");
    assert.strictEqual(record.patch.fileCount, 2);
    assert.strictEqual(record.patch.types.update, 1);
    assert.strictEqual(record.patch.types.add, 1);
    assert.strictEqual(record.stateSignal, "working");
  });

  it("preserves parsed find filters as path patterns", () => {
    const record = parser.normalizeRecordObject({
      timestamp: "2026-04-15T12:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "exec_command_end",
        call_id: "call_find",
        turn_id: "turn_find",
        command: ["/bin/zsh", "-lc", "find . -name 'AGENTS.md' -print"],
        cwd: "/repo",
        parsed_cmd: [{
          type: "search",
          cmd: "find . -name 'AGENTS.md' -print",
          query: "AGENTS.md",
          path: ".",
        }],
        source: "unified_exec_startup",
        aggregated_output: "./AGENTS.md\n",
        exit_code: 0,
        duration: { secs: 0, nanos: 1 },
        status: "completed",
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "tool_output");
    assert.deepStrictEqual(record.commandTypes, ["search"]);
    assert.deepStrictEqual(record.commandPaths, ["."]);
    assert.deepStrictEqual(record.commandPathPatterns, ["AGENTS.md"]);
    assert.deepStrictEqual(record.commandQueries, ["AGENTS.md"]);
    assert.strictEqual(record.commandParts[0].path, ".");
    assert.strictEqual(record.commandParts[0].pathPattern, null);
  });

  it("parses token_count details", () => {
    const record = parser.normalizeRecordObject({
      timestamp: "2026-04-09T16:02:11.405Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { total_tokens: 1000 },
          last_token_usage: { total_tokens: 100 },
          model_context_window: 258400,
        },
        rate_limits: { limit_id: "codex" },
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "token_count");
    assert.strictEqual(record.tokenUsage.total.total_tokens, 1000);
    assert.strictEqual(record.rateLimits.limit_id, "codex");
  });

  it("parses thread_rolled_back history mutations", () => {
    const record = parser.normalizeRecordObject({
      timestamp: "2026-04-15T10:10:10.000Z",
      type: "event_msg",
      payload: {
        type: "thread_rolled_back",
        num_turns: 2,
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "history_mutation");
    assert.deepStrictEqual(record.mutation, {
      type: "thread_rollback",
      numTurns: 2,
    });
    assert.match(record.preview, /rolled back 2 turns/i);
  });

  it("parses web_search_call query details", () => {
    const record = parser.normalizeRecordObject({
      timestamp: "2026-04-09T14:41:16.628Z",
      type: "response_item",
      payload: {
        type: "web_search_call",
        status: "completed",
        action: {
          type: "search",
          query: "site:github.com test query",
          queries: ["site:github.com test query", "site:developers.openai.com test query"],
        },
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "web_search");
    assert.strictEqual(record.toolName, "web_search");
    assert.strictEqual(record.query, "site:github.com test query");
    assert.deepStrictEqual(record.queries, [
      "site:github.com test query",
      "site:developers.openai.com test query",
    ]);
    assert.strictEqual(record.actionType, "search");
  });

  it("parses MCP tool call summaries", () => {
    const record = parser.normalizeRecordObject({
      timestamp: "2026-04-09T15:56:21.501Z",
      type: "event_msg",
      payload: {
        type: "mcp_tool_call_end",
        call_id: "call_mcp",
        invocation: {
          server: "openaiDeveloperDocs",
          tool: "search_openai_docs",
          arguments: { query: "test" },
        },
        duration: { secs: 0, nanos: 378860667 },
        result: { Ok: { content: [{ type: "text", text: "hello world" }] } },
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "mcp");
    assert.strictEqual(record.mcp.server, "openaiDeveloperDocs");
    assert.strictEqual(record.mcp.tool, "search_openai_docs");
    assert.strictEqual(record.mcp.durationMs, 379);
    assert.match(record.mcp.resultPreview, /hello world/);
  });

  it("parses structured error metadata", () => {
    const record = parser.normalizeRecordObject({
      timestamp: "2026-04-14T12:57:49.360Z",
      type: "event_msg",
      payload: {
        type: "error",
        message: "unexpected status 401 Unauthorized: Incorrect API key provided, url: https://api.openai.com/v1/responses, cf-ray: 9ec2e0e27958ecfb-LHR, request id: req_8f2c4d0e953a42ef94da7c1e4af5d2a7",
        codex_error_info: "other",
      },
    }, { logEventMap: codexConfig.logEventMap });

    assert.strictEqual(record.kind, "error");
    assert.strictEqual(record.error.code, "other");
    assert.strictEqual(record.error.statusCode, 401);
    assert.strictEqual(record.error.url, "https://api.openai.com/v1/responses");
    assert.strictEqual(record.error.requestId, "req_8f2c4d0e953a42ef94da7c1e4af5d2a7");
  });

  it("creates synthetic permission records", () => {
    const record = parser.createSyntheticPermissionRecord("git push", { name: "exec_command" });
    assert.strictEqual(record.kind, "permission");
    assert.strictEqual(record.command, "git push");
    assert.strictEqual(record.permissionDetail.command, "git push");
  });
});
