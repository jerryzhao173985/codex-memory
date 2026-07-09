const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("node:child_process");
const {
  buildBridgeMetadataPatchFromArgs,
  buildBridgeThreadListHints,
  formatQueryDisplayValue,
  formatQueryValueList,
  getHistoryCliInvocationCommand,
  normalizeBridgeThreadMemoryModeArgument,
  parseArgs,
  shouldPrintSourceSelection
} = require("../history");
const {
  BRIDGE_CANONICAL_THREAD_SORT_KEYS,
  BRIDGE_CANONICAL_THREAD_SOURCE_KINDS,
} = require("../app-server-thread-contract");

const { formatChoiceList } = require("../cli-text");

const REPO_ROOT = path.resolve(__dirname, "..");
const HISTORY_CLI = path.join(REPO_ROOT, "history.js");
const BRIDGE_THREAD_SORT_HELP_TEXT = formatChoiceList(BRIDGE_CANONICAL_THREAD_SORT_KEYS);
const BRIDGE_THREAD_SOURCE_KIND_HELP_TEXT = BRIDGE_CANONICAL_THREAD_SOURCE_KINDS.join(", ");

function makeTempSessionDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-history-cli-"));
  const dateDir = path.join(tmpDir, "2026", "04", "09");
  fs.mkdirSync(dateDir, { recursive: true });
  return { tmpDir, dateDir };
}

function writeRollout(dateDir, fileName, records) {
  fs.writeFileSync(path.join(dateDir, fileName), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

function runHistory(args, options = {}) {
  return execFileSync(process.execPath, [
    HISTORY_CLI,
    ...args,
  ], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function runHistoryFailure(args, options = {}) {
  try {
    runHistory(args, options);
  } catch (err) {
    return err;
  }
  assert.fail(`expected history CLI to fail: ${args.join(" ")}`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("history CLI", () => {
  const cleanup = [];

  afterEach(() => {
    while (cleanup.length) {
      fs.rmSync(cleanup.pop(), { recursive: true, force: true });
    }
  });

  it("derives display commands for direct, parent-repo, and npm-script usage", () => {
    assert.strictEqual(
      getHistoryCliInvocationCommand({
        scriptPath: HISTORY_CLI,
        cwd: REPO_ROOT,
      }),
      "node history.js"
    );
    assert.strictEqual(
      getHistoryCliInvocationCommand({
        scriptPath: HISTORY_CLI,
        cwd: path.dirname(REPO_ROOT),
      }),
      `node ${path.basename(REPO_ROOT)}/history.js`
    );
    assert.strictEqual(
      getHistoryCliInvocationCommand({
        scriptPath: HISTORY_CLI,
        cwd: REPO_ROOT,
        npmLifecycleEvent: "history",
      }),
      "npm run history --"
    );
  });

  it("builds precise bridge metadata patches from CLI args", () => {
    assert.deepStrictEqual(
      buildBridgeMetadataPatchFromArgs(parseArgs([
        "metadata",
        "codex:019d-thread",
        "--git-branch",
        "release/main",
        "--clear-git-sha",
        "--git-origin-url",
        "https://example.test/repo.git",
      ])),
      {
        gitInfo: {
          branch: "release/main",
          sha: null,
          originUrl: "https://example.test/repo.git",
        },
      }
    );
    assert.strictEqual(
      buildBridgeMetadataPatchFromArgs(parseArgs([
        "metadata",
        "codex:019d-thread",
      ])),
      null
    );
    assert.throws(
      () => buildBridgeMetadataPatchFromArgs(parseArgs([
        "metadata",
        "codex:019d-thread",
        "--git-branch",
        "   ",
      ])),
      /--git-branch value is required/
    );
  });

  it("normalizes exact bridge memory mode arguments", () => {
    assert.strictEqual(
      normalizeBridgeThreadMemoryModeArgument(parseArgs([
        "memory-mode",
        "codex:019d-thread",
        "--mode",
        "disabled",
      ]).mode),
      "disabled"
    );
    assert.strictEqual(
      normalizeBridgeThreadMemoryModeArgument(" ENABLED "),
      "enabled"
    );
    assert.throws(
      () => normalizeBridgeThreadMemoryModeArgument("polluted"),
      /memory mode must be enabled or disabled/
    );
  });

  it("parses exact bridge thread-list filters for upstream app-server parity", () => {
    assert.deepStrictEqual(
      parseArgs([
        "threads",
        "--sort",
        "updated_at",
        "--model-provider",
        "openai",
        "--model-provider",
        "anthropic",
        "--source-kind",
        "sub-agent-thread-spawn",
        "--source-kind",
        "cli",
      ]),
      {
        command: "threads",
        json: false,
        pretty: false,
        sortKey: "updated_at",
        modelProviders: ["openai", "anthropic"],
        sourceKinds: ["sub-agent-thread-spawn", "cli"],
      }
    );
  });

  it("rejects missing exact bridge thread-list filter values", () => {
    assert.throws(
      () => parseArgs([
        "threads",
        "--cursor",
      ]),
      /--cursor value is required/
    );
    assert.throws(
      () => parseArgs([
        "threads",
        "--q",
      ]),
      /--q value is required/
    );
    assert.throws(
      () => parseArgs([
        "threads",
        "--cwd",
      ]),
      /--cwd value is required/
    );
    assert.throws(
      () => parseArgs([
        "threads",
        "--sort",
      ]),
      /--sort value is required/
    );
    assert.throws(
      () => parseArgs([
        "threads",
        "--sort",
        "--source-kind",
        "cli",
      ]),
      /--sort value is required/
    );
    assert.throws(
      () => parseArgs([
        "threads",
        "--model-provider",
      ]),
      /--model-provider value is required/
    );
    assert.throws(
      () => parseArgs([
        "threads",
        "--model-provider",
        "--source-kind",
        "cli",
      ]),
      /--model-provider value is required/
    );
    assert.throws(
      () => parseArgs([
        "threads",
        "--source-kind",
      ]),
      /--source-kind value is required/
    );
  });

  it("rejects missing values for general power-cli flags", () => {
    assert.throws(
      () => parseArgs([
        "project",
        "--session-dir",
      ]),
      /--session-dir value is required/
    );
    assert.throws(
      () => parseArgs([
        "project",
        "--area",
      ]),
      /--area value is required/
    );
    assert.throws(
      () => parseArgs([
        "metadata",
        "codex:019d-thread",
        "--git-branch",
      ]),
      /--git-branch value is required/
    );
    assert.throws(
      () => parseArgs([
        "annotate-session",
        "codex:019d-thread",
        "--tag",
      ]),
      /--tag value is required/
    );
  });

  it("rejects invalid integer values for numeric power-cli flags", () => {
    assert.throws(
      () => parseArgs([
        "overview",
        "--limit",
        "not-a-number",
      ]),
      /--limit must be an integer/
    );
    assert.throws(
      () => parseArgs([
        "workstream",
        "codex:019d-thread",
        "--family-limit",
        "1.5",
      ]),
      /--family-limit must be an integer/
    );
    assert.throws(
      () => parseArgs([
        "fork-prune",
        "codex:019d-thread",
        "--drop-last",
        "abc",
      ]),
      /--drop-last must be an integer/
    );
    assert.throws(
      () => parseArgs([
        "overview",
        "--limit",
        "0",
      ]),
      /--limit must be a positive integer/
    );
    assert.throws(
      () => parseArgs([
        "list",
        "--offset",
        "-1",
      ]),
      /--offset must be a non-negative integer/
    );
    assert.throws(
      () => parseArgs([
        "doctor",
        "--live-window-ms",
        "0",
      ]),
      /--live-window-ms must be a positive integer/
    );
  });

  it("prints concise user-facing errors for expected exact-thread validation failures", () => {
    const missingValue = runHistoryFailure(["threads", "--q"]);
    assert.strictEqual(missingValue.status, 1);
    assert.strictEqual(String(missingValue.stderr), "--q value is required\n");
    assert.doesNotMatch(String(missingValue.stderr), /readRequiredOptionValue|history\.js:/);

    const invalidSort = runHistoryFailure(["threads", "--sort", "not-real"]);
    assert.strictEqual(invalidSort.status, 1);
    assert.strictEqual(
      String(invalidSort.stderr),
      `sort key must be one of ${BRIDGE_CANONICAL_THREAD_SORT_KEYS.join(", ")}\n`
    );
    assert.doesNotMatch(String(invalidSort.stderr), /app-server-thread-contract\.js:|normalizeBridgeThreadListParams/);
  });

  it("prints concise user-facing errors for broader parser validation failures", () => {
    const missingBranch = runHistoryFailure(["metadata", "codex:019d-thread", "--git-branch"]);
    assert.strictEqual(missingBranch.status, 1);
    assert.strictEqual(String(missingBranch.stderr), "--git-branch value is required\n");
    assert.doesNotMatch(String(missingBranch.stderr), /history\.js:|readRequiredOptionValue/);

    const invalidLimit = runHistoryFailure(["overview", "--limit", "abc"]);
    assert.strictEqual(invalidLimit.status, 1);
    assert.strictEqual(String(invalidLimit.stderr), "--limit must be an integer\n");
    assert.doesNotMatch(String(invalidLimit.stderr), /history\.js:|readRequiredIntegerOptionValue/);

    const zeroLimit = runHistoryFailure(["overview", "--limit", "0"]);
    assert.strictEqual(zeroLimit.status, 1);
    assert.strictEqual(String(zeroLimit.stderr), "--limit must be a positive integer\n");
    assert.doesNotMatch(String(zeroLimit.stderr), /history\.js:|readPositiveIntegerOptionValue/);

    const negativeOffset = runHistoryFailure(["list", "--offset", "-1"]);
    assert.strictEqual(negativeOffset.status, 1);
    assert.strictEqual(String(negativeOffset.stderr), "--offset must be a non-negative integer\n");
    assert.doesNotMatch(String(negativeOffset.stderr), /history\.js:|readNonNegativeIntegerOptionValue/);

    const zeroDropLast = runHistoryFailure(["prune-preview", "codex:019d-thread", "--drop-last", "0"]);
    assert.strictEqual(zeroDropLast.status, 1);
    assert.strictEqual(String(zeroDropLast.stderr), "--drop-last must be a positive integer\n");
    assert.doesNotMatch(String(zeroDropLast.stderr), /either drop_last or through_turn is required/);
  });

  it("derives bridge help text from the shared canonical contract", () => {
    const output = runHistory(["--help"]);
    assert.match(
      output,
      new RegExp(`--sort <k>\\s+Bridge thread sort: ${escapeRegExp(BRIDGE_THREAD_SORT_HELP_TEXT)}`)
    );
    assert.match(
      output,
      new RegExp(`canonical kinds: ${escapeRegExp(BRIDGE_THREAD_SOURCE_KIND_HELP_TEXT)}`)
    );
  });

  it("prints source selection details for exact bridge-only views", () => {
    assert.strictEqual(
      shouldPrintSourceSelection({
        requested: "app_server",
        used: "app_server",
        selectionReason: "app_server_only_operation",
        selectionNote: "used app-server because this operation is exact bridge-only.",
      }),
      true
    );
    assert.strictEqual(
      shouldPrintSourceSelection({
        requested: "app_server",
        used: "app_server",
        selectionReason: "requested_app_server",
        selectionNote: "used app-server because source=app-server was requested.",
      }),
      false
    );
  });

  it("builds exact thread-list next commands for inspect, resume, and pagination", () => {
    assert.deepStrictEqual(
      buildBridgeThreadListHints({
        threads: [
          {
            sessionId: "codex:019d-thread",
          },
        ],
        nextCursor: "2026-04-16T21:31:36Z|019d-thread",
      }, {
        invocationCommand: "node history.js",
      }),
      [
        "node history.js thread codex:019d-thread",
        "node history.js transcript codex:019d-thread --source app-server",
        "node history.js resume codex:019d-thread --source app-server --reload-policy strict",
        "node history.js threads --cursor \"2026-04-16T21:31:36Z|019d-thread\"",
      ]
    );
  });

  it("compacts and deduplicates noisy query strings for human output", () => {
    assert.strictEqual(
      formatQueryDisplayValue("  AGENTS.md    site:developers.openai.com   hooks   ", 32),
      "AGENTS.md site:developers.ope..."
    );
    assert.strictEqual(
      formatQueryValueList([
        "AGENTS.md site:developers.openai.com hooks",
        "  AGENTS.md   site:developers.openai.com hooks  ",
        "docker",
      ], 6, 24),
      "AGENTS.md site:develo..., docker"
    );
  });

  it("provides a simple overview over archive quality buckets", () => {
    const { tmpDir, dateDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateDir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "019d23d4-f1a9-7633-b9c7-758327137228", cwd: "/repo/a", memory_mode: "disabled" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-1", cwd: "/repo/a", model: "gpt-5.4" },
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
          call_id: "call_1",
          arguments: "{\"cmd\":\"git status --short\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T15:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call_patch",
          turn_id: "turn-1",
          success: true,
          changes: {
            "/repo/a/src/feature.js": { type: "update" },
          },
        },
      },
      {
        timestamp: "2026-04-09T15:10:56.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          last_agent_message: "Feature toggle implementation completed",
        },
      },
    ]);

    writeRollout(dateDir, "rollout-b.jsonl", [
      {
        timestamp: "2026-04-09T16:10:51.000Z",
        type: "session_meta",
        payload: { id: "019d23d4-f1a9-7633-b9c7-758327137229", cwd: "/repo/b" },
      },
      {
        timestamp: "2026-04-09T16:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-2", cwd: "/repo/b", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T16:10:53.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_2",
          arguments: "{\"cmd\":\"rg -n feature-toggle src\",\"workdir\":\"/repo/b\"}",
        },
      },
    ]);

    writeRollout(dateDir, "rollout-c.jsonl", [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: { id: "019d23d4-f1a9-7633-b9c7-758327137230", cwd: "/repo/c" },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-3", cwd: "/repo/c", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: { type: "turn_aborted", turn_id: "turn-3", reason: "user interrupted" },
      },
    ]);

    const output = runHistory([
      "overview",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);

    const overview = JSON.parse(output);
    assert.strictEqual(overview.summary.sessionCount, 3);
    assert.strictEqual(overview.summary.qualityClassCounts.rich_extended, 1);
    assert.strictEqual(overview.summary.qualityClassCounts.partial_investigation, 1);
    assert.strictEqual(overview.summary.qualityClassCounts.aborted_empty, 1);
    assert.strictEqual(overview.buckets.richExtended.total, 1);
    assert.strictEqual(overview.buckets.partialInvestigation.total, 1);
    assert.strictEqual(overview.buckets.abortedEmpty.total, 1);
    assert.ok(Array.isArray(overview.recommendedCommands));
    assert.ok(overview.recommendedCommands.some((command) => /transcript/.test(command)));
    assert.ok(overview.recommendedCommands.some((command) => /resume/.test(command)));
    assert.ok(overview.recommendedCommands.some((command) => /^node history\.js transcript /.test(command)));
    assert.ok(overview.recommendedCommands.every((command) => !/codex\/history\.js/.test(command)));
  });

  it("supports fuzzy session browse modes with explicit match details", () => {
    const { tmpDir, dateDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateDir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "019d23d4-f1a9-7633-b9c7-758327137228", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-1", cwd: "/repo/a", model: "gpt-5.4" },
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
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "docker",
            queries: ["docker"],
          },
        },
      },
      {
        timestamp: "2026-04-09T15:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          last_agent_message: "Found the docker entry point and feature toggle notes",
        },
      },
    ]);

    const fuzzyByQuery = JSON.parse(runHistory([
      "search",
      "--query",
      "dokcer",
      "--query-mode",
      "fuzzy",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(fuzzyByQuery.queryMode, "fuzzy");
    assert.strictEqual(fuzzyByQuery.total, 1);
    assert.deepStrictEqual(fuzzyByQuery.querySignalSummary, {
      onlyLowSignal: false,
      examples: [],
    });
    assert.deepStrictEqual(fuzzyByQuery.sessions[0].match, {
      kind: "query",
      text: "docker",
      signalTier: "medium",
    });

    const fuzzyByQueryOutput = runHistory([
      "search",
      "--query",
      "dokcer",
      "--query-mode",
      "fuzzy",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    assert.match(fuzzyByQueryOutput, /match: query=docker/);
    assert.doesNotMatch(fuzzyByQueryOutput, /matched-queries:\s*docker/);

    const fuzzyByQOutput = runHistory([
      "search",
      "--q",
      "implemnt feature toggle",
      "--q-mode",
      "fuzzy",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    assert.match(fuzzyByQOutput, /match: user=Implement feature toggle search/);
    assert.match(fuzzyByQOutput, /match-reasons: user/);
  });

  it("labels low-signal fuzzy captured-query matches and prints a narrowing note", () => {
    const { tmpDir, dateDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateDir, "rollout-a.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "019d23d4-f1a9-7633-b9c7-758327137228", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-1", cwd: "/repo/a", model: "gpt-5.4" },
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

    const output = runHistory([
      "search",
      "--query",
      "AGNTS",
      "--query-mode",
      "fuzzy",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);

    assert.match(output, /match: query=AGENTS\.md \[low-signal\]/);
    assert.match(output, /low-signal filename\/glob filters/);
    assert.match(output, /--query-mode exact/);
    assert.match(output, /search --q \.\.\. --q-mode fuzzy/);

    const jsonOutput = JSON.parse(runHistory([
      "search",
      "--query",
      "AGNTS",
      "--query-mode",
      "fuzzy",
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

  it("supports fuzzy query mode in deeper turn and transcript power-user surfaces", () => {
    const { tmpDir, dateDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateDir, "rollout-turn-query.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "019d23d4-f1a9-7633-b9c7-758327137250", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-1", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
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
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          last_agent_message: "confirmed docker usage",
        },
      },
    ]);

    const fuzzyTurnSearch = JSON.parse(runHistory([
      "turn-search",
      "--query",
      "dokcer",
      "--query-mode",
      "fuzzy",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(fuzzyTurnSearch.queryMode, "fuzzy");
    assert.strictEqual(fuzzyTurnSearch.total, 1);
    assert.deepStrictEqual(fuzzyTurnSearch.turns[0].matchedQueries, ["docker"]);

    const fuzzyTranscriptOutput = runHistory([
      "transcript",
      "codex:019d23d4-f1a9-7633-b9c7-758327137250",
      "--query",
      "dokcer",
      "--query-mode",
      "fuzzy",
      "--source",
      "rollout",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    assert.match(fuzzyTranscriptOutput, /query-mode: fuzzy/);
    assert.match(fuzzyTranscriptOutput, /matched-queries: docker/);
  });

  it("supports fuzzy query mode in project, area, family, and workstream power-user surfaces", () => {
    const { tmpDir, dateDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateDir, "rollout-root.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "root-session-id", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-root", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
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
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call_root_patch",
          turn_id: "turn-root",
          success: true,
          changes: {
            "/repo/a/src/app.js": { type: "update" },
          },
        },
      },
      {
        timestamp: "2026-04-09T15:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-root",
          last_agent_message: "Updated the root app flow",
        },
      },
    ]);

    writeRollout(dateDir, "rollout-child.jsonl", [
      {
        timestamp: "2026-04-09T16:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "child-session-id",
          cwd: "/repo/a",
          forked_from_id: "root-session-id",
        },
      },
      {
        timestamp: "2026-04-09T16:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-child", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T16:10:53.000Z",
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
      {
        timestamp: "2026-04-09T16:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-child",
          last_agent_message: "Checked the child branch work",
        },
      },
    ]);

    const fuzzyProjects = JSON.parse(runHistory([
      "projects",
      "--query",
      "dokcer",
      "--query-mode",
      "fuzzy",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(fuzzyProjects.queryMode, "fuzzy");
    assert.strictEqual(fuzzyProjects.total, 1);
    assert.strictEqual(fuzzyProjects.projects[0].cwd, "/repo/a");

    const fuzzyAreas = JSON.parse(runHistory([
      "areas",
      "--cwd",
      "/repo/a",
      "--query",
      "dokcer",
      "--query-mode",
      "fuzzy",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(fuzzyAreas.queryMode, "fuzzy");
    assert.strictEqual(fuzzyAreas.total, 1);
    assert.strictEqual(fuzzyAreas.areas[0].root, "src");

    const fuzzyProject = JSON.parse(runHistory([
      "project",
      "/repo/a",
      "--query",
      "dokcer",
      "--query-mode",
      "fuzzy",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(fuzzyProject.queryMode, "fuzzy");
    assert.ok(fuzzyProject.turns.some((turn) => Array.isArray(turn.matchedQueries) && turn.matchedQueries.includes("docker")));

    const fuzzyArea = JSON.parse(runHistory([
      "area",
      "/repo/a",
      "src",
      "--query",
      "dokcer",
      "--query-mode",
      "fuzzy",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(fuzzyArea.queryMode, "fuzzy");
    assert.ok(fuzzyArea.turns.some((turn) => Array.isArray(turn.matchedQueries) && turn.matchedQueries.includes("docker")));

    const fuzzyFamily = JSON.parse(runHistory([
      "family",
      "codex:child-session-id",
      "--query",
      "dokcer",
      "--query-mode",
      "fuzzy",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(fuzzyFamily.queryMode, "fuzzy");
    assert.ok(fuzzyFamily.turns.some((turn) => Array.isArray(turn.matchedQueries) && turn.matchedQueries.includes("docker")));

    const fuzzyWorkstream = JSON.parse(runHistory([
      "workstream",
      "codex:child-session-id",
      "--query",
      "dokcer",
      "--query-mode",
      "fuzzy",
      "--json",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]));
    assert.strictEqual(fuzzyWorkstream.queryMode, "fuzzy");
    assert.ok(fuzzyWorkstream.turns.some((turn) => Array.isArray(turn.matchedQueries) && turn.matchedQueries.includes("docker")));

    const familyOutput = runHistory([
      "family",
      "codex:child-session-id",
      "--query",
      "dokcer",
      "--query-mode",
      "fuzzy",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    assert.match(familyOutput, /query-mode: fuzzy/);

    const noAreaOutput = runHistory([
      "areas",
      "--cwd",
      "/repo/a",
      "--query",
      "missing-query",
      "--query-mode",
      "fuzzy",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    assert.match(noAreaOutput, /No areas found\./);
  });

  it("prints turn detail safely when the turn cwd is missing and matched events use their own cwd", () => {
    const { tmpDir, dateDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateDir, "rollout-turn-cwd.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "019d23d4-f1a9-7633-b9c7-758327137251", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-1", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_1",
          turn_id: "turn-1",
          command: ["/bin/zsh", "-lc", "sed -n '1,20p' src/history.js"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "read",
            cmd: "sed -n '1,20p' src/history.js",
            path: "src/history.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "history layer\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 91700000 },
          status: "completed",
        },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          last_agent_message: "reviewed history.js",
        },
      },
    ]);

    const output = runHistory([
      "turn",
      "codex:019d23d4-f1a9-7633-b9c7-758327137251",
      "turn-1",
      "--path",
      "history.js",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
    ]);
    assert.match(output, /matched-paths: src\/history\.js|matched-paths: \/repo\/a\/src\/history\.js/);
    assert.match(output, /timeline:/);
  });

  it("describes resume truncation as hitting the budget instead of printing a useless remaining=0 banner", () => {
    const { tmpDir, dateDir } = makeTempSessionDir();
    const indexDir = path.join(tmpDir, "index");
    cleanup.push(tmpDir);

    writeRollout(dateDir, "rollout-resume.jsonl", [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: { id: "019d23d4-f1a9-7633-b9c7-758327137240", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-1", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "Please summarize the current history harness architecture in detail and keep all the important details about transcript shaping, artifacts, filters, bridge behavior, resume safety, and the useful commands for later work.",
        },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          last_agent_message: "The harness reads rollout logs, builds a reusable index, exposes transcript and resume views, preserves exact bridge-backed thread reads, and keeps shaping and filtering details available for later recovery work across a fairly large set of commands and diagnostics.",
        },
      },
    ]);

    const output = runHistory([
      "resume",
      "codex:019d23d4-f1a9-7633-b9c7-758327137240",
      "--session-dir",
      tmpDir,
      "--index-dir",
      indexDir,
      "--source",
      "rollout",
      "--reload-policy",
      "allow",
      "--budget-chars",
      "300",
    ]);

    assert.match(output, /resume was shortened to fit the 300-char budget\./);
    assert.doesNotMatch(output, /resume text truncated, remaining=0/);
  });
});
