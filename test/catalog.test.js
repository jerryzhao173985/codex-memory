const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildHistoricalCatalog,
  buildArtifactCatalog,
  buildCatalogFacets,
  buildProjectCatalog,
  listCatalogProjects,
  listCatalogProjectAreas,
  summarizeEntityFocusRoots,
  derivePrimaryEntityFocusRoot,
  searchCatalogTurns,
  listCatalogSessions,
  listCatalogArtifacts,
  getCatalogArtifact,
  getCatalogArtifactTurns,
  getCatalogPathThread,
  getCatalogRelatedSessions,
  getCatalogTurn,
  getCatalogProject,
  getCatalogArea,
  getCatalogSession,
  getCatalogEvents,
  getCatalogTranscript,
  getCatalogResume,
  SESSION_DOC_SCHEMA_VERSION,
} = require("../catalog");

function makeTempSessionDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-history-"));
  const dateDir = path.join(tmpDir, "2026", "04", "09");
  fs.mkdirSync(dateDir, { recursive: true });
  return { tmpDir, dateDir };
}

function writeRollout(dateDir, fileName, records) {
  fs.writeFileSync(path.join(dateDir, fileName), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

function writeLegacyRollout(dir, fileName, session, items) {
  fs.writeFileSync(path.join(dir, fileName), JSON.stringify({ session, items }, null, 2));
}

const FILE_A = "rollout-2026-04-09T15-10-51-019d23d4-f1a9-7633-b9c7-758327137228.jsonl";
const FILE_B = "rollout-2026-04-09T16-10-51-019d23d4-f1a9-7633-b9c7-758327137229.jsonl";
const FILE_C = "rollout-2026-04-09T17-10-51-019d23d4-f1a9-7633-b9c7-758327137230.jsonl";
const FILE_D = "rollout-2026-04-09T18-10-51-019d23d4-f1a9-7633-b9c7-758327137231.jsonl";
const FILE_E = "rollout-2026-04-09T19-10-51-019d23d4-f1a9-7633-b9c7-758327137232.jsonl";
const FILE_F = "rollout-2026-04-09T20-10-51-019d23d4-f1a9-7633-b9c7-758327137233.jsonl";

function queryTexts(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => (entry && typeof entry === "object" ? entry.query : entry))
    .filter(Boolean);
}

describe("historical catalog", () => {
  let tmpDir;
  let dateDir;

  beforeEach(() => {
    ({ tmpDir, dateDir } = makeTempSessionDir());

    writeRollout(dateDir, FILE_A, [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137228",
          cwd: "/repo/a",
          cli_version: "0.117.0-alpha.22",
          model_provider: "openai",
          source: "vscode",
          memory_mode: "disabled",
          agent_nickname: "Turing",
          agent_role: "default",
          agent_path: "agents/default",
          git: {
            branch: "main",
            commit_hash: "abc123",
            repository_url: "git@github.com:openai/codex.git",
          },
          base_instructions: {
            text: "Follow the repo instructions and prefer rg.",
          },
          dynamic_tools: [
            { name: "read_thread_terminal" },
          ],
        },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-1",
          cwd: "/repo/a",
          model: "gpt-5.4",
          approval_policy: "never",
          sandbox_policy: { type: "workspace-write", network_access: true },
          effort: "medium",
          summary: "auto",
        },
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

    writeRollout(dateDir, FILE_B, [
      {
        timestamp: "2026-04-09T16:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137229",
          cwd: "/repo/b",
          cli_version: "0.117.0-alpha.22",
          model_provider: "openai",
        },
      },
      {
        timestamp: "2026-04-09T16:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-2",
          cwd: "/repo/b",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T16:10:53.000Z",
        type: "response_item",
        payload: {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "site:github.com codex search history",
            queries: ["site:github.com codex search history"],
          },
        },
      },
      {
        timestamp: "2026-04-09T16:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "error",
          message: "unexpected status 401 Unauthorized, url: https://api.openai.com/v1/responses, request id: req_123",
          codex_error_info: "other",
        },
      },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reconstructs sessions and turns from rollout history", () => {
    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    assert.strictEqual(catalog.sessionCount, 2);

    const session = getCatalogSession(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137228");
    assert.ok(session);
    assert.strictEqual(session.cwd, "/repo/a");
    assert.strictEqual(session.model, "gpt-5.4");
    assert.strictEqual(session.cliVersion, "0.117.0-alpha.22");
    assert.strictEqual(session.modelProvider, "openai");
    assert.strictEqual(session.source, "vscode");
    assert.strictEqual(session.sourceKind, "vscode");
    assert.strictEqual(session.agentPath, "agents/default");
    assert.deepStrictEqual(session.git, {
      branch: "main",
      sha: "abc123",
      originUrl: "git@github.com:openai/codex.git",
    });
    assert.match(session.baseInstructionsPreview, /prefer rg/);
    assert.deepStrictEqual(session.dynamicToolNames, ["read_thread_terminal"]);
    assert.strictEqual(session.dynamicToolCount, 1);
    assert.strictEqual(session.turnCount, 1);
    assert.strictEqual(session.counts.commands, 1);
    assert.strictEqual(session.counts.patches, 1);
    assert.strictEqual(session.rolloutPersistence.memoryMode, "disabled");
    assert.strictEqual(session.rolloutPersistence.eventMode, "extended_observed");
    assert.ok(session.rolloutPersistence.observedEventKeys.includes("event_msg:patch_apply_end"));
    assert.ok(session.tags.includes("has_extended_events"));
    assert.ok(session.tags.includes("memory_disabled"));
    assert.match(session.finalAnswerPreview, /Feature toggle implementation completed/);
    assert.deepStrictEqual(session.filesTouched, ["/repo/a/src/feature.js"]);
    assert.deepStrictEqual(session.pathRoles.write, ["/repo/a/src/feature.js"]);
    assert.strictEqual(session.turns[0].turnId, "turn-1");
    assert.match(session.turns[0].userPromptPreview, /Implement feature toggle search/);
  });

  it("indexes legacy flat rollout json files alongside jsonl history", () => {
    writeLegacyRollout(tmpDir, "rollout-2025-04-28-08e89bd6-a21c-4356-aa02-ceeb5d84716d.json", {
      timestamp: "2025-04-28T16:19:19.416Z",
      id: "08e89bd6-a21c-4356-aa02-ceeb5d84716d",
      instructions: "legacy instructions",
    }, [
      {
        role: "user",
        content: [{ type: "text", text: "create a dockerfile" }],
      },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_7vo5n56e",
            type: "function",
            function: {
              name: "shell",
              arguments: "{\"command\":[\"git\",\"status\"]}",
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_7vo5n56e",
        content: "{\"output\":\"On branch main\\n\",\"metadata\":{\"exit_code\":0}}",
      },
      {
        role: "assistant",
        content: "Use git to keep local and remote folders in sync.",
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const session = getCatalogSession(catalog, "codex:08e89bd6-a21c-4356-aa02-ceeb5d84716d");

    assert.ok(session);
    assert.strictEqual(catalog.sessionCount, 3);
    assert.match(session.baseInstructionsPreview, /legacy instructions/);
    assert.strictEqual(session.counts.commands, 1);
    assert.match(session.lastUserPreview, /create a dockerfile/);
    assert.match(session.finalAnswerPreview, /Use git to keep local and remote folders in sync/);
    assert.ok(session.recentCommands.some((entry) => entry.command === "git status"));
  });

  it("ignores nested materialized session docs when scanning rollout trees", () => {
    const indexSessionsDir = path.join(tmpDir, "index", "sessions");
    fs.mkdirSync(indexSessionsDir, { recursive: true });

    fs.writeFileSync(path.join(indexSessionsDir, "rollout-index-copy.json"), JSON.stringify({
      schemaVersion: SESSION_DOC_SCHEMA_VERSION,
      historyMode: "effective",
      sessionId: "codex:index-copy",
      turns: [],
    }, null, 2));

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const sessionIds = listCatalogSessions(catalog, { limit: 20 }).sessions.map((session) => session.sessionId);

    assert.strictEqual(catalog.sessionCount, 2);
    assert.deepStrictEqual(sessionIds, [
      "codex:019d23d4-f1a9-7633-b9c7-758327137229",
      "codex:019d23d4-f1a9-7633-b9c7-758327137228",
    ]);
  });

  it("applies thread rollback markers so derived history matches the surviving turns", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/c",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-keep",
          cwd: "/repo/c",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "keep this turn",
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-keep",
          last_agent_message: "kept answer",
        },
      },
      {
        timestamp: "2026-04-09T17:10:55.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-drop",
          cwd: "/repo/c",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:56.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "drop this turn",
        },
      },
      {
        timestamp: "2026-04-09T17:10:57.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call_drop_patch",
          turn_id: "turn-drop",
          success: true,
          changes: {
            "/repo/c/src/drop.js": { type: "update" },
          },
        },
      },
      {
        timestamp: "2026-04-09T17:10:57.500Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-drop",
          last_agent_message: "dropped answer",
        },
      },
      {
        timestamp: "2026-04-09T17:10:58.000Z",
        type: "event_msg",
        payload: {
          type: "thread_rolled_back",
          num_turns: 1,
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const sessionId = "codex:019d23d4-f1a9-7633-b9c7-758327137230";
    const session = getCatalogSession(catalog, sessionId);
    assert.ok(session);
    assert.strictEqual(session.turnCount, 1);
    assert.strictEqual(session.rolloutPersistence.eventMode, "limited_or_unknown");
    assert.strictEqual(session.turns[0].turnId, "turn-keep");
    assert.match(session.finalAnswerPreview, /kept answer/);

    const droppedTurn = getCatalogTurn(catalog, sessionId, "turn-drop");
    assert.strictEqual(droppedTurn, null);

    const rawSession = getCatalogSession(catalog, sessionId, { historyMode: "raw" });
    assert.ok(rawSession);
    assert.strictEqual(rawSession.historyMode, "raw");
    assert.strictEqual(rawSession.turnCount, 2);
    assert.strictEqual(rawSession.rolloutPersistence.eventMode, "extended_observed");
    assert.ok(rawSession.rolloutPersistence.observedEventKeys.includes("event_msg:patch_apply_end"));
    assert.match(rawSession.finalAnswerPreview, /dropped answer/);

    const rawTurn = getCatalogTurn(catalog, sessionId, "turn-drop", { historyMode: "raw" });
    assert.ok(rawTurn);
    assert.strictEqual(rawTurn.historyMode, "raw");
    assert.match(rawTurn.turn.finalAnswerPreview, /dropped answer/);

    const events = getCatalogEvents(catalog, sessionId, {});
    assert.ok(events.events.some((event) => event.kind === "history_mutation"));
    assert.ok(!events.events.some((event) => event.turnId === "turn-drop"));

    const rawEvents = getCatalogEvents(catalog, sessionId, { historyMode: "raw" });
    assert.ok(rawEvents.events.some((event) => event.turnId === "turn-drop"));
    assert.ok(rawEvents.events.some((event) => event.includedInFinalHistory === false));

    const transcript = getCatalogTranscript(catalog, sessionId, {});
    assert.ok(!transcript.items.some((item) => item.turnId === "turn-drop"));
    assert.ok(transcript.items.some((item) => /rolled back/i.test(item.text || item.detail || "")));

    const rawTranscript = getCatalogTranscript(catalog, sessionId, { historyMode: "raw" });
    assert.ok(rawTranscript.items.some((item) => item.turnId === "turn-drop"));
    assert.ok(rawTranscript.items.some((item) => item.includedInFinalHistory === false));

    const rawSearch = searchCatalogTurns(catalog, {
      q: "drop this turn",
      historyMode: "raw",
    });
    assert.strictEqual(rawSearch.total, 1);
    assert.strictEqual(rawSearch.turns[0].turnId, "turn-drop");

    const rawArtifactTurns = getCatalogArtifactTurns(catalog, "file", "/repo/c/src/drop.js", {
      historyMode: "raw",
    });
    assert.ok(rawArtifactTurns);
    assert.strictEqual(rawArtifactTurns.historyMode, "raw");
    assert.strictEqual(rawArtifactTurns.turnCount, 1);
    assert.strictEqual(rawArtifactTurns.turns[0].turnId, "turn-drop");
  });

  it("keeps the primary rollout session id when replayed parent session_meta lines are present", () => {
    writeRollout(dateDir, FILE_D, [
      {
        timestamp: "2026-04-09T18:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137231",
          forked_from_id: "019d23d4-f1a9-7633-b9c7-758327137228",
          cwd: "/repo/a",
          agent_nickname: "Helmholtz",
          agent_role: "explorer",
          source: {
            subagent: {
              thread_spawn: {
                parent_thread_id: "019d23d4-f1a9-7633-b9c7-758327137228",
                depth: 1,
                agent_nickname: "Helmholtz",
                agent_role: "explorer",
              },
            },
          },
        },
      },
      {
        timestamp: "2026-04-09T18:10:51.100Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137228",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T18:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-subagent",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T18:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-subagent",
          last_agent_message: "subagent complete",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const session = getCatalogSession(catalog, path.basename(FILE_D, ".jsonl"));

    assert.ok(session);
    assert.strictEqual(session.sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137231");
    assert.strictEqual(session.forkedFromId, "codex:019d23d4-f1a9-7633-b9c7-758327137228");
    assert.strictEqual(session.parentThreadId, "codex:019d23d4-f1a9-7633-b9c7-758327137228");
    assert.deepStrictEqual(session.replayedSessionIds, ["codex:019d23d4-f1a9-7633-b9c7-758327137228"]);
    assert.ok(session.tags.includes("forked"));
    assert.ok(session.tags.includes("subagent"));
    assert.ok(session.tags.includes("has_replayed_history"));
  });

  it("filters query surfaces by rollout persistence coverage", () => {
    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });

    const disabledSessions = listCatalogSessions(catalog, { memoryMode: "disabled" });
    assert.strictEqual(disabledSessions.total, 1);
    assert.strictEqual(disabledSessions.sessions[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137228");

    const effectiveExtendedSessions = listCatalogSessions(catalog, { eventMode: "extended" });
    assert.strictEqual(effectiveExtendedSessions.total, 2);
    assert.ok(effectiveExtendedSessions.sessions.some((session) => session.sessionId === "codex:019d23d4-f1a9-7633-b9c7-758327137228"));
    assert.ok(effectiveExtendedSessions.sessions.some((session) => session.sessionId === "codex:019d23d4-f1a9-7633-b9c7-758327137229"));

    const rawExtendedSessions = listCatalogSessions(catalog, { historyMode: "raw", eventMode: "extended_observed" });
    assert.strictEqual(rawExtendedSessions.total, 2);
    assert.ok(rawExtendedSessions.sessions.some((session) => session.sessionId === "codex:019d23d4-f1a9-7633-b9c7-758327137228"));
    assert.ok(rawExtendedSessions.sessions.some((session) => session.sessionId === "codex:019d23d4-f1a9-7633-b9c7-758327137229"));

    const filteredTurns = searchCatalogTurns(catalog, {
      eventMode: "extended",
      has: ["memory_disabled"],
    });
    assert.strictEqual(filteredTurns.total, 1);
    assert.strictEqual(filteredTurns.sessionCount, 1);
    assert.strictEqual(filteredTurns.turns[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137228");

    const filteredProjects = listCatalogProjects(catalog, { memoryMode: "disabled" });
    assert.strictEqual(filteredProjects.total, 1);
    assert.strictEqual(filteredProjects.projects[0].cwd, "/repo/a");

    const filteredArtifacts = listCatalogArtifacts(catalog, {
      kind: "file",
      q: "feature.js",
      memoryMode: "disabled",
    });
    assert.strictEqual(filteredArtifacts.total, 1);
    assert.strictEqual(filteredArtifacts.artifacts[0].value, "/repo/a/src/feature.js");
  });

  it("classifies sessions by derived archive quality", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/c",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-answer-only",
          cwd: "/repo/c",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "summarize the current status",
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-answer-only",
          last_agent_message: "Current status summarized",
        },
      },
    ]);

    writeRollout(dateDir, FILE_D, [
      {
        timestamp: "2026-04-09T18:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137231",
          cwd: "/repo/d",
        },
      },
      {
        timestamp: "2026-04-09T18:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-useful-limited",
          cwd: "/repo/d",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T18:10:53.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_useful_limited",
          arguments: "{\"cmd\":\"cat README.md\",\"workdir\":\"/repo/d\"}",
        },
      },
      {
        timestamp: "2026-04-09T18:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-useful-limited",
          last_agent_message: "Read the README and summarized the current setup",
        },
      },
    ]);

    writeRollout(dateDir, FILE_E, [
      {
        timestamp: "2026-04-09T19:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137232",
          cwd: "/repo/e",
        },
      },
      {
        timestamp: "2026-04-09T19:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-aborted-empty",
          cwd: "/repo/e",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T19:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "turn_aborted",
          turn_id: "turn-aborted-empty",
          reason: "user interrupted",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });

    const richExtended = listCatalogSessions(catalog, { qualityClass: "rich_extended" });
    assert.strictEqual(richExtended.total, 1);
    assert.strictEqual(richExtended.sessions[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137228");
    assert.strictEqual(richExtended.sessions[0].qualityClass, "rich_extended");

    const partialInvestigation = listCatalogSessions(catalog, { qualityClass: "partial" });
    assert.strictEqual(partialInvestigation.total, 1);
    assert.strictEqual(partialInvestigation.sessions[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137229");
    assert.strictEqual(partialInvestigation.sessions[0].qualityClass, "partial_investigation");

    const answerOnly = listCatalogSessions(catalog, { qualityClass: "answer_only" });
    assert.strictEqual(answerOnly.total, 1);
    assert.strictEqual(answerOnly.sessions[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137230");
    assert.strictEqual(answerOnly.sessions[0].qualityClass, "answer_only");

    const usefulLimited = listCatalogSessions(catalog, { qualityClass: "useful_limited" });
    assert.strictEqual(usefulLimited.total, 1);
    assert.strictEqual(usefulLimited.sessions[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137231");
    assert.strictEqual(usefulLimited.sessions[0].qualityClass, "useful_limited");

    const abortedEmpty = listCatalogSessions(catalog, { qualityClass: "aborted_empty" });
    assert.strictEqual(abortedEmpty.total, 1);
    assert.strictEqual(abortedEmpty.sessions[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137232");
    assert.strictEqual(abortedEmpty.sessions[0].qualityClass, "aborted_empty");

    const compactUseful = listCatalogSessions(catalog, { qualityClass: "useful", shape: "compact" });
    assert.strictEqual(compactUseful.total, 1);
    assert.strictEqual(compactUseful.sessions[0].qualityClass, "useful_limited");
  });

  it("supports text and artifact search without raw grep", () => {
    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });

    const byText = listCatalogSessions(catalog, { q: "feature toggle" });
    assert.strictEqual(byText.total, 1);
    assert.strictEqual(byText.sessions[0].cwd, "/repo/a");

    const byFile = listCatalogSessions(catalog, { file: "src/feature.js" });
    assert.strictEqual(byFile.total, 1);
    assert.strictEqual(byFile.sessions[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137228");

    const byError = listCatalogSessions(catalog, { error: "401 Unauthorized" });
    assert.strictEqual(byError.total, 1);
    assert.strictEqual(byError.sessions[0].cwd, "/repo/b");

    const byErrorRequestId = listCatalogSessions(catalog, { error: "req_123" });
    assert.strictEqual(byErrorRequestId.total, 1);
    assert.strictEqual(byErrorRequestId.sessions[0].cwd, "/repo/b");

    const byTool = listCatalogSessions(catalog, { tool: "web_search" });
    assert.strictEqual(byTool.total, 1);
    assert.strictEqual(byTool.sessions[0].cwd, "/repo/b");
  });

  it("supports compact result shapes for session, turn, and project listings", () => {
    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });

    const compactSessions = listCatalogSessions(catalog, {
      q: "feature toggle",
      shape: "compact",
    });
    assert.strictEqual(compactSessions.shape, "compact");
    assert.strictEqual(compactSessions.total, 1);
    assert.strictEqual(compactSessions.facets, undefined);
    assert.strictEqual(compactSessions.sessions[0].recentCommands, undefined);
    assert.strictEqual(compactSessions.sessions[0].artifactSamples, undefined);
    assert.ok(Array.isArray(compactSessions.sessions[0].commandOps));
    assert.strictEqual(compactSessions.sessions[0].focusRoot, "src");

    const compactTurns = searchCatalogTurns(catalog, {
      q: "git status",
      cwd: "/repo/a",
      shape: "compact",
    });
    assert.strictEqual(compactTurns.shape, "compact");
    assert.strictEqual(compactTurns.total, 1);
    assert.strictEqual(compactTurns.turns[0].queries, undefined);
    assert.strictEqual(compactTurns.turns[0].errors, undefined);
    assert.strictEqual(compactTurns.turns[0].pathsReferenced, undefined);
    assert.strictEqual(compactTurns.turns[0].counts.errors, 0);
    assert.ok(Array.isArray(compactTurns.turns[0].commandOps));

    const compactProjects = listCatalogProjects(catalog, {
      q: "repo/a",
      shape: "compact",
    });
    assert.strictEqual(compactProjects.shape, "compact");
    assert.strictEqual(compactProjects.total, 1);
    assert.strictEqual(compactProjects.facets, undefined);
    assert.strictEqual(compactProjects.projects[0].recentSessions, undefined);
    assert.ok(Array.isArray(compactProjects.projects[0].topFiles));

    const compactArtifacts = listCatalogArtifacts(catalog, {
      kind: "command",
      q: "git status",
      shape: "compact",
    });
    assert.strictEqual(compactArtifacts.shape, "compact");
    assert.strictEqual(compactArtifacts.total, 1);
    assert.strictEqual(compactArtifacts.artifacts[0].sessions, undefined);

    const compactArtifact = getCatalogArtifact(catalog, "command", "git status --short", {
      shape: "compact",
    });
    assert.ok(compactArtifact);
    assert.strictEqual(compactArtifact.shape, "compact");
    assert.strictEqual(compactArtifact.sessions[0].filePath, undefined);
    assert.strictEqual(compactArtifact.sessions[0].artifactSamples, undefined);
    assert.ok(Array.isArray(compactArtifact.sessions[0].turns[0].commandOps));
    assert.deepStrictEqual(compactArtifact.sessions[0].turns[0].matchValues, ["git status --short"]);

    const compactArtifactTurns = getCatalogArtifactTurns(catalog, "command", "git status --short", {
      shape: "compact",
      cwd: "/repo/a",
    });
    assert.ok(compactArtifactTurns);
    assert.strictEqual(compactArtifactTurns.shape, "compact");
    assert.strictEqual(compactArtifactTurns.turns[0].filePath, undefined);
    assert.deepStrictEqual(compactArtifactTurns.turns[0].counts, {
      files: 1,
      paths: 1,
      queries: 0,
      errors: 0,
    });
    assert.deepStrictEqual(compactArtifactTurns.turns[0].matchValues, ["git status --short"]);

    const firstSessionPage = listCatalogSessions(catalog, { limit: 1 });
    const pagedSessions = listCatalogSessions(catalog, { limit: 1, offset: 1 });
    assert.strictEqual(pagedSessions.offset, 1);
    assert.strictEqual(pagedSessions.total, 2);
    assert.strictEqual(pagedSessions.sessions.length, 1);
    assert.notStrictEqual(pagedSessions.sessions[0].sessionId, firstSessionPage.sessions[0].sessionId);

    const firstTurnPage = searchCatalogTurns(catalog, { limit: 1 });
    const pagedTurns = searchCatalogTurns(catalog, { limit: 1, offset: 1 });
    assert.strictEqual(pagedTurns.offset, 1);
    assert.strictEqual(pagedTurns.total, 2);
    assert.strictEqual(pagedTurns.turns.length, 1);
    assert.notStrictEqual(pagedTurns.turns[0].turnId, firstTurnPage.turns[0].turnId);
  });

  it("shapes long preview text for compact browse cards", () => {
    const longUser = `Inspect ${"alpha ".repeat(80)}`.trim();
    const longAnswer = `Result ${"beta ".repeat(80)}`.trim();

    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/c",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/c",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: longUser,
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-3",
          last_agent_message: longAnswer,
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const fullSessions = listCatalogSessions(catalog, { cwd: "/repo/c" });
    const compactSessions = listCatalogSessions(catalog, { cwd: "/repo/c", shape: "compact" });
    const fullSession = fullSessions.sessions.find((session) => session.sessionId === "codex:019d23d4-f1a9-7633-b9c7-758327137230");
    const compactSession = compactSessions.sessions.find((session) => session.sessionId === "codex:019d23d4-f1a9-7633-b9c7-758327137230");
    assert.ok(fullSession);
    assert.ok(compactSession);
    assert.ok(compactSession.lastUserPreview.length < fullSession.lastUserPreview.length);
    assert.ok(compactSession.finalAnswerPreview.length < fullSession.finalAnswerPreview.length);
    assert.ok(compactSession.lastUserPreview.endsWith("..."));
    assert.ok(compactSession.finalAnswerPreview.endsWith("..."));

    const fullTurns = searchCatalogTurns(catalog, { cwd: "/repo/c" });
    const compactTurns = searchCatalogTurns(catalog, { cwd: "/repo/c", shape: "compact" });
    const fullTurn = fullTurns.turns.find((turn) => turn.turnId === "turn-3");
    const compactTurn = compactTurns.turns.find((turn) => turn.turnId === "turn-3");
    assert.ok(fullTurn);
    assert.ok(compactTurn);
    assert.ok(compactTurn.userPromptPreview.length < fullTurn.userPromptPreview.length);
    assert.ok(compactTurn.finalAnswerPreview.length < fullTurn.finalAnswerPreview.length);
  });

  it("builds artifact ledgers across sessions", () => {
    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const files = listCatalogArtifacts(catalog, { kind: "file" });
    assert.strictEqual(files.total, 1);
    assert.strictEqual(files.artifacts[0].value, "/repo/a/src/feature.js");
    assert.strictEqual(files.artifacts[0].sessionCount, 1);

    const errors = listCatalogArtifacts(catalog, { kind: "error", q: "401" });
    assert.strictEqual(errors.total, 1);
    assert.match(errors.artifacts[0].value, /401 Unauthorized/);

    const errorByRequestId = listCatalogArtifacts(catalog, { kind: "error", q: "req_123" });
    assert.strictEqual(errorByRequestId.total, 1);
    assert.match(errorByRequestId.artifacts[0].value, /401 Unauthorized/);

    const errorArtifact = getCatalogArtifact(catalog, "error", "req_123");
    assert.ok(errorArtifact);
    assert.match(errorArtifact.value, /401 Unauthorized/);
  });

  it("separates semantic query stats from low-signal query filters and sorts query artifacts by signal", () => {
    const sessions = [
      {
        sessionId: "codex:a",
        startedAt: "2026-04-09T15:00:00.000Z",
        updatedAt: "2026-04-09T15:10:00.000Z",
        cwd: "/repo/a",
        toolsUsed: [],
        filesTouched: [],
        turns: [],
        commandArtifacts: [],
        commandOpArtifacts: [],
        errorArtifacts: [],
        recentErrors: [],
        queryArtifacts: ["AGENTS.md", "/api/ai/analyze", "def load_book_cached"],
      },
      {
        sessionId: "codex:b",
        startedAt: "2026-04-09T15:20:00.000Z",
        updatedAt: "2026-04-09T15:30:00.000Z",
        cwd: "/repo/a",
        toolsUsed: [],
        filesTouched: [],
        turns: [],
        commandArtifacts: [],
        commandOpArtifacts: [],
        errorArtifacts: [],
        recentErrors: [],
        queryArtifacts: ["AGENTS.md", "/api/ai/analyze", "*.cmake"],
      },
      {
        sessionId: "codex:c",
        startedAt: "2026-04-09T15:40:00.000Z",
        updatedAt: "2026-04-09T15:50:00.000Z",
        cwd: "/repo/a",
        toolsUsed: [],
        filesTouched: [],
        turns: [],
        commandArtifacts: [],
        commandOpArtifacts: [],
        errorArtifacts: [],
        recentErrors: [],
        queryArtifacts: ["AGENTS.md", "/api/ai/analyze"],
      },
    ];

    const facets = buildCatalogFacets(sessions);
    assert.deepStrictEqual(
      facets.topQueries.map((item) => ({ query: item.query, signalTier: item.signalTier })),
      [
        { query: "/api/ai/analyze", signalTier: "medium" },
        { query: "def load_book_cached", signalTier: "high" },
      ]
    );
    assert.deepStrictEqual(
      facets.topLowSignalQueries.map((item) => ({ query: item.query, signalTier: item.signalTier })),
      [
        { query: "AGENTS.md", signalTier: "low" },
        { query: "*.cmake", signalTier: "low" },
      ]
    );

    const artifactCatalog = {
      generatedAt: "2026-04-09T16:00:00.000Z",
      historyMode: "effective",
      artifacts: buildArtifactCatalog(sessions),
    };
    const queryArtifacts = listCatalogArtifacts(artifactCatalog, { kind: "query", limit: 4 });
    assert.strictEqual(queryArtifacts.artifacts[0].value, "def load_book_cached");
    assert.strictEqual(queryArtifacts.artifacts[0].signalTier, "high");
    assert.strictEqual(queryArtifacts.artifacts[1].value, "/api/ai/analyze");
    assert.strictEqual(queryArtifacts.artifacts[1].signalTier, "medium");
    assert.strictEqual(queryArtifacts.artifacts[2].value, "AGENTS.md");
    assert.strictEqual(queryArtifacts.artifacts[2].signalTier, "low");
  });

  it("drills from an artifact into matching sessions and turns", () => {
    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const artifact = getCatalogArtifact(catalog, "command", "git status --short");

    assert.ok(artifact);
    assert.strictEqual(artifact.kind, "command");
    assert.strictEqual(artifact.value, "git status --short");
    assert.strictEqual(artifact.sessionCount, 1);
    assert.strictEqual(artifact.turnCount, 1);
    assert.strictEqual(artifact.sessions[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137228");
    assert.strictEqual(artifact.sessions[0].turns[0].turnId, "turn-1");
    assert.deepStrictEqual(artifact.sessions[0].turns[0].matchValues, ["git status --short"]);
  });

  it("returns flat artifact-to-turn history for exact file and command values", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_2",
          arguments: "{\"cmd\":\"git status --short\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call_patch_2",
          turn_id: "turn-3",
          success: true,
          changes: {
            "/repo/a/src/feature.js": { type: "update" },
          },
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const commandTurns = getCatalogArtifactTurns(catalog, "command", "git status --short", {
      cwd: "/repo/a",
    });
    assert.ok(commandTurns);
    assert.strictEqual(commandTurns.turnCount, 2);
    assert.strictEqual(commandTurns.sessionCount, 2);
    assert.ok(commandTurns.turns.every((turn) => turn.matchValues.includes("git status --short")));

    const fileTurns = getCatalogArtifactTurns(catalog, "file", "/repo/a/src/feature.js", {
      cwd: "/repo/a",
    });
    assert.ok(fileTurns);
    assert.strictEqual(fileTurns.turnCount, 2);
    assert.ok(fileTurns.turns.every((turn) => turn.matchValues.includes("/repo/a/src/feature.js")));
  });

  it("builds workspace-level summaries and detail views", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "Debug the repo a test failure",
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_2",
          arguments: "{\"cmd\":\"npm test\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T17:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "error",
          message: "test runner failed with EADDRINUSE",
          codex_error_info: "other",
        },
      },
      {
        timestamp: "2026-04-09T17:10:56.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-3",
          last_agent_message: "Investigated the repo a test failure",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const projects = listCatalogProjects(catalog, { q: "repo a test failure" });
    assert.strictEqual(projects.total, 1);
    assert.strictEqual(projects.projects[0].cwd, "/repo/a");
    assert.strictEqual(projects.projects[0].sessionCount, 2);
    assert.strictEqual(projects.projects[0].topFocusRoots[0].root, "src");

    const project = getCatalogProject(catalog, "/repo/a", {
      q: "npm test",
      limit: 5,
      turnLimit: 5,
    });
    assert.ok(project);
    assert.strictEqual(project.cwd, "/repo/a");
    assert.strictEqual(project.sessionCount, 2);
    assert.strictEqual(project.matchedSessionCount, 1);
    assert.strictEqual(project.matchedTurnCount, 1);
    assert.strictEqual(project.turns[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137230");
    assert.strictEqual(project.turns[0].turnId, "turn-3");
    assert.match(project.turns[0].summary, /commands|errors/i);
    assert.ok(project.topFiles.some((item) => item.file === "/repo/a/src/feature.js"));
    assert.strictEqual(project.topFocusRoots[0].root, "src");
  });

  it("derives project areas and supports area-filtered project detail", () => {
    writeRollout(dateDir, FILE_D, [
      {
        timestamp: "2026-04-09T18:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137231",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T18:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-docs",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T18:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "refresh the docs overview",
        },
      },
      {
        timestamp: "2026-04-09T18:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call_docs_patch",
          turn_id: "turn-docs",
          success: true,
          changes: {
            "/repo/a/docs/guide.md": { type: "update" },
          },
        },
      },
      {
        timestamp: "2026-04-09T18:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-docs",
          last_agent_message: "Updated the docs guide",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const project = getCatalogProject(catalog, "/repo/a", {
      limit: 10,
      turnLimit: 10,
    });
    assert.ok(project);
    assert.strictEqual(project.selectedArea, null);
    assert.strictEqual(project.selectedAreaMatched, null);
    assert.strictEqual(project.areaCount, 2);
    assert.deepStrictEqual(project.unscopedAreaCounts, { sessions: 0, turns: 0 });
    assert.deepStrictEqual(project.unscopedAreaReasons, { sessions: [], turns: [] });
    assert.deepStrictEqual(project.unscopedAreaSamples, { sessions: [], turns: [] });
    assert.ok(project.areas.some((item) => item.root === "src"));
    assert.ok(project.areas.some((item) => item.root === "docs"));
    const docsArea = project.areas.find((item) => item.root === "docs");
    assert.ok(docsArea);
    assert.strictEqual(docsArea.sessionCount, 1);
    assert.strictEqual(docsArea.turnCount, 1);
    assert.strictEqual(docsArea.topFiles[0].file, "/repo/a/docs/guide.md");

    const docsProject = getCatalogProject(catalog, "/repo/a", {
      area: "docs",
      limit: 10,
      turnLimit: 10,
    });
    assert.ok(docsProject);
    assert.strictEqual(docsProject.selectedArea, "docs");
    assert.strictEqual(docsProject.selectedAreaMatched, true);
    assert.strictEqual(docsProject.areaCount, 2);
    assert.strictEqual(docsProject.matchedSessionCount, 1);
    assert.strictEqual(docsProject.matchedTurnCount, 1);
    assert.strictEqual(docsProject.sessions[0].focusRoot, "docs");
    assert.strictEqual(docsProject.turns[0].focusRoot, "docs");
    assert.strictEqual(docsProject.turns[0].turnId, "turn-docs");

    const missingAreaProject = getCatalogProject(catalog, "/repo/a", {
      area: "missing-area",
      limit: 10,
      turnLimit: 10,
    });
    assert.ok(missingAreaProject);
    assert.strictEqual(missingAreaProject.selectedArea, "missing-area");
    assert.strictEqual(missingAreaProject.selectedAreaMatched, false);
    assert.strictEqual(missingAreaProject.matchedSessionCount, 0);
    assert.strictEqual(missingAreaProject.matchedTurnCount, 0);

    const docsAreaDetail = getCatalogArea(catalog, "/repo/a", "docs", {
      limit: 10,
      turnLimit: 10,
    });
    assert.ok(docsAreaDetail);
    assert.strictEqual(docsAreaDetail.cwd, "/repo/a");
    assert.strictEqual(docsAreaDetail.root, "docs");
    assert.strictEqual(docsAreaDetail.areaMatched, true);
    assert.ok(docsAreaDetail.area);
    assert.strictEqual(docsAreaDetail.area.root, "docs");
    assert.strictEqual(docsAreaDetail.matchedSessionCount, 1);
    assert.strictEqual(docsAreaDetail.matchedTurnCount, 1);
    assert.strictEqual(docsAreaDetail.sessions[0].focusRoot, "docs");
    assert.strictEqual(docsAreaDetail.turns[0].focusRoot, "docs");
    assert.strictEqual(docsAreaDetail.turns[0].turnId, "turn-docs");

    const missingAreaDetail = getCatalogArea(catalog, "/repo/a", "missing-area", {
      limit: 10,
      turnLimit: 10,
    });
    assert.ok(missingAreaDetail);
    assert.strictEqual(missingAreaDetail.root, "missing-area");
    assert.strictEqual(missingAreaDetail.areaMatched, false);
    assert.strictEqual(missingAreaDetail.area, null);
    assert.strictEqual(missingAreaDetail.matchedSessionCount, 0);
    assert.strictEqual(missingAreaDetail.matchedTurnCount, 0);
  });

  it("lists derived project areas as first-class browse results", () => {
    writeRollout(dateDir, FILE_D, [
      {
        timestamp: "2026-04-09T18:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137231",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T18:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-docs",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T18:10:53.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Update the docs guide" },
      },
      {
        timestamp: "2026-04-09T18:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call_docs_patch",
          turn_id: "turn-docs",
          success: true,
          changes: {
            "/repo/a/docs/guide.md": { type: "update" },
          },
        },
      },
      {
        timestamp: "2026-04-09T18:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-docs",
          last_agent_message: "Updated the docs guide",
        },
      },
    ]);
    writeRollout(dateDir, FILE_E, [
      {
        timestamp: "2026-04-09T19:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137232",
          cwd: "/repo/a/nested",
        },
      },
      {
        timestamp: "2026-04-09T19:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-nested",
          cwd: "/repo/a/nested",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T19:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call_nested_patch",
          turn_id: "turn-nested",
          success: true,
          changes: {
            "/repo/a/nested/child/notes.md": { type: "update" },
          },
        },
      },
      {
        timestamp: "2026-04-09T19:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-nested",
          last_agent_message: "Updated nested notes",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const allAreas = listCatalogProjectAreas(catalog, {
      cwd: "/repo/a",
      limit: 10,
    });
    assert.strictEqual(allAreas.total, 2);
    assert.deepStrictEqual(allAreas.areas.map((item) => item.root), ["docs", "src"]);
    assert.ok(allAreas.areas.every((item) => item.cwd === "/repo/a"));
    assert.strictEqual(allAreas.areas[0].cwd, "/repo/a");
    assert.strictEqual(allAreas.areas[0].topFiles[0].file, "/repo/a/docs/guide.md");

    const filteredAreas = listCatalogProjectAreas(catalog, {
      cwd: "/repo/a",
      q: "guide",
      limit: 10,
    });
    assert.strictEqual(filteredAreas.total, 1);
    assert.strictEqual(filteredAreas.areas[0].root, "docs");
    assert.ok(filteredAreas.areas[0].matchReasons.includes("files"));

    const exactArea = listCatalogProjectAreas(catalog, {
      cwd: "/repo/a",
      area: "src",
      limit: 10,
    });
    assert.strictEqual(exactArea.total, 1);
    assert.strictEqual(exactArea.areas[0].root, "src");
  });

  it("uses area-scoped focus roots in area recent sessions while preserving session focus separately", () => {
    writeRollout(dateDir, FILE_F, [
      {
        timestamp: "2026-04-09T20:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137233",
          cwd: "/repo/mixed",
        },
      },
      {
        timestamp: "2026-04-09T20:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-src",
          cwd: "/repo/mixed",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T20:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call_src_patch",
          turn_id: "turn-src",
          success: true,
          changes: {
            "/repo/mixed/src/app.js": { type: "update" },
          },
        },
      },
      {
        timestamp: "2026-04-09T20:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-src",
          last_agent_message: "Updated src app",
        },
      },
      {
        timestamp: "2026-04-09T20:11:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-docs-1",
          cwd: "/repo/mixed",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T20:11:53.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call_docs_patch_1",
          turn_id: "turn-docs-1",
          success: true,
          changes: {
            "/repo/mixed/docs/guide.md": { type: "update" },
          },
        },
      },
      {
        timestamp: "2026-04-09T20:11:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-docs-1",
          last_agent_message: "Updated docs guide",
        },
      },
      {
        timestamp: "2026-04-09T20:12:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-docs-2",
          cwd: "/repo/mixed",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T20:12:53.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call_docs_patch_2",
          turn_id: "turn-docs-2",
          success: true,
          changes: {
            "/repo/mixed/docs/guide.md": { type: "update" },
          },
        },
      },
      {
        timestamp: "2026-04-09T20:12:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-docs-2",
          last_agent_message: "Updated docs guide again",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const mixedAreas = listCatalogProjectAreas(catalog, {
      cwd: "/repo/mixed",
      limit: 10,
    });
    const srcArea = mixedAreas.areas.find((item) => item.root === "src");
    const docsArea = mixedAreas.areas.find((item) => item.root === "docs");
    assert.ok(srcArea);
    assert.ok(docsArea);
    assert.strictEqual(srcArea.recentSessions[0].focusRoot, "src");
    assert.strictEqual(srcArea.recentSessions[0].sessionFocusRoot, "docs");
    assert.strictEqual(docsArea.recentSessions[0].focusRoot, "docs");
    assert.strictEqual(docsArea.recentSessions[0].sessionFocusRoot, "docs");
  });

  it("prefers stronger focus-root signals over flat path ties", () => {
    const entity = {
      cwd: "/repo/weighted",
      pathArtifacts: [
        "/repo/weighted/alpha",
        "/repo/weighted/zdocs/guide.md",
      ],
      pathRoles: {
        read: ["/repo/weighted/zdocs/guide.md"],
        search_scope: ["/repo/weighted/alpha"],
        list_scope: [],
        write: [],
      },
      pathPatternArtifacts: [
        "/repo/weighted/beta/**/*.js",
      ],
      pathPatternRoles: {
        read: [],
        search_scope: ["/repo/weighted/beta/**/*.js"],
        list_scope: [],
        write: [],
      },
    };

    assert.strictEqual(derivePrimaryEntityFocusRoot(entity, "/repo/weighted"), "zdocs");
    assert.deepStrictEqual(
      summarizeEntityFocusRoots(entity, "/repo/weighted", 3).map((item) => item.root),
      ["zdocs", "alpha", "beta"]
    );
  });

  it("explains unscoped project areas with reasons and samples", () => {
    const queryOnlyFile = "rollout-2026-04-09T19-10-51-019d23d4-f1a9-7633-b9c7-758327137232.jsonl";
    const abortedFile = "rollout-2026-04-09T20-10-51-019d23d4-f1a9-7633-b9c7-758327137233.jsonl";

    writeRollout(dateDir, queryOnlyFile, [
      {
        timestamp: "2026-04-09T19:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137232",
          cwd: "/repo/unscoped",
        },
      },
      {
        timestamp: "2026-04-09T19:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-query-only",
          cwd: "/repo/unscoped",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T19:10:53.000Z",
        type: "response_item",
        payload: {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "compiler flags search history",
            queries: ["compiler flags search history"],
          },
        },
      },
      {
        timestamp: "2026-04-09T19:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-query-only",
          last_agent_message: "Searched compiler flags history",
        },
      },
    ]);

    writeRollout(dateDir, abortedFile, [
      {
        timestamp: "2026-04-09T20:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137233",
          cwd: "/repo/unscoped",
        },
      },
      {
        timestamp: "2026-04-09T20:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-aborted-empty",
          cwd: "/repo/unscoped",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T20:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "turn_aborted",
          turn_id: "turn-aborted-empty",
          reason: "user interrupted",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const project = getCatalogProject(catalog, "/repo/unscoped", {
      limit: 10,
      turnLimit: 10,
    });
    assert.ok(project);
    assert.strictEqual(project.areaCount, 0);
    assert.deepStrictEqual(project.unscopedAreaCounts, { sessions: 2, turns: 2 });
    assert.deepStrictEqual(
      project.unscopedAreaReasons.sessions.map((item) => ({ reason: item.reason, count: item.count })),
      [
        { reason: "aborted_no_activity", count: 1 },
        { reason: "query_only_search", count: 1 },
      ]
    );
    assert.deepStrictEqual(
      project.unscopedAreaReasons.turns.map((item) => ({ reason: item.reason, count: item.count })),
      [
        { reason: "aborted_no_activity", count: 1 },
        { reason: "query_only_search", count: 1 },
      ]
    );
    assert.ok(project.unscopedAreaSamples.sessions.some((item) => item.reason === "query_only_search"));
    assert.ok(project.unscopedAreaSamples.sessions.some((item) => item.reason === "aborted_no_activity"));
    assert.ok(project.unscopedAreaSamples.turns.some((item) => item.reason === "query_only_search"));
    assert.ok(project.unscopedAreaSamples.turns.some((item) => item.reason === "aborted_no_activity"));
  });

  it("aggregates project top tools, files, and paths by turn activity", () => {
    const multiTurnFile = "rollout-2026-04-09T17-40-00-019d23d4-f1a9-7633-b9c7-758327137240.jsonl";
    writeRollout(dateDir, multiTurnFile, [
      {
        timestamp: "2026-04-09T17:40:00.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137240",
          cwd: "/repo/turn-counts",
        },
      },
      {
        timestamp: "2026-04-09T17:40:01.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-a",
          cwd: "/repo/turn-counts",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:40:02.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call-turn-a-read",
          arguments: "{\"cmd\":\"sed -n '1,80p' src/history.js\",\"workdir\":\"/repo/turn-counts\"}",
        },
      },
      {
        timestamp: "2026-04-09T17:40:03.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call-turn-a-read",
          exit_code: 0,
          stdout: "history line",
          parsed_cmd: {
            type: "read",
            cmd: "sed -n '1,80p' src/history.js",
            path: "src/history.js",
          },
        },
      },
      {
        timestamp: "2026-04-09T17:40:04.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call-turn-a-patch",
          success: true,
          changes: {
            "/repo/turn-counts/src/history.js": { type: "update" },
          },
        },
      },
      {
        timestamp: "2026-04-09T17:40:04.500Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-a",
          last_agent_message: "Reviewed history logic",
        },
      },
      {
        timestamp: "2026-04-09T17:40:05.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-b",
          cwd: "/repo/turn-counts",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:40:06.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call-turn-b-read",
          arguments: "{\"cmd\":\"sed -n '81,160p' src/history.js\",\"workdir\":\"/repo/turn-counts\"}",
        },
      },
      {
        timestamp: "2026-04-09T17:40:07.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call-turn-b-read",
          exit_code: 0,
          stdout: "history line 2",
          parsed_cmd: {
            type: "read",
            cmd: "sed -n '81,160p' src/history.js",
            path: "src/history.js",
          },
        },
      },
      {
        timestamp: "2026-04-09T17:40:08.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call-turn-b-patch",
          success: true,
          changes: {
            "/repo/turn-counts/src/history.js": { type: "update" },
          },
        },
      },
      {
        timestamp: "2026-04-09T17:40:08.500Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-b",
          last_agent_message: "Reviewed more history logic",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const project = getCatalogProject(catalog, "/repo/turn-counts", {
      limit: 5,
      turnLimit: 5,
    });
    assert.ok(project);
    assert.strictEqual(project.sessionCount, 1);
    assert.strictEqual(project.turnCount, 2);
    assert.ok(project.topTools.some((item) => item.tool === "exec_command" && item.count === 2));
    assert.ok(project.topFiles.some((item) => item.file === "/repo/turn-counts/src/history.js" && item.count === 2));
    assert.ok(project.topFiles.some((item) => item.file === "/repo/turn-counts/src/history.js" && item.displayFile === "src/history.js"));
    assert.ok(project.topPaths.some((item) => item.path === "/repo/turn-counts/src/history.js" && item.count === 2));
    assert.ok(project.topPaths.some((item) => item.path === "/repo/turn-counts/src/history.js" && item.displayPath === "src/history.js"));
    assert.ok(catalog.facets.topActiveTools.some((item) => item.tool === "exec_command" && item.count >= 2));
    assert.ok(catalog.facets.topActiveFiles.some((item) => item.file === "/repo/turn-counts/src/history.js" && item.count === 2));
    assert.ok(catalog.facets.topActivePaths.some((item) => item.path === "/repo/turn-counts/src/history.js" && item.count === 2));
    assert.ok(catalog.facets.topProjects.some((item) => item.cwd === "/repo/turn-counts" && item.count === 1));
    assert.ok(catalog.facets.topActiveProjects.some((item) => item.cwd === "/repo/turn-counts" && item.count === 2));
  });

  it("normalizes relative file change artifacts against cwd", () => {
    const relativeFile = "rollout-2026-04-09T17-45-00-019d23d4-f1a9-7633-b9c7-758327137241.jsonl";
    writeRollout(dateDir, relativeFile, [
      {
        timestamp: "2026-04-09T17:45:00.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137241",
          cwd: "/repo/relative-files",
        },
      },
      {
        timestamp: "2026-04-09T17:45:01.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-rel",
          cwd: "/repo/relative-files",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:45:02.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call-rel-patch",
          success: true,
          changes: {
            "README.md": { type: "update" },
          },
        },
      },
      {
        timestamp: "2026-04-09T17:45:03.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-rel",
          last_agent_message: "Normalized the README patch",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const session = getCatalogSession(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137241");
    assert.ok(session);
    assert.ok(session.filesTouched.includes("/repo/relative-files/README.md"));
    assert.ok(!session.filesTouched.includes("README.md"));
    assert.ok(session.pathRoles.write.includes("/repo/relative-files/README.md"));
    assert.ok(catalog.facets.topActiveFiles.some((item) => item.file === "/repo/relative-files/README.md"));
  });

  it("supports cross-session turn search", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "Run npm test and summarize the failing suite",
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_2",
          arguments: "{\"cmd\":\"npm test\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T17:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-3",
          last_agent_message: "Summarized the npm test failure",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const turns = searchCatalogTurns(catalog, {
      q: "npm test",
      cwd: "/repo/a",
      limit: 10,
    });

    assert.strictEqual(turns.total, 1);
    assert.strictEqual(turns.sessionCount, 1);
    assert.strictEqual(turns.turns[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137230");
    assert.strictEqual(turns.turns[0].turnId, "turn-3");
    assert.match(turns.turns[0].userPromptPreview, /Run npm test/);
    assert.deepStrictEqual(turns.turns[0].toolsUsed, ["exec_command"]);
  });

  it("tracks referenced paths and harness command types from exec_command_end", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_3",
          arguments: "{\"cmd\":\"sed -n '1,220p' src/settings-loader.js\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_3",
          turn_id: "turn-3",
          command: ["/bin/zsh", "-lc", "sed -n '1,220p' src/settings-loader.js"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "read",
            cmd: "sed -n '1,220p' src/settings-loader.js",
            name: "settings-loader.js",
            path: "src/settings-loader.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "module.exports = {};\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 341700000 },
          status: "completed",
        },
      },
      {
        timestamp: "2026-04-09T17:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-3",
          last_agent_message: "Inspected the settings loader",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const byPath = listCatalogSessions(catalog, { path: "settings-loader.js" });
    assert.strictEqual(byPath.total, 1);
    assert.ok(byPath.sessions[0].pathsReferenced.includes("/repo/a/src/settings-loader.js"));
    assert.deepStrictEqual(byPath.sessions[0].matchedPaths, ["/repo/a/src/settings-loader.js"]);
    assert.deepStrictEqual(byPath.sessions[0].pathRoles.read, ["/repo/a/src/settings-loader.js"]);

    const byType = searchCatalogTurns(catalog, {
      commandType: "read",
      cwd: "/repo/a",
      limit: 10,
    });
    assert.strictEqual(byType.total, 1);
    assert.deepStrictEqual(byType.turns[0].commandTypes, ["read"]);
    assert.ok(byType.turns[0].pathsReferenced.includes("/repo/a/src/settings-loader.js"));
    assert.deepStrictEqual(byType.turns[0].pathRoles.read, ["/repo/a/src/settings-loader.js"]);

    const byCommandOp = listCatalogSessions(catalog, {
      commandOp: "sed",
      cwd: "/repo/a",
    });
    assert.strictEqual(byCommandOp.total, 1);
    assert.strictEqual(byCommandOp.sessions[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137230");
    assert.ok(byCommandOp.sessions[0].commandOps.includes("sed"));

    const turnsByCommandOp = searchCatalogTurns(catalog, {
      commandOp: "sed",
      cwd: "/repo/a",
      limit: 10,
    });
    assert.strictEqual(turnsByCommandOp.total, 1);
    assert.strictEqual(turnsByCommandOp.turns[0].turnId, "turn-3");
    assert.ok(turnsByCommandOp.turns[0].commandOps.includes("sed"));

    const byReadRole = searchCatalogTurns(catalog, {
      path: "settings-loader.js",
      pathRole: "read",
      cwd: "/repo/a",
      limit: 10,
    });
    assert.strictEqual(byReadRole.total, 1);
    assert.deepStrictEqual(byReadRole.turns[0].matchedPaths, ["/repo/a/src/settings-loader.js"]);

    const byWriteRole = searchCatalogTurns(catalog, {
      path: "settings-loader.js",
      pathRole: "write",
      cwd: "/repo/a",
      limit: 10,
    });
    assert.strictEqual(byWriteRole.total, 0);

    const paths = listCatalogArtifacts(catalog, { kind: "path", q: "settings-loader.js" });
    assert.strictEqual(paths.total, 1);
    assert.strictEqual(paths.artifacts[0].value, "/repo/a/src/settings-loader.js");
    assert.deepStrictEqual(paths.artifacts[0].pathRoles, ["read"]);

    const relativePaths = listCatalogArtifacts(catalog, {
      kind: "path",
      q: "./src/settings-loader.js",
      cwd: "/repo/a",
    });
    assert.strictEqual(relativePaths.total, 1);
    assert.strictEqual(relativePaths.artifacts[0].value, "/repo/a/src/settings-loader.js");

    const pathTurns = getCatalogArtifactTurns(catalog, "path", "/repo/a/src/settings-loader.js", {
      cwd: "/repo/a",
      pathRole: "read",
    });
    assert.ok(pathTurns);
    assert.strictEqual(pathTurns.turnCount, 1);
    assert.deepStrictEqual(pathTurns.turns[0].matchValues, ["/repo/a/src/settings-loader.js"]);
    assert.deepStrictEqual(pathTurns.turns[0].matchRoles, ["read"]);

    const relativePathTurns = getCatalogArtifactTurns(catalog, "path", "./src/settings-loader.js", {
      cwd: "/repo/a",
      pathRole: "read",
    });
    assert.ok(relativePathTurns);
    assert.strictEqual(relativePathTurns.turnCount, 1);
    assert.deepStrictEqual(relativePathTurns.turns[0].matchValues, ["/repo/a/src/settings-loader.js"]);

    const turn = getCatalogTurn(
      catalog,
      "codex:019d23d4-f1a9-7633-b9c7-758327137230",
      "turn-3"
    );
    const commandEvent = turn.events.find((event) => event.kind === "tool_output");
    assert.ok(commandEvent);
    assert.strictEqual(commandEvent.commandSource, "unified_exec_startup");
    assert.deepStrictEqual(commandEvent.commandTypes, ["read"]);
    assert.deepStrictEqual(commandEvent.commandPaths, ["/repo/a/src/settings-loader.js"]);

    const transcriptByCommandOp = getCatalogTranscript(
      catalog,
      "codex:019d23d4-f1a9-7633-b9c7-758327137230",
      {
        commandOp: "sed",
        limit: 10,
      }
    );
    assert.ok(transcriptByCommandOp);
    assert.strictEqual(transcriptByCommandOp.matchedItems, 1);
    assert.ok(transcriptByCommandOp.items[0].shellCommands.includes("sed"));

    const projectByCommandOp = getCatalogProject(catalog, "/repo/a", {
      commandOp: "sed",
      limit: 10,
      turnLimit: 10,
    });
    assert.ok(projectByCommandOp);
    assert.strictEqual(projectByCommandOp.matchedSessionCount, 1);
    assert.strictEqual(projectByCommandOp.matchedTurnCount, 1);
    assert.ok(projectByCommandOp.sessions[0].commandOps.includes("sed"));
    assert.ok(projectByCommandOp.turns[0].commandOps.includes("sed"));
  });

  it("prefers touched file roots for session focusRoot over tied search-only roots", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/Users/tester",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-focus",
          cwd: "/Users/tester",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_focus_1",
          turn_id: "turn-focus",
          command: ["/bin/zsh", "-lc", "sed -n '1,20p' Downloads/foo.txt"],
          cwd: "/Users/tester",
          parsed_cmd: [{
            type: "read",
            cmd: "sed -n '1,20p' Downloads/foo.txt",
            name: "foo.txt",
            path: "Downloads/foo.txt",
          }],
          aggregated_output: "download data\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 1 },
          status: "completed",
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_focus_2",
          turn_id: "turn-focus",
          command: ["/bin/zsh", "-lc", "sed -n '1,20p' Library/bar.txt"],
          cwd: "/Users/tester",
          parsed_cmd: [{
            type: "read",
            cmd: "sed -n '1,20p' Library/bar.txt",
            name: "bar.txt",
            path: "Library/bar.txt",
          }],
          aggregated_output: "library data\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 1 },
          status: "completed",
        },
      },
      {
        timestamp: "2026-04-09T17:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call_patch_focus",
          turn_id: "turn-focus",
          success: true,
          changes: {
            "/Users/tester/report.md": { type: "update" },
          },
        },
      },
      {
        timestamp: "2026-04-09T17:10:56.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-focus",
          last_agent_message: "Saved the report",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const session = listCatalogSessions(catalog, { cwd: "/Users/tester" }).sessions[0];
    assert.strictEqual(session.focusRoot, "report.md");
    assert.ok(session.topFocusRoots.some((item) => item.root === "Downloads"));
    assert.ok(session.topFocusRoots.some((item) => item.root === "Library"));
    assert.ok(session.topFocusRoots.some((item) => item.root === "report.md"));
  });

  it("uses exact path artifacts when summary path buckets are truncated", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_read_1",
          turn_id: "turn-3",
          command: ["/bin/zsh", "-lc", "sed -n '1,220p' src/settings-loader.js"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "read",
            cmd: "sed -n '1,220p' src/settings-loader.js",
            path: "src/settings-loader.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "const settings = {};\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 341700000 },
          status: "completed",
        },
      },
    ]);

    writeRollout(dateDir, FILE_D, [
      {
        timestamp: "2026-04-09T18:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137231",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T18:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-4",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T18:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_read_2",
          turn_id: "turn-4",
          command: ["/bin/zsh", "-lc", "nl -ba src/settings-loader.js"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "read",
            cmd: "nl -ba src/settings-loader.js",
            path: "src/settings-loader.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "1 const settings = {};\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 241700000 },
          status: "completed",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const targetPath = "/repo/a/src/settings-loader.js";

    for (const session of catalog.sessions) {
      session.pathsReferenced = [];
      for (const turn of session.turns) turn.pathsReferenced = [];
    }
    catalog.artifacts = buildArtifactCatalog(catalog.sessions);
    catalog.projects = buildProjectCatalog(catalog.sessions);

    const artifacts = listCatalogArtifacts(catalog, {
      kind: "path",
      q: "settings-loader.js",
      pathRole: "read",
    });
    assert.strictEqual(artifacts.total, 1);
    assert.strictEqual(artifacts.artifacts[0].value, targetPath);
    assert.deepStrictEqual(artifacts.artifacts[0].pathRoles, ["read"]);

    const thread = getCatalogPathThread(catalog, "src/settings-loader.js", {
      cwd: "/repo/a",
      pathRole: "read",
      limit: 5,
    });
    assert.ok(thread);
    assert.strictEqual(thread.path, targetPath);
    assert.strictEqual(thread.turnCount, 2);

    const related = getCatalogRelatedSessions(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230");
    assert.ok(related);
    assert.strictEqual(related.total, 1);
    assert.ok(related.sessions[0].shared.paths.includes(targetPath));
  });

  it("stores non-literal command scopes separately from exact path artifacts", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_pattern",
          turn_id: "turn-3",
          command: ["/bin/zsh", "-lc", "rg -n \"feature toggle\" src/**/*.test.js src/history.js"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "search",
            cmd: "rg -n 'feature toggle' 'src/**/*.test.js' src/history.js",
            query: "feature toggle",
            path: "*.test.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "src/history.js:12: feature toggle\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 341700000 },
          status: "completed",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const session = getCatalogSession(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230");
    assert.ok(session);
    assert.ok(!session.artifactSamples.paths.some((value) => value.includes("*.test.js")));
    assert.deepStrictEqual(session.artifactSamples.pathPatterns, ["/repo/a/src/**/*.test.js"]);

    const artifacts = listCatalogArtifacts(catalog, {
      kind: "path_pattern",
      q: "*.test.js",
      cwd: "/repo/a",
      pathRole: "search_scope",
    });
    assert.strictEqual(artifacts.total, 1);
    assert.strictEqual(artifacts.artifacts[0].value, "/repo/a/src/**/*.test.js");
    assert.strictEqual(artifacts.artifacts[0].patternKind, "glob_scope");
    assert.deepStrictEqual(artifacts.artifacts[0].pathRoles, ["search_scope"]);

    const artifact = getCatalogArtifact(catalog, "path_pattern", "./src/**/*.test.js", {
      cwd: "/repo/a",
      pathRole: "search_scope",
    });
    assert.ok(artifact);
    assert.strictEqual(artifact.patternKind, "glob_scope");
    assert.strictEqual(artifact.turnCount, 1);
    assert.deepStrictEqual(artifact.pathRoles, ["search_scope"]);

    const turns = getCatalogArtifactTurns(catalog, "path_pattern", "./src/**/*.test.js", {
      cwd: "/repo/a",
      pathRole: "search_scope",
    });
    assert.ok(turns);
    assert.strictEqual(turns.patternKind, "glob_scope");
    assert.strictEqual(turns.turnCount, 1);
    assert.deepStrictEqual(turns.turns[0].matchValues, ["/repo/a/src/**/*.test.js"]);
    assert.deepStrictEqual(turns.turns[0].matchRoles, ["search_scope"]);

    const transcript = getCatalogTranscript(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230", {
      kind: "tool",
      limit: 5,
    });
    assert.ok(transcript);
    assert.deepStrictEqual(transcript.items[0].commandPathPatterns, ["/repo/a/src/**/*.test.js"]);

    const transcriptByRole = getCatalogTranscript(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230", {
      pathRole: "search_scope",
      limit: 5,
    });
    assert.ok(transcriptByRole);
    assert.strictEqual(transcriptByRole.matchedItems, 1);
    assert.deepStrictEqual(transcriptByRole.items[0].commandPathPatterns, ["/repo/a/src/**/*.test.js"]);
  });

  it("preserves basename-style find filters as path_pattern artifacts", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_pattern",
          turn_id: "turn-3",
          command: ["/bin/zsh", "-lc", "find . -name 'AGENTS.md' -print"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "search",
            cmd: "find . -name 'AGENTS.md' -print",
            query: "AGENTS.md",
            path: ".",
          }],
          source: "unified_exec_startup",
          aggregated_output: "./AGENTS.md\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 341700000 },
          status: "completed",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const session = getCatalogSession(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230");
    assert.ok(session);
    assert.ok(!session.artifactSamples.paths.includes("AGENTS.md"));
    assert.ok(session.artifactSamples.pathPatterns.includes("AGENTS.md"));

    const byPathPattern = listCatalogSessions(catalog, {
      cwd: "/repo/a",
      pathPattern: "AGENTS.md",
    });
    assert.strictEqual(byPathPattern.total, 1);
    assert.deepStrictEqual(byPathPattern.sessions[0].matchedPathPatterns, ["AGENTS.md"]);

    const turnsByPathPattern = searchCatalogTurns(catalog, {
      cwd: "/repo/a",
      pathPattern: "AGENTS.md",
      limit: 10,
    });
    assert.strictEqual(turnsByPathPattern.total, 1);
    assert.deepStrictEqual(turnsByPathPattern.turns[0].matchedPathPatterns, ["AGENTS.md"]);

    const artifacts = listCatalogArtifacts(catalog, {
      kind: "path_pattern",
      q: "AGENTS.md",
      cwd: "/repo/a",
      pathRole: "search_scope",
    });
    assert.strictEqual(artifacts.total, 1);
    assert.strictEqual(artifacts.artifacts[0].value, "AGENTS.md");
    assert.strictEqual(artifacts.artifacts[0].patternKind, "basename_filter");
    assert.deepStrictEqual(artifacts.artifacts[0].pathRoles, ["search_scope"]);

    const artifact = getCatalogArtifact(catalog, "path_pattern", "AGENTS.md", {
      cwd: "/repo/a",
      pathRole: "search_scope",
    });
    assert.ok(artifact);
    assert.strictEqual(artifact.patternKind, "basename_filter");
    assert.strictEqual(artifact.turnCount, 1);
    assert.deepStrictEqual(artifact.pathRoles, ["search_scope"]);

    const turns = getCatalogArtifactTurns(catalog, "path_pattern", "./AGENTS.md", {
      cwd: "/repo/a",
      pathRole: "search_scope",
    });
    assert.ok(turns);
    assert.strictEqual(turns.patternKind, "basename_filter");
    assert.strictEqual(turns.turnCount, 1);
    assert.deepStrictEqual(turns.turns[0].matchValues, ["AGENTS.md"]);
    assert.deepStrictEqual(turns.turns[0].matchRoles, ["search_scope"]);

    const transcript = getCatalogTranscript(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230", {
      kind: "tool",
      limit: 5,
    });
    assert.ok(transcript);
    assert.deepStrictEqual(transcript.items[0].commandPathPatterns, ["AGENTS.md"]);

    const transcriptByPathPattern = getCatalogTranscript(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230", {
      pathPattern: "AGENTS.md",
      pathRole: "search_scope",
      limit: 5,
    });
    assert.ok(transcriptByPathPattern);
    assert.strictEqual(transcriptByPathPattern.matchedItems, 1);
    assert.deepStrictEqual(transcriptByPathPattern.items[0].commandPathPatterns, ["AGENTS.md"]);
  });

  it("classifies command_op signal tiers and prioritizes high-signal artifact browsing", () => {
    const isolated = makeTempSessionDir();
    const signalFile = "rollout-2026-04-09T19-10-51-019d23d4-f1a9-7633-b9c7-758327137232.jsonl";

    try {
      writeRollout(isolated.dateDir, signalFile, [
        {
          timestamp: "2026-04-09T19:10:51.000Z",
          type: "session_meta",
          payload: {
            id: "019d23d4-f1a9-7633-b9c7-758327137232",
            cwd: "/repo/signal",
          },
        },
        {
          timestamp: "2026-04-09T19:10:52.000Z",
          type: "turn_context",
          payload: {
            turn_id: "turn-signal",
            cwd: "/repo/signal",
            model: "gpt-5.4",
          },
        },
        {
          timestamp: "2026-04-09T19:10:53.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            call_id: "call_ls",
            turn_id: "turn-signal",
            command: ["/bin/zsh", "-lc", "ls src"],
            parsed_cmd: [{
              type: "list_files",
              cmd: "ls src",
              path: "src",
            }],
            source: "unified_exec_startup",
            aggregated_output: "file.js\n",
            exit_code: 0,
            duration: { secs: 0, nanos: 1000000 },
            status: "completed",
          },
        },
        {
          timestamp: "2026-04-09T19:10:54.000Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            call_id: "call_sed",
            turn_id: "turn-signal",
            command: ["/bin/zsh", "-lc", "sed -n '1,20p' src/file.js"],
            parsed_cmd: [{
              type: "read",
              cmd: "sed -n '1,20p' src/file.js",
              name: "file.js",
              path: "src/file.js",
            }],
            source: "unified_exec_startup",
            aggregated_output: "const value = 1;\n",
            exit_code: 0,
            duration: { secs: 0, nanos: 1000000 },
            status: "completed",
          },
        },
        {
          timestamp: "2026-04-09T19:10:54.500Z",
          type: "event_msg",
          payload: {
            type: "exec_command_end",
            call_id: "call_python",
            turn_id: "turn-signal",
            command: ["/bin/zsh", "-lc", "python scripts/report.py"],
            parsed_cmd: [{
              type: "exec_command",
              cmd: "python scripts/report.py",
            }],
            source: "unified_exec_startup",
            aggregated_output: "report ok\n",
            exit_code: 0,
            duration: { secs: 0, nanos: 1000000 },
            status: "completed",
          },
        },
      ]);

      const catalog = buildHistoricalCatalog({ sessionDir: isolated.tmpDir });
      const commandOps = listCatalogArtifacts(catalog, { kind: "command_op", limit: 10 });
      assert.strictEqual(commandOps.artifacts[0].value, "sed");
      assert.strictEqual(commandOps.artifacts[0].signalTier, "high");
      assert.strictEqual(commandOps.artifacts[1].value, "python");
      assert.strictEqual(commandOps.artifacts[1].signalTier, "medium");
      assert.strictEqual(commandOps.artifacts[2].value, "ls");
      assert.strictEqual(commandOps.artifacts[2].signalTier, "low");

      const highSignalCommandOps = listCatalogArtifacts(catalog, {
        kind: "command_op",
        commandOpSignal: "high",
        limit: 10,
      });
      assert.deepStrictEqual(highSignalCommandOps.artifacts.map((item) => item.value), ["sed"]);

      const lowSignalMismatch = listCatalogSessions(catalog, {
        cwd: "/repo/signal",
        commandOp: "ls",
        commandOpSignal: "high",
      });
      assert.strictEqual(lowSignalMismatch.total, 0);

      const highSignalSessions = listCatalogSessions(catalog, {
        cwd: "/repo/signal",
        commandOpSignal: "high",
      });
      assert.strictEqual(highSignalSessions.total, 1);
      assert.deepStrictEqual(highSignalSessions.sessions[0].matchedCommandOps, ["sed"]);

      const highSignalTurns = searchCatalogTurns(catalog, {
        cwd: "/repo/signal",
        commandOpSignal: "high",
      });
      assert.strictEqual(highSignalTurns.total, 1);
      assert.deepStrictEqual(highSignalTurns.turns[0].matchedCommandOps, ["sed"]);

      const mediumSignalSessions = listCatalogSessions(catalog, {
        cwd: "/repo/signal",
        commandOpSignal: "medium",
      });
      assert.strictEqual(mediumSignalSessions.total, 1);
      assert.deepStrictEqual(mediumSignalSessions.sessions[0].matchedCommandOps, ["python"]);

      const mediumSignalTurns = searchCatalogTurns(catalog, {
        cwd: "/repo/signal",
        commandOpSignal: "medium",
      });
      assert.strictEqual(mediumSignalTurns.total, 1);
      assert.deepStrictEqual(mediumSignalTurns.turns[0].matchedCommandOps, ["python"]);

      const filteredTranscript = getCatalogTranscript(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137232", {
        commandOpSignal: "high",
        limit: 10,
      });
      assert.ok(filteredTranscript.items.some((item) => Array.isArray(item.shellCommands) && item.shellCommands.includes("sed")));
      assert.ok(!filteredTranscript.items.some((item) => Array.isArray(item.shellCommands) && item.shellCommands.includes("ls")));

      const lowArtifactBlocked = getCatalogArtifact(catalog, "command_op", "ls", {
        commandOpSignal: "high",
      });
      assert.strictEqual(lowArtifactBlocked, null);

      const session = listCatalogSessions(catalog, { cwd: "/repo/signal" }).sessions[0];
      assert.deepStrictEqual(session.commandOps.slice(0, 3), ["sed", "python", "ls"]);

      const topCommandOps = catalog.facets.topCommandOps;
      assert.ok(topCommandOps.some((item) => item.commandOp === "sed" && item.signalTier === "high"));
      assert.ok(topCommandOps.some((item) => item.commandOp === "python" && item.signalTier === "medium"));
      assert.ok(topCommandOps.some((item) => item.commandOp === "ls" && item.signalTier === "low"));
      assert.strictEqual(catalog.facets.topHighSignalCommandOps[0].commandOp, "sed");
      assert.strictEqual(catalog.facets.topHighSignalCommandOps[0].signalTier, "high");
    } finally {
      fs.rmSync(isolated.tmpDir, { recursive: true, force: true });
    }
  });

  it("prefers basename filters over broader path globs for basename path_pattern queries", () => {
    writeRollout(dateDir, FILE_A, [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137228",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-1",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_glob_1",
          turn_id: "turn-1",
          command: ["/bin/zsh", "-lc", "rg -n \"cmake_minimum_required\" design/**/files.cmake CMakeLists.txt"],
          cwd: "/repo/a",
          source: "unified_exec_startup",
          aggregated_output: "design/core/files.cmake:1:cmake_minimum_required\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 141700000 },
          status: "completed",
        },
      },
    ]);

    writeRollout(dateDir, FILE_B, [
      {
        timestamp: "2026-04-09T16:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137229",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T16:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-2",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T16:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_glob_2",
          turn_id: "turn-2",
          command: ["/bin/zsh", "-lc", "rg -n \"cmake_minimum_required\" design/**/files.cmake cmake/entry.txt"],
          cwd: "/repo/a",
          source: "unified_exec_startup",
          aggregated_output: "design/ui/files.cmake:1:cmake_minimum_required\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 141700000 },
          status: "completed",
        },
      },
    ]);

    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_basename",
          turn_id: "turn-3",
          command: ["/bin/zsh", "-lc", "find . -name 'files.cmake' -print"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "search",
            cmd: "find . -name 'files.cmake' -print",
            query: "files.cmake",
            path: ".",
          }],
          source: "unified_exec_startup",
          aggregated_output: "./design/core/files.cmake\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 141700000 },
          status: "completed",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const artifacts = listCatalogArtifacts(catalog, {
      kind: "path_pattern",
      q: "files.cmake",
      cwd: "/repo/a",
      limit: 10,
    });

    assert.strictEqual(artifacts.total, 2);
    assert.strictEqual(artifacts.artifacts[0].value, "files.cmake");
    assert.strictEqual(artifacts.artifacts[0].patternKind, "basename_filter");
    assert.strictEqual(artifacts.artifacts[1].value, "/repo/a/design/**/files.cmake");
    assert.strictEqual(artifacts.artifacts[1].patternKind, "glob_scope");
    assert.ok(artifacts.artifacts[0].sessionCount < artifacts.artifacts[1].sessionCount);
  });

  it("preserves exclude globs as exclude path_pattern artifacts instead of path-like scopes", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_exclude",
          turn_id: "turn-3",
          command: ["/bin/zsh", "-lc", "rg --glob '!build/**' --glob '!dist/**' foo src"],
          cwd: "/repo/a",
          source: "unified_exec_startup",
          aggregated_output: "src/index.js:1:foo\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 141700000 },
          status: "completed",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const session = getCatalogSession(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230");
    assert.ok(session);
    assert.ok(session.artifactSamples.pathPatterns.includes("!build/**"));
    assert.ok(session.artifactSamples.pathPatterns.includes("!dist/**"));
    assert.ok(!session.artifactSamples.pathPatterns.includes("/repo/a/!build/**"));

    const artifacts = listCatalogArtifacts(catalog, {
      kind: "path_pattern",
      q: "!build/**",
      cwd: "/repo/a",
      pathRole: "search_scope",
    });
    assert.strictEqual(artifacts.total, 1);
    assert.strictEqual(artifacts.artifacts[0].value, "!build/**");
    assert.strictEqual(artifacts.artifacts[0].patternKind, "exclude_pattern");

    const artifact = getCatalogArtifact(catalog, "path_pattern", "!build/**", {
      cwd: "/repo/a",
      pathRole: "search_scope",
    });
    assert.ok(artifact);
    assert.strictEqual(artifact.value, "!build/**");
    assert.strictEqual(artifact.patternKind, "exclude_pattern");

    const turns = getCatalogArtifactTurns(catalog, "path_pattern", "!build/**", {
      cwd: "/repo/a",
      pathRole: "search_scope",
    });
    assert.ok(turns);
    assert.strictEqual(turns.value, "!build/**");
    assert.strictEqual(turns.patternKind, "exclude_pattern");

    const transcript = getCatalogTranscript(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230", {
      kind: "tool",
      limit: 5,
    });
    assert.ok(transcript);
    assert.deepStrictEqual(transcript.items[0].commandPathPatterns, ["!build/**", "!dist/**"]);
  });

  it("requires disambiguation when an exact relative path matches multiple workspaces", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_read_a",
          turn_id: "turn-3",
          command: ["/bin/zsh", "-lc", "sed -n '1,120p' src/history.js"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "read",
            cmd: "sed -n '1,120p' src/history.js",
            path: "src/history.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "console.log('a');\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 341700000 },
          status: "completed",
        },
      },
    ]);

    writeRollout(dateDir, FILE_D, [
      {
        timestamp: "2026-04-09T18:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137231",
          cwd: "/repo/b",
        },
      },
      {
        timestamp: "2026-04-09T18:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-4",
          cwd: "/repo/b",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T18:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_read_b",
          turn_id: "turn-4",
          command: ["/bin/zsh", "-lc", "sed -n '1,120p' src/history.js"],
          cwd: "/repo/b",
          parsed_cmd: [{
            type: "read",
            cmd: "sed -n '1,120p' src/history.js",
            path: "src/history.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "console.log('b');\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 241700000 },
          status: "completed",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });

    const ambiguous = getCatalogArtifactTurns(catalog, "path", "src/history.js");
    assert.strictEqual(ambiguous, null);

    const scoped = getCatalogArtifactTurns(catalog, "path", "src/history.js", {
      cwd: "/repo/a",
    });
    assert.ok(scoped);
    assert.strictEqual(scoped.value, "/repo/a/src/history.js");
    assert.strictEqual(scoped.turnCount, 1);
  });

  it("turns raw command text into searchable path and query memory when parsed_cmd is missing", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_3",
          arguments: "{\"cmd\":\"rg -n \\\"ENABLE_DASHBOARD\\\" src/feature.js\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_3",
          turn_id: "turn-3",
          command: ["/bin/zsh", "-lc", "git diff -- src/feature.js"],
          cwd: "/repo/a",
          source: "unified_exec_startup",
          aggregated_output: "diff --git a/src/feature.js b/src/feature.js\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 341700000 },
          status: "completed",
        },
      },
      {
        timestamp: "2026-04-09T17:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-3",
          last_agent_message: "Checked the dashboard flag and the feature diff",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const byPath = listCatalogSessions(catalog, { path: "src/feature.js" });
    assert.strictEqual(byPath.total, 2);
    assert.ok(byPath.sessions.some((session) =>
      session.sessionId === "codex:019d23d4-f1a9-7633-b9c7-758327137230" &&
      session.pathsReferenced.includes("/repo/a/src/feature.js")
    ));

    const queries = listCatalogArtifacts(catalog, { kind: "query", q: "ENABLE_DASHBOARD" });
    assert.strictEqual(queries.total, 1);
    assert.strictEqual(queries.artifacts[0].value, "ENABLE_DASHBOARD");

    const turns = searchCatalogTurns(catalog, {
      path: "src/feature.js",
      commandType: "read",
      cwd: "/repo/a",
    });
    assert.strictEqual(turns.total, 1);
    assert.ok(turns.turns[0].pathsReferenced.includes("/repo/a/src/feature.js"));
    assert.ok(turns.turns[0].commandTypes.includes("read"));
    assert.ok(queryTexts(turns.turns[0].queries).includes("ENABLE_DASHBOARD"));
  });

  it("builds a grouped path lineage thread with anchors and paired command events", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "Inspect and update the settings loader",
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_lineage",
          arguments: "{\"cmd\":\"sed -n '1,220p' src/settings-loader.js\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T17:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_lineage",
          turn_id: "turn-3",
          command: ["/bin/zsh", "-lc", "sed -n '1,220p' src/settings-loader.js"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "read",
            cmd: "sed -n '1,220p' src/settings-loader.js",
            name: "settings-loader.js",
            path: "src/settings-loader.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "const settings = {};\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 341700000 },
          status: "completed",
        },
      },
      {
        timestamp: "2026-04-09T17:10:56.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call_patch_lineage",
          turn_id: "turn-3",
          success: true,
          changes: {
            "/repo/a/src/settings-loader.js": { type: "update" },
          },
        },
      },
      {
        timestamp: "2026-04-09T17:10:57.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-3",
          last_agent_message: "Updated the settings loader after inspection",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const thread = getCatalogPathThread(catalog, "src/settings-loader.js", {
      cwd: "/repo/a",
      limit: 5,
      eventLimit: 10,
    });

    assert.ok(thread);
    assert.strictEqual(thread.path, "/repo/a/src/settings-loader.js");
    assert.strictEqual(thread.sessionCount, 1);
    assert.strictEqual(thread.turnCount, 1);
    assert.strictEqual(thread.threads[0].turnId, "turn-3");
    assert.ok(thread.threads[0].actions.includes("read"));
    assert.ok(thread.threads[0].actions.includes("patch"));
    assert.ok(thread.threads[0].actions.includes("answer"));
    assert.ok(thread.threads[0].commands.some((value) => /settings-loader/.test(value)));
    assert.ok(thread.threads[0].events.some((event) => event.kind === "turn_context"));
    assert.ok(thread.threads[0].events.some((event) => event.kind === "message" && event.role === "user"));
    assert.ok(thread.threads[0].events.some((event) => event.kind === "tool_call" && /settings-loader/.test(event.command || "")));
    assert.ok(thread.threads[0].events.some((event) => event.kind === "tool_output" && Array.isArray(event.commandPaths) && event.commandPaths.includes("/repo/a/src/settings-loader.js")));
    assert.ok(thread.threads[0].events.some((event) => event.kind === "patch" && event.filesTouched.includes("/repo/a/src/settings-loader.js")));
    assert.ok(thread.threads[0].events.some((event) => event.kind === "turn_lifecycle" && /Updated the settings loader/.test(event.detail || "")));
  });

  it("indexes harness command queries and links related sessions by shared artifacts", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: { id: "019d23d4-f1a9-7633-b9c7-758327137230", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-3", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_search_1",
          turn_id: "turn-3",
          command: ["/bin/zsh", "-lc", "rg -n \"ENABLE_EXPERIMENTAL_DASHBOARD\" src/feature.js"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "search",
            cmd: "rg -n \"ENABLE_EXPERIMENTAL_DASHBOARD\" src/feature.js",
            query: "ENABLE_EXPERIMENTAL_DASHBOARD",
            path: "src/feature.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "12:const ENABLE_EXPERIMENTAL_DASHBOARD = true;\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 341700000 },
          status: "completed",
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-3",
          last_agent_message: "Found the experimental dashboard flag",
        },
      },
    ]);

    writeRollout(dateDir, FILE_D, [
      {
        timestamp: "2026-04-09T18:10:51.000Z",
        type: "session_meta",
        payload: { id: "019d23d4-f1a9-7633-b9c7-758327137231", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T18:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-4", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T18:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_search_2",
          turn_id: "turn-4",
          command: ["/bin/zsh", "-lc", "rg -n \"ENABLE_EXPERIMENTAL_DASHBOARD\" src/feature.js"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "search",
            cmd: "rg -n \"ENABLE_EXPERIMENTAL_DASHBOARD\" src/feature.js",
            query: "ENABLE_EXPERIMENTAL_DASHBOARD",
            path: "src/feature.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "12:const ENABLE_EXPERIMENTAL_DASHBOARD = true;\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 241700000 },
          status: "completed",
        },
      },
      {
        timestamp: "2026-04-09T18:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-4",
          last_agent_message: "Confirmed the same flag in a follow-up session",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });

    const queries = listCatalogArtifacts(catalog, {
      kind: "query",
      q: "ENABLE_EXPERIMENTAL_DASHBOARD",
    });
    assert.strictEqual(queries.total, 1);
    assert.strictEqual(queries.artifacts[0].value, "ENABLE_EXPERIMENTAL_DASHBOARD");

    const sessionsByQuery = listCatalogSessions(catalog, {
      query: "ENABLE_EXPERIMENTAL_DASHBOARD",
      cwd: "/repo/a",
      limit: 10,
    });
    assert.strictEqual(sessionsByQuery.total, 2);
    assert.deepStrictEqual(sessionsByQuery.sessions[0].matchedQueries, ["ENABLE_EXPERIMENTAL_DASHBOARD"]);
    assert.deepStrictEqual(sessionsByQuery.sessions[0].match, {
      kind: "query",
      text: "ENABLE_EXPERIMENTAL_DASHBOARD",
      signalTier: "high",
    });

    const fuzzySessionsByQuery = listCatalogSessions(catalog, {
      query: "ENABLE_EXPERIMENTAL_DASHBAORD",
      queryMode: "fuzzy",
      cwd: "/repo/a",
      limit: 10,
    });
    assert.strictEqual(fuzzySessionsByQuery.queryMode, "fuzzy");
    assert.strictEqual(fuzzySessionsByQuery.total, 2);
    assert.deepStrictEqual(fuzzySessionsByQuery.querySignalSummary, {
      onlyLowSignal: false,
      examples: [],
    });
    assert.deepStrictEqual(fuzzySessionsByQuery.sessions[0].match, {
      kind: "query",
      text: "ENABLE_EXPERIMENTAL_DASHBOARD",
      signalTier: "high",
    });

    const noisyQuerySession = catalog.sessions.find((session) => session.sessionId === "codex:019d23d4-f1a9-7633-b9c7-758327137228");
    assert.ok(noisyQuerySession);
    noisyQuerySession.recentQueries.unshift({
      timestamp: "2026-04-09T15:10:57.000Z",
      query: "site:developers.openai.com Codex hooks AGENTS MCP app server config shell",
      actionType: "search",
    });
    noisyQuerySession.queryArtifacts.push(
      "matchedPathPatterns|AGENTS.md|transcriptByPathPattern|pathRole: \\\"search_scope\\\"|getCatalogTranscript\\(",
      "matchedPathPatterns|AGENTS.md|transcriptByPathPattern|pathRole: \"search_scope\"|getCatalogTranscript("
    );
    noisyQuerySession.turns[0].queries.unshift({
      timestamp: "2026-04-09T15:10:57.000Z",
      query: "site:developers.openai.com Codex hooks AGENTS MCP app server config shell",
      actionType: "search",
    });
    noisyQuerySession.turns[0].queryArtifacts.push(
      "matchedPathPatterns|AGENTS.md|transcriptByPathPattern|pathRole: \\\"search_scope\\\"|getCatalogTranscript\\(",
      "matchedPathPatterns|AGENTS.md|transcriptByPathPattern|pathRole: \"search_scope\"|getCatalogTranscript("
    );

    const fuzzySessionsByNoisyQuery = listCatalogSessions(catalog, {
      query: "AGNTS",
      queryMode: "fuzzy",
      sessionId: noisyQuerySession.sessionId,
      limit: 10,
    });
    assert.deepStrictEqual(fuzzySessionsByNoisyQuery.sessions[0].matchedQueries, [
      "site:developers.openai.com Codex hooks AGENTS MCP app server config shell",
    ]);

    const fuzzySessionsByQ = listCatalogSessions(catalog, {
      q: "implemnt feature toggle",
      qMode: "fuzzy",
      cwd: "/repo/a",
      limit: 10,
    });
    assert.strictEqual(fuzzySessionsByQ.qMode, "fuzzy");
    assert.strictEqual(fuzzySessionsByQ.total, 1);
    assert.deepStrictEqual(fuzzySessionsByQ.sessions[0].match, {
      kind: "user",
      text: "Implement feature toggle search",
    });

    const turns = searchCatalogTurns(catalog, {
      query: "ENABLE_EXPERIMENTAL_DASHBOARD",
      q: "ENABLE_EXPERIMENTAL_DASHBOARD",
      cwd: "/repo/a",
      limit: 10,
    });
    assert.strictEqual(turns.total, 2);
    assert.ok(turns.turns.every((turn) => queryTexts(turn.queries).includes("ENABLE_EXPERIMENTAL_DASHBOARD")));
    assert.deepStrictEqual(turns.turns[0].matchedQueries, ["ENABLE_EXPERIMENTAL_DASHBOARD"]);

    const fuzzyTurnsByNoisyQuery = searchCatalogTurns(catalog, {
      query: "AGNTS",
      queryMode: "fuzzy",
      sessionId: noisyQuerySession.sessionId,
      limit: 10,
    });
    assert.strictEqual(fuzzyTurnsByNoisyQuery.total, 1);
    assert.deepStrictEqual(fuzzyTurnsByNoisyQuery.turns[0].matchedQueries, [
      "site:developers.openai.com Codex hooks AGENTS MCP app server config shell",
    ]);

    const transcript = getCatalogTranscript(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230", {
      query: "ENABLE_EXPERIMENTAL_DASHBOARD",
      limit: 10,
    });
    assert.ok(transcript);
    assert.strictEqual(transcript.matchedItems, 1);
    assert.deepStrictEqual(transcript.items[0].matchedQueries, ["ENABLE_EXPERIMENTAL_DASHBOARD"]);

    const events = getCatalogEvents(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230", {
      query: "ENABLE_EXPERIMENTAL_DASHBOARD",
      limit: 10,
    });
    assert.ok(events);
    assert.strictEqual(events.matchedEvents, 1);
    assert.deepStrictEqual(events.events[0].matchedQueries, ["ENABLE_EXPERIMENTAL_DASHBOARD"]);

    const related = getCatalogRelatedSessions(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230");
    assert.ok(related);
    assert.strictEqual(related.scopeCwd, "/repo/a");
    assert.strictEqual(related.total, 2);
    assert.strictEqual(related.sessions[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137231");
    assert.ok(related.sessions[0].shared.paths.includes("/repo/a/src/feature.js"));
    assert.ok(related.sessions[0].shared.queries.includes("ENABLE_EXPERIMENTAL_DASHBOARD"));
    assert.strictEqual(related.sessions[0].matchedTurnCount, 1);

    const compactRelated = getCatalogRelatedSessions(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230", {
      shape: "compact",
    });
    assert.strictEqual(compactRelated.shape, "compact");
    assert.ok(compactRelated.source);
    assert.strictEqual(compactRelated.source.pathsReferenced, undefined);
    assert.strictEqual(compactRelated.source.artifactSamples, undefined);
    assert.strictEqual(compactRelated.total, 2);
    assert.strictEqual(compactRelated.sessions[0].filePath, undefined);
    assert.ok(Array.isArray(compactRelated.sessions[0].shared.paths));
  });

  it("ignores low-signal boilerplate commands when linking related sessions", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: { id: "019d23d4-f1a9-7633-b9c7-758327137230", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-3", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_status_1",
          arguments: "{\"cmd\":\"git status --short\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_diff_1",
          arguments: "{\"cmd\":\"git diff --stat\",\"workdir\":\"/repo/a\"}",
        },
      },
    ]);

    writeRollout(dateDir, FILE_D, [
      {
        timestamp: "2026-04-09T18:10:51.000Z",
        type: "session_meta",
        payload: { id: "019d23d4-f1a9-7633-b9c7-758327137231", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T18:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-4", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T18:10:53.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_status_2",
          arguments: "{\"cmd\":\"git status --short\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T18:10:54.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_diff_2",
          arguments: "{\"cmd\":\"git diff --stat\",\"workdir\":\"/repo/a\"}",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const related = getCatalogRelatedSessions(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230");
    assert.ok(related);
    assert.strictEqual(related.total, 0);
  });

  it("returns an exact turn trace with resolved turn membership", () => {
    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const turn = getCatalogTurn(
      catalog,
      "codex:019d23d4-f1a9-7633-b9c7-758327137228",
      "turn-1"
    );

    assert.ok(turn);
    assert.strictEqual(turn.turn.turnId, "turn-1");
    assert.strictEqual(turn.turn.status, "completed");
    assert.match(turn.turn.userPromptPreview, /Implement feature toggle search/);
    assert.strictEqual(turn.events[0].turnId, "turn-1");
    assert.strictEqual(turn.events[0].kind, "turn_context");
    assert.ok(turn.events.some((event) => event.kind === "message" && /Implement feature toggle search/.test(event.detail || "")));
    assert.ok(turn.events.some((event) => event.kind === "tool_call" && /git status --short/.test(event.command || "")));
    assert.ok(turn.events.some((event) => event.kind === "turn_lifecycle" && /Feature toggle implementation completed/.test(event.detail || "")));
  });

  it("compacts adjacent duplicate timeline events in a turn trace", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/c",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/c",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          phase: "final_answer",
          message: "done",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          phase: "final_answer",
          message: "done",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const turn = getCatalogTurn(
      catalog,
      "codex:019d23d4-f1a9-7633-b9c7-758327137230",
      "turn-3"
    );

    assert.ok(turn);
    const assistantFinalMessages = turn.events.filter((event) =>
      event.kind === "message" &&
      event.role === "assistant" &&
      event.phase === "final_answer" &&
      event.detail === "done"
    );
    assert.strictEqual(assistantFinalMessages.length, 1);
  });

  it("keeps deeper session text searchable beyond a tiny fixed item cap", () => {
    const records = [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/c",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/c",
          model: "gpt-5.4",
        },
      },
    ];

    for (let index = 0; index < 120; index += 1) {
      records.push({
        timestamp: new Date(Date.parse("2026-04-09T17:10:53.000Z") + (index * 1000)).toISOString(),
        type: "event_msg",
        payload: {
          type: "user_message",
          message: index === 0
            ? "historical needle from the beginning of a long session"
            : `filler message ${index}`,
        },
      });
    }

    writeRollout(dateDir, FILE_C, records);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const result = listCatalogSessions(catalog, { q: "historical needle from the beginning" });
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.sessions[0].cwd, "/repo/c");
  });

  it("exposes a normalized event timeline for a session", () => {
    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const events = getCatalogEvents(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      tool: "exec_command",
      limit: 5,
    });

    assert.ok(events);
    assert.strictEqual(events.sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137228");
    assert.strictEqual(events.matchedEvents, 1);
    assert.strictEqual(events.events.length, 1);
    assert.strictEqual(events.events[0].kind, "tool_call");
    assert.match(events.events[0].command, /git status --short/);
  });

  it("filters the event timeline by resolved turn id", () => {
    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const events = getCatalogEvents(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      turn: "turn-1",
      limit: 20,
    });

    assert.ok(events);
    assert.ok(events.matchedEvents >= 4);
    assert.ok(events.events.every((event) => event.turnId === "turn-1"));
    assert.ok(events.events.some((event) => event.kind === "message"));
  });

  it("builds a readable transcript with paired tool output and skips duplicate completion text", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/c",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/c",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "inspect the history backend",
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_transcript",
          arguments: "{\"cmd\":\"sed -n '1,120p' src/history.js\",\"workdir\":\"/repo/c\"}",
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.100Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_transcript",
          turn_id: "turn-3",
          command: ["/bin/zsh", "-lc", "sed -n '1,120p' src/history.js"],
          cwd: "/repo/c",
          parsed_cmd: [{
            type: "read",
            cmd: "sed -n '1,120p' src/history.js",
            path: "src/history.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "history layer\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 141700000 },
          status: "completed",
        },
      },
      {
        timestamp: "2026-04-09T17:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          phase: "final_answer",
          message: "history parser looks correct",
        },
      },
      {
        timestamp: "2026-04-09T17:10:55.050Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          content: [{ type: "output_text", text: "history parser looks correct" }],
        },
      },
      {
        timestamp: "2026-04-09T17:10:55.100Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-3",
          last_agent_message: "history parser looks correct",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const transcript = getCatalogTranscript(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230", {
      limit: 10,
    });
    assert.ok(transcript);
    assert.strictEqual(transcript.totalItems, 3);
    assert.strictEqual(transcript.matchedItems, 3);
    assert.deepStrictEqual(transcript.items.map((item) => item.type), ["user", "tool", "assistant"]);

    const toolItem = transcript.items[1];
    assert.strictEqual(toolItem.stage, "paired");
    assert.strictEqual(toolItem.toolName, "exec_command");
    assert.strictEqual(toolItem.command, "sed -n '1,120p' src/history.js");
    assert.deepStrictEqual(toolItem.commandTypes, ["read"]);
    assert.deepStrictEqual(toolItem.commandPaths, ["/repo/c/src/history.js"]);
    assert.strictEqual(toolItem.exitCode, 0);
    assert.match(toolItem.text, /history layer/);

    const filtered = getCatalogTranscript(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230", {
      path: "history.js",
      commandType: "read",
      kind: "tool",
    });
    assert.ok(filtered);
    assert.strictEqual(filtered.matchedItems, 1);
    assert.strictEqual(filtered.items[0].type, "tool");
  });

  it("preserves rollout error metadata in transcripts and filters by request id", () => {
    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const transcript = getCatalogTranscript(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137229", {
      error: "req_123",
    });

    assert.ok(transcript);
    assert.strictEqual(transcript.matchedItems, 1);
    assert.strictEqual(transcript.items[0].type, "error");
    assert.strictEqual(transcript.items[0].errorCode, "other");
    assert.strictEqual(transcript.items[0].statusCode, 401);
    assert.strictEqual(transcript.items[0].errorRequestId, "req_123");
    assert.strictEqual(transcript.items[0].errorUrl, "https://api.openai.com/v1/responses");
    assert.match(transcript.items[0].detail, /req_123/);
    assert.match(transcript.items[0].detail, /api\.openai\.com\/v1\/responses/);
  });

  it("keeps transcript error filters scoped to actual error items", () => {
    const localFile = "rollout-2026-04-09T21-10-51-019d23d4-f1a9-7633-b9c7-758327137299.jsonl";
    writeRollout(dateDir, localFile, [
      {
        timestamp: "2026-04-09T21:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137299",
          cwd: "/repo/error",
        },
      },
      {
        timestamp: "2026-04-09T21:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-error-only",
          cwd: "/repo/error",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T21:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "note this request id req_shadow_1 in the prompt",
        },
      },
      {
        timestamp: "2026-04-09T21:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "error",
          message: "unexpected status 500 Internal Server Error, url: https://api.openai.com/v1/responses, request id: req_shadow_1",
          codex_error_info: "other",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const transcript = getCatalogTranscript(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137299", {
      error: "req_shadow_1",
    });

    assert.ok(transcript);
    assert.strictEqual(transcript.matchedItems, 1);
    assert.strictEqual(transcript.items[0].type, "error");
    assert.strictEqual(transcript.items[0].errorRequestId, "req_shadow_1");
  });

  it("deduplicates adjacent identical reasoning items in a transcript", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/c",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/c",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "inspect the reasoning stream",
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "agent_reasoning",
          text: "**Checking binary help output**",
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.002Z",
        type: "event_msg",
        payload: {
          type: "agent_reasoning",
          text: "**Checking binary help output**",
        },
      },
      {
        timestamp: "2026-04-09T17:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          phase: "final_answer",
          message: "done",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const transcript = getCatalogTranscript(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230", {
      limit: 10,
    });

    assert.ok(transcript);
    assert.strictEqual(transcript.totalItems, 3);
    assert.deepStrictEqual(transcript.items.map((item) => item.type), ["user", "reasoning", "assistant"]);
    assert.strictEqual(transcript.items[1].text, "**Checking binary help output**");
  });

  it("keeps shell command structure for multiline command transcripts without fake paths", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/c",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/c",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_transcript",
          arguments: JSON.stringify({
            cmd: "tail -n 120\necho \"BUILD_STATUS=$status\"\nexit $status",
            workdir: "/repo/c",
          }),
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_transcript",
          turn_id: "turn-3",
          command: ["/bin/zsh", "-lc", "tail -n 120\necho \"BUILD_STATUS=$status\"\nexit $status"],
          cwd: "/repo/c",
          source: "unified_exec_startup",
          aggregated_output: "BUILD_STATUS=0\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 141700000 },
          status: "completed",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const transcript = getCatalogTranscript(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230", {
      limit: 10,
    });

    assert.ok(transcript);
    assert.strictEqual(transcript.totalItems, 1);
    assert.strictEqual(transcript.items[0].type, "tool");
    assert.deepStrictEqual(transcript.items[0].commandPaths, []);
    assert.deepStrictEqual(transcript.items[0].commandTypeHints, ["read"]);
    assert.deepStrictEqual(transcript.items[0].shellCommands, ["tail", "echo", "exit"]);

    const ops = listCatalogArtifacts(catalog, {
      kind: "command_op",
    });
    assert.ok(ops.artifacts.some((item) => item.value === "tail"));
    assert.ok(ops.artifacts.some((item) => item.value === "echo"));
    assert.ok(ops.artifacts.some((item) => item.value === "exit"));

    const opTurns = getCatalogArtifactTurns(catalog, "command_op", "tail", {
      limit: 10,
    });
    assert.ok(opTurns);
    assert.strictEqual(opTurns.turnCount, 1);
    assert.strictEqual(opTurns.turns[0].turnId, "turn-3");
    assert.deepStrictEqual(opTurns.turns[0].matchValues, ["tail"]);
  });

  it("builds a bounded resume view with explicit shaping and omitted read output", () => {
    writeRollout(dateDir, FILE_C, [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137230",
          cwd: "/repo/c",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-3",
          cwd: "/repo/c",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T17:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "Inspect the session memory shaping and keep only the useful important details for a later safe resume into Codex without noisy file dumps.",
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_read",
          turn_id: "turn-3",
          command: ["/bin/zsh", "-lc", "sed -n '1,120p' src/history.js"],
          cwd: "/repo/c",
          parsed_cmd: [{
            type: "read",
            cmd: "sed -n '1,120p' src/history.js",
            path: "src/history.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 241700000 },
          status: "completed",
        },
      },
      {
        timestamp: "2026-04-09T17:10:54.500Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_search",
          turn_id: "turn-3",
          command: ["/bin/zsh", "-lc", "rg -n \"history layer\" src/history.js"],
          cwd: "/repo/c",
          parsed_cmd: [{
            type: "search",
            cmd: "rg -n \"history layer\" src/history.js",
            query: "history layer",
            path: "src/history.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "2:history layer\n15:history layer extra context\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 141700000 },
          status: "completed",
        },
      },
      {
        timestamp: "2026-04-09T17:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "context_compacted",
          replacement_history: [{ role: "assistant", content: "older context" }],
          message: "Older context compacted into a summary block",
        },
      },
      {
        timestamp: "2026-04-09T17:10:56.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          phase: "final_answer",
          message: "The resume layer now keeps searches and changed files visible while omitting noisy read output by default.",
        },
      },
      {
        timestamp: "2026-04-09T17:10:56.100Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-3",
          last_agent_message: "The resume layer now keeps searches and changed files visible while omitting noisy read output by default.",
        },
      },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir });
    const resume = getCatalogResume(catalog, "codex:019d23d4-f1a9-7633-b9c7-758327137230", {
      totalChars: 1200,
      itemChars: 90,
      toolChars: 70,
      lineLimit: 3,
      turnLimit: 1,
      itemLimit: 6,
      toolText: "salient",
      trimStrategy: "middle",
    });

    assert.ok(resume);
    assert.strictEqual(resume.compactions.count, 1);
    assert.strictEqual(resume.turns.length, 1);
    assert.ok(resume.shaping.operationsApplied.includes("omit_read_and_listing_output"));
    assert.ok(resume.shaping.operationsApplied.includes("path_focus=role_annotated_recent"));
    assert.ok(resume.text.length <= 1200);
    assert.match(resume.text, /\[output omitted: read_output\]/);
    assert.match(resume.text, /history layer/);
    assert.match(resume.text, /Path focus:/);
    assert.match(resume.text, /src\/history\.js \[read, search\]/);

    const pathHighlight = resume.highlights.pathHighlights.find((entry) => entry.path === "/repo/c/src/history.js");
    assert.ok(pathHighlight);
    assert.ok(pathHighlight.roles.includes("read"));
    assert.ok(pathHighlight.roles.includes("search_scope"));
    assert.ok(resume.highlights.pathsRead.includes("/repo/c/src/history.js"));
    assert.ok(resume.highlights.searchScopes.includes("/repo/c/src/history.js"));

    const readItem = resume.turns[0].items.find((item) => item.command && item.command.includes("sed -n"));
    assert.ok(readItem);
    assert.strictEqual(readItem.textMode, "omitted");
    assert.strictEqual(readItem.omissionReason, "read_output");

    const searchItem = resume.turns[0].items.find((item) => item.command && item.command.includes("rg -n"));
    assert.ok(searchItem);
    assert.strictEqual(searchItem.textMode, "salient");
    assert.match(searchItem.text, /history layer/);
  });
});

describe("session evidence wiring", () => {
  it("captures thread names, collab agent spawns, and guardian counts on session docs", () => {
    const { tmpDir, dateDir } = makeTempSessionDir();
    try {
      writeRollout(dateDir, FILE_A, [
        {
          timestamp: "2026-04-09T15:10:51.000Z",
          type: "session_meta",
          payload: { id: "019d23d4-f1a9-7633-b9c7-758327137228", cwd: "/repo/wire" },
        },
        {
          timestamp: "2026-04-09T15:10:52.000Z",
          type: "event_msg",
          payload: { type: "task_started", turn_id: "turn-1" },
        },
        {
          timestamp: "2026-04-09T15:10:53.000Z",
          type: "event_msg",
          payload: {
            type: "thread_name_updated",
            thread_id: "019d23d4-f1a9-7633-b9c7-758327137228",
            thread_name: "Wire evidence probe",
          },
        },
        {
          timestamp: "2026-04-09T15:10:54.000Z",
          type: "event_msg",
          payload: {
            type: "collab_agent_spawn_end",
            call_id: "call-spawn",
            sender_thread_id: "019d23d4-f1a9-7633-b9c7-758327137228",
            new_thread_id: "019d23d4-aaaa-7633-b9c7-758327137aaa",
            new_agent_nickname: "Herschel",
            new_agent_role: "explorer",
            model: "gpt-5.4-mini",
            prompt: "Explore the wiring",
            status: "pending_init",
          },
        },
        {
          timestamp: "2026-04-09T15:10:55.000Z",
          type: "event_msg",
          payload: {
            type: "guardian_assessment",
            id: "assessment-1",
            target_item_id: "call-risky",
            turn_id: "turn-1",
            status: "in_progress",
            action: { type: "command", command: "rm -rf build", cwd: "/repo/wire" },
          },
        },
        {
          timestamp: "2026-04-09T15:10:56.000Z",
          type: "event_msg",
          payload: { type: "task_complete", turn_id: "turn-1", last_agent_message: "wired" },
        },
      ]);

      const catalog = buildHistoricalCatalog({ sessionDir: tmpDir, historyMode: "effective" });
      const session = catalog.sessions.find(
        (item) => item.sessionId === "codex:019d23d4-f1a9-7633-b9c7-758327137228"
      );
      assert.ok(session);
      assert.strictEqual(session.threadName, "Wire evidence probe");
      assert.strictEqual(session.guardianCount, 1);
      assert.deepStrictEqual(session.collabAgentSpawns, [{
        threadId: "codex:019d23d4-aaaa-7633-b9c7-758327137aaa",
        agentNickname: "Herschel",
        agentRole: "explorer",
        model: "gpt-5.4-mini",
      }]);

      const summary = getCatalogSession(catalog, session.sessionId, {});
      assert.strictEqual(summary.threadName, "Wire evidence probe");
      assert.strictEqual(summary.guardianCount, 1);
      assert.strictEqual(summary.collabAgentSpawns.length, 1);

      // Name and spawned-agent nickname are searchable evidence.
      const byName = listCatalogSessions(catalog, { q: "Wire evidence probe" });
      assert.strictEqual(byName.total, 1);
      const byAgent = listCatalogSessions(catalog, { q: "Herschel" });
      assert.strictEqual(byAgent.total, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("implicit turn synthesis", () => {
  it("keeps implicit turn ids aligned across catalog build and event reads when a rollback drops a turn", () => {
    const { tmpDir, dateDir } = makeTempSessionDir();
    try {
      runImplicitTurnRollbackScenario(tmpDir, dateDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function runImplicitTurnRollbackScenario(tmpDir, dateDir) {
    const fileName = "rollout-2025-09-09T10-00-00-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl";
    writeRollout(dateDir, fileName, [
      {
        timestamp: "2025-09-09T10:00:00.000Z",
        type: "session_meta",
        payload: { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", cwd: "/repo/implicit" },
      },
      { timestamp: "2025-09-09T10:00:01.000Z", type: "message", role: "user", content: "first real user turn" },
      { timestamp: "2025-09-09T10:00:02.000Z", type: "message", role: "assistant", content: "answer one" },
      { timestamp: "2025-09-09T10:00:03.000Z", type: "message", role: "user", content: "second real user turn" },
      { timestamp: "2025-09-09T10:00:04.000Z", type: "message", role: "assistant", content: "answer two" },
      {
        timestamp: "2025-09-09T10:00:05.000Z",
        type: "event_msg",
        payload: { type: "thread_rolled_back", num_turns: 1 },
      },
      { timestamp: "2025-09-09T10:00:06.000Z", type: "message", role: "user", content: "third user turn after rollback" },
      { timestamp: "2025-09-09T10:00:07.000Z", type: "message", role: "assistant", content: "answer three" },
    ]);

    const catalog = buildHistoricalCatalog({ sessionDir: tmpDir, historyMode: "effective" });
    const session = catalog.sessions.find(
      (item) => item.sessionId === "codex:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    );
    assert.ok(session);
    // Rolled-back implicit-2 is excluded from effective history; the surviving
    // turn keeps the id minted by the event reader (implicit-3), so drilldowns
    // resolve on both paths.
    assert.deepStrictEqual(session.turns.map((turn) => turn.turnId), ["implicit-1", "implicit-3"]);

    for (const turnId of ["implicit-1", "implicit-3"]) {
      const turn = getCatalogTurn(catalog, session.sessionId, turnId, {});
      assert.ok(turn, `turn ${turnId} should resolve`);
      assert.ok(turn.events.length > 0, `turn ${turnId} should have drillable events`);
    }
  }
});
