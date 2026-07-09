const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createHistoryStore, HISTORY_INDEX_VERSION } = require("../history-store");

function makeTempDirs() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-history-store-"));
  const sessionDir = path.join(rootDir, "sessions");
  const dateDir = path.join(sessionDir, "2026", "04", "09");
  const indexDir = path.join(rootDir, "index");
  fs.mkdirSync(dateDir, { recursive: true });
  return { rootDir, sessionDir, dateDir, indexDir };
}

function writeRollout(dateDir, fileName, records) {
  fs.writeFileSync(path.join(dateDir, fileName), records.map((record) => JSON.stringify(record)).join("\n") + "\n");
}

const FILE_A = "rollout-2026-04-09T15-10-51-019d23d4-f1a9-7633-b9c7-758327137228.jsonl";
const FILE_B = "rollout-2026-04-09T16-10-51-019d23d4-f1a9-7633-b9c7-758327137229.jsonl";

describe("history store", () => {
  let rootDir;
  let sessionDir;
  let dateDir;
  let indexDir;

  beforeEach(() => {
    ({ rootDir, sessionDir, dateDir, indexDir } = makeTempDirs());
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("persists session docs and reuses unchanged rollout files", () => {
    writeRollout(dateDir, FILE_A, [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137228",
          cwd: "/repo/a",
          memory_mode: "disabled",
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
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_1",
          arguments: "{\"cmd\":\"git status --short\",\"workdir\":\"/repo/a\"}",
        },
      },
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    const first = store.getStats(true);
    assert.strictEqual(first.sessionCount, 1);
    assert.strictEqual(first.rebuiltFiles, 1);
    assert.strictEqual(first.reusedFiles, 0);
    assert.strictEqual(first.extendedEventSessions, 0);
    assert.deepStrictEqual(first.memoryModeCounts, { disabled: 1 });
    assert.deepStrictEqual(first.eventModeCounts, { limited_or_unknown: 1 });
    assert.ok(first.topActiveTools.some((item) => item.tool === "exec_command" && item.count === 1));

    const second = store.getStats(true);
    assert.strictEqual(second.rebuiltFiles, 0);
    assert.strictEqual(second.reusedFiles, 1);
    assert.strictEqual(second.reuseCandidates, 1);
    assert.strictEqual(second.reuseFailures, 0);
    assert.deepStrictEqual(second.reuseFailureCounts, {});

    writeRollout(dateDir, FILE_A, [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "019d23d4-f1a9-7633-b9c7-758327137228",
          cwd: "/repo/a",
          memory_mode: "disabled",
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
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_1",
          arguments: "{\"cmd\":\"git status --short\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          last_agent_message: "finished indexing",
        },
      },
    ]);

    const third = store.getStats(true);
    assert.strictEqual(third.rebuiltFiles, 1);
    assert.strictEqual(third.reusedFiles, 0);

    const session = store.getSession("codex:019d23d4-f1a9-7633-b9c7-758327137228", false);
    assert.match(session.finalAnswerPreview, /finished indexing/);
    assert.strictEqual(session.rolloutPersistence.memoryMode, "disabled");
    assert.strictEqual(session.rolloutPersistence.eventMode, "limited_or_unknown");
  });

  it("persists manual annotations and applies them across session, turn, transcript, and event views", async () => {
    writeRollout(dateDir, FILE_A, [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "annotation-session",
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
          type: "user_message",
          message: "review baseline state",
        },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          last_agent_message: "baseline done",
        },
      },
      {
        timestamp: "2026-04-09T15:11:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-2",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T15:11:53.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "fix approval flow",
        },
      },
      {
        timestamp: "2026-04-09T15:11:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-2",
          last_agent_message: "approval fixed",
        },
      },
    ]);

    const store = createHistoryStore({
      sessionDir,
      indexRoot: indexDir,
      refreshMs: 0,
      appServer: false,
    });

    const sessionAnnotation = store.setSessionAnnotation("annotation-session", {
      bookmarked: true,
      addTags: ["Important", "backend"],
      note: "resume from here",
    }, { refresh: true });
    assert.ok(sessionAnnotation);
    assert.strictEqual(sessionAnnotation.sessionId, "codex:annotation-session");
    assert.strictEqual(sessionAnnotation.annotation.bookmarked, true);
    assert.deepStrictEqual(sessionAnnotation.annotation.tags, ["backend", "important"]);

    const turnAnnotation = store.setTurnAnnotation("annotation-session", "turn-2", {
      bookmarked: true,
      addTags: ["fix"],
      note: "approval path",
    }, { refresh: true });
    assert.ok(turnAnnotation);
    assert.strictEqual(turnAnnotation.turnId, "turn-2");
    assert.deepStrictEqual(turnAnnotation.annotation.tags, ["fix"]);

    const bookmarkedSessions = store.listSessions({ bookmarked: true, refresh: false });
    assert.strictEqual(bookmarkedSessions.total, 1);
    assert.strictEqual(bookmarkedSessions.sessions[0].annotation.bookmarked, true);

    const noteSearch = store.listSessions({ q: "resume from here", refresh: false });
    assert.strictEqual(noteSearch.total, 1);
    assert.strictEqual(noteSearch.sessions[0].matchReasons.includes("annotation_note"), true);

    const taggedTurns = store.searchTurns({ manualTags: ["fix"], refresh: false });
    assert.strictEqual(taggedTurns.total, 1);
    assert.strictEqual(taggedTurns.turns[0].turnId, "turn-2");
    assert.deepStrictEqual(taggedTurns.turns[0].annotation.tags, ["fix"]);

    const transcript = await store.getTranscriptResolved("annotation-session", {
      manualTags: ["fix"],
      source: "rollout",
      refresh: false,
    });
    assert.ok(transcript);
    assert.ok(transcript.matchedItems > 0);
    assert.ok(transcript.items.every((item) => item.turnId === "turn-2"));
    assert.deepStrictEqual(transcript.session.annotation.tags, ["backend", "important"]);

    const events = store.getEvents("annotation-session", {
      manualTags: ["fix"],
      refresh: false,
    });
    assert.ok(events);
    assert.ok(events.matchedEvents > 0);
    assert.ok(events.events.every((event) => event.turnId === "turn-2"));

    const stats = store.getStats(false);
    assert.strictEqual(stats.annotatedSessions, 1);
    assert.strictEqual(stats.bookmarkedSessions, 1);
    assert.strictEqual(stats.annotatedTurns, 1);
    assert.strictEqual(stats.bookmarkedTurns, 1);
    assert.deepStrictEqual(stats.topManualTags, [
      { tag: "backend", count: 1 },
      { tag: "fix", count: 1 },
      { tag: "important", count: 1 },
    ]);
    assert.strictEqual(stats.manualProjectCount, 1);
    assert.strictEqual(stats.bookmarkedProjectCount, 1);
    assert.deepStrictEqual(stats.topManualProjects, [
      {
        cwd: "/repo/a",
        updatedAt: "2026-04-09T15:11:54.000Z",
        annotatedSessions: 1,
        bookmarkedSessions: 1,
        annotatedTurns: 1,
        bookmarkedTurns: 1,
        topTags: [
          { tag: "backend", count: 1 },
          { tag: "fix", count: 1 },
          { tag: "important", count: 1 },
        ],
      },
    ]);
    assert.ok(stats.topProjects.some((item) => item.cwd === "/repo/a" && item.count === 1));
    assert.ok(stats.topActiveProjects.some((item) => item.cwd === "/repo/a" && item.count === 2));
  });

  it("keeps main manual stats resolved to the current catalog and reports orphan annotations separately", () => {
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
          type: "task_complete",
          turn_id: "turn-1",
          last_agent_message: "done",
        },
      },
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    store.setSessionAnnotation("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      bookmarked: true,
      addTags: ["live"],
    }, { refresh: true });
    store.setTurnAnnotation("codex:019d23d4-f1a9-7633-b9c7-758327137228", "turn-1", {
      addTags: ["turn-live"],
    }, { refresh: false });

    const annotationPath = path.join(indexDir, "annotations.json");
    const annotationStore = JSON.parse(fs.readFileSync(annotationPath, "utf8"));
    annotationStore.sessions["codex:missing-session"] = {
      bookmarked: false,
      tags: ["stale-session"],
      note: "",
      updatedAt: "2026-04-09T15:20:00.000Z",
    };
    annotationStore.turns["codex:missing-session::turn-stale"] = {
      bookmarked: false,
      tags: ["stale-turn"],
      note: "",
      updatedAt: "2026-04-09T15:20:00.000Z",
    };
    fs.writeFileSync(annotationPath, JSON.stringify(annotationStore, null, 2));

    const stats = store.getStats(true);
    assert.strictEqual(stats.annotatedSessions, 1);
    assert.strictEqual(stats.bookmarkedSessions, 1);
    assert.strictEqual(stats.annotatedTurns, 1);
    assert.strictEqual(stats.bookmarkedTurns, 0);
    assert.deepStrictEqual(stats.topManualTags, [
      { tag: "live", count: 1 },
      { tag: "turn-live", count: 1 },
    ]);
    assert.strictEqual(stats.orphanSessionAnnotations, 1);
    assert.strictEqual(stats.orphanTurnAnnotations, 1);
  });

  it("rebuilds session docs when the index schema version changes", () => {
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
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_1",
          arguments: "{\"cmd\":\"pwd\",\"workdir\":\"/repo/a\"}",
        },
      },
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    const first = store.getStats(true);
    assert.strictEqual(first.rebuiltFiles, 1);

    const manifestPath = path.join(indexDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.version = HISTORY_INDEX_VERSION - 1;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const reloadedStore = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    const rebuilt = reloadedStore.getStats(true);
    assert.strictEqual(rebuilt.reusedFiles, 0);
    assert.strictEqual(rebuilt.rebuiltFiles, 1);
  });

  it("reuses unchanged session docs when command type hints are already represented by command types", () => {
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
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_1",
          arguments: "{\"cmd\":\"sed -n '1,120p' src/history.js\",\"workdir\":\"/repo/a\"}",
        },
      },
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    const first = store.getStats(true);
    assert.strictEqual(first.rebuiltFiles, 1);

    const second = store.getStats(true);
    assert.strictEqual(second.reusedFiles, 1);
    assert.strictEqual(second.rebuiltFiles, 0);
    assert.strictEqual(second.reuseCandidates, 1);
    assert.strictEqual(second.reuseFailures, 0);
    assert.deepStrictEqual(second.reuseFailureCounts, {});
  });

  it("uses a unique session-doc path per rollout file even when session ids repeat", () => {
    writeRollout(dateDir, FILE_A, [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "shared-session-id",
          cwd: "/repo/a",
        },
      },
    ]);

    writeRollout(dateDir, FILE_B, [
      {
        timestamp: "2026-04-09T16:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "shared-session-id",
          cwd: "/repo/b",
        },
      },
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    store.getStats(true);

    const manifestPath = path.join(indexDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const entryA = manifest.files[path.join(dateDir, FILE_A)];
    const entryB = manifest.files[path.join(dateDir, FILE_B)];

    assert.ok(entryA);
    assert.ok(entryB);
    assert.notStrictEqual(entryA.docPath, entryB.docPath);

    const sessionB = store.getSession(path.basename(FILE_B, ".jsonl"), false);
    assert.ok(sessionB);
    assert.strictEqual(sessionB.filePath, path.join(dateDir, FILE_B));
    assert.strictEqual(sessionB.cwd, "/repo/b");

    const filtered = store.listSessions({ sessionKey: path.basename(FILE_B, ".jsonl"), refresh: false });
    assert.strictEqual(filtered.total, 1);
    assert.strictEqual(filtered.sessions[0].filePath, path.join(dateDir, FILE_B));
  });

  it("reuses unchanged session docs when long command previews are truncated", () => {
    const longQuery = [
      "isInternalTitleOnlyMessage",
      "parseStructuredPatch",
      "extractPatchedText",
      "createFileChangeToolBlocks",
      "__codexToolUseResult",
      "fileChangeToToolBlocks",
      "itemTypeById",
      "authoritativeTurn",
      "finalizeTurn",
      "deriveAssistantToolUseResult",
      "codexStreamingToolOutputById",
      "useLegacyBaseInstructions",
      "coerceInlineAssistantToolResults",
    ].join("|");

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
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_1",
          arguments: JSON.stringify({
            cmd: `rg -n "${longQuery}" src/query-engine.ts src/messages.tsx`,
            workdir: "/repo/a",
          }),
        },
      },
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    const first = store.getStats(true);
    assert.strictEqual(first.rebuiltFiles, 1);

    const second = store.getStats(true);
    assert.strictEqual(second.reusedFiles, 1);
    assert.strictEqual(second.rebuiltFiles, 0);
    assert.strictEqual(second.reuseFailures, 0);
  });

  it("reports duplicate rollout ids and per-file build status in doctor output", () => {
    writeRollout(dateDir, FILE_A, [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "shared-session-id",
          cwd: "/repo/a",
        },
      },
    ]);

    writeRollout(dateDir, FILE_B, [
      {
        timestamp: "2026-04-09T16:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "shared-session-id",
          cwd: "/repo/b",
        },
      },
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    const first = store.getDoctor({ refresh: true, status: "rebuilt" });
    assert.strictEqual(first.total, 2);
    assert.strictEqual(first.counts.rebuilt, 2);
    assert.strictEqual(first.duplicates[0].sessionId, "codex:shared-session-id");
    assert.strictEqual(first.duplicates[0].count, 2);
    assert.ok(first.files.every((item) => item.buildStatus === "rebuilt"));
    assert.ok(first.files.every((item) => item.duplicateSessionId === true));

    const second = store.getDoctor({ refresh: true, status: "reused" });
    assert.strictEqual(second.total, 2);
    assert.strictEqual(second.counts.reused, 2);
    assert.ok(second.files.every((item) => item.buildStatus === "reused"));

    const annotated = store.setSessionAnnotation("codex:shared-session-id", { bookmarked: true }, { refresh: true });
    assert.ok(annotated);

    const rebuilt = store.getDoctor({ rebuild: true, status: "rebuilt" });
    assert.strictEqual(rebuilt.counts.rebuilt, 2);
    assert.strictEqual(rebuilt.counts.reused, 0);
    assert.ok(rebuilt.files.every((item) => item.buildReason === "forced_rebuild"));

    // Both rollout files share the annotated session id, so both entries stay
    // bookmarked after the forced rebuild — annotations must survive it.
    const afterRebuild = store.listSessions({ bookmarked: "1", refresh: true });
    assert.strictEqual(afterRebuild.total, 2, "annotations must survive a forced rebuild");
    assert.ok(afterRebuild.sessions.every((session) => session.annotation && session.annotation.bookmarked === true));
  });

  it("treats forked subagent rollouts as lineage, not duplicate session ids", () => {
    writeRollout(dateDir, FILE_A, [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "root-session-id",
          cwd: "/repo/a",
        },
      },
    ]);

    writeRollout(dateDir, FILE_B, [
      {
        timestamp: "2026-04-09T16:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "child-session-id",
          forked_from_id: "root-session-id",
          cwd: "/repo/a",
          agent_nickname: "Helmholtz",
          agent_role: "explorer",
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
        payload: {
          id: "root-session-id",
          cwd: "/repo/a",
        },
      },
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    const doctor = store.getDoctor({ refresh: true });

    assert.strictEqual(doctor.duplicates.length, 0);
    assert.strictEqual(doctor.counts.duplicates, 0);
    assert.strictEqual(doctor.counts.forked, 1);
    assert.strictEqual(doctor.counts.subagent, 1);
    assert.strictEqual(doctor.forkFamilies.length, 1);
    assert.strictEqual(doctor.forkFamilies[0].rootSessionId, "codex:root-session-id");
    assert.strictEqual(doctor.forkFamilies[0].count, 2);

    const child = doctor.files.find((item) => item.sessionKey === path.basename(FILE_B, ".jsonl"));
    assert.ok(child);
    assert.strictEqual(child.sessionId, "codex:child-session-id");
    assert.strictEqual(child.forkedFromId, "codex:root-session-id");
    assert.strictEqual(child.parentThreadId, "codex:root-session-id");

    const stats = store.getStats(true);
    assert.strictEqual(stats.duplicateSessionIds, 0);
    assert.strictEqual(stats.forkFamilies, 1);
    assert.strictEqual(stats.forkedSessions, 1);
    assert.strictEqual(stats.subagentSessions, 1);
  });

  it("serves lineage families and lineage-root filters from the persistent index", () => {
    writeRollout(dateDir, FILE_A, [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "root-session-id",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-root",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "Inspect the root session state",
        },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-root",
          last_agent_message: "Root session finished",
        },
      },
    ]);

    writeRollout(dateDir, FILE_B, [
      {
        timestamp: "2026-04-09T16:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "child-session-id",
          forked_from_id: "root-session-id",
          cwd: "/repo/a",
          agent_nickname: "Helmholtz",
          agent_role: "explorer",
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
        payload: {
          id: "root-session-id",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T16:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-child",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T16:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "Inspect the child explorer result",
        },
      },
      {
        timestamp: "2026-04-09T16:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-child",
          last_agent_message: "Child explorer finished",
        },
      },
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    const family = store.getFamily("codex:child-session-id", { refresh: true });

    assert.ok(family);
    assert.strictEqual(family.lineageRootId, "codex:root-session-id");
    assert.strictEqual(family.familySessionCount, 2);
    assert.strictEqual(family.matchedSessionCount, 2);
    assert.strictEqual(family.matchedTurnCount, 2);
    assert.ok(family.rootSession);
    assert.strictEqual(family.rootSession.sessionId, "codex:root-session-id");
    assert.strictEqual(family.sessions[0].sessionId, "codex:root-session-id");
    assert.strictEqual(family.sessions[0].lineageDepth, 0);
    assert.strictEqual(family.sessions[1].sessionId, "codex:child-session-id");
    assert.strictEqual(family.sessions[1].lineageRootId, "codex:root-session-id");
    assert.strictEqual(family.sessions[1].lineageDepth, 1);

    const lineageMatches = store.listSessions({
      lineageRoot: "codex:root-session-id",
      refresh: false,
    });
    assert.strictEqual(lineageMatches.total, 2);
    assert.ok(lineageMatches.sessions.every((session) => session.lineageRootId === "codex:root-session-id"));

    const childMatches = store.listSessions({
      parentThread: "codex:root-session-id",
      refresh: false,
    });
    assert.strictEqual(childMatches.total, 1);
    assert.strictEqual(childMatches.sessions[0].sessionId, "codex:child-session-id");

    const familyTurns = store.searchTurns({
      lineageRoot: "codex:root-session-id",
      refresh: false,
    });
    assert.strictEqual(familyTurns.sessionCount, 2);
    assert.strictEqual(familyTurns.total, 2);
  });

  it("builds workstreams from lineage families plus same-project related sessions", () => {
    writeRollout(dateDir, FILE_A, [
      {
        timestamp: "2026-04-09T15:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "root-session-id",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T15:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-root",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T15:10:53.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_root",
          arguments: "{\"cmd\":\"sed -n '1,120p' src/app.js\",\"workdir\":\"/repo/a\"}",
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
          cwd: "/repo/a",
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
        payload: {
          type: "task_complete",
          turn_id: "turn-root",
          last_agent_message: "Root session finished",
        },
      },
      {
        timestamp: "2026-04-09T15:10:55.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-root-docs",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T15:10:56.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call_root_docs",
          turn_id: "turn-root-docs",
          success: true,
          changes: {
            "/repo/a/docs/guide.md": { type: "update" },
          },
        },
      },
      {
        timestamp: "2026-04-09T15:10:57.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-root-docs",
          last_agent_message: "Root docs refreshed",
        },
      },
    ]);

    writeRollout(dateDir, FILE_B, [
      {
        timestamp: "2026-04-09T16:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "child-session-id",
          forked_from_id: "root-session-id",
          cwd: "/repo/a",
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
        payload: {
          id: "root-session-id",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T16:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-child",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T16:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-child",
          last_agent_message: "Child session finished",
        },
      },
    ]);

    writeRollout(dateDir, "rollout-2026-04-09T17-10-51-context-session-id.jsonl", [
      {
        timestamp: "2026-04-09T17:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "context-session-id",
          cwd: "/repo/a",
        },
      },
      {
        timestamp: "2026-04-09T17:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-context",
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
          call_id: "call_context",
          arguments: "{\"cmd\":\"sed -n '1,120p' src/app.js\",\"workdir\":\"/repo/a\"}",
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
          cwd: "/repo/a",
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
        payload: {
          type: "task_complete",
          turn_id: "turn-context",
          last_agent_message: "Context session finished",
        },
      },
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    store.setSessionAnnotation("root-session-id", {
      bookmarked: true,
      addTags: ["anchor"],
      note: "keep this root",
    }, { refresh: false });
    store.setSessionAnnotation("context-session-id", {
      addTags: ["related"],
      note: "useful context",
    }, { refresh: false });
    store.setTurnAnnotation("context-session-id", "turn-context", {
      bookmarked: true,
      addTags: ["fix"],
      note: "important context turn",
    }, { refresh: false });
    const workstream = store.getWorkstream("codex:child-session-id", {
      path: "src/app.js",
      shape: "compact",
      limit: 1,
      familyLimit: 1,
      turnLimit: 10,
      refresh: true,
    });

    assert.ok(workstream);
    assert.strictEqual(workstream.shape, "compact");
    assert.strictEqual(workstream.lineageRootId, "codex:root-session-id");
    assert.strictEqual(workstream.familySessionCount, 2);
    assert.strictEqual(workstream.familyPeerCount, 1);
    assert.strictEqual(workstream.contextSessionCount, 1);
    assert.strictEqual(workstream.rootSession.sessionId, "codex:root-session-id");
    assert.strictEqual(workstream.rootSession.artifactSamples, undefined);
    assert.strictEqual(workstream.familySessions[0].sessionId, "codex:child-session-id");
    assert.strictEqual(workstream.familySessions[0].artifactSamples, undefined);
    assert.strictEqual(workstream.contextSessions[0].sessionId, "codex:context-session-id");
    assert.strictEqual(workstream.contextSessions[0].shared, undefined);
    assert.ok(workstream.contextSessions[0].sharedCounts.paths > 0);
    assert.deepStrictEqual(workstream.contextSessions[0].linkedSessions, ["codex:root-session-id"]);
    assert.ok(workstream.turns.every((turn) => turn.counts && turn.filesTouched === undefined));
    assert.ok(workstream.turns.some((turn) => turn.sessionId === "codex:root-session-id"));
    assert.ok(workstream.turns.some((turn) => turn.sessionId === "codex:context-session-id"));
    assert.ok(workstream.turns.find((turn) => turn.sessionId === "codex:context-session-id").relatedKinds.includes("path"));
    assert.strictEqual(workstream.manual.annotatedSessions, 2);
    assert.strictEqual(workstream.manual.bookmarkedSessions, 1);
    assert.strictEqual(workstream.manual.annotatedTurns, 1);
    assert.strictEqual(workstream.manual.bookmarkedTurns, 1);
    assert.deepStrictEqual(workstream.manual.topTags, [
      { tag: "anchor", count: 1 },
      { tag: "fix", count: 1 },
      { tag: "related", count: 1 },
    ]);
    assert.strictEqual(workstream.manual.sessionHighlights[0].sessionId, "codex:root-session-id");
    assert.strictEqual(workstream.manual.sessionHighlights[0].workstreamRole, "root");
    assert.strictEqual(workstream.manual.turnHighlights[0].turnId, "turn-context");
    assert.strictEqual(workstream.manual.turnHighlights[0].workstreamRole, "context");

    const areaWorkstream = store.getWorkstream("codex:child-session-id", {
      area: "src",
      shape: "compact",
      limit: 1,
      familyLimit: 1,
      turnLimit: 10,
      refresh: false,
    });

    assert.ok(areaWorkstream);
    assert.strictEqual(areaWorkstream.selectedArea, "src");
    assert.strictEqual(areaWorkstream.selectedAreaMatched, true);
    assert.ok(areaWorkstream.turns.length > 0);
    assert.ok(areaWorkstream.turns.some((turn) => turn.turnId === "turn-root"));
    assert.ok(areaWorkstream.turns.some((turn) => turn.turnId === "turn-context"));
    assert.ok(!areaWorkstream.turns.some((turn) => turn.turnId === "turn-root-docs"));

    const pagedWorkstream = store.getWorkstream("codex:child-session-id", {
      path: "src/app.js",
      familyOffset: 1,
      familyLimit: 1,
      turnLimit: 10,
      refresh: false,
    });

    assert.ok(pagedWorkstream);
    assert.strictEqual(pagedWorkstream.familySessions.length, 0);
    assert.strictEqual(pagedWorkstream.truncatedFamilySessions, true);
  });

  it("rebuilds stale cached session docs when inferred harness metadata is missing", () => {
    const rolloutPath = path.join(dateDir, FILE_A);
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
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_1",
          arguments: "{\"cmd\":\"rg -n \\\"ENABLE_DASHBOARD\\\" src/feature.js\",\"workdir\":\"/repo/a\"}",
        },
      },
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    const first = store.getStats(true);
    assert.strictEqual(first.rebuiltFiles, 1);

    const manifestPath = path.join(indexDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const entry = manifest.files[rolloutPath];
    const docPath = path.join(indexDir, entry.docPath);
    const staleDoc = JSON.parse(fs.readFileSync(docPath, "utf8"));
    staleDoc.recentCommands = staleDoc.recentCommands.map((command) => ({
      ...command,
      commandTypes: [],
      commandPaths: [],
      commandQueries: [],
    }));
    staleDoc.pathsReferenced = [];
    staleDoc.pathArtifacts = [];
    staleDoc.queryArtifacts = [];
    staleDoc.recentQueries = [];
    staleDoc.turns = staleDoc.turns.map((turn) => ({
      ...turn,
      commands: turn.commands.map((command) => ({
        ...command,
        commandTypes: [],
        commandPaths: [],
        commandQueries: [],
      })),
      pathsReferenced: [],
      pathArtifacts: [],
      queries: [],
      queryArtifacts: [],
    }));
    fs.writeFileSync(docPath, JSON.stringify(staleDoc, null, 2));

    const reloadedStore = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    const rebuilt = reloadedStore.getStats(true);
    assert.strictEqual(rebuilt.reusedFiles, 0);
    assert.strictEqual(rebuilt.rebuiltFiles, 1);
    assert.strictEqual(rebuilt.reuseCandidates, 1);
    assert.strictEqual(rebuilt.reuseFailures, 1);
    assert.strictEqual(rebuilt.reuseFailureCounts["recent:missing_commandTypes"], 1);
    assert.strictEqual(rebuilt.reuseFailureSamples["recent:missing_commandTypes"], rolloutPath);

    const session = reloadedStore.getSession("codex:019d23d4-f1a9-7633-b9c7-758327137228", false);
    assert.ok(session.pathsReferenced.includes("/repo/a/src/feature.js"));
    assert.ok(session.artifactSamples.queries.includes("ENABLE_DASHBOARD"));
    assert.deepStrictEqual(session.recentCommands[0].commandTypes, ["search"]);
    assert.deepStrictEqual(session.recentCommands[0].commandPaths, ["/repo/a/src/feature.js"]);
    assert.deepStrictEqual(session.recentCommands[0].commandQueries, ["ENABLE_DASHBOARD"]);
    assert.deepStrictEqual(session.turns[0].queries, [{
      timestamp: "2026-04-09T15:10:53.000Z",
      query: "ENABLE_DASHBOARD",
      actionType: "command",
    }]);
  });

  it("serves artifact ledgers from the persistent index", () => {
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
        type: "response_item",
        payload: {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "codex history infra",
            queries: ["codex history infra"],
          },
        },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_read",
          turn_id: "turn-1",
          command: ["/bin/zsh", "-lc", "sed -n '1,120p' src/history.js"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "read",
            cmd: "sed -n '1,120p' src/history.js",
            name: "history.js",
            path: "src/history.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "console.log('history');\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 341700000 },
          status: "completed",
        },
      },
      {
        timestamp: "2026-04-09T15:10:54.500Z",
        type: "event_msg",
        payload: {
          type: "error",
          message: "unexpected status 401 Unauthorized, url: https://api.openai.com/v1/responses, request id: req_hist_123",
          codex_error_info: "other",
        },
      },
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    const artifacts = store.listArtifacts({ kind: "query", q: "history infra", refresh: true });
    assert.strictEqual(artifacts.total, 1);
    assert.strictEqual(artifacts.artifacts[0].kind, "query");
    assert.match(artifacts.artifacts[0].value, /codex history infra/);

    const errors = store.listArtifacts({ kind: "error", q: "401", refresh: false });
    assert.strictEqual(errors.total, 1);
    assert.match(errors.artifacts[0].value, /401 Unauthorized/);

    const requestIdErrors = store.listArtifacts({ kind: "error", q: "req_hist_123", refresh: false });
    assert.strictEqual(requestIdErrors.total, 1);
    assert.match(requestIdErrors.artifacts[0].value, /401 Unauthorized/);

    const requestIdArtifact = store.getArtifact("error", "req_hist_123", { refresh: false });
    assert.ok(requestIdArtifact);
    assert.match(requestIdArtifact.value, /401 Unauthorized/);

    const transcript = store.getTranscript("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      error: "req_hist_123",
      refresh: false,
    });
    assert.ok(transcript);
    assert.strictEqual(transcript.matchedItems, 1);
    assert.strictEqual(transcript.items[0].type, "error");
    assert.strictEqual(transcript.items[0].errorCode, "other");
    assert.strictEqual(transcript.items[0].statusCode, 401);
    assert.strictEqual(transcript.items[0].errorRequestId, "req_hist_123");
    assert.strictEqual(transcript.items[0].errorUrl, "https://api.openai.com/v1/responses");
    assert.match(transcript.items[0].detail, /req_hist_123/);

    const paths = store.listArtifacts({ kind: "path", q: "history.js", refresh: false });
    assert.strictEqual(paths.total, 1);
    assert.strictEqual(paths.artifacts[0].value, "/repo/a/src/history.js");

    const artifact = store.getArtifact("query", "codex history infra", { refresh: false });
    assert.ok(artifact);
    assert.strictEqual(artifact.sessionCount, 1);
    assert.strictEqual(artifact.turnCount, 1);
    assert.strictEqual(artifact.sessions[0].turns[0].turnId, "turn-1");
  });

  it("serves workspace summaries from the persistent index", () => {
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
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_1",
          arguments: "{\"cmd\":\"git status --short\",\"workdir\":\"/repo/a\"}",
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
          type: "user_message",
          message: "run npm test in repo a",
        },
      },
      {
        timestamp: "2026-04-09T16:10:54.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_2",
          arguments: "{\"cmd\":\"npm test\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T16:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-2",
          last_agent_message: "repo a tests checked",
        },
      },
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    store.setSessionAnnotation("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      bookmarked: true,
      addTags: ["anchor"],
      note: "workspace anchor",
    }, { refresh: false });
    store.setTurnAnnotation("codex:019d23d4-f1a9-7633-b9c7-758327137229", "turn-2", {
      addTags: ["fix"],
      note: "workspace turn",
    }, { refresh: false });
    const projects = store.listProjects({ q: "repo a", refresh: true });
    assert.strictEqual(projects.total, 1);
    assert.strictEqual(projects.projects[0].cwd, "/repo/a");
    assert.strictEqual(projects.projects[0].sessionCount, 2);
    assert.deepStrictEqual(projects.projects[0].manualCounts, {
      annotatedSessions: 1,
      bookmarkedSessions: 1,
      annotatedTurns: 1,
      bookmarkedTurns: 0,
    });
    assert.deepStrictEqual(projects.projects[0].topManualTags, [
      { tag: "anchor", count: 1 },
      { tag: "fix", count: 1 },
    ]);
    assert.deepStrictEqual(projects.projects[0].matchedManualCounts, {
      annotatedSessions: 0,
      bookmarkedSessions: 0,
      annotatedTurns: 1,
      bookmarkedTurns: 0,
    });
    assert.deepStrictEqual(projects.projects[0].matchedTopManualTags, [
      { tag: "fix", count: 1 },
    ]);

    const compactProjects = store.listProjects({ q: "repo a", shape: "compact", refresh: false });
    assert.strictEqual(compactProjects.total, 1);
    assert.deepStrictEqual(compactProjects.projects[0].manualCounts, {
      annotatedSessions: 1,
      bookmarkedSessions: 1,
      annotatedTurns: 1,
      bookmarkedTurns: 0,
    });
    assert.deepStrictEqual(compactProjects.projects[0].topManualTags, [
      { tag: "anchor", count: 1 },
      { tag: "fix", count: 1 },
    ]);
    assert.deepStrictEqual(compactProjects.projects[0].matchedManualCounts, {
      annotatedSessions: 0,
      bookmarkedSessions: 0,
      annotatedTurns: 1,
      bookmarkedTurns: 0,
    });
    assert.deepStrictEqual(compactProjects.projects[0].matchedTopManualTags, [
      { tag: "fix", count: 1 },
    ]);

    const focusedProjects = store.listProjects({ q: "npm test", refresh: false });
    assert.strictEqual(focusedProjects.total, 1);
    assert.deepStrictEqual(focusedProjects.projects[0].manualCounts, {
      annotatedSessions: 1,
      bookmarkedSessions: 1,
      annotatedTurns: 1,
      bookmarkedTurns: 0,
    });
    assert.deepStrictEqual(focusedProjects.projects[0].topManualTags, [
      { tag: "anchor", count: 1 },
      { tag: "fix", count: 1 },
    ]);
    assert.deepStrictEqual(focusedProjects.projects[0].matchedManualCounts, {
      annotatedSessions: 0,
      bookmarkedSessions: 0,
      annotatedTurns: 1,
      bookmarkedTurns: 0,
    });
    assert.deepStrictEqual(focusedProjects.projects[0].matchedTopManualTags, [
      { tag: "fix", count: 1 },
    ]);

    store.setSessionAnnotation("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      addTags: ["ignored"],
      note: "outside the filtered project view",
    }, { refresh: false });
    store.setSessionAnnotation("codex:019d23d4-f1a9-7633-b9c7-758327137229", {
      bookmarked: true,
      addTags: ["anchor"],
      note: "project root note",
    }, { refresh: false });
    store.setTurnAnnotation("codex:019d23d4-f1a9-7633-b9c7-758327137229", "turn-2", {
      addTags: ["fix"],
      note: "important project turn",
    }, { refresh: false });

    const project = store.getProject("/repo/a", { q: "npm test", refresh: false });
    assert.ok(project);
    assert.strictEqual(project.matchedSessionCount, 1);
    assert.strictEqual(project.matchedTurnCount, 1);
    assert.strictEqual(project.turns[0].turnId, "turn-2");
    assert.strictEqual(project.manual.annotatedSessions, 1);
    assert.strictEqual(project.manual.bookmarkedSessions, 1);
    assert.strictEqual(project.manual.annotatedTurns, 1);
    assert.strictEqual(project.manual.bookmarkedTurns, 0);
    assert.deepStrictEqual(project.manual.topTags, [
      { tag: "anchor", count: 1 },
      { tag: "fix", count: 1 },
    ]);
    assert.strictEqual(project.manual.sessionHighlights[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137229");
    assert.strictEqual(project.manual.turnHighlights[0].turnId, "turn-2");

    const stats = store.getStats(false);
    assert.strictEqual(stats.projectCount, 1);
    assert.strictEqual(stats.topProjects[0].cwd, "/repo/a");
    assert.ok(Array.isArray(stats.topActiveTools));
    assert.ok(Array.isArray(stats.topActiveFiles));
    assert.ok(Array.isArray(stats.topActivePaths));
  });

  it("serves cross-session turn search from the persistent index", () => {
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
          type: "user_message",
          message: "Run npm test and inspect failures",
        },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_1",
          arguments: "{\"cmd\":\"npm test\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T15:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          last_agent_message: "npm test failures inspected",
        },
      },
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    const turns = store.searchTurns({
      q: "npm test",
      cwd: "/repo/a",
      refresh: true,
    });

    assert.strictEqual(turns.total, 1);
    assert.strictEqual(turns.sessionCount, 1);
    assert.strictEqual(turns.turns[0].turnId, "turn-1");
    assert.strictEqual(turns.turns[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137228");
  });

  it("serves exact turn traces from the persistent index", () => {
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
          type: "user_message",
          message: "Implement history trace",
        },
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
          type: "task_complete",
          turn_id: "turn-1",
          last_agent_message: "history trace complete",
        },
      },
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    const turn = store.getTurn("codex:019d23d4-f1a9-7633-b9c7-758327137228", "turn-1", { refresh: true });

    assert.ok(turn);
    assert.strictEqual(turn.turn.turnId, "turn-1");
    assert.ok(turn.events.some((event) => event.kind === "message"));
    assert.ok(turn.events.some((event) => event.kind === "tool_call"));
  });

  it("serves flat artifact-to-turn history from the persistent index", () => {
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
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_1",
          arguments: "{\"cmd\":\"git status --short\",\"workdir\":\"/repo/a\"}",
        },
      },
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    const turns = store.getArtifactTurns("command", "git status --short", {
      cwd: "/repo/a",
      refresh: true,
    });

    assert.ok(turns);
    assert.strictEqual(turns.turnCount, 1);
    assert.strictEqual(turns.sessionCount, 1);
    assert.strictEqual(turns.turns[0].turnId, "turn-1");
    assert.deepStrictEqual(turns.turns[0].matchValues, ["git status --short"]);
  });

  it("serves grouped path lineage threads from the persistent index", () => {
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
          type: "user_message",
          message: "Inspect and update the history loader",
        },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_1",
          arguments: "{\"cmd\":\"sed -n '1,120p' src/history-loader.js\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T15:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_1",
          turn_id: "turn-1",
          command: ["/bin/zsh", "-lc", "sed -n '1,120p' src/history-loader.js"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "read",
            cmd: "sed -n '1,120p' src/history-loader.js",
            name: "history-loader.js",
            path: "src/history-loader.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "module.exports = {};\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 341700000 },
          status: "completed",
        },
      },
      {
        timestamp: "2026-04-09T15:10:56.000Z",
        type: "event_msg",
        payload: {
          type: "patch_apply_end",
          call_id: "call_patch",
          turn_id: "turn-1",
          success: true,
          changes: {
            "/repo/a/src/history-loader.js": { type: "update" },
          },
        },
      },
      {
        timestamp: "2026-04-09T15:10:57.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          last_agent_message: "Updated the history loader",
        },
      },
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    const thread = store.getPathThread("src/history-loader.js", {
      cwd: "/repo/a",
      refresh: true,
    });

    assert.ok(thread);
    assert.strictEqual(thread.path, "/repo/a/src/history-loader.js");
    assert.strictEqual(thread.turnCount, 1);
    assert.strictEqual(thread.threads[0].turnId, "turn-1");
    assert.ok(thread.threads[0].events.some((event) => event.kind === "tool_call"));
    assert.ok(thread.threads[0].events.some((event) => event.kind === "patch"));
    assert.ok(thread.threads[0].actions.includes("read"));
    assert.ok(thread.threads[0].actions.includes("patch"));
  });

  it("indexes harness command queries and serves related sessions from the persistent index", () => {
    writeRollout(dateDir, FILE_A, [
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
        payload: {
          type: "exec_command_end",
          call_id: "call_search_1",
          turn_id: "turn-1",
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
    ]);

    writeRollout(dateDir, FILE_B, [
      {
        timestamp: "2026-04-09T16:10:51.000Z",
        type: "session_meta",
        payload: { id: "019d23d4-f1a9-7633-b9c7-758327137229", cwd: "/repo/a" },
      },
      {
        timestamp: "2026-04-09T16:10:52.000Z",
        type: "turn_context",
        payload: { turn_id: "turn-2", cwd: "/repo/a", model: "gpt-5.4" },
      },
      {
        timestamp: "2026-04-09T16:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_search_2",
          turn_id: "turn-2",
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
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    const queries = store.listArtifacts({
      kind: "query",
      q: "ENABLE_EXPERIMENTAL_DASHBOARD",
      refresh: true,
    });
    assert.strictEqual(queries.total, 1);
    assert.strictEqual(queries.artifacts[0].value, "ENABLE_EXPERIMENTAL_DASHBOARD");

    const turns = store.searchTurns({
      q: "ENABLE_EXPERIMENTAL_DASHBOARD",
      cwd: "/repo/a",
      refresh: false,
    });
    assert.strictEqual(turns.total, 2);

    const related = store.getRelatedSessions("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      refresh: false,
    });
    assert.ok(related);
    assert.strictEqual(related.total, 1);
    assert.strictEqual(related.sessions[0].sessionId, "codex:019d23d4-f1a9-7633-b9c7-758327137229");
    assert.ok(related.sessions[0].shared.queries.includes("ENABLE_EXPERIMENTAL_DASHBOARD"));
    assert.ok(related.sessions[0].shared.paths.includes("/repo/a/src/feature.js"));
  });

  it("serves transcript and schema profile views from the persistent index", () => {
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
          type: "user_message",
          message: "inspect history parser behavior",
        },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call_1",
          arguments: "{\"cmd\":\"sed -n '1,120p' src/history.js\",\"workdir\":\"/repo/a\"}",
        },
      },
      {
        timestamp: "2026-04-09T15:10:54.100Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call_1",
          turn_id: "turn-1",
          command: ["/bin/zsh", "-lc", "sed -n '1,120p' src/history.js"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "read",
            cmd: "sed -n '1,120p' src/history.js",
            path: "src/history.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "history layer\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 241700000 },
          status: "completed",
        },
      },
      {
        timestamp: "2026-04-09T15:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "agent_message",
          phase: "final_answer",
          message: "history parser looks correct",
        },
      },
      {
        timestamp: "2026-04-09T15:10:55.100Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          last_agent_message: "history parser looks correct",
        },
      },
    ]);

    const store = createHistoryStore({ sessionDir, indexRoot: indexDir, refreshMs: 0 });
    const transcript = store.getTranscript("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      path: "history.js",
      commandType: "read",
      refresh: true,
    });
    assert.ok(transcript);
    assert.strictEqual(transcript.matchedItems, 1);
    assert.strictEqual(transcript.items[0].stage, "paired");
    assert.deepStrictEqual(transcript.items[0].commandPaths, ["/repo/a/src/history.js"]);
    assert.strictEqual(transcript.source.selectionReason, "requested_rollout");
    assert.match(transcript.source.selectionNote, /source=rollout/);

    const resume = store.getResume("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      toolText: "salient",
      turnLimit: 1,
      itemChars: 80,
      toolChars: 60,
      refresh: true,
    });
    assert.ok(resume);
    assert.strictEqual(resume.turns.length, 1);
    assert.ok(resume.turns[0].items.some((item) => item.textMode === "omitted" && item.omissionReason === "read_output"));
    assert.ok(Array.isArray(resume.highlights.pathHighlights));
    assert.ok(resume.highlights.pathHighlights.some((entry) => Array.isArray(entry.roles) && entry.roles.includes("read")));
    assert.match(resume.text, /Path focus:/);
    assert.match(resume.text, /\[output omitted: read_output\]/);
    assert.strictEqual(resume.source.selectionReason, "requested_rollout");
    assert.match(resume.source.selectionNote, /source=rollout/);

    const autoTranscript = store.getTranscript("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      source: "auto",
      refresh: true,
    });
    assert.ok(autoTranscript);
    assert.strictEqual(autoTranscript.source.requested, "auto");
    assert.strictEqual(autoTranscript.source.used, "rollout");
    assert.strictEqual(autoTranscript.source.selectionReason, "rollout_only_view");
    assert.match(autoTranscript.source.selectionNote, /only reads rollout-derived history/);

    const autoResume = store.getResume("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      source: "auto",
      refresh: true,
    });
    assert.ok(autoResume);
    assert.strictEqual(autoResume.source.requested, "auto");
    assert.strictEqual(autoResume.source.used, "rollout");
    assert.strictEqual(autoResume.source.selectionReason, "rollout_only_view");
    assert.match(autoResume.source.selectionNote, /only reads rollout-derived history/);

    const schema = store.getSchemaProfile({
      q: "exec_command_end",
      refresh: true,
    });
    assert.strictEqual(schema.totalMatchedKeys, 1);
    assert.strictEqual(schema.keys[0].key, "event_msg:exec_command_end");
    assert.ok(schema.keys[0].rawFields.some((field) => field.path === "payload.parsed_cmd[].path"));
    assert.ok(schema.keys[0].normalizedFields.some((field) => field.path === "commandPaths"));
  });

  it("can resolve transcript and resume through the app-server thread bridge", async () => {
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
          type: "user_message",
          message: "fallback rollout prompt",
        },
      },
    ]);

    const store = createHistoryStore({
      sessionDir,
      indexRoot: indexDir,
      refreshMs: 0,
      appServer: {
        async readThread() {
          return {
            thread: {
              id: "019d23d4-f1a9-7633-b9c7-758327137228",
              preview: "bridge preview",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1775747451,
              updatedAt: 1775747455,
              status: { type: "notLoaded" },
              path: "/tmp/rollout-019d23d4-f1a9-7633-b9c7-758327137228.jsonl",
              cwd: "/repo/a",
              cliVersion: "0.119.0-alpha.5",
              source: "cli",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: null,
              turns: [
                {
                  id: "turn-1",
                  status: "completed",
                  error: {
                    message: "stream failure",
                    codexErrorInfo: {
                      responseStreamDisconnected: {
                        httpStatusCode: 502,
                      },
                    },
                    additionalDetails: "socket closed",
                  },
                  startedAt: 1775747452,
                  completedAt: 1775747455,
                  durationMs: 3000,
                  items: [
                    {
                      type: "userMessage",
                      id: "item-1",
                      content: [{ type: "text", text: "inspect bridge transcript", text_elements: [] }],
                    },
                    {
                      type: "commandExecution",
                      id: "call-1",
                      command: "rg -n \"bridge transcript\" src/history.js",
                      cwd: "/repo/a",
                      processId: "123",
                      source: "unifiedExecStartup",
                      status: "completed",
                      commandActions: [{
                        type: "search",
                        command: "rg -n \"bridge transcript\" src/history.js",
                        query: "bridge transcript",
                        path: "src/history.js",
                      }],
                      aggregatedOutput: "12:bridge transcript\n",
                      exitCode: 0,
                      durationMs: 22,
                    },
                    {
                      type: "agentMessage",
                      id: "item-2",
                      text: "bridge transcript looks exact",
                      phase: "final_answer",
                      memoryCitation: {
                        entries: [
                          {
                            path: "MEMORY.md",
                            lineStart: 1,
                            lineEnd: 2,
                            note: "bridge summary",
                          },
                        ],
                        threadIds: ["rollout-1"],
                      },
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

    const transcript = await store.getTranscriptResolved("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      source: "app-server",
      path: "history.js",
      commandType: "search",
      refresh: true,
    });
    assert.ok(transcript);
    assert.strictEqual(transcript.source.used, "app_server");
    assert.strictEqual(transcript.source.selectionReason, "requested_app_server");
    assert.strictEqual(transcript.matchedItems, 1);
    assert.strictEqual(transcript.items[0].command, "rg -n \"bridge transcript\" src/history.js");
    assert.deepStrictEqual(transcript.items[0].commandQueries, ["bridge transcript"]);
    assert.strictEqual(transcript.quality.mode, "app_server_thread_view");
    assert.ok(transcript.quality.warnings.some((item) => /lossy for tool and result detail/.test(item)));

    const citationTranscript = await store.getTranscriptResolved("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      source: "app-server",
      q: "bridge summary",
      file: "MEMORY.md",
      refresh: true,
    });
    assert.ok(citationTranscript);
    assert.strictEqual(citationTranscript.matchedItems, 1);
    assert.strictEqual(citationTranscript.items[0].type, "assistant");
    assert.deepStrictEqual(citationTranscript.items[0].memoryCitation, {
      entries: [
        {
          path: "MEMORY.md",
          lineStart: 1,
          lineEnd: 2,
          note: "bridge summary",
        },
      ],
      threadIds: ["rollout-1"],
    });
    assert.deepStrictEqual(citationTranscript.items[0].matchedFiles, ["/repo/a/MEMORY.md"]);

    const errorTranscript = await store.getTranscriptResolved("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      source: "app-server",
      error: "responseStreamDisconnected",
      refresh: true,
    });
    assert.ok(errorTranscript);
    assert.strictEqual(errorTranscript.matchedItems, 1);
    assert.strictEqual(errorTranscript.items[0].type, "error");
    assert.strictEqual(errorTranscript.items[0].errorCode, "responseStreamDisconnected");
    assert.strictEqual(errorTranscript.items[0].statusCode, 502);
    assert.deepStrictEqual(errorTranscript.items[0].codexErrorInfo, {
      responseStreamDisconnected: {
        httpStatusCode: 502,
      },
    });
    assert.strictEqual(errorTranscript.items[0].additionalDetails, "socket closed");

    const detailedErrorTranscript = await store.getTranscriptResolved("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      source: "app-server",
      error: "socket closed",
      refresh: true,
    });
    assert.ok(detailedErrorTranscript);
    assert.strictEqual(detailedErrorTranscript.matchedItems, 1);
    assert.strictEqual(detailedErrorTranscript.items[0].statusCode, 502);

    const resume = await store.getResumeResolved("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      source: "app-server",
      toolText: "salient",
      turnLimit: 1,
      refresh: true,
    });
    assert.ok(resume);
    assert.strictEqual(resume.source.used, "app_server");
    assert.strictEqual(resume.source.selectionReason, "requested_app_server");
    assert.strictEqual(resume.turns.length, 1);
    assert.match(resume.text, /bridge transcript looks exact/);
    assert.match(resume.text, /bridge transcript/);
    assert.strictEqual(resume.quality.mode, "app_server_thread_view");
    assert.ok(resume.quality.recommendations.some((item) => /source=rollout/.test(item)));
    assert.strictEqual(resume.reloadSafety.decision, "ready");
    assert.strictEqual(resume.reloadSafety.allowed, true);
    const resumeErrorItem = resume.turns[0].items.find((item) => item.type === "error");
    assert.ok(resumeErrorItem);
    assert.strictEqual(resumeErrorItem.errorCode, "responseStreamDisconnected");
    assert.strictEqual(resumeErrorItem.statusCode, 502);
    assert.match(resumeErrorItem.text, /socket closed/);

    const autoTranscript = await store.getTranscriptResolved("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      source: "auto",
      refresh: true,
    });
    assert.ok(autoTranscript);
    assert.strictEqual(autoTranscript.source.used, "app_server");
    assert.strictEqual(autoTranscript.source.selectionReason, "auto_preferred_app_server");

    const autoResume = await store.getResumeResolved("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      source: "auto",
      turnLimit: 1,
      refresh: true,
    });
    assert.ok(autoResume);
    assert.strictEqual(autoResume.source.used, "app_server");
    assert.strictEqual(autoResume.source.selectionReason, "auto_preferred_app_server");
  });

  it("keeps annotation-scoped transcript filters exact over the app-server bridge and falls back when exact results miss", async () => {
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
          type: "user_message",
          message: "annotated rollout prompt",
        },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          last_agent_message: "annotated rollout answer",
        },
      },
    ]);

    let readThreadCalls = 0;
    const store = createHistoryStore({
      sessionDir,
      indexRoot: indexDir,
      refreshMs: 0,
      appServer: {
        async readThread() {
          readThreadCalls += 1;
          return {
            thread: {
              id: "019d23d4-f1a9-7633-b9c7-758327137228",
              preview: "annotation bridge preview",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1775747451,
              updatedAt: 1775747455,
              status: { type: "notLoaded" },
              path: "/tmp/rollout-019d23d4-f1a9-7633-b9c7-758327137228.jsonl",
              cwd: "/repo/a",
              cliVersion: "0.119.0-alpha.5",
              source: "cli",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: null,
              turns: [
                {
                  id: "turn-1",
                  status: "completed",
                  error: null,
                  startedAt: 1775747452,
                  completedAt: 1775747455,
                  durationMs: 3000,
                  items: [
                    {
                      type: "userMessage",
                      id: "item-1",
                      content: [{ type: "text", text: "annotated exact prompt", text_elements: [] }],
                    },
                    {
                      type: "agentMessage",
                      id: "item-2",
                      text: "annotated exact answer",
                      phase: "final_answer",
                      memoryCitation: null,
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

    store.setSessionAnnotation("019d23d4-f1a9-7633-b9c7-758327137228", {
      addTags: ["important"],
    }, { refresh: true });

    const exactTranscript = await store.getTranscriptResolved("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      source: "auto",
      manualTag: "important",
      refresh: true,
    });

    assert.ok(exactTranscript);
    assert.strictEqual(readThreadCalls, 1);
    assert.strictEqual(exactTranscript.source.used, "app_server");
    assert.strictEqual(exactTranscript.source.selectionReason, "auto_preferred_app_server");
    assert.ok(exactTranscript.matchedItems > 0);
    assert.deepStrictEqual(exactTranscript.session.annotation.tags, ["important"]);

    const fallbackStore = createHistoryStore({
      sessionDir,
      indexRoot: indexDir,
      refreshMs: 0,
      appServer: {
        async readThread() {
          return {
            thread: {
              id: "019d23d4-f1a9-7633-b9c7-758327137228",
              preview: "annotation bridge preview",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1775747451,
              updatedAt: 1775747455,
              status: { type: "notLoaded" },
              path: "/tmp/rollout-019d23d4-f1a9-7633-b9c7-758327137228.jsonl",
              cwd: "/repo/a",
              cliVersion: "0.119.0-alpha.5",
              source: "cli",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: null,
              turns: [],
            },
          };
        },
        close() {},
      },
    });

    const propagated = fallbackStore.setSessionAnnotation("019d23d4-f1a9-7633-b9c7-758327137228", {
      addTags: ["important"],
    }, { refresh: true });
    assert.ok(propagated);

    const fallbackTranscript = await fallbackStore.getTranscriptResolved("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      source: "auto",
      manualTag: "important",
      refresh: true,
    });

    assert.ok(fallbackTranscript);
    assert.strictEqual(fallbackTranscript.source.used, "rollout");
    assert.strictEqual(fallbackTranscript.source.selectionReason, "auto_fallback_filter_miss");
    assert.match(fallbackTranscript.source.selectionNote, /structured transcript filters/i);
    assert.ok(fallbackTranscript.matchedItems > 0);
    assert.match(fallbackTranscript.session.finalAnswerPreview, /annotated rollout answer/);
  });

  it("falls back to rollout transcript in auto mode when structured query filters miss in app-server view", async () => {
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
          type: "user_message",
          message: "inspect query fallback",
        },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "exec_command_end",
          call_id: "call-1",
          turn_id: "turn-1",
          command: ["/bin/zsh", "-lc", "rg -n \"bridge transcript\" src/history.js"],
          cwd: "/repo/a",
          parsed_cmd: [{
            type: "search",
            cmd: "rg -n \"bridge transcript\" src/history.js",
            query: "bridge transcript",
            path: "src/history.js",
          }],
          source: "unified_exec_startup",
          aggregated_output: "12:bridge transcript\n",
          exit_code: 0,
          duration: { secs: 0, nanos: 241700000 },
          status: "completed",
        },
      },
      {
        timestamp: "2026-04-09T15:10:55.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          last_agent_message: "rollout query fallback answer",
        },
      },
      {
        timestamp: "2026-04-09T15:10:56.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-2",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T15:10:57.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "follow-up without structured query",
        },
      },
      {
        timestamp: "2026-04-09T15:10:58.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-2",
          last_agent_message: "late unrelated answer",
        },
      },
    ]);

    let readThreadCalls = 0;
    const store = createHistoryStore({
      sessionDir,
      indexRoot: indexDir,
      refreshMs: 0,
      appServer: {
        async readThread() {
          readThreadCalls += 1;
          return {
            thread: {
              id: "019d23d4-f1a9-7633-b9c7-758327137228",
              forkedFromId: null,
              preview: "lossy bridge thread",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1776171451,
              updatedAt: 1776171455,
              status: { type: "notLoaded" },
              path: "/tmp/019d23d4-f1a9-7633-b9c7-758327137228.jsonl",
              cwd: "/repo/a",
              cliVersion: "0.119.0-alpha.5",
              source: "cli",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: "Lossy bridge thread",
              turns: [
                {
                  id: "turn-1",
                  status: "completed",
                  error: null,
                  startedAt: 1776171452,
                  completedAt: 1776171455,
                  items: [
                    {
                      type: "userMessage",
                      id: "item-1",
                      content: [{ type: "text", text: "inspect query fallback", text_elements: [] }],
                    },
                    {
                      type: "agentMessage",
                      id: "item-2",
                      text: "rollout query fallback answer",
                      phase: "final_answer",
                      memoryCitation: null,
                    },
                  ],
                },
                {
                  id: "turn-2",
                  status: "completed",
                  error: null,
                  startedAt: 1776171456,
                  completedAt: 1776171458,
                  items: [
                    {
                      type: "userMessage",
                      id: "item-3",
                      content: [{ type: "text", text: "follow-up without structured query", text_elements: [] }],
                    },
                    {
                      type: "agentMessage",
                      id: "item-4",
                      text: "late unrelated answer",
                      phase: "final_answer",
                      memoryCitation: null,
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

    const transcript = await store.getTranscriptResolved("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      source: "auto",
      query: "bridge transcript",
      refresh: true,
    });

    assert.ok(transcript);
    assert.strictEqual(readThreadCalls, 1);
    assert.strictEqual(transcript.source.used, "rollout");
    assert.strictEqual(transcript.source.selectionReason, "auto_fallback_filter_miss");
    assert.match(transcript.source.selectionNote, /structured transcript filters/);
    assert.strictEqual(transcript.matchedItems, 1);
    assert.deepStrictEqual(transcript.items[0].matchedQueries, ["bridge transcript"]);
    assert.strictEqual(transcript.quality.mode, "derived_extended_rollout");

    const resume = await store.getResumeResolved("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      source: "auto",
      query: "bridge transcript",
      turnLimit: 2,
      refresh: true,
    });

    assert.ok(resume);
    assert.strictEqual(readThreadCalls, 2);
    assert.strictEqual(resume.source.used, "rollout");
    assert.strictEqual(resume.source.selectionReason, "auto_fallback_filter_miss");
    assert.match(resume.source.selectionNote, /requested resume filters/);
    assert.strictEqual(resume.turnCount, 1);
    assert.strictEqual(resume.totalTurnCount, 2);
    assert.strictEqual(resume.turns.length, 1);
    assert.strictEqual(resume.turns[0].turnId, "turn-1");
    assert.deepStrictEqual(resume.turns[0].matchedQueries, ["bridge transcript"]);
    assert.deepStrictEqual(resume.highlights.queries, ["bridge transcript"]);
    assert.match(resume.text, /Turns: 1 of 2/);
    assert.match(resume.text, /Matched queries: bridge transcript/);
    assert.match(resume.text, /rollout query fallback answer/);
    assert.doesNotMatch(resume.text, /late unrelated answer/);
    assert.strictEqual(resume.quality.mode, "derived_extended_rollout");
  });

  it("falls back to rollout transcript when the app-server bridge fails in auto mode", async () => {
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
          type: "user_message",
          message: "rollout fallback prompt",
        },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          last_agent_message: "rollout fallback answer",
        },
      },
    ]);

    const store = createHistoryStore({
      sessionDir,
      indexRoot: indexDir,
      refreshMs: 0,
      appServer: {
        async readThread() {
          throw new Error("bridge unavailable in test");
        },
        close() {},
      },
    });

    const transcript = await store.getTranscriptResolved("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      source: "auto",
      refresh: true,
    });
    assert.ok(transcript);
    assert.strictEqual(transcript.source.used, "rollout");
    assert.strictEqual(transcript.source.selectionReason, "auto_fallback_bridge_error");
    assert.match(transcript.source.bridgeError, /bridge unavailable in test/);
    assert.match(transcript.session.finalAnswerPreview, /rollout fallback answer/);
    assert.strictEqual(transcript.quality.mode, "derived_limited_rollout");
    assert.strictEqual(transcript.quality.sourceRequested, "auto");
    assert.ok(transcript.quality.recommendations.some((item) => /source=app-server/.test(item)));

    const resume = await store.getResumeResolved("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      source: "auto",
      reloadPolicy: "strict",
      refresh: true,
    });
    assert.ok(resume);
    assert.strictEqual(resume.source.used, "rollout");
    assert.strictEqual(resume.source.selectionReason, "auto_fallback_bridge_error");
    assert.strictEqual(resume.reloadSafety.decision, "blocked");
    assert.strictEqual(resume.reloadSafety.allowed, false);
    assert.ok(resume.reloadSafety.suggestedFlags.includes("--source app-server"));
    assert.ok(resume.reloadSafety.suggestedFlags.includes("--reload-policy allow"));
  });

  it("uses rollout history directly for raw transcript mode without calling the app-server bridge", async () => {
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
          type: "user_message",
          message: "keep this turn",
        },
      },
      {
        timestamp: "2026-04-09T15:10:54.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          last_agent_message: "kept answer",
        },
      },
      {
        timestamp: "2026-04-09T15:10:55.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-2",
          cwd: "/repo/a",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T15:10:56.000Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "drop this turn",
        },
      },
      {
        timestamp: "2026-04-09T15:10:57.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-2",
          last_agent_message: "dropped answer",
        },
      },
      {
        timestamp: "2026-04-09T15:10:58.000Z",
        type: "event_msg",
        payload: {
          type: "thread_rolled_back",
          num_turns: 1,
        },
      },
    ]);

    let bridgeCalls = 0;
    const store = createHistoryStore({
      sessionDir,
      indexRoot: indexDir,
      refreshMs: 0,
      appServer: {
        async readThread() {
          bridgeCalls += 1;
          throw new Error("bridge should not be called for raw transcript mode");
        },
        close() {},
      },
    });

    const transcript = await store.getTranscriptResolved("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      source: "auto",
      historyMode: "raw",
      refresh: true,
    });
    assert.ok(transcript);
    assert.strictEqual(bridgeCalls, 0);
    assert.strictEqual(transcript.historyMode, "raw");
    assert.strictEqual(transcript.source.used, "rollout");
    assert.strictEqual(transcript.source.selectionReason, "raw_history_requires_rollout");
    assert.ok(transcript.items.some((item) => item.turnId === "turn-2"));
    assert.ok(transcript.items.some((item) => item.includedInFinalHistory === false));
    assert.strictEqual(transcript.quality.mode, "raw_rollout_forensic");
    assert.ok(transcript.quality.warnings.some((item) => /rolled-back or superseded turns/.test(item)));

    const resume = await store.getResumeResolved("codex:019d23d4-f1a9-7633-b9c7-758327137228", {
      source: "auto",
      historyMode: "raw",
      refresh: true,
    });
    assert.ok(resume);
    assert.strictEqual(resume.source.selectionReason, "raw_history_requires_rollout");
    assert.strictEqual(resume.reloadSafety.decision, "blocked");
    assert.strictEqual(resume.reloadSafety.allowed, false);
    assert.ok(resume.reloadSafety.suggestedFlags.includes("--history-mode effective"));
  });

  it("can list and inspect exact bridge threads without requiring rollout indexing", async () => {
    const namedThreads = new Map([
      ["019d-thread-a", null],
      ["019d-thread-b", "Pinned backend work"],
    ]);
    const gitInfos = new Map([
      ["019d-thread-a", null],
      ["019d-thread-b", null],
    ]);
    let lastListThreadParams = null;
    let lastLoadedThreadParams = null;
    let closeCalls = 0;

    function makeThread(id) {
      return {
        id,
        forkedFromId: null,
        preview: id === "019d-thread-a" ? "bridge preview a" : "bridge preview b",
        ephemeral: false,
        modelProvider: "openai",
        createdAt: 1776171492,
        updatedAt: 1776171510,
        status: { type: "notLoaded" },
        path: `/tmp/${id}.jsonl`,
        cwd: "/repo/bridge",
        cliVersion: "0.119.0-alpha.5",
        source: id === "019d-thread-b"
          ? {
            subAgent: {
              threadSpawn: {
                parentThreadId: "019d-thread-parent",
                depth: 1,
                agentPath: null,
                agentNickname: "worker",
                agentRole: "default",
              },
            },
          }
          : "cli",
        agentNickname: null,
        agentRole: null,
        gitInfo: gitInfos.get(id),
        name: namedThreads.get(id),
        turns: id === "019d-thread-b"
          ? [{
            id: "turn-1",
            status: "completed",
            error: null,
            startedAt: 1776171493,
            completedAt: 1776171500,
            items: [
              { type: "userMessage", id: "item-1", content: [{ type: "text", text: "inspect exact bridge", text_elements: [] }] },
              { type: "agentMessage", id: "item-2", text: "done", phase: "final_answer", memoryCitation: null },
            ],
          }]
          : [],
      };
    }

    const store = createHistoryStore({
      sessionDir,
      indexRoot: indexDir,
      refreshMs: 0,
      appServer: {
        async listThreads(params = {}) {
          lastListThreadParams = { ...params };
          return {
            data: [makeThread("019d-thread-a"), makeThread("019d-thread-b")],
            nextCursor: "cursor-2",
          };
        },
        async listLoadedThreads(params = {}) {
          lastLoadedThreadParams = { ...params };
          return {
            data: ["019d-thread-b"],
            nextCursor: null,
          };
        },
        async readThread(sessionId) {
          const id = String(sessionId).replace(/^codex:/, "");
          return { thread: makeThread(id) };
        },
        async setThreadName(sessionId, name) {
          const id = String(sessionId).replace(/^codex:/, "");
          namedThreads.set(id, name);
          return { thread: makeThread(id) };
        },
        async updateThreadMetadata(sessionId, patch = {}) {
          const id = String(sessionId).replace(/^codex:/, "");
          const currentGitInfo = gitInfos.get(id) || {};
          const nextGitInfo = {
            branch: Object.prototype.hasOwnProperty.call(patch.gitInfo || {}, "branch")
              ? patch.gitInfo.branch
              : (currentGitInfo.branch ?? null),
            sha: Object.prototype.hasOwnProperty.call(patch.gitInfo || {}, "sha")
              ? patch.gitInfo.sha
              : (currentGitInfo.sha ?? null),
            originUrl: Object.prototype.hasOwnProperty.call(patch.gitInfo || {}, "originUrl")
              ? patch.gitInfo.originUrl
              : (currentGitInfo.originUrl ?? null),
          };
          gitInfos.set(id, nextGitInfo);
          return { thread: makeThread(id) };
        },
        close() {
          closeCalls += 1;
        },
      },
    });

    const threads = await store.listBridgeThreads({
      q: "bridge",
      limit: 2,
      sortKey: "updated_at",
      modelProviders: ["openai", "anthropic"],
      sourceKinds: ["sub-agent-thread-spawn", "cli"],
    });
    assert.strictEqual(threads.total, 2);
    assert.strictEqual(threads.nextCursor, "cursor-2");
    assert.strictEqual(threads.source.selectionReason, "app_server_only_operation");
    assert.match(threads.source.selectionNote, /exact bridge-only/);
    assert.strictEqual(threads.threads[1].name, "Pinned backend work");
    assert.strictEqual(threads.threads[1].source, "subAgentThreadSpawn");
    assert.strictEqual(threads.threads[1].sourceKind, "subAgentThreadSpawn");
    assert.strictEqual(threads.threads[1].sourceDetail.parentThreadId, "codex:019d-thread-parent");
    assert.deepStrictEqual(lastListThreadParams, {
      cursor: undefined,
      limit: 2,
      sortKey: "updated_at",
      sortDirection: undefined,
      useStateDbOnly: undefined,
      modelProviders: ["openai", "anthropic"],
      sourceKinds: ["subAgentThreadSpawn", "cli"],
      cwd: undefined,
      searchTerm: "bridge",
      archived: null,
    });

    const loaded = await store.listLoadedThreads({ limit: 5 });
    assert.strictEqual(loaded.total, 1);
    assert.strictEqual(loaded.source.selectionReason, "app_server_only_operation");
    assert.match(loaded.source.selectionNote, /exact bridge-only/);
    assert.strictEqual(loaded.threads[0].sessionId, "codex:019d-thread-b");
    assert.deepStrictEqual(lastLoadedThreadParams, {
      cursor: undefined,
      limit: 5,
    });

    const thread = await store.getBridgeThread("codex:019d-thread-b");
    assert.ok(thread);
    assert.strictEqual(thread.source.selectionReason, "app_server_only_operation");
    assert.match(thread.source.selectionNote, /exact bridge-only/);
    assert.strictEqual(thread.thread.turnCount, 1);
    assert.deepStrictEqual(thread.thread.itemTypes, ["userMessage", "agentMessage"]);

    const renamed = await store.setBridgeThreadName("codex:019d-thread-a", "Bridge exact view");
    assert.ok(renamed);
    assert.strictEqual(renamed.source.selectionReason, "app_server_only_operation");
    assert.match(renamed.source.selectionNote, /exact bridge-only/);
    assert.strictEqual(renamed.thread.name, "Bridge exact view");

    const metadataUpdated = await store.updateBridgeThreadMetadata("codex:019d-thread-a", {
      gitInfo: {
        branch: "release/main",
        sha: "abc123",
        originUrl: "https://example.test/repo.git",
      },
    });
    assert.ok(metadataUpdated);
    assert.strictEqual(metadataUpdated.source.selectionReason, "app_server_only_operation");
    assert.match(metadataUpdated.source.selectionNote, /exact bridge-only/);
    assert.deepStrictEqual(metadataUpdated.thread.gitInfo, {
      branch: "release/main",
      sha: "abc123",
      originUrl: "https://example.test/repo.git",
    });

    await store.close();
    assert.strictEqual(closeCalls, 1);
  });

  it("can set exact bridge memory mode and invalidate cached catalog state", async () => {
    const fileName = "rollout-2026-04-09T18-10-51-thread-memory-mode.jsonl";
    const rolloutPath = path.join(dateDir, fileName);
    writeRollout(dateDir, fileName, [
      {
        timestamp: "2026-04-09T18:10:51.000Z",
        type: "session_meta",
        payload: {
          id: "thread-memory-mode",
          cwd: "/repo/memory",
          memory_mode: "enabled",
        },
      },
      {
        timestamp: "2026-04-09T18:10:52.000Z",
        type: "turn_context",
        payload: {
          turn_id: "turn-1",
          cwd: "/repo/memory",
          model: "gpt-5.4",
        },
      },
      {
        timestamp: "2026-04-09T18:10:53.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "turn-1",
          last_agent_message: "memory mode baseline",
        },
      },
    ]);

    const store = createHistoryStore({
      sessionDir,
      indexRoot: indexDir,
      refreshMs: 60000,
      appServer: {
        async setThreadMemoryMode(sessionId, mode) {
          assert.strictEqual(sessionId, "codex:thread-memory-mode");
          assert.strictEqual(mode, "disabled");
          const current = fs.readFileSync(rolloutPath, "utf8");
          const nextRecord = `${JSON.stringify({
            timestamp: "2026-04-09T18:10:54.000Z",
            type: "session_meta",
            payload: {
              id: "thread-memory-mode",
              cwd: "/repo/memory",
              memory_mode: "disabled",
            },
          })}\n`;
          fs.writeFileSync(rolloutPath, `${current}${nextRecord}`);
          return {
            threadId: "thread-memory-mode",
            sessionId,
            memoryMode: mode,
          };
        },
        close() {},
      },
    });

    const before = store.getSession("codex:thread-memory-mode", false);
    assert.ok(before);
    assert.strictEqual(before.rolloutPersistence.memoryMode, "enabled");

    const mutation = await store.setBridgeThreadMemoryMode("codex:thread-memory-mode", "disabled");
    assert.strictEqual(mutation.threadId, "thread-memory-mode");
    assert.strictEqual(mutation.sessionId, "codex:thread-memory-mode");
    assert.strictEqual(mutation.memoryMode, "disabled");
    assert.strictEqual(mutation.source.selectionReason, "app_server_only_operation");
    assert.match(mutation.source.selectionNote, /exact bridge-only/);

    const after = store.getSession("codex:thread-memory-mode", false);
    assert.ok(after);
    assert.strictEqual(after.rolloutPersistence.memoryMode, "disabled");

    const stats = store.getStats(false);
    assert.deepStrictEqual(stats.memoryModeCounts, { disabled: 1 });
  });

  it("can preview and persist a safe fork+prune flow over the app-server bridge", async () => {
    const threads = new Map();
    let lastForkOptions = null;

    function clone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    function makeTurn(id, userText, answerText, startedAt) {
      return {
        id,
        status: "completed",
        error: null,
        startedAt,
        completedAt: startedAt + 5,
        durationMs: 5000,
        items: [
          {
            type: "userMessage",
            id: `${id}-user`,
            content: [{ type: "text", text: userText, text_elements: [] }],
          },
          {
            type: "agentMessage",
            id: `${id}-answer`,
            text: answerText,
            phase: "final_answer",
            memoryCitation: null,
          },
        ],
      };
    }

    threads.set("019d-thread-prune", {
      id: "019d-thread-prune",
      forkedFromId: null,
      preview: "prunable thread",
      ephemeral: false,
      modelProvider: "openai",
      createdAt: 1776171492,
      updatedAt: 1776171510,
      status: { type: "notLoaded" },
      path: "/tmp/019d-thread-prune.jsonl",
      cwd: "/repo/prune",
      cliVersion: "0.119.0-alpha.5",
      source: "cli",
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: null,
      turns: [
        makeTurn("turn-1", "keep this turn", "first answer", 1776171493),
        makeTurn("turn-2", "drop this turn", "second answer", 1776171503),
        makeTurn("turn-3", "drop this too", "third answer", 1776171513),
      ],
    });

    const store = createHistoryStore({
      sessionDir,
      indexRoot: indexDir,
      refreshMs: 0,
      appServer: {
        async readThread(sessionId) {
          const id = String(sessionId).replace(/^codex:/, "");
          return { thread: clone(threads.get(id)) };
        },
        async forkThread(sessionId, options = {}) {
          const id = String(sessionId).replace(/^codex:/, "");
          lastForkOptions = { ...options };
          const source = clone(threads.get(id));
          const forkId = `${id}-fork`;
          const forked = {
            ...source,
            id: forkId,
            forkedFromId: id,
            path: `/tmp/${forkId}.jsonl`,
            name: null,
          };
          if (typeof options.lastTurnId === "string" && options.lastTurnId) {
            const keepIndex = forked.turns.findIndex((turn) => turn.id === options.lastTurnId);
            if (keepIndex >= 0) forked.turns = forked.turns.slice(0, keepIndex + 1);
          }
          threads.set(forkId, forked);
          return { thread: clone(forked) };
        },
        async rollbackThread() {
          throw new Error("rollback should not be called when the fork honors lastTurnId");
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

    const candidates = await store.listPruneCandidates("codex:019d-thread-prune", {
      limit: 3,
      refresh: true,
    });
    assert.ok(candidates);
    assert.strictEqual(candidates.source.selectionReason, "app_server_only_operation");
    assert.match(candidates.source.selectionNote, /exact bridge-only/);
    assert.strictEqual(candidates.quality.mode, "app_server_thread_view");
    assert.strictEqual(candidates.candidateCount, 3);
    assert.strictEqual(candidates.candidates[0].turnId, "turn-1");
    assert.strictEqual(candidates.candidates[0].newerTurns, 2);
    assert.strictEqual(candidates.candidates[1].remainingTurnCount, 2);

    const preview = await store.getPrunePreview("codex:019d-thread-prune", {
      throughTurn: "turn-1",
      turnLimit: 2,
      refresh: true,
    });
    assert.ok(preview);
    assert.strictEqual(preview.source.selectionReason, "app_server_only_operation");
    assert.match(preview.source.selectionNote, /exact bridge-only/);
    assert.strictEqual(preview.originalTurnCount, 3);
    assert.strictEqual(preview.selectionMode, "through_turn");
    assert.strictEqual(preview.throughTurnId, "turn-1");
    assert.strictEqual(preview.appliedDropTurns, 2);
    assert.strictEqual(preview.remainingTurnCount, 1);
    assert.strictEqual(preview.droppedTurns.length, 2);
    assert.strictEqual(preview.quality.mode, "app_server_thread_view");
    assert.ok(preview.quality.recommendations.some((item) => /thread\/fork, thread\/rollback, or thread\/inject_items/.test(item)));
    assert.match(preview.resume.text, /keep this turn/);
    assert.ok(!/third answer/.test(preview.resume.text));

    const forked = await store.forkPruneThread("codex:019d-thread-prune", {
      throughTurn: "turn-1",
      name: "Trimmed thread",
      turnLimit: 2,
      refresh: true,
    });
    assert.ok(forked);
    assert.strictEqual(forked.source.selectionReason, "app_server_only_operation");
    assert.match(forked.source.selectionNote, /exact bridge-only/);
    assert.strictEqual(forked.forkedSessionId, "codex:019d-thread-prune-fork");
    assert.strictEqual(forked.thread.name, "Trimmed thread");
    assert.strictEqual(forked.thread.forkedFromId, "codex:019d-thread-prune");
    assert.strictEqual(forked.remainingTurnCount, 1);
    assert.strictEqual(forked.prunedVia, "fork_last_turn_id");
    assert.strictEqual(forked.quality.mode, "app_server_thread_view");
    assert.match(forked.resume.text, /first answer/);
    assert.strictEqual(threads.get("019d-thread-prune").turns.length, 3);
    assert.strictEqual(threads.get("019d-thread-prune-fork").turns.length, 1);
    assert.deepStrictEqual(lastForkOptions, {
      ephemeral: false,
      lastTurnId: "turn-1",
    });
  });

  it("recomputes prune selection against the fork snapshot before rollback", async () => {
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
        completedAt: startedAt + 5,
        durationMs: 5000,
        items: [
          {
            type: "userMessage",
            id: `${id}-user`,
            content: [{ type: "text", text: userText, text_elements: [] }],
          },
          {
            type: "agentMessage",
            id: `${id}-answer`,
            text: answerText,
            phase: "final_answer",
            memoryCitation: null,
          },
        ],
      };
    }

    threads.set("019d-thread-shifting", {
      id: "019d-thread-shifting",
      forkedFromId: null,
      preview: "shifting thread",
      ephemeral: false,
      modelProvider: "openai",
      createdAt: 1776171492,
      updatedAt: 1776171510,
      status: { type: "notLoaded" },
      path: "/tmp/019d-thread-shifting.jsonl",
      cwd: "/repo/prune",
      cliVersion: "0.119.0-alpha.5",
      source: "cli",
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: null,
      turns: [
        makeTurn("turn-1", "keep this turn", "first answer", 1776171493),
        makeTurn("turn-2", "drop this turn", "second answer", 1776171503),
      ],
    });

    const store = createHistoryStore({
      sessionDir,
      indexRoot: indexDir,
      refreshMs: 0,
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
            path: `/tmp/${forkId}.jsonl`,
            turns: [
              ...source.turns,
              makeTurn("turn-3", "interrupted tail", "third answer", 1776171513),
            ],
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
        close() {},
      },
    });

    const forked = await store.forkPruneThread("codex:019d-thread-shifting", {
      throughTurn: "turn-1",
      refresh: true,
    });

    assert.ok(forked);
    assert.strictEqual(forked.appliedDropTurns, 2);
    assert.strictEqual(forked.remainingTurnCount, 1);
    assert.strictEqual(threads.get("019d-thread-shifting-fork").turns.length, 1);
    assert.strictEqual(threads.get("019d-thread-shifting-fork").turns[0].id, "turn-1");
  });

  it("can resolve app-server transcript without a rollout-backed session document", async () => {
    const store = createHistoryStore({
      sessionDir,
      indexRoot: indexDir,
      refreshMs: 0,
      appServer: {
        async readThread() {
          return {
            thread: {
              id: "019d-thread-only",
              forkedFromId: null,
              preview: "exact bridge only session",
              ephemeral: false,
              modelProvider: "openai",
              createdAt: 1776171492,
              updatedAt: 1776171510,
              status: { type: "notLoaded" },
              path: "/tmp/019d-thread-only.jsonl",
              cwd: "/repo/exact",
              cliVersion: "0.119.0-alpha.5",
              source: "cli",
              agentNickname: null,
              agentRole: null,
              gitInfo: null,
              name: "Exact bridge only",
              turns: [
                {
                  id: "turn-exact",
                  status: "completed",
                  error: null,
                  startedAt: 1776171493,
                  completedAt: 1776171500,
                  items: [
                    {
                      type: "userMessage",
                      id: "item-1",
                      content: [{ type: "text", text: "show exact thread", text_elements: [] }],
                    },
                    {
                      type: "agentMessage",
                      id: "item-2",
                      text: "exact thread answer",
                      phase: "final_answer",
                      memoryCitation: null,
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

    const transcript = await store.getTranscriptResolved("codex:019d-thread-only", {
      source: "app-server",
      refresh: true,
    });

    assert.ok(transcript);
    assert.strictEqual(transcript.source.used, "app_server");
    assert.strictEqual(transcript.session.sessionId, "codex:019d-thread-only");
    assert.match(transcript.session.finalAnswerPreview, /exact thread answer/);
    assert.strictEqual(transcript.quality.mode, "app_server_thread_view");
  });
});
