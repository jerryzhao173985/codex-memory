const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("node:child_process");
const {
  BRIDGE_CANONICAL_THREAD_SORT_KEYS,
  BRIDGE_CANONICAL_THREAD_SOURCE_KINDS,
} = require("../app-server-thread-contract");

const REPO_ROOT = path.resolve(__dirname, "..");
const CMEM_CLI = path.join(REPO_ROOT, "bin", "cmem.js");
const BRIDGE_THREAD_SORT_HELP_TEXT = `${BRIDGE_CANONICAL_THREAD_SORT_KEYS[0]} or ${BRIDGE_CANONICAL_THREAD_SORT_KEYS[1]}`;
const BRIDGE_THREAD_SOURCE_KIND_HELP_TEXT = BRIDGE_CANONICAL_THREAD_SOURCE_KINDS.join(", ");

function makeTempSessionDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-cmem-cli-"));
  const dateADir = path.join(tmpDir, "2026", "04", "09");
  const dateBDir = path.join(tmpDir, "2026", "04", "10");
  fs.mkdirSync(dateADir, { recursive: true });
  fs.mkdirSync(dateBDir, { recursive: true });
  return { tmpDir, dateADir, dateBDir };
}

function writeRollout(dateDir, fileName, records) {
  fs.writeFileSync(path.join(dateDir, fileName), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

function runCmem(args, options = {}) {
  return execFileSync(process.execPath, [
    CMEM_CLI,
    ...args,
  ], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeFakeCodexDir(threadPages = {}, options = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-cmem-fake-app-server-"));
  const scriptPath = path.join(tmpDir, "codex");
  const script = `#!/usr/bin/env node
const readline = require("node:readline");

const threadPages = ${JSON.stringify(threadPages)};
const archiveResult = ${JSON.stringify(options.archiveResult || null)};
const unarchiveResult = ${JSON.stringify(options.unarchiveResult || null)};
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

rl.on("line", (line) => {
  const raw = String(line || "").trim();
  if (!raw) return;

  const message = JSON.parse(raw);
  if (!message || typeof message !== "object" || typeof message.method !== "string") return;

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

  if (message.method === "thread/archive") {
    send({
      id: message.id,
      result: archiveResult || {
        threadId: message.params && message.params.threadId,
        archived: true,
      },
    });
    return;
  }

  if (message.method === "thread/unarchive") {
    send({
      id: message.id,
      result: unarchiveResult || {
        thread: {
          id: message.params && message.params.threadId,
        },
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

describe("cmem CLI", () => {
  const cleanup = [];

  afterEach(() => {
    while (cleanup.length) {
      fs.rmSync(cleanup.pop(), { recursive: true, force: true });
    }
  });

  it("supports flags before the command and returns compact latest cards", () => {
    const { tmpDir, dateADir, dateBDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Implement feature toggle search" },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call-a",
          arguments: "{\"cmd\":\"rg -n \\\"feature toggle\\\" src/feature.js\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T15:10:55.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-a", last_agent_message: "Feature toggle done" },
      },
    ]);

    writeRollout(dateBDir, "rollout-b.jsonl", [
      {
        timestamp: "2026-04-10T10:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-b", cwd: "/repo/b" },
      },
      {
        timestamp: "2026-04-10T10:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-b", cwd: "/repo/b", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-10T10:10:53.000Z",
        type: "response_item",
        payload: {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "AGENTS.md",
            queries: ["AGENTS.md"],
          },
        },
      },
      {
        timestamp: "2026-04-10T10:10:54.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-b", last_agent_message: "Found AGENTS.md guidance" },
      },
    ]);

    const output = runCmem([
      "--json",
      "latest",
      "--limit",
      "1",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);

    const result = JSON.parse(output);
    assert.strictEqual(result.command, "latest");
    assert.strictEqual(result.sessions.length, 1);
    assert.strictEqual(result.sessions[0].sessionId, "codex:session-b");
    assert.strictEqual(result.sessions[0].cwd, "/repo/b");
    assert.strictEqual(result.sessions[0].answerPreview, "Found AGENTS.md guidance");
    assert.ok(!("pathsReferenced" in result.sessions[0]));
  });

  it("supports date, all, and exact query flows with compact JSON", () => {
    const { tmpDir, dateADir, dateBDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Implement feature toggle search" },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call-a",
          arguments: "{\"cmd\":\"rg -n \\\"feature toggle\\\" src/feature.js\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T15:10:55.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-a", last_agent_message: "Feature toggle done" },
      },
    ]);

    writeRollout(dateBDir, "rollout-b.jsonl", [
      {
        timestamp: "2026-04-10T10:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-b", cwd: "/repo/b" },
      },
      {
        timestamp: "2026-04-10T10:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-b", cwd: "/repo/b", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-10T10:10:53.000Z",
        type: "response_item",
        payload: {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "AGENTS.md",
            queries: ["AGENTS.md"],
          },
        },
      },
      {
        timestamp: "2026-04-10T10:10:54.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-b", last_agent_message: "Found AGENTS.md guidance" },
      },
    ]);

    const byDate = JSON.parse(runCmem([
      "date",
      "2026-04-09",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(byDate.total, 1);
    assert.strictEqual(byDate.sessions[0].sessionId, "codex:session-a");

    const all = JSON.parse(runCmem([
      "all",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(all.total, 2);
    assert.strictEqual(all.sessions.length, 2);

    const query = JSON.parse(runCmem([
      "query",
      "AGENTS.md",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(query.total, 1);
    assert.strictEqual(query.sessions[0].sessionId, "codex:session-b");

    const find = JSON.parse(runCmem([
      "find",
      "feature toggle",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(find.total, 1);
    assert.strictEqual(find.sessions[0].sessionId, "codex:session-a");
  });

  it("supports substring, exact, and fuzzy query matching with truthful labels", () => {
    const { tmpDir, dateADir, dateBDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    const dateCDir = path.join(tmpDir, "2026", "04", "11");
    fs.mkdirSync(dateCDir, { recursive: true });
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "response_item",
        payload: {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "AGENTS.md",
            queries: ["AGENTS.md"],
          },
        },
      },
    ]);

    writeRollout(dateBDir, "rollout-b.jsonl", [
      {
        timestamp: "2026-04-10T10:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-b", cwd: "/repo/b" },
      },
      {
        timestamp: "2026-04-10T10:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-b", cwd: "/repo/b", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-10T10:10:53.000Z",
        type: "response_item",
        payload: {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "AGENTS",
            queries: ["AGENTS"],
          },
        },
      },
    ]);

    writeRollout(dateCDir, "rollout-c.jsonl", [
      {
        timestamp: "2026-04-11T11:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-c", cwd: "/repo/c" },
      },
      {
        timestamp: "2026-04-11T11:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-c", cwd: "/repo/c", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-11T11:10:53.000Z",
        type: "response_item",
        payload: {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "docker",
            queries: ["docker"],
          },
        },
      },
    ]);

    const substringOutput = runCmem([
      "query",
      "AGENTS",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    assert.match(substringOutput, /Captured query match for "AGENTS" \(2\)/);

    const exactResult = JSON.parse(runCmem([
      "query",
      "AGENTS",
      "--exact",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(exactResult.matchMode, "exact");
    assert.strictEqual(exactResult.title, 'Exact captured query "AGENTS"');
    assert.strictEqual(exactResult.total, 1);
    assert.strictEqual(exactResult.sessions[0].sessionId, "codex:session-b");

    const fuzzyResult = JSON.parse(runCmem([
      "query",
      "AGNTS",
      "--fuzzy",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(fuzzyResult.matchMode, "fuzzy");
    assert.strictEqual(fuzzyResult.title, 'Fuzzy captured query "AGNTS"');
    assert.strictEqual(fuzzyResult.total, 2);
    assert.ok(fuzzyResult.sessions.every((session) => session.match && session.match.kind === "query"));
    assert.ok(fuzzyResult.sessions.some((session) => session.match.text === "AGENTS"));
    assert.ok(fuzzyResult.sessions.some((session) => session.match.signalTier === "low"));
    assert.ok(fuzzyResult.sessions.some((session) => session.match.signalTier === "medium"));
    assert.deepStrictEqual(fuzzyResult.querySignalSummary, {
      onlyLowSignal: false,
      examples: [],
    });

    const fuzzyOutput = runCmem([
      "query",
      "AGNTS",
      "--fuzzy",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    assert.match(fuzzyOutput, /match: query=AGENTS\.md \[low-signal\]/);

    const transposeResult = JSON.parse(runCmem([
      "query",
      "dokcer",
      "--fuzzy",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(transposeResult.matchMode, "fuzzy");
    assert.strictEqual(transposeResult.total, 1);
    assert.strictEqual(transposeResult.sessions[0].sessionId, "codex:session-c");
    assert.deepStrictEqual(transposeResult.sessions[0].match, { kind: "query", text: "docker", signalTier: "medium" });
  });

  it("explains when fuzzy captured-query hits are only low-signal filename filters", () => {
    const { tmpDir, dateADir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "response_item",
        payload: {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "AGENTS.md",
            queries: ["AGENTS.md"],
          },
        },
      },
    ]);

    const output = runCmem([
      "query",
      "AGNTS",
      "--fuzzy",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);

    assert.match(output, /match: query=AGENTS\.md \[low-signal\]/);
    assert.match(output, /low-signal filename\/glob filters/);
    assert.match(output, /cmem query <text> --exact/);
    assert.match(output, /cmem find <text> --fuzzy/);

    const jsonOutput = JSON.parse(runCmem([
      "query",
      "AGNTS",
      "--fuzzy",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.deepStrictEqual(jsonOutput.querySignalSummary, {
      onlyLowSignal: true,
      examples: ["AGENTS.md"],
    });
    assert.deepStrictEqual(jsonOutput.sessions[0].match, {
      kind: "query",
      text: "AGENTS.md",
      signalTier: "low",
    });
  });

  it("supports lightweight fuzzy find search over session previews", () => {
    const { tmpDir, dateADir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Review AGENTS guidance for the harness" },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-a", last_agent_message: "Reviewed AGENTS guidance" },
      },
    ]);

    const fuzzyResult = JSON.parse(runCmem([
      "find",
      "AGNTS",
      "--fuzzy",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(fuzzyResult.matchMode, "fuzzy");
    assert.strictEqual(fuzzyResult.title, 'Fuzzy search for "AGNTS"');
    assert.strictEqual(fuzzyResult.total, 1);
    assert.strictEqual(fuzzyResult.sessions[0].sessionId, "codex:session-a");
    assert.deepStrictEqual(fuzzyResult.sessions[0].match, {
      kind: "user",
      text: "Review AGENTS guidance for the harness",
    });

    const output = runCmem([
      "find",
      "AGNTS",
      "--fuzzy",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    assert.match(output, /match: user=Review AGENTS guidance for the harness/);
  });

  it("prints a native front-door resume summary while keeping the bounded resume text", () => {
    const { tmpDir, dateADir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Summarize the harness state" },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-a",
          last_agent_message: "The harness state is summarized and ready to reload.",
        },
      },
    ]);

    const output = runCmem([
      "resume",
      "latest",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
      "--source",
      "rollout",
      "--reload-policy",
      "allow",
    ]);

    assert.match(output, /^cmem resume$/m);
    assert.match(output, /source=rollout/);
    assert.match(output, /Resume text:/);
    assert.match(output, /Goal: Summarize the harness state/);
    assert.match(output, /Try:\n  cmem open codex:session-a\n  cmem note codex:session-a "resume from here"\n  cmem pin codex:session-a/m);
    assert.doesNotMatch(output, /^tool-text=/m);
    assert.doesNotMatch(output, /^compactions=/m);
  });

  it("prints a native front-door transcript view for cmem open", () => {
    const { tmpDir, dateADir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Summarize the harness state" },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-a",
          last_agent_message: "The harness state is summarized and ready to reload.",
        },
      },
    ]);

    const output = runCmem([
      "open",
      "latest",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
      "--source",
      "rollout",
    ]);

    assert.match(output, /^cmem open$/m);
    assert.match(output, /source=rollout/);
    assert.match(output, /view=conversation-first/);
    assert.match(output, /Summarize the harness state/);
    assert.match(output, /Try:\n  cmem resume codex:session-a\n  cmem pin codex:session-a\n  node history\.js transcript codex:session-a --source rollout/m);
    assert.doesNotMatch(output, /^file:/m);
    assert.doesNotMatch(output, /^command-types:/m);
    assert.doesNotMatch(output, /^.*tool=apply_patch.*$/m);
  });

  it("supports an explicit raw timeline mode for cmem open", () => {
    const { tmpDir, dateADir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Inspect the harness timeline" },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call-a",
          arguments: "{\"cmd\":\"git status\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T15:10:55.000Z",
        type: "function_call_output",
        call_id: "call-a",
        output: "On branch main",
      },
      {
        timestamp: "2026-04-09T15:10:56.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-a",
          last_agent_message: "The harness timeline is clear.",
        },
      },
    ]);

    const output = runCmem([
      "open",
      "latest",
      "--timeline",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
      "--source",
      "rollout",
    ]);

    assert.match(output, /view=timeline/);
    assert.match(output, /tool=exec_command/);
    assert.match(output, /command: git status/);
  });

  it("prints native filter summaries for q-filtered cmem open and resume views", () => {
    const { tmpDir, dateADir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Inspect the harness timeline" },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call-a",
          arguments: "{\"cmd\":\"git status\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T15:10:55.000Z",
        type: "function_call_output",
        call_id: "call-a",
        output: "On branch main",
      },
      {
        timestamp: "2026-04-09T15:10:56.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-a",
          last_agent_message: "The harness timeline is clear.",
        },
      },
    ]);

    const openOutput = runCmem([
      "open",
      "latest",
      "--q",
      "git status",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
      "--source",
      "rollout",
    ]);
    assert.match(openOutput, /view=timeline/);
    assert.match(openOutput, /filter: q="git status" matched 1 transcript item; timeline view keeps the matching raw activity visible\./);

    const resumeOutput = runCmem([
      "resume",
      "latest",
      "--q",
      "git status",
      "--reload-policy",
      "allow",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
      "--source",
      "rollout",
    ]);
    assert.match(resumeOutput, /^cmem resume$/m);
    assert.match(resumeOutput, /filter: q="git status" narrowed the resume to 1 turn\./);
  });

  it("shows the simple global install path in help", () => {
    const output = runCmem(["--help"]);
    assert.match(output, /npm install -g \./);
    assert.doesNotMatch(output, /cd codex/);
    assert.match(output, /Exact thread commands still require a working codex CLI on PATH\./);
    assert.match(output, /cmem latest/);
    assert.match(output, /--timeline\s+For cmem open, force the raw recent timeline in plain text/);
    assert.match(output, /--fuzzy\s+Lightweight typo-tolerant search for cmem find\/query/);
    assert.match(output, /--exact\s+Exact captured query match for cmem query/);
    assert.match(output, /--cursor <c>\s+Bridge pagination cursor for cmem threads/);
    assert.match(output, /--q <text>\s+Search\/filter term for cmem open\/resume, or exact thread search for cmem threads/);
    assert.match(
      output,
      new RegExp(`--sort <k>\\s+Bridge thread sort: ${escapeRegExp(BRIDGE_THREAD_SORT_HELP_TEXT)}`)
    );
    assert.match(
      output,
      new RegExp(`canonical kinds: ${escapeRegExp(BRIDGE_THREAD_SOURCE_KIND_HELP_TEXT)}`)
    );
    assert.match(output, /cmem date 2026-04-09/);
    assert.match(output, /bare numbers like 1 and 2 only follow latest-session order/);
  });

  it("rejects missing native exact thread filter values", () => {
    assert.throws(
      () => runCmem(["threads", "--cursor"]),
      /--cursor value is required/
    );
    assert.throws(
      () => runCmem(["threads", "--q"]),
      /--q value is required/
    );
    assert.throws(
      () => runCmem(["threads", "--cwd"]),
      /--cwd value is required/
    );
    assert.throws(
      () => runCmem(["threads", "--sort"]),
      /--sort value is required/
    );
    assert.throws(
      () => runCmem(["threads", "--model-provider"]),
      /--model-provider value is required/
    );
    assert.throws(
      () => runCmem(["threads", "--source-kind"]),
      /--source-kind value is required/
    );
  });

  it("rejects missing values for general cmem flags", () => {
    assert.throws(
      () => runCmem(["--session-dir"]),
      /--session-dir value is required/
    );
    assert.throws(
      () => runCmem(["--index-dir"]),
      /--index-dir value is required/
    );
    assert.throws(
      () => runCmem(["--config"]),
      /--config value is required/
    );
    assert.throws(
      () => runCmem(["--quality"]),
      /--quality value is required/
    );
    assert.throws(
      () => runCmem(["--source"]),
      /--source value is required/
    );
    assert.throws(
      () => runCmem(["--history-mode"]),
      /--history-mode value is required/
    );
    assert.throws(
      () => runCmem(["--reload-policy"]),
      /--reload-policy value is required/
    );
  });

  it("rejects invalid integer values for numeric cmem flags", () => {
    assert.throws(
      () => runCmem(["--limit", "abc"]),
      /--limit must be an integer/
    );
    assert.throws(
      () => runCmem(["threads", "--limit", "1.5"]),
      /--limit must be an integer/
    );
    assert.throws(
      () => runCmem(["--limit", "0"]),
      /--limit must be a positive integer/
    );
    assert.throws(
      () => runCmem(["--limit", "-1"]),
      /--limit must be a positive integer/
    );
  });

  it("prints action hints with the correct ref shape for latest and filtered lists", () => {
    const { tmpDir, dateADir, dateBDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-a", last_agent_message: "Repo A done" },
      },
    ]);

    writeRollout(dateBDir, "rollout-b.jsonl", [
      {
        timestamp: "2026-04-10T10:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-b", cwd: "/repo/b" },
      },
      {
        timestamp: "2026-04-10T10:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-b", cwd: "/repo/b", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-10T10:10:53.000Z",
        type: "response_item",
        payload: {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "AGENTS.md",
            queries: ["AGENTS.md"],
          },
        },
      },
      {
        timestamp: "2026-04-10T10:10:54.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-b", last_agent_message: "Found AGENTS.md guidance" },
      },
    ]);

    const latestOutput = runCmem([
      "latest",
      "--limit",
      "1",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    assert.match(latestOutput, /Try:/);
    assert.match(latestOutput, /cmem open 1/);
    assert.match(latestOutput, /cmem resume 1/);
    assert.match(latestOutput, /cmem pin 1/);
    assert.match(latestOutput, /Tip: Bare numbers like 1 and 2 follow latest-session order\./);

    const findOutput = runCmem([
      "find",
      "AGENTS.md",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    assert.match(findOutput, /cmem open codex:session-b/);
    assert.match(findOutput, /cmem resume codex:session-b/);
    assert.match(findOutput, /cmem pin codex:session-b/);
    assert.match(findOutput, /Tip: Use the printed session id for filtered lists\./);
  });

  it("suggests narrowing filtered multi-repo results with --cwd", () => {
    const { tmpDir, dateADir, dateBDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "response_item",
        payload: {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "AGENTS.md",
            queries: ["AGENTS.md"],
          },
        },
      },
    ]);

    writeRollout(dateBDir, "rollout-b.jsonl", [
      {
        timestamp: "2026-04-10T10:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-b", cwd: "/repo/b" },
      },
      {
        timestamp: "2026-04-10T10:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-b", cwd: "/repo/b", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-10T10:10:53.000Z",
        type: "response_item",
        payload: {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "AGENTS.md",
            queries: ["AGENTS.md"],
          },
        },
      },
    ]);

    const output = runCmem([
      "query",
      "AGENTS.md",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);

    assert.match(output, /Add --cwd \/repo\/b to narrow to one repo\./);
  });

  it("keeps compact latest-session fields intact in overview output", () => {
    const { tmpDir, dateADir, dateBDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-a", last_agent_message: "Repo A done" },
      },
    ]);

    writeRollout(dateBDir, "rollout-b.jsonl", [
      {
        timestamp: "2026-04-10T10:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-b", cwd: "/repo/b" },
      },
      {
        timestamp: "2026-04-10T10:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-b", cwd: "/repo/b", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-10T10:10:53.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Find AGENTS guidance" },
      },
      {
        timestamp: "2026-04-10T10:10:54.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-b", last_agent_message: "Found AGENTS.md guidance" },
      },
    ]);

    runCmem([
      "pin",
      "latest",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    runCmem([
      "note",
      "latest",
      "resume from here",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);

    const overview = JSON.parse(runCmem([
      "--json",
      "--pretty",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));

    assert.strictEqual(overview.command, "overview");
    assert.ok(Array.isArray(overview.latest));
    assert.strictEqual(overview.latest[0].sessionId, "codex:session-b");
    assert.strictEqual(overview.latest[0].answerPreview, "Found AGENTS.md guidance");
    assert.strictEqual(overview.latest[0].bookmarked, true);
    assert.strictEqual(overview.latest[0].note, "resume from here");
  });

  it("can initialize and show native cmem config", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmem-home-"));
    cleanup.push(tmpDir);
    const configPath = path.join(tmpDir, "config.json");

    const init = JSON.parse(runCmem([
      "config",
      "init",
      "--json",
      "--config",
      configPath,
    ]));
    assert.strictEqual(init.created, true);
    assert.strictEqual(init.configPath, configPath);
    assert.ok(fs.existsSync(configPath));

    const shown = JSON.parse(runCmem([
      "config",
      "show",
      "--json",
      "--config",
      configPath,
    ]));
    assert.strictEqual(shown.exists, true);
    assert.strictEqual(shown.configPath, configPath);
    assert.strictEqual(shown.resolved.reloadPolicy, "strict");
    assert.ok(shown.resolved.sessionDir);
    assert.ok(shown.resolved.indexDir);
  });

  it("can recover from a broken config file with config init --force", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmem-home-bad-"));
    cleanup.push(tmpDir);
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, "{ not-valid-json }\n");

    const repaired = JSON.parse(runCmem([
      "config",
      "init",
      "--force",
      "--json",
      "--config",
      configPath,
    ]));
    assert.strictEqual(repaired.created, true);

    const shown = JSON.parse(runCmem([
      "config",
      "show",
      "--json",
      "--config",
      configPath,
    ]));
    assert.strictEqual(shown.exists, true);
    assert.strictEqual(shown.config.version, 1);
  });

  it("uses ~/.cmem defaults without overriding explicit CLI args", () => {
    const { tmpDir, dateADir, dateBDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    const cmemHome = path.join(tmpDir, "cmem-home");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-a", last_agent_message: "Repo A done" },
      },
    ]);

    writeRollout(dateBDir, "rollout-b.jsonl", [
      {
        timestamp: "2026-04-10T10:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-b", cwd: "/repo/b" },
      },
      {
        timestamp: "2026-04-10T10:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-b", cwd: "/repo/b", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-10T10:10:53.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-b", last_agent_message: "Repo B done" },
      },
    ]);

    writeRollout(dateBDir, "rollout-c.jsonl", [
      {
        timestamp: "2026-04-10T10:12:51.000Z",
        type: "session_meta",
        payload: { id: "session-c", cwd: "/repo/c" },
      },
      {
        timestamp: "2026-04-10T10:12:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-c", cwd: "/repo/c", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-10T10:12:53.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-c", last_agent_message: "Repo C done" },
      },
    ]);

    fs.mkdirSync(cmemHome, { recursive: true });
    fs.writeFileSync(path.join(cmemHome, "config.json"), `${JSON.stringify({
      version: 1,
      paths: {
        sessionDir: tmpDir,
        indexDir,
      },
      defaults: {
        cwd: "/repo/a",
        limit: 1,
        source: "auto",
        historyMode: "effective",
        reloadPolicy: "strict",
      },
    }, null, 2)}\n`);

    const configDefault = JSON.parse(runCmem([
      "latest",
      "--json",
    ], {
      env: { ...process.env, CMEM_HOME: cmemHome },
    }));
    assert.strictEqual(configDefault.sessions.length, 1);
    assert.strictEqual(configDefault.sessions[0].cwd, "/repo/a");

    const cliOverride = JSON.parse(runCmem([
      "latest",
      "--json",
      "--cwd",
      "/repo/b",
      "--limit",
      "2",
    ], {
      env: { ...process.env, CMEM_HOME: cmemHome },
    }));
    assert.strictEqual(cliOverride.sessions.length, 1);
    assert.strictEqual(cliOverride.sessions[0].cwd, "/repo/b");
  });

  it("lets latest positional counts override configured default limits", () => {
    const { tmpDir, dateADir, dateBDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    const cmemHome = path.join(tmpDir, "cmem-home");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-a", last_agent_message: "Repo A done" },
      },
    ]);

    writeRollout(dateBDir, "rollout-b.jsonl", [
      {
        timestamp: "2026-04-10T10:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-b", cwd: "/repo/b" },
      },
      {
        timestamp: "2026-04-10T10:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-b", cwd: "/repo/b", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-10T10:10:53.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-b", last_agent_message: "Repo B done" },
      },
    ]);

    writeRollout(dateBDir, "rollout-c.jsonl", [
      {
        timestamp: "2026-04-10T10:12:51.000Z",
        type: "session_meta",
        payload: { id: "session-c", cwd: "/repo/c" },
      },
      {
        timestamp: "2026-04-10T10:12:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-c", cwd: "/repo/c", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-10T10:12:53.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-c", last_agent_message: "Repo C done" },
      },
    ]);

    fs.mkdirSync(cmemHome, { recursive: true });
    fs.writeFileSync(path.join(cmemHome, "config.json"), `${JSON.stringify({
      version: 1,
      paths: {
        sessionDir: tmpDir,
        indexDir,
      },
      defaults: {
        cwd: "",
        limit: 1,
        source: "auto",
        historyMode: "effective",
        reloadPolicy: "strict",
      },
    }, null, 2)}\n`);

    const positionalOverride = JSON.parse(runCmem([
      "latest",
      "3",
      "--json",
    ], {
      env: { ...process.env, CMEM_HOME: cmemHome },
    }));
    assert.strictEqual(positionalOverride.sessions.length, 3);
    assert.deepStrictEqual(
      positionalOverride.sessions.map((session) => session.cwd),
      ["/repo/c", "/repo/b", "/repo/a"]
    );

    const explicitLimit = JSON.parse(runCmem([
      "latest",
      "3",
      "--json",
      "--limit",
      "2",
    ], {
      env: { ...process.env, CMEM_HOME: cmemHome },
    }));
    assert.strictEqual(explicitLimit.sessions.length, 2);
    assert.deepStrictEqual(
      explicitLimit.sessions.map((session) => session.cwd),
      ["/repo/c", "/repo/b"]
    );
  });

  it("can set and unset config values from the CLI", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmem-config-set-"));
    cleanup.push(tmpDir);
    const configPath = path.join(tmpDir, "config.json");

    runCmem(["config", "init", "--config", configPath]);

    const setLimit = JSON.parse(runCmem([
      "config",
      "set",
      "limit",
      "25",
      "--json",
      "--config",
      configPath,
    ]));
    assert.strictEqual(setLimit.resolved.limit, 25);

    const setIndex = JSON.parse(runCmem([
      "config",
      "set",
      "index-dir",
      "~/.cmem/index",
      "--json",
      "--config",
      configPath,
    ]));
    assert.strictEqual(setIndex.config.paths.indexDir, "~/.cmem/index");

    const unsetCwd = JSON.parse(runCmem([
      "config",
      "unset",
      "cwd",
      "--json",
      "--config",
      configPath,
    ]));
    assert.strictEqual(unsetCwd.config.defaults.cwd, "");
  });

  it("can save the current repo with cmem use", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmem-use-"));
    cleanup.push(tmpDir);
    const configPath = path.join(tmpDir, "config.json");

    const used = JSON.parse(runCmem([
      "use",
      process.cwd(),
      "--json",
      "--config",
      configPath,
    ]));
    assert.strictEqual(used.cwd, process.cwd());
    assert.strictEqual(used.resolved.cwd, process.cwd());

    const shown = JSON.parse(runCmem([
      "config",
      "show",
      "--json",
      "--config",
      configPath,
    ]));
    assert.strictEqual(shown.resolved.cwd, process.cwd());
  });

  it("prints a concise native repo summary by default and keeps json output for full project data", () => {
    const { tmpDir, dateADir, dateBDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Fix parser output" },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call-a",
          arguments: "{\"cmd\":\"sed -n '1,40p' src/parser.js\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T15:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call-patch",
          turn_id: "turn-a",
          success: true,
          changes: {
            "/repo/a/src/parser.js": { type: "update" },
          },
        },
      },
      {
        timestamp: "2026-04-09T15:10:56.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-a", last_agent_message: "Parser output fixed" },
      },
    ]);

    writeRollout(dateBDir, "rollout-b.jsonl", [
      {
        timestamp: "2026-04-10T10:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-b", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-10T10:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-b", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-10T10:10:53.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Review harness README" },
      },
      {
        timestamp: "2026-04-10T10:10:54.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-b", last_agent_message: "README reviewed" },
      },
    ]);

    const output = runCmem([
      "repo",
      "/repo/a",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);

    assert.match(output, /^cmem repo/m);
    assert.match(output, /models: gpt-5\.4 \(2\)/);
    assert.match(output, /tools: exec_command \(1\)/);
    assert.match(output, /files: src\/parser\.js \(1\)/);
    assert.match(output, /Recent sessions \(2\)/);
    assert.match(output, /cmem open codex:session-b/);
    assert.match(output, /Next:\n  cmem latest --cwd \/repo\/a\n  cmem all --cwd \/repo\/a/);

    const json = JSON.parse(runCmem([
      "repo",
      "/repo/a",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(json.cwd, "/repo/a");
    assert.strictEqual(json.sessionCount, 2);
    assert.ok(Array.isArray(json.topFiles));
  });

  it("prints a concise native thread summary with repo narrowing and next commands", () => {
    const { tmpDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    const fakeCodexDir = makeFakeCodexDir({
      __default__: {
        data: [
          {
            id: "019d-thread-a",
            preview: "Understand deeply for meof the whole ptojecy and everything",
            modelProvider: "openai",
            createdAt: 1776358310,
            updatedAt: 1776376184,
            status: { type: "notLoaded", activeFlags: [] },
            cwd: "/repo/a",
            cliVersion: "0.119.0-alpha.5",
            source: "cli",
            gitInfo: {
              branch: "master",
              sha: "84cbd9d024712dc7fdfa2bc6ac2c6bfa9220c1cf",
            },
          },
          {
            id: "019d-thread-b",
            preview: "Investigate disk usage and storage locations",
            modelProvider: "openai",
            createdAt: 1776202255,
            updatedAt: 1776202291,
            status: { type: "notLoaded", activeFlags: [] },
            cwd: "/repo/b",
            cliVersion: "0.119.0-alpha.5",
            source: "vscode",
          },
        ],
        nextCursor: "cursor-1",
      },
      "cursor-1": {
        data: [
          {
            id: "019d-thread-c",
            preview: "Archived thread cleanup pass",
            modelProvider: "openai",
            createdAt: 1776115800,
            updatedAt: 1776115900,
            status: { type: "notLoaded", activeFlags: [] },
            cwd: "/repo/a",
            cliVersion: "0.119.0-alpha.5",
            source: "cli",
            name: "Archived cleanup",
          },
        ],
        nextCursor: null,
      },
    });
    cleanup.push(tmpDir, fakeCodexDir);

    const output = runCmem([
      "threads",
      "--limit",
      "2",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ], {
      env: {
        ...process.env,
        PATH: `${fakeCodexDir}:${process.env.PATH}`,
      },
    });

    assert.match(output, /^cmem threads \(2\)/m);
    assert.match(output, /source: exact app-server thread list/);
    assert.match(output, /1\. codex:019d-thread-a .*status=notLoaded/);
    assert.match(output, /provider=openai  source=cli  cli=0\.119\.0-alpha\.5/);
    assert.match(output, /preview: Understand deeply for meof the whole ptojecy and everything/);
    assert.match(output, /git: master @ 84cbd9d02471/);
    assert.match(output, /Try:\n  cmem open codex:019d-thread-a\n  cmem resume codex:019d-thread-a\n  node history\.js thread codex:019d-thread-a\n  cmem archive codex:019d-thread-a/m);
    assert.match(output, /Tip: Add --cwd \/repo\/a to narrow to one repo\./);
    assert.match(output, /Next:\n  cmem threads --limit 2 --cursor cursor-1\n  cmem threads --limit 2 --archived/m);
  });

  it("keeps common thread filters on the native cmem threads front door", () => {
    const { tmpDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    const fakeCodexDir = makeFakeCodexDir({
      __default__: {
        data: [
          {
            id: "019d-thread-a",
            preview: "Understand deeply for meof the whole ptojecy and everything",
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
    cleanup.push(tmpDir, fakeCodexDir);

    const output = runCmem([
      "threads",
      "--limit",
      "2",
      "--q",
      "backend",
      "--sort",
      "updated_at",
      "--model-provider",
      "openai",
      "--source-kind",
      "cli",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ], {
      env: {
        ...process.env,
        PATH: `${fakeCodexDir}:${process.env.PATH}`,
      },
    });

    assert.match(output, /^cmem threads \(1\)/m);
    assert.match(output, /filters: q=backend  sort=updated_at  provider=openai  source=cli/);
    assert.match(output, /Next:\n  cmem threads --limit 2 --q backend --sort updated_at --model-provider openai --source-kind cli --cursor cursor-1\n  cmem threads --limit 2 --q backend --sort updated_at --model-provider openai --source-kind cli --archived/m);
  });

  it("supports native thread cursor paging and archived actions", () => {
    const { tmpDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    const fakeCodexDir = makeFakeCodexDir({
      __default__: {
        data: [],
        nextCursor: null,
      },
      "cursor-1": {
        data: [
          {
            id: "019d-thread-c",
            preview: "Archived thread cleanup pass",
            modelProvider: "openai",
            createdAt: 1776115800,
            updatedAt: 1776115900,
            status: { type: "notLoaded", activeFlags: [] },
            cwd: "/repo/a",
            cliVersion: "0.119.0-alpha.5",
            source: "cli",
            name: "Archived cleanup",
          },
        ],
        nextCursor: null,
      },
    });
    cleanup.push(tmpDir, fakeCodexDir);

    const output = runCmem([
      "threads",
      "--limit",
      "1",
      "--cursor",
      "cursor-1",
      "--archived",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ], {
      env: {
        ...process.env,
        PATH: `${fakeCodexDir}:${process.env.PATH}`,
      },
    });

    assert.match(output, /filters: cursor=cursor-1  archived=true/);
    assert.match(output, /name: Archived cleanup/);
    assert.match(output, /Try:\n  cmem open codex:019d-thread-c\n  cmem resume codex:019d-thread-c\n  node history\.js thread codex:019d-thread-c\n  cmem unarchive codex:019d-thread-c/m);
    assert.doesNotMatch(output, /\nNext:\n/);
  });

  it("prints native archive and unarchive results for exact threads", () => {
    const { tmpDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    const fakeCodexDir = makeFakeCodexDir({}, {
      archiveResult: {
        threadId: "019d-thread-a",
        archived: true,
      },
      unarchiveResult: {
        thread: {
          id: "019d-thread-a",
          preview: "Understand deeply for meof the whole ptojecy and everything",
          modelProvider: "openai",
          createdAt: 1776358310,
          updatedAt: 1776376184,
          status: { type: "notLoaded", activeFlags: [] },
          cwd: "/repo/a",
          cliVersion: "0.119.0-alpha.5",
          source: "cli",
          gitInfo: {
            branch: "master",
            sha: "84cbd9d024712dc7fdfa2bc6ac2c6bfa9220c1cf",
          },
          name: "Restored thread",
        },
      },
    });
    cleanup.push(tmpDir, fakeCodexDir);

    const archiveOutput = runCmem([
      "archive",
      "codex:019d-thread-a",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ], {
      env: {
        ...process.env,
        PATH: `${fakeCodexDir}:${process.env.PATH}`,
      },
    });

    assert.match(archiveOutput, /^Archived thread/m);
    assert.match(archiveOutput, /codex:019d-thread-a \| archived=true/);
    assert.match(archiveOutput, /Next:\n  cmem threads --archived\n  cmem unarchive codex:019d-thread-a\n  node history\.js thread codex:019d-thread-a/m);
    assert.doesNotMatch(archiveOutput, /source selection:/);

    const unarchiveOutput = runCmem([
      "unarchive",
      "codex:019d-thread-a",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ], {
      env: {
        ...process.env,
        PATH: `${fakeCodexDir}:${process.env.PATH}`,
      },
    });

    assert.match(unarchiveOutput, /^Unarchived thread/m);
    assert.match(unarchiveOutput, /codex:019d-thread-a .*status=notLoaded/);
    assert.match(unarchiveOutput, /name: Restored thread/);
    assert.match(unarchiveOutput, /Try:\n  cmem open codex:019d-thread-a\n  cmem resume codex:019d-thread-a\n  cmem archive codex:019d-thread-a\n  node history\.js thread codex:019d-thread-a/m);
    assert.match(unarchiveOutput, /Next:\n  cmem threads --cwd \/repo\/a\n  cmem threads\n  cmem threads --archived/m);
    assert.doesNotMatch(unarchiveOutput, /source selection:/);
  });

  it("reports native status with config, index, and bridge health", () => {
    const { tmpDir, dateADir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-a", last_agent_message: "Repo A done" },
      },
    ]);

    const status = JSON.parse(runCmem([
      "status",
      "--json",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(status.command, "status");
    assert.strictEqual(status.config.loaded, false);
    assert.strictEqual(status.paths.sessionDir, tmpDir);
    assert.strictEqual(status.paths.indexDir, indexDir);
    assert.strictEqual(status.index.sessionCount, 1);
    assert.ok(typeof status.bridge.ok === "boolean");
  });

  it("explains when status is using built-in defaults because config is not created yet", () => {
    const { tmpDir, dateADir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    const cmemHome = path.join(tmpDir, "cmem-home");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-a", last_agent_message: "Repo A done" },
      },
    ]);

    const output = runCmem([
      "status",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ], {
      env: { ...process.env, CMEM_HOME: cmemHome },
    });

    assert.match(output, /config: default-only .*not created yet/);
    assert.match(output, /defaults: limit=10  source=auto  history=effective  reload=strict/);
    assert.match(output, /Next:\n  cmem config init/);
  });

  it("guides the user when saved and bookmark lists are empty", () => {
    const { tmpDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    const savedOutput = runCmem([
      "saved",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    assert.match(savedOutput, /Saved sessions \(0\)/);
    assert.match(savedOutput, /No sessions found\./);
    assert.match(savedOutput, /cmem pin latest/);
    assert.match(savedOutput, /cmem note latest "resume from here"/);
    assert.match(savedOutput, /cmem tag latest important/);

    const bookmarksOutput = runCmem([
      "bookmarks",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    assert.match(bookmarksOutput, /Bookmarked sessions \(0\)/);
    assert.match(bookmarksOutput, /No sessions found\./);
    assert.match(bookmarksOutput, /cmem pin latest/);
    assert.match(bookmarksOutput, /cmem saved/);
  });

  it("delegates cmem doctor to the native harness doctor surface", () => {
    const { tmpDir, dateADir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-a", last_agent_message: "Repo A done" },
      },
    ]);

    const doctor = JSON.parse(runCmem([
      "doctor",
      "--json",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(doctor.sessionCount, 1);
    assert.strictEqual(doctor.total, 1);
    assert.ok(Array.isArray(doctor.files));
    assert.ok(doctor.files.length >= 1);
  });

  it("supports simple saved-session flows with bookmarks, tags, notes, and saved-session listing", () => {
    const { tmpDir, dateADir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Investigate AGENTS.md handling" },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-a", last_agent_message: "Done" },
      },
    ]);

    const pinned = JSON.parse(runCmem([
      "pin",
      "latest",
      "--json",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(pinned.command, "pin");
    assert.strictEqual(pinned.session.sessionId, "codex:session-a");
    assert.strictEqual(pinned.session.bookmarked, true);

    const noted = JSON.parse(runCmem([
      "note",
      "latest",
      "resume from here",
      "--json",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(noted.command, "note");
    assert.strictEqual(noted.session.note, "resume from here");

    const tagged = JSON.parse(runCmem([
      "tag",
      "latest",
      "important",
      "--json",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(tagged.command, "tag");
    assert.deepStrictEqual(tagged.session.tags, ["important"]);

    const status = JSON.parse(runCmem([
      "status",
      "--json",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(status.index.annotatedSessions, 1);
    assert.strictEqual(status.index.bookmarkedSessions, 1);

    const bookmarks = JSON.parse(runCmem([
      "bookmarks",
      "--json",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(bookmarks.command, "bookmarks");
    assert.strictEqual(bookmarks.total, 1);
    assert.strictEqual(bookmarks.sessions[0].bookmarked, true);
    assert.strictEqual(bookmarks.sessions[0].note, "resume from here");
    assert.deepStrictEqual(bookmarks.sessions[0].tags, ["important"]);

    const unpinned = JSON.parse(runCmem([
      "unpin",
      "latest",
      "--json",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(unpinned.command, "unpin");
    assert.strictEqual(unpinned.session.bookmarked, false);

    const bookmarksAfter = JSON.parse(runCmem([
      "bookmarks",
      "--json",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(bookmarksAfter.total, 0);

    const saved = JSON.parse(runCmem([
      "saved",
      "--json",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(saved.command, "saved");
    assert.strictEqual(saved.total, 1);
    assert.strictEqual(saved.sessions[0].saved, true);
    assert.strictEqual(saved.sessions[0].bookmarked, false);
    assert.strictEqual(saved.sessions[0].note, "resume from here");
    assert.deepStrictEqual(saved.sessions[0].tags, ["important"]);

    const clearedNote = JSON.parse(runCmem([
      "clear-note",
      "latest",
      "--json",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(clearedNote.command, "clear-note");
    assert.strictEqual(clearedNote.session.note, "");

    const untagged = JSON.parse(runCmem([
      "untag",
      "latest",
      "important",
      "--json",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(untagged.command, "untag");
    assert.deepStrictEqual(untagged.session.tags, []);

    const savedAfter = JSON.parse(runCmem([
      "saved",
      "--json",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(savedAfter.total, 0);
  });

  it("orders manual-memory sessions by bookmark priority and manual update time", () => {
    const { tmpDir, dateADir, dateBDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T09:00:00.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T09:00:01.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T09:00:02.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-a", last_agent_message: "Older session" },
      },
    ]);

    writeRollout(dateBDir, "rollout-b.jsonl", [
      {
        timestamp: "2026-04-10T09:00:00.000Z",
        type: "session_meta",
        payload: { id: "session-b", cwd: "/repo/b" },
      },
      {
        timestamp: "2026-04-10T09:00:01.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-b", cwd: "/repo/b", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-10T09:00:02.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-b", last_agent_message: "Newer session" },
      },
    ]);

    runCmem([
      "pin",
      "codex:session-b",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    runCmem([
      "pin",
      "codex:session-a",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    runCmem([
      "note",
      "codex:session-b",
      "keep as note too",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);

    const bookmarks = JSON.parse(runCmem([
      "bookmarks",
      "--json",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(bookmarks.total, 2);
    assert.strictEqual(bookmarks.sessions[0].sessionId, "codex:session-b");
    assert.strictEqual(bookmarks.sessions[1].sessionId, "codex:session-a");
    assert.ok(bookmarks.sessions[0].manualUpdatedAt);

    runCmem([
      "unpin",
      "codex:session-b",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);

    const saved = JSON.parse(runCmem([
      "saved",
      "--json",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(saved.total, 2);
    assert.strictEqual(saved.sessions[0].sessionId, "codex:session-a");
    assert.strictEqual(saved.sessions[0].bookmarked, true);
    assert.strictEqual(saved.sessions[1].sessionId, "codex:session-b");
    assert.strictEqual(saved.sessions[1].bookmarked, false);
    assert.strictEqual(saved.sessions[1].note, "keep as note too");
  });

  it("resolves saved and bookmark refs in native mutation commands", () => {
    const { tmpDir, dateADir, dateBDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateADir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T08:00:00.000Z",
        type: "session_meta",
        payload: { id: "session-a", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T08:00:01.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-a", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T08:00:02.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-a", last_agent_message: "Older saved target" },
      },
    ]);

    writeRollout(dateBDir, "rollout-b.jsonl", [
      {
        timestamp: "2026-04-10T08:00:00.000Z",
        type: "session_meta",
        payload: { id: "session-b", cwd: "/repo/b" },
      },
      {
        timestamp: "2026-04-10T08:00:01.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-b", cwd: "/repo/b", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-10T08:00:02.000Z",
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-b", last_agent_message: "Bookmarked target" },
      },
    ]);

    runCmem([
      "note",
      "codex:session-a",
      "saved target",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    runCmem([
      "pin",
      "codex:session-b",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);

    const taggedSaved = JSON.parse(runCmem([
      "tag",
      "saved",
      "top",
      "--json",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(taggedSaved.session.sessionId, "codex:session-b");
    assert.deepStrictEqual(taggedSaved.session.tags, ["top"]);

    const taggedSavedSecond = JSON.parse(runCmem([
      "tag",
      "saved:2",
      "second",
      "--json",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(taggedSavedSecond.session.sessionId, "codex:session-a");
    assert.deepStrictEqual(taggedSavedSecond.session.tags, ["second"]);

    const notedBookmark = JSON.parse(runCmem([
      "note",
      "bookmark",
      "bookmark note",
      "--json",
      "--no-config",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(notedBookmark.session.sessionId, "codex:session-b");
    assert.strictEqual(notedBookmark.session.note, "bookmark note");
  });

  it("supports front-door aliases, latest:N refs, and uncapped find results", () => {
    const { tmpDir, dateADir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    for (let index = 1; index <= 12; index += 1) {
      const minute = String(index).padStart(2, "0");
      writeRollout(dateADir, `rollout-2026-04-09T15-${minute}-00-alias-${minute}.jsonl`, [
        {
          timestamp: `2026-04-09T15:${minute}:00.000Z`,
          type: "session_meta",
          payload: { id: `alias-session-${minute}`, cwd: "/repo/alias" },
        },
        {
          timestamp: `2026-04-09T15:${minute}:01.000Z`,
          type: "turn_context",
          payload: { turn_id: `turn-${minute}`, cwd: "/repo/alias", model: "gpt-5.4" },
        },
        {
          timestamp: `2026-04-09T15:${minute}:02.000Z`,
          type: "event_msg",
          payload: { type: "user_message", message: `alias probe request ${minute}` },
        },
        {
          timestamp: `2026-04-09T15:${minute}:03.000Z`,
          type: "event_msg",
          payload: { type: "task_complete", turn_id: `turn-${minute}`, last_agent_message: `alias answer ${minute}` },
        },
      ]);
    }

    const shared = ["--no-config", "--session-dir", tmpDir, "--index-dir", indexDir];

    // `search` aliases `find`, and default results are NOT capped at 10.
    const searchResult = JSON.parse(runCmem(["search", "alias probe", "--json", ...shared]));
    assert.strictEqual(searchResult.command, "find");
    assert.strictEqual(searchResult.total, 12);
    assert.strictEqual(searchResult.sessions.length, 12);

    // An explicit --limit is still honored.
    const limitedResult = JSON.parse(runCmem(["find", "alias probe", "--limit", "2", "--json", ...shared]));
    assert.strictEqual(limitedResult.sessions.length, 2);

    // `on` aliases `date` and honors an explicit --limit.
    const onResult = JSON.parse(runCmem(["on", "2026-04-09", "--limit", "3", "--json", ...shared]));
    assert.strictEqual(onResult.command, "date");
    assert.strictEqual(onResult.total, 12);
    assert.strictEqual(onResult.sessions.length, 3);

    // `project` aliases `repo`.
    const projectResult = JSON.parse(runCmem(["project", "/repo/alias", "--json", ...shared]));
    assert.strictEqual(projectResult.cwd, "/repo/alias");

    // `latest:N` refs resolve (case-insensitively) to the Nth latest session.
    const pinned = JSON.parse(runCmem(["pin", "LATEST:2", "--json", ...shared]));
    assert.strictEqual(pinned.session.sessionId, "codex:alias-session-11");

    // Unknown flags swallow their value so it never leaks into positional text.
    const noted = JSON.parse(runCmem(["note", "latest", "keep this note", "--mystery-flag", "stray-value", "--json", ...shared]));
    assert.strictEqual(noted.session.note, "keep this note");
  });

  it("fails loudly when the config file is corrupt", () => {
    const { tmpDir } = makeTempSessionDir();
    cleanup.push(tmpDir);
    const configPath = path.join(tmpDir, "config.json");
    fs.writeFileSync(configPath, "{ not valid json");

    assert.throws(
      () => runCmem(["latest", "--config", configPath, "--session-dir", tmpDir, "--index-dir", path.join(tmpDir, "index")]),
      (err) => /invalid cmem config/.test(String(err.stderr || err.message))
    );
  });
});
