const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const README_PATH = path.join(REPO_ROOT, "README.md");
const HARNESS_GUIDE_PATH = path.join(REPO_ROOT, "docs", "codex-history-harness.md");
const CMEM_CLI = path.join(REPO_ROOT, "bin", "cmem.js");
const NPM_CMD = process.platform === "win32" ? "npm.cmd" : "npm";
const DEFAULT_CWD = "/repo/a";
const DEFAULT_MODEL = "gpt-5.4";

function makeTempSessionDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-readme-smoke-"));
  const dateDir = path.join(tmpDir, "2026", "04", "09");
  fs.mkdirSync(dateDir, { recursive: true });
  return { tmpDir, dateDir };
}

function writeRollout(dateDir, fileName, records) {
  fs.writeFileSync(
    path.join(dateDir, fileName),
    records.map((record) => JSON.stringify(record)).join("\n") + "\n"
  );
}

function runNpmHistory(args, options = {}) {
  return execFileSync(NPM_CMD, [
    "run",
    "history",
    "--",
    ...args,
  ], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    ...options,
  });
}

function runCmem(args, options = {}) {
  return execFileSync(process.execPath, [
    CMEM_CLI,
    ...args,
  ], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    ...options,
  });
}

function extractJsonFromCommandOutput(output) {
  const text = typeof output === "string" ? output : "";
  const jsonStart = text.indexOf("{");
  assert.ok(jsonStart >= 0, "expected command output to include a JSON object");
  return JSON.parse(text.slice(jsonStart));
}

function makeFakeCodexDir(threadPages = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-readme-fake-app-server-"));
  const scriptPath = path.join(tmpDir, "codex");
  const script = `#!/usr/bin/env node
const readline = require("node:readline");

const threadPages = ${JSON.stringify(threadPages)};
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

rl.on("line", (line) => {
  const raw = String(line || "").trim();
  if (!raw) return;

  const message = JSON.parse(raw);
  if (message.method === "initialize") {
    send({
      id: message.id,
      result: {
        serverInfo: {
          name: "fake-codex",
          version: "0.0.0",
        },
      },
    });
    return;
  }

  if (message.method === "thread/list") {
    const params = message.params || {};
    const key = params.cursor ? String(params.cursor) : "__default__";
    send({
      id: message.id,
      result: threadPages[key] || { data: [], nextCursor: null },
    });
    return;
  }

  if (message.method === "thread/loaded/list") {
    send({
      id: message.id,
      result: {
        data: [],
        nextCursor: null,
      },
    });
    return;
  }

  send({
    id: message.id,
    error: {
      code: -32601,
      message: "unsupported method",
    },
  });
});
`;
  fs.writeFileSync(scriptPath, script);
  fs.chmodSync(scriptPath, 0o755);
  return tmpDir;
}

function withPrependedPath(dir) {
  return {
    ...process.env,
    PATH: `${dir}${path.delimiter}${process.env.PATH || ""}`,
  };
}

function assertDocIncludes(filePath, snippet) {
  const text = fs.readFileSync(filePath, "utf8");
  assert.ok(text.includes(snippet), `expected ${path.basename(filePath)} to include: ${snippet}`);
}

function createFixtureCase(cleanup) {
  const { tmpDir, dateDir } = makeTempSessionDir();
  const indexDir = path.join(tmpDir, "index");
  cleanup.push(tmpDir);
  return { tmpDir, dateDir, indexDir };
}

function writeCapturedQueryFixture(dateDir, {
  fileName = "rollout-a.jsonl",
  sessionId = "session-a",
  cwd = DEFAULT_CWD,
  turnId = "turn-a",
  model = DEFAULT_MODEL,
  query,
  queries = [query],
  answer,
  userMessage = null,
} = {}) {
  const responseTimestamp = userMessage
    ? "2026-04-09T15:10:54.000Z"
    : "2026-04-09T15:10:53.000Z";
  const completeTimestamp = userMessage
    ? "2026-04-09T15:10:55.000Z"
    : "2026-04-09T15:10:54.000Z";

  const records = [
    {
      timestamp: "2026-04-09T15:10:51.000Z",
      type: "session_meta",
      payload: { id: sessionId, cwd },
    },
    {
      timestamp: "2026-04-09T15:10:52.000Z",
      type: "turn_context",
      payload: { turn_id: turnId, cwd, model },
    },
  ];

  if (userMessage) {
    records.push({
      timestamp: "2026-04-09T15:10:53.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: userMessage },
    });
  }

  records.push(
    {
      timestamp: responseTimestamp,
      type: "response_item",
      payload: {
        type: "web_search_call",
        status: "completed",
        action: { type: "search", query, queries },
      },
    },
    {
      timestamp: completeTimestamp,
      type: "event_msg",
      payload: { type: "task_complete", turn_id: turnId, last_agent_message: answer },
    }
  );

  writeRollout(dateDir, fileName, records);
}

function writeRepoProjectFixture(dateDir, {
  fileName = "rollout-a.jsonl",
  sessionId = "session-a",
  cwd = DEFAULT_CWD,
  turnId = "turn-a",
  model = DEFAULT_MODEL,
  userMessage = "Review AGENTS guidance for the harness",
  command = 'rg -n "AGENTS" AGENTS.md src/index.js',
  query = "AGENTS",
  paths = ["AGENTS.md", "src/index.js"],
  answer = "Reviewed AGENTS guidance",
  callId = "call-a",
} = {}) {
  writeRollout(dateDir, fileName, [
    {
      timestamp: "2026-04-09T15:10:51.000Z",
      type: "session_meta",
      payload: { id: sessionId, cwd },
    },
    {
      timestamp: "2026-04-09T15:10:52.000Z",
      type: "turn_context",
      payload: { turn_id: turnId, cwd, model },
    },
    {
      timestamp: "2026-04-09T15:10:53.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: userMessage },
    },
    {
      timestamp: "2026-04-09T15:10:54.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        call_id: callId,
        arguments: JSON.stringify({ cmd: command, workdir: cwd }),
      },
    },
    {
      timestamp: "2026-04-09T15:10:55.000Z",
      type: "exec_command_end",
      payload: {
        call_id: callId,
        stdout: "12:AGENTS guidance\n",
        stderr: "",
        parsed_cmd: { kind: "search", query, paths },
      },
    },
    {
      timestamp: "2026-04-09T15:10:56.000Z",
      type: "event_msg",
      payload: { type: "task_complete", turn_id: turnId, last_agent_message: answer },
    },
  ]);
}

function writeLineageFixture(dateDir, { includeContext = false } = {}) {
  writeRollout(dateDir, "rollout-root.jsonl", [
    {
      timestamp: "2026-04-09T15:10:51.000Z",
      type: "session_meta",
      payload: { id: "root-session-id", cwd: DEFAULT_CWD },
    },
    {
      timestamp: "2026-04-09T15:10:52.000Z",
      type: "turn_context",
      payload: { turn_id: "turn-root", cwd: DEFAULT_CWD, model: DEFAULT_MODEL },
    },
    {
      timestamp: "2026-04-09T15:10:53.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        call_id: "call_root",
        arguments: JSON.stringify({ cmd: "sed -n '1,120p' src/app.js", workdir: DEFAULT_CWD }),
      },
    },
    {
      timestamp: "2026-04-09T15:10:53.100Z",
      type: "event_msg",
      payload: {
        type: "exec_command_end",
        call_id: "call_root",
        turn_id: "turn-root",
        command: ["/bin/zsh", "-lc", "sed -n '1,120p' src/app.js"],
        cwd: DEFAULT_CWD,
        parsed_cmd: [{
          type: "read",
          cmd: "sed -n '1,120p' src/app.js",
          path: "src/app.js",
        }],
        aggregated_output: "root\n",
        exit_code: 0,
        duration: { secs: 0, nanos: 1000 },
        status: "completed",
      },
    },
    {
      timestamp: "2026-04-09T15:10:54.000Z",
      type: "event_msg",
      payload: { type: "task_complete", turn_id: "turn-root", last_agent_message: "Root session finished" },
    },
  ]);

  writeRollout(dateDir, "rollout-child.jsonl", [
    {
      timestamp: "2026-04-09T16:10:51.000Z",
      type: "session_meta",
      payload: {
        id: "child-session-id",
        forked_from_id: "root-session-id",
        cwd: DEFAULT_CWD,
        source: {
          subagent: {
            thread_spawn: {
              parent_thread_id: "root-session-id",
              depth: 1,
              agent_nickname: "Helmholtz",
              agent_role: "explorer",
            },
          },
        },
      },
    },
    {
      timestamp: "2026-04-09T16:10:51.100Z",
      type: "session_meta",
      payload: { id: "root-session-id", cwd: DEFAULT_CWD },
    },
    {
      timestamp: "2026-04-09T16:10:52.000Z",
      type: "turn_context",
      payload: { turn_id: "turn-child", cwd: DEFAULT_CWD, model: DEFAULT_MODEL },
    },
    {
      timestamp: "2026-04-09T16:10:53.000Z",
      type: "event_msg",
      payload: { type: "task_complete", turn_id: "turn-child", last_agent_message: "Child session finished" },
    },
  ]);

  if (!includeContext) return;

  writeRollout(dateDir, "rollout-context.jsonl", [
    {
      timestamp: "2026-04-09T17:10:51.000Z",
      type: "session_meta",
      payload: { id: "context-session-id", cwd: DEFAULT_CWD },
    },
    {
      timestamp: "2026-04-09T17:10:52.000Z",
      type: "turn_context",
      payload: { turn_id: "turn-context", cwd: DEFAULT_CWD, model: DEFAULT_MODEL },
    },
    {
      timestamp: "2026-04-09T17:10:53.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        call_id: "call_context",
        arguments: JSON.stringify({ cmd: "sed -n '1,120p' src/app.js", workdir: DEFAULT_CWD }),
      },
    },
    {
      timestamp: "2026-04-09T17:10:53.100Z",
      type: "event_msg",
      payload: {
        type: "exec_command_end",
        call_id: "call_context",
        turn_id: "turn-context",
        command: ["/bin/zsh", "-lc", "sed -n '1,120p' src/app.js"],
        cwd: DEFAULT_CWD,
        parsed_cmd: [{
          type: "read",
          cmd: "sed -n '1,120p' src/app.js",
          path: "src/app.js",
        }],
        aggregated_output: "context\n",
        exit_code: 0,
        duration: { secs: 0, nanos: 1000 },
        status: "completed",
      },
    },
    {
      timestamp: "2026-04-09T17:10:54.000Z",
      type: "event_msg",
      payload: { type: "task_complete", turn_id: "turn-context", last_agent_message: "Context session finished" },
    },
  ]);
}

describe("README command smoke tests", () => {
  const cleanup = [];

  afterEach(() => {
    while (cleanup.length) {
      fs.rmSync(cleanup.pop(), { recursive: true, force: true });
    }
  });

  it("runs the documented npm history overview example against fixture data", () => {
    assertDocIncludes(README_PATH, "npm run history -- overview");

    const { tmpDir, dateDir, indexDir } = createFixtureCase(cleanup);

    writeCapturedQueryFixture(dateDir, {
      query: "dokcer",
      answer: "Feature toggle done",
      userMessage: "Implement feature toggle search",
    });

    const output = runNpmHistory([
      "overview",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);

    assert.match(output, /overview \| sessions=1 \| projects=1 \| extended=0/);
    assert.match(output, /Good limited sessions \(1\)/);
    assert.match(output, /answer: Feature toggle done/);
    assert.match(output, /npm run history -- transcript codex:session-a/);
  });

  it("runs the documented npm history fuzzy captured-query example against fixture data", () => {
    assertDocIncludes(README_PATH, 'npm run history -- search --query "dokcer" --query-mode fuzzy --limit 5');

    const { tmpDir, dateDir, indexDir } = createFixtureCase(cleanup);

    writeCapturedQueryFixture(dateDir, {
      query: "dokcer",
      answer: "Feature toggle done",
    });

    const output = runNpmHistory([
      "search",
      "--query",
      "dokcer",
      "--query-mode",
      "fuzzy",
      "--limit",
      "5",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);

    assert.match(output, /history mode: effective/);
    assert.match(output, /codex:session-a/);
    assert.match(output, /match: query=dokcer/);
    assert.match(output, /match-reasons: query/);
  });

  it("runs the documented compact json captured-query search example against fixture data", () => {
    assertDocIncludes(README_PATH, 'npm run history -- search --query "feature-toggle" --json --pretty --compact');

    const { tmpDir, dateDir, indexDir } = createFixtureCase(cleanup);

    writeCapturedQueryFixture(dateDir, {
      query: "feature-toggle",
      queries: ["feature-toggle", "feature flags"],
      answer: "Feature toggle done",
    });

    const rawOutput = runNpmHistory([
      "search",
      "--query",
      "feature-toggle",
      "--json",
      "--pretty",
      "--compact",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    const output = extractJsonFromCommandOutput(rawOutput);

    assert.strictEqual(output.shape, "compact");
    assert.strictEqual(output.historyMode, "effective");
    assert.strictEqual(output.queryMode, "substring");
    assert.strictEqual(output.total, 1);
    assert.strictEqual(output.sessions.length, 1);
    assert.strictEqual(output.sessions[0].sessionId, "codex:session-a");
    assert.strictEqual(output.sessions[0].cwd, "/repo/a");
    assert.deepStrictEqual(output.sessions[0].matchedQueries, ["feature-toggle"]);
    assert.deepStrictEqual(output.sessions[0].match, {
      kind: "query",
      text: "feature-toggle",
      signalTier: "medium",
    });
    assert.deepStrictEqual(output.sessions[0].matchReasons, ["query"]);
    assert.strictEqual(output.sessions[0].finalAnswerPreview, "Feature toggle done");
  });

  it("runs the documented npm history exact thread-list example against a fake app-server bridge", () => {
    assertDocIncludes(
      README_PATH,
      "npm run history -- threads --sort updated_at --model-provider openai --source-kind sub-agent-thread-spawn"
    );

    const fakeCodexDir = makeFakeCodexDir({
      __default__: {
        data: [
          {
            id: "019d-thread-a",
            preview: "Docs thread",
            modelProvider: "openai",
            createdAt: 1776358310,
            updatedAt: 1776376184,
            status: { type: "notLoaded", activeFlags: [] },
            cwd: "/repo/a",
            cliVersion: "0.119.0-alpha.5",
            source: "cli",
          },
        ],
        nextCursor: "cursor-1",
      },
    });
    cleanup.push(fakeCodexDir);

    const output = runNpmHistory([
      "threads",
      "--limit",
      "2",
      "--sort",
      "updated_at",
      "--model-provider",
      "openai",
      "--source-kind",
      "sub-agent-thread-spawn",
    ], {
      env: withPrependedPath(fakeCodexDir),
    });

    assert.match(output, /source selection: used app-server because this operation is exact bridge-only\./);
    assert.match(output, /codex:019d-thread-a/);
    assert.match(output, /npm run history -- thread codex:019d-thread-a/);
    assert.match(output, /next cursor: cursor-1/);
  });

  it("runs the documented cmem fuzzy captured-query example through the local cmem entrypoint", () => {
    assertDocIncludes(HARNESS_GUIDE_PATH, 'cmem query "dokcer" --fuzzy');

    const { tmpDir, dateDir, indexDir } = createFixtureCase(cleanup);

    writeCapturedQueryFixture(dateDir, {
      query: "dokcer",
      answer: "Feature toggle done",
    });

    const output = runCmem([
      "query",
      "dokcer",
      "--fuzzy",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);

    assert.match(output, /Fuzzy captured query "dokcer" \(1\)/);
    assert.match(output, /match: query=dokcer/);
    assert.match(output, /cmem open codex:session-a/);
  });

  it("runs the documented cmem exact thread-list example through the local cmem entrypoint", () => {
    assertDocIncludes(
      README_PATH,
      "cmem threads --sort updated_at --model-provider openai --source-kind cli"
    );

    const fakeCodexDir = makeFakeCodexDir({
      __default__: {
        data: [
          {
            id: "019d-thread-a",
            preview: "Docs thread",
            modelProvider: "openai",
            createdAt: 1776358310,
            updatedAt: 1776376184,
            status: { type: "notLoaded", activeFlags: [] },
            cwd: "/repo/a",
            cliVersion: "0.119.0-alpha.5",
            source: "cli",
          },
        ],
        nextCursor: "cursor-1",
      },
    });
    cleanup.push(fakeCodexDir);

    const output = runCmem([
      "threads",
      "--limit",
      "2",
      "--sort",
      "updated_at",
      "--model-provider",
      "openai",
      "--source-kind",
      "cli",
    ], {
      env: withPrependedPath(fakeCodexDir),
    });

    assert.match(output, /^cmem threads \(1\)/m);
    assert.match(output, /filters: sort=updated_at  provider=openai  source=cli/);
    assert.match(output, /cmem open codex:019d-thread-a/);
    assert.match(output, /cmem threads --limit 2 --sort updated_at --model-provider openai --source-kind cli --cursor cursor-1/);
  });

  it("runs the documented npm history project recovery example against fixture data", () => {
    assertDocIncludes(README_PATH, 'npm run history -- project --cwd "/Users/you/repo"');

    const { tmpDir, dateDir, indexDir } = createFixtureCase(cleanup);

    writeRepoProjectFixture(dateDir);

    const output = runNpmHistory([
      "project",
      "--cwd",
      "/repo/a",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);

    assert.match(output, /^\/repo\/a \| 2026-04-09T15:10:56.000Z \| history=effective/m);
    assert.match(output, /sessions=1  matched_sessions=1  turns=1  matched_turns=1/);
    assert.match(output, /areas=1/);
    assert.match(output, /AGENTS\.md \| sessions=1 \| turns=1 \| cmd=1 \| search=1/);
    assert.match(output, /command-ops: rg/);
  });

  it("runs the documented cmem repo recovery example through the local cmem entrypoint", () => {
    assertDocIncludes(HARNESS_GUIDE_PATH, "cmem repo \"/Users/you/repo\"");

    const { tmpDir, dateDir, indexDir } = createFixtureCase(cleanup);

    writeRepoProjectFixture(dateDir);

    const output = runCmem([
      "repo",
      "/repo/a",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);

    assert.match(output, /^cmem repo/m);
    assert.match(output, /^\/repo\/a$/m);
    assert.match(output, /updated=2026-04-09 15:10  history=effective  sessions=1  turns=1/);
    assert.match(output, /areas: AGENTS\.md \(turns=1, search=1\)/);
    assert.match(output, /Recent sessions \(1\)/);
    assert.match(output, /cmem open codex:session-a/);
  });

  it("runs the documented npm history workstream recovery example against lineage fixture data", () => {
    assertDocIncludes(
      README_PATH,
      "npm run history -- workstream codex:019d... --family-limit 5 --limit 5 --turn-limit 8"
    );

    const { tmpDir, dateDir, indexDir } = createFixtureCase(cleanup);

    writeLineageFixture(dateDir, { includeContext: true });

    const output = runNpmHistory([
      "workstream",
      "codex:child-session-id",
      "--family-limit",
      "5",
      "--limit",
      "5",
      "--turn-limit",
      "8",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);

    assert.match(
      output,
      /codex:root-session-id \| source=codex:child-session-id \| cwd=\/repo\/a \| family=2 \| peers=1 \| context=1 \| turns=3 \| history=effective/
    );
    assert.match(output, /family peers:/);
    assert.match(output, /codex:child-session-id \| .* \| source \| family/);
    assert.match(
      output,
      /lineage: root=codex:root-session-id depth=1 forked_from=codex:root-session-id parent=codex:root-session-id/
    );
    assert.match(output, /context sessions:/);
    assert.match(output, /codex:context-session-id \| .* \| related=\d+/);
    assert.match(output, /shared-paths: src\/app\.js/);
    assert.match(output, /shared-commands: sed -n '1,120p' src\/app\.js/);
    assert.match(output, /timeline:/);
    assert.match(output, /related: path, command/);
  });

  it("runs the documented npm history family recovery example against lineage fixture data", () => {
    assertDocIncludes(
      README_PATH,
      "npm run history -- family codex:019d... --limit 5 --turn-limit 5"
    );

    const { tmpDir, dateDir, indexDir } = createFixtureCase(cleanup);

    writeLineageFixture(dateDir);

    const output = runNpmHistory([
      "family",
      "codex:child-session-id",
      "--limit",
      "5",
      "--turn-limit",
      "5",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);

    assert.match(
      output,
      /codex:root-session-id \| source=codex:child-session-id \| sessions=2 \| matched_sessions=2 \| matched_turns=2 \| history=effective/
    );
    assert.match(output, /forked=1  subagents=1  max_depth=1/);
    assert.match(output, /sessions:/);
    assert.match(output, /codex:root-session-id \| rollout=rollout-root \| .* \| model=gpt-5\.4/);
    assert.match(output, /lineage: root=codex:root-session-id/);
    assert.match(output, /codex:child-session-id \| rollout=rollout-child \| .* \| model=gpt-5\.4/);
    assert.match(
      output,
      /lineage: root=codex:root-session-id depth=1 forked_from=codex:root-session-id parent=codex:root-session-id/
    );
    assert.match(output, /turns:/);
    assert.match(output, /codex:child-session-id \| turn-child \| completed \| .*$/m);
    assert.match(output, /codex:root-session-id \| turn-root \| completed \| .*$/m);
  });

  it("runs the documented compact json workstream example against lineage fixture data", () => {
    assertDocIncludes(
      README_PATH,
      "npm run history -- workstream codex:019d... --family-limit 3 --limit 3 --turn-limit 6 --json --pretty --compact"
    );

    const { tmpDir, dateDir, indexDir } = createFixtureCase(cleanup);

    writeLineageFixture(dateDir, { includeContext: true });

    const rawOutput = runNpmHistory([
      "workstream",
      "codex:child-session-id",
      "--family-limit",
      "3",
      "--limit",
      "3",
      "--turn-limit",
      "6",
      "--json",
      "--pretty",
      "--compact",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    const output = extractJsonFromCommandOutput(rawOutput);

    assert.strictEqual(output.shape, "compact");
    assert.strictEqual(output.sourceSessionId, "codex:child-session-id");
    assert.strictEqual(output.lineageRootId, "codex:root-session-id");
    assert.strictEqual(output.familySessionCount, 2);
    assert.strictEqual(output.familyPeerCount, 1);
    assert.strictEqual(output.contextSessionCount, 1);
    assert.strictEqual(output.rootSession.sessionId, "codex:root-session-id");
    assert.strictEqual(output.familySessions[0].sessionId, "codex:child-session-id");
    assert.strictEqual(output.contextSessions[0].sessionId, "codex:context-session-id");
    assert.deepStrictEqual(output.contextSessions[0].linkedSessions, ["codex:root-session-id"]);
    assert.deepStrictEqual(output.contextSessions[0].sharedCounts, {
      files: 0,
      paths: 1,
      queries: 0,
      commands: 1,
      tools: 1,
    });
    assert.ok(output.turns.some((turn) => turn.sessionId === "codex:root-session-id" && turn.workstreamRole === "root"));
    assert.ok(output.turns.some((turn) => turn.sessionId === "codex:child-session-id" && turn.workstreamRole === "family"));
    assert.ok(output.turns.some((turn) => turn.sessionId === "codex:context-session-id" && turn.workstreamRole === "context"));
  });

  it("runs the documented compact json query-artifacts example against fixture data", () => {
    assertDocIncludes(
      README_PATH,
      'npm run history -- artifacts --kind query --q "feature-toggle" --json --pretty --compact'
    );

    const { tmpDir, dateDir, indexDir } = createFixtureCase(cleanup);

    writeCapturedQueryFixture(dateDir, {
      query: "feature-toggle",
      queries: ["feature-toggle", "feature flags"],
      answer: "Feature toggle done",
    });

    const rawOutput = runNpmHistory([
      "artifacts",
      "--kind",
      "query",
      "--q",
      "feature-toggle",
      "--json",
      "--pretty",
      "--compact",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    const output = extractJsonFromCommandOutput(rawOutput);

    assert.strictEqual(output.shape, "compact");
    assert.strictEqual(output.kind, "query");
    assert.strictEqual(output.total, 1);
    assert.deepStrictEqual(output.counts, {
      file: 0,
      path: 0,
      path_pattern: 0,
      tool: 1,
      command: 0,
      command_op: 0,
      query: 2,
      error: 0,
    });
    assert.strictEqual(output.artifacts.length, 1);
    assert.deepStrictEqual(output.artifacts[0], {
      kind: "query",
      value: "feature-toggle",
      signalTier: "medium",
      sessionCount: 1,
      lastSeenAt: "2026-04-09T15:10:54.000Z",
    });
  });
});
