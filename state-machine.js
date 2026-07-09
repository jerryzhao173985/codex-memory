"use strict";

const { EventEmitter } = require("events");
const { summarizeRecord } = require("./parser");
const {
  createActivityCounts,
  categorizeRecord,
  updateActivityCounts,
  noteToolUsage,
  buildSessionAnalytics,
  buildGlobalAnalytics,
} = require("./analytics");

const STATE_PRIORITY = Object.freeze({
  error: 8,
  notification: 7,
  sweeping: 6,
  attention: 5,
  carrying: 4,
  juggling: 4,
  working: 3,
  thinking: 2,
  idle: 1,
  sleeping: 0,
});

const ONESHOT_STATES = new Set(["attention", "error", "sweeping", "notification", "carrying"]);

const DEFAULT_ONESHOT_MS = Object.freeze({
  attention: 4000,
  error: 5000,
  sweeping: 2500,
  notification: 2500,
  carrying: 3000,
});

const MAX_SESSION_EVENTS = 30;
const MAX_GLOBAL_EVENTS = 200;
const MAX_RECENT_ITEMS = 10;
const MAX_RECENT_RECORD_FINGERPRINTS = 400;

function normalizeState(rawState, fallbackState) {
  const candidate = rawState || fallbackState;
  if (candidate === "codex-permission") return "notification";
  return candidate;
}

function toPositiveInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function toTimestampMs(value) {
  if (Number.isFinite(value)) return Number(value);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

function pushBounded(list, item, limit) {
  list.push(item);
  if (list.length > limit) list.splice(0, list.length - limit);
}

function cloneSerializable(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function buildRecordFingerprint(record) {
  return JSON.stringify([
    record && record.timestamp ? record.timestamp : null,
    record && record.key ? record.key : null,
    record && record.turnId ? record.turnId : null,
    record && record.callId ? record.callId : null,
    record && record.role ? record.role : null,
    record && record.phase ? record.phase : null,
    record && record.toolName ? record.toolName : null,
    record && record.command ? record.command : null,
    record && record.commandSource ? record.commandSource : null,
    record && Array.isArray(record.commandTypes) ? record.commandTypes : null,
    record && Array.isArray(record.commandPaths) ? record.commandPaths : null,
    record && record.query ? record.query : null,
    record && record.preview ? record.preview : null,
    record && Object.prototype.hasOwnProperty.call(record, "success") ? record.success : null,
  ]);
}

function rememberFingerprint(session, fingerprint) {
  if (!fingerprint) return true;
  if (session._recentRecordFingerprints.has(fingerprint)) return false;
  session._recentRecordFingerprints.add(fingerprint);
  session._recentRecordOrder.push(fingerprint);
  if (session._recentRecordOrder.length > MAX_RECENT_RECORD_FINGERPRINTS) {
    const removed = session._recentRecordOrder.shift();
    if (removed) session._recentRecordFingerprints.delete(removed);
  }
  return true;
}

function createSession(sessionId, now) {
  return {
    sessionId,
    state: "idle",
    updatedAt: now,
    cwd: "",
    sourcePid: null,
    agentPid: null,
    host: null,
    lastEvent: "",
    lastRawState: "idle",
    permissionDetail: null,
    sessionMeta: null,
    turnContext: null,
    activeTurnId: null,
    turnsStarted: 0,
    turnsCompleted: 0,
    turnsAborted: 0,
    compactionCount: 0,
    toolCallCount: 0,
    lastUserMessage: null,
    lastAssistantMessage: null,
    lastCommentary: null,
    lastFinalAnswer: null,
    lastReasoning: null,
    lastTokenCount: null,
    rateLimits: null,
    lastCommand: null,
    lastPatch: null,
    lastWebSearch: null,
    lastMcpCall: null,
    lastError: null,
    lastCompaction: null,
    recentMessages: [],
    recentReasoning: [],
    recentCommands: [],
    recentPatches: [],
    recentWebSearches: [],
    recentMcpCalls: [],
    recentErrors: [],
    recentEvents: [],
    activityCounts: createActivityCounts(),
    toolUsage: {},
    commandStats: {
      started: 0,
      completed: 0,
      failed: 0,
    },
    patchStats: {
      total: 0,
      applied: 0,
      failed: 0,
      filesTouched: 0,
      add: 0,
      update: 0,
      delete: 0,
    },
    searchStats: {
      total: 0,
    },
    mcpStats: {
      total: 0,
    },
    errorCount: 0,
    lastActivity: null,
    _recentRecordFingerprints: new Set(),
    _recentRecordOrder: [],
    _pendingToolCalls: new Map(),
  };
}

class CodexStateMachine extends EventEmitter {
  constructor(options = {}) {
    super();
    this._workingStaleMs = options.workingStaleMs || 300000;
    this._sessionStaleMs = options.sessionStaleMs || 600000;
    this._staleCleanupIntervalMs = options.staleCleanupIntervalMs || 10000;
    this._oneshotMs = { ...DEFAULT_ONESHOT_MS, ...(options.oneshotMs || {}) };
    this.sessions = new Map();
    this.currentState = "idle";
    this.currentStateAt = Date.now();
    this.recentEvents = [];
    this._autoReturnTimer = null;
    this._staleCleanupTimer = null;
  }

  start() {
    if (this._staleCleanupTimer) return this;
    this._staleCleanupTimer = setInterval(
      () => this.cleanStaleSessions(),
      this._staleCleanupIntervalMs
    );
    return this;
  }

  stop() {
    this._clearAutoReturn();
    if (this._staleCleanupTimer) {
      clearInterval(this._staleCleanupTimer);
      this._staleCleanupTimer = null;
    }
  }

  observeRecord(sessionId, record, extra = {}) {
    const now = toTimestampMs(extra.timestampMs) ?? toTimestampMs(record && record.timestamp) ?? Date.now();
    if (!sessionId) {
      const globalEvent = {
        sessionId,
        ...summarizeRecord(record),
        cwd: record.cwd || extra.cwd || "",
        sourcePid: toPositiveInt(extra.sourcePid) || null,
        agentPid: toPositiveInt(extra.agentPid) || null,
        host: typeof extra.host === "string" ? extra.host : "",
      };
      pushBounded(this.recentEvents, globalEvent, MAX_GLOBAL_EVENTS);
      this.emit("snapshot", this.getSnapshot());
      return;
    }

    const session = this._ensureSession(sessionId, now);
    if (record.cwd) session.cwd = record.cwd;
    if (extra.cwd) session.cwd = extra.cwd;
    session.sourcePid = toPositiveInt(extra.sourcePid ?? session.sourcePid) || session.sourcePid;
    session.agentPid = toPositiveInt(extra.agentPid ?? session.agentPid) || session.agentPid;
    if (typeof extra.host === "string" && extra.host) session.host = extra.host;

    const fingerprint = buildRecordFingerprint(record);
    if (!rememberFingerprint(session, fingerprint)) return;

    session.updatedAt = now;
    const globalEvent = {
      sessionId,
      ...summarizeRecord(record),
      cwd: record.cwd || extra.cwd || "",
      sourcePid: toPositiveInt(extra.sourcePid) || null,
      agentPid: toPositiveInt(extra.agentPid) || null,
      host: typeof extra.host === "string" ? extra.host : "",
    };
    pushBounded(this.recentEvents, globalEvent, MAX_GLOBAL_EVENTS);
    pushBounded(session.recentEvents, globalEvent, MAX_SESSION_EVENTS);
    session.lastActivity = {
      timestamp: record.timestamp,
      kind: record.kind,
      preview: record.preview,
      category: categorizeRecord(record),
    };

    switch (record.kind) {
      case "session_meta":
        session.sessionMeta = cloneSerializable(record.sessionMeta);
        if (record.sessionMeta && record.sessionMeta.cwd) session.cwd = record.sessionMeta.cwd;
        break;
      case "turn_context":
        session.turnContext = cloneSerializable(record.turnContext);
        if (record.turnContext && record.turnContext.turnId) session.activeTurnId = record.turnContext.turnId;
        if (record.turnContext && record.turnContext.cwd) session.cwd = record.turnContext.cwd;
        break;
      case "turn_lifecycle":
        if (record.lifecycle === "started") {
          session.turnsStarted += 1;
          if (record.turnId) session.activeTurnId = record.turnId;
        } else if (record.lifecycle === "completed") {
          session.turnsCompleted += 1;
          if (record.turnId) session.activeTurnId = record.turnId;
          if (record.text) {
            session.lastAssistantMessage = {
              text: record.text,
              preview: record.preview,
              phase: "final_answer",
              timestamp: record.timestamp,
            };
            session.lastFinalAnswer = session.lastAssistantMessage;
          }
        } else if (record.lifecycle === "aborted") {
          session.turnsAborted += 1;
        }
        break;
      case "message": {
        const entry = {
          timestamp: record.timestamp,
          role: record.role || null,
          phase: record.phase || null,
          text: record.text || "",
          preview: record.preview,
        };
        pushBounded(session.recentMessages, entry, MAX_RECENT_ITEMS);
        if (record.role === "user") {
          session.lastUserMessage = entry;
        } else if (record.role === "assistant") {
          session.lastAssistantMessage = entry;
          if (record.phase === "commentary") session.lastCommentary = entry;
          if (record.phase === "final_answer") session.lastFinalAnswer = entry;
        }
        break;
      }
      case "reasoning": {
        const entry = {
          timestamp: record.timestamp,
          text: record.text || "",
          preview: record.preview,
        };
        session.lastReasoning = entry;
        pushBounded(session.recentReasoning, entry, MAX_RECENT_ITEMS);
        updateActivityCounts(session.activityCounts, "reasoning");
        break;
      }
      case "token_count":
        session.lastTokenCount = cloneSerializable(record.tokenUsage);
        session.rateLimits = cloneSerializable(record.rateLimits);
        break;
      case "tool_call": {
        session.toolCallCount += 1;
        noteToolUsage(session.toolUsage, record);
        const entry = {
          timestamp: record.timestamp,
          callId: record.callId || null,
          toolName: record.toolName || null,
          toolClass: record.toolClass || null,
          command: record.command || null,
          commandSource: record.commandSource || null,
          commandTypes: cloneSerializable(record.commandTypes || []),
          commandTypeHints: cloneSerializable(record.commandTypeHints || []),
          commandPaths: cloneSerializable(record.commandPaths || []),
          commandQueries: cloneSerializable(record.commandQueries || []),
          shellCommands: cloneSerializable(record.shellCommands || []),
          preview: record.preview,
          patch: cloneSerializable(record.patch),
        };
        if (record.callId) session._pendingToolCalls.set(record.callId, entry);
        if (record.command) {
          session.commandStats.started += 1;
          updateActivityCounts(session.activityCounts, categorizeRecord(record));
          session.lastCommand = { ...entry, completed: false };
          pushBounded(session.recentCommands, { ...entry, completed: false }, MAX_RECENT_ITEMS);
        }
        if (record.patch && record.toolName === "apply_patch") {
          updateActivityCounts(session.activityCounts, "edit");
          session.lastPatch = {
            timestamp: record.timestamp,
            preview: record.preview,
            patch: cloneSerializable(record.patch),
          };
        }
        break;
      }
      case "tool_output": {
        const pending = record.callId ? session._pendingToolCalls.get(record.callId) : null;
        if (pending && pending.command) {
          session.commandStats.completed += 1;
          if (record.output && Number.isInteger(record.output.exitCode) && record.output.exitCode !== 0) {
            session.commandStats.failed += 1;
          }
          const completed = {
            ...pending,
            completed: true,
            timestamp: record.timestamp || pending.timestamp,
            commandSource: record.commandSource || pending.commandSource || null,
            commandTypes: cloneSerializable(
              (Array.isArray(record.commandTypes) && record.commandTypes.length)
                ? record.commandTypes
                : (pending.commandTypes || [])
            ),
            commandTypeHints: cloneSerializable(
              (Array.isArray(record.commandTypeHints) && record.commandTypeHints.length)
                ? record.commandTypeHints
                : (pending.commandTypeHints || [])
            ),
            commandPaths: cloneSerializable(
              (Array.isArray(record.commandPaths) && record.commandPaths.length)
                ? record.commandPaths
                : (pending.commandPaths || [])
            ),
            commandQueries: cloneSerializable(
              (Array.isArray(record.commandQueries) && record.commandQueries.length)
                ? record.commandQueries
                : (pending.commandQueries || [])
            ),
            shellCommands: cloneSerializable(
              (Array.isArray(record.shellCommands) && record.shellCommands.length)
                ? record.shellCommands
                : (pending.shellCommands || [])
            ),
            outputPreview: record.output ? record.output.preview : record.preview,
            exitCode: record.output ? record.output.exitCode : null,
            durationSeconds: record.output ? record.output.durationSeconds : null,
            tokenCount: record.output ? record.output.tokenCount : null,
            chunkId: record.output ? record.output.chunkId : null,
          };
          session.lastCommand = completed;
          pushBounded(session.recentCommands, completed, MAX_RECENT_ITEMS);
          session._pendingToolCalls.delete(record.callId);
        } else if (record.command) {
          noteToolUsage(session.toolUsage, record);
          updateActivityCounts(session.activityCounts, categorizeRecord(record));
          session.commandStats.started += 1;
          session.commandStats.completed += 1;
          if (record.output && Number.isInteger(record.output.exitCode) && record.output.exitCode !== 0) {
            session.commandStats.failed += 1;
          }
          const completed = {
            timestamp: record.timestamp,
            callId: record.callId || null,
            toolName: record.toolName || null,
            toolClass: record.toolClass || null,
            command: record.command,
            commandSource: record.commandSource || null,
            commandTypes: cloneSerializable(record.commandTypes || []),
            commandTypeHints: cloneSerializable(record.commandTypeHints || []),
            commandPaths: cloneSerializable(record.commandPaths || []),
            commandQueries: cloneSerializable(record.commandQueries || []),
            shellCommands: cloneSerializable(record.shellCommands || []),
            preview: record.preview,
            completed: true,
            outputPreview: record.output ? record.output.preview : record.preview,
            exitCode: record.output ? record.output.exitCode : null,
            durationSeconds: record.output ? record.output.durationSeconds : null,
            tokenCount: record.output ? record.output.tokenCount : null,
            chunkId: record.output ? record.output.chunkId : null,
          };
          session.lastCommand = completed;
          pushBounded(session.recentCommands, completed, MAX_RECENT_ITEMS);
        }
        break;
      }
      case "patch": {
        updateActivityCounts(session.activityCounts, "edit");
        const entry = {
          timestamp: record.timestamp,
          callId: record.callId || null,
          turnId: record.turnId || null,
          success: record.success === true,
          preview: record.preview,
          patch: cloneSerializable(record.patch),
        };
        session.lastPatch = entry;
        pushBounded(session.recentPatches, entry, MAX_RECENT_ITEMS);
        session.patchStats.total += 1;
        if (entry.success) session.patchStats.applied += 1;
        else session.patchStats.failed += 1;
        if (record.patch) {
          session.patchStats.filesTouched += record.patch.fileCount || 0;
          session.patchStats.add += record.patch.types && record.patch.types.add ? record.patch.types.add : 0;
          session.patchStats.update += record.patch.types && record.patch.types.update ? record.patch.types.update : 0;
          session.patchStats.delete += record.patch.types && record.patch.types.delete ? record.patch.types.delete : 0;
        }
        if (record.callId) session._pendingToolCalls.delete(record.callId);
        break;
      }
      case "web_search": {
        session.toolCallCount += 1;
        noteToolUsage(session.toolUsage, record);
        updateActivityCounts(session.activityCounts, "search");
        const entry = {
          timestamp: record.timestamp,
          callId: record.callId || null,
          query: record.query || "",
          queries: cloneSerializable(record.queries || []),
          actionType: record.actionType || null,
          status: record.toolStatus || null,
          preview: record.preview,
        };
        session.lastWebSearch = entry;
        pushBounded(session.recentWebSearches, entry, MAX_RECENT_ITEMS);
        session.searchStats.total += 1;
        break;
      }
      case "mcp": {
        session.toolCallCount += 1;
        noteToolUsage(session.toolUsage, record);
        updateActivityCounts(session.activityCounts, categorizeRecord(record));
        const entry = {
          timestamp: record.timestamp,
          callId: record.callId || null,
          server: record.mcp ? record.mcp.server : null,
          tool: record.mcp ? record.mcp.tool : null,
          durationMs: record.mcp ? record.mcp.durationMs : null,
          resultPreview: record.mcp ? record.mcp.resultPreview : "",
          preview: record.preview,
        };
        session.lastMcpCall = entry;
        pushBounded(session.recentMcpCalls, entry, MAX_RECENT_ITEMS);
        session.mcpStats.total += 1;
        break;
      }
      case "error": {
        updateActivityCounts(session.activityCounts, "error");
        const entry = {
          timestamp: record.timestamp,
          code: record.error ? record.error.code : null,
          statusCode: record.error ? record.error.statusCode : null,
          requestId: record.error ? record.error.requestId : null,
          url: record.error ? record.error.url : null,
          message: record.error ? record.error.message : "",
          preview: record.preview,
        };
        session.lastError = entry;
        pushBounded(session.recentErrors, entry, MAX_RECENT_ITEMS);
        session.errorCount += 1;
        break;
      }
      case "compaction":
        session.compactionCount += 1;
        session.lastCompaction = {
          timestamp: record.timestamp,
          preview: record.preview,
          compaction: cloneSerializable(record.compaction),
        };
        break;
      case "permission":
        session.permissionDetail = cloneSerializable(record.permissionDetail);
        break;
      default:
        break;
    }

    this.emit("snapshot", this.getSnapshot());
  }

  handleEvent(input = {}) {
    const now = toTimestampMs(input.timestampMs ?? input.timestamp_ms) ?? Date.now();
    const sessionId = typeof input.sessionId === "string" && input.sessionId
      ? input.sessionId
      : (typeof input.session_id === "string" && input.session_id ? input.session_id : "default");
    const event = typeof input.event === "string" ? input.event : "";
    const rawState = typeof input.rawState === "string" && input.rawState
      ? input.rawState
      : (typeof input.raw_state === "string" && input.raw_state
        ? input.raw_state
        : (typeof input.state === "string" ? input.state : ""));
    const logicalState = normalizeState(rawState, input.state);
    if (!logicalState || !Object.prototype.hasOwnProperty.call(STATE_PRIORITY, logicalState)) {
      throw new Error(`Unknown state: ${rawState || input.state || "<empty>"}`);
    }

    const session = this._ensureSession(sessionId, now);
    if (typeof input.cwd === "string" && input.cwd) session.cwd = input.cwd;
    session.sourcePid = toPositiveInt(input.sourcePid ?? input.source_pid) || session.sourcePid;
    session.agentPid = toPositiveInt(input.agentPid ?? input.agent_pid ?? input.codex_pid) || session.agentPid;
    if (typeof input.host === "string" && input.host) session.host = input.host;

    const permissionDetail = input.permissionDetail || input.permission_detail || session.permissionDetail || null;

    if (logicalState === "sleeping" || event === "SessionEnd" || event === "stale-cleanup") {
      this.sessions.delete(sessionId);
      this._clearAutoReturn();
      this._setCurrentState(this.resolveDisplayState(), now);
      return this._emitTransition({
        sessionId,
        event,
        rawState,
        state: logicalState,
        cwd: session.cwd,
        permissionDetail,
        removed: true,
      });
    }

    if (ONESHOT_STATES.has(logicalState)) {
      session.updatedAt = now;
      session.lastEvent = event;
      session.lastRawState = rawState;
      session.permissionDetail = logicalState === "notification" ? cloneSerializable(permissionDetail) : null;
      this._setCurrentState(logicalState, now);
      this._scheduleAutoReturn(logicalState, sessionId);
      return this._emitTransition({
        sessionId,
        event,
        rawState,
        state: logicalState,
        cwd: session.cwd,
        permissionDetail: session.permissionDetail,
        removed: false,
      });
    }

    session.state = logicalState;
    session.updatedAt = now;
    session.lastEvent = event;
    session.lastRawState = rawState;
    session.permissionDetail = null;
    this._clearAutoReturn();
    this._setCurrentState(this.resolveDisplayState(), now);
    return this._emitTransition({
      sessionId,
      event,
      rawState,
      state: logicalState,
      cwd: session.cwd,
      permissionDetail: null,
      removed: false,
    });
  }

  resolveDisplayState() {
    if (this.sessions.size === 0) return "idle";
    let best = "sleeping";
    for (const session of this.sessions.values()) {
      if ((STATE_PRIORITY[session.state] || 0) > (STATE_PRIORITY[best] || 0)) {
        best = session.state;
      }
    }
    return best;
  }

  cleanStaleSessions() {
    const now = Date.now();
    let changed = false;

    for (const [id, session] of this.sessions) {
      const age = now - session.updatedAt;
      const livePid = session.agentPid || session.sourcePid || null;
      if (livePid && !isProcessAlive(livePid)) {
        this.sessions.delete(id);
        changed = true;
        continue;
      }
      if (age > this._sessionStaleMs) {
        this.sessions.delete(id);
        changed = true;
        continue;
      }
      if (age > this._workingStaleMs && (session.state === "working" || session.state === "thinking")) {
        session.state = "idle";
        session.permissionDetail = null;
        changed = true;
      }
    }

    if (!changed) return null;
    this._clearAutoReturn();
    this._setCurrentState(this.resolveDisplayState(), now);
    return this._emitTransition({
      sessionId: null,
      event: "stale-cleanup",
      rawState: null,
      state: this.currentState,
      cwd: "",
      permissionDetail: null,
      removed: true,
    });
  }

  listSessions() {
    return [...this.sessions.entries()]
      .map(([sessionId, session]) => this._serializeSession(sessionId, session))
      .sort((a, b) => {
        const priorityDelta = (STATE_PRIORITY[b.state] || 0) - (STATE_PRIORITY[a.state] || 0);
        if (priorityDelta !== 0) return priorityDelta;
        return b.updatedAt - a.updatedAt;
      });
  }

  getSnapshot() {
    return {
      state: this.currentState,
      resolvedState: this.resolveDisplayState(),
      updatedAt: new Date(this.currentStateAt).toISOString(),
      sessionCount: this.sessions.size,
      analytics: this.getAnalytics(),
      recentEvents: cloneSerializable(this.recentEvents),
      sessions: this.listSessions(),
    };
  }

  getAnalytics() {
    return buildGlobalAnalytics(this.listSessions(), {
      state: this.currentState,
      resolvedState: this.resolveDisplayState(),
    });
  }

  _ensureSession(sessionId, now) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = createSession(sessionId, now);
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  _serializeSession(sessionId, session) {
    return {
      sessionId,
      state: session.state,
      updatedAt: session.updatedAt,
      cwd: session.cwd,
      sourcePid: session.sourcePid,
      agentPid: session.agentPid,
      host: session.host,
      lastEvent: session.lastEvent,
      lastRawState: session.lastRawState,
      permissionDetail: cloneSerializable(session.permissionDetail),
      sessionMeta: cloneSerializable(session.sessionMeta),
      turnContext: cloneSerializable(session.turnContext),
      activeTurnId: session.activeTurnId,
      turnsStarted: session.turnsStarted,
      turnsCompleted: session.turnsCompleted,
      turnsAborted: session.turnsAborted,
      compactionCount: session.compactionCount,
      toolCallCount: session.toolCallCount,
      lastUserMessage: cloneSerializable(session.lastUserMessage),
      lastAssistantMessage: cloneSerializable(session.lastAssistantMessage),
      lastCommentary: cloneSerializable(session.lastCommentary),
      lastFinalAnswer: cloneSerializable(session.lastFinalAnswer),
      lastReasoning: cloneSerializable(session.lastReasoning),
      lastTokenCount: cloneSerializable(session.lastTokenCount),
      rateLimits: cloneSerializable(session.rateLimits),
      lastCommand: cloneSerializable(session.lastCommand),
      lastPatch: cloneSerializable(session.lastPatch),
      lastWebSearch: cloneSerializable(session.lastWebSearch),
      lastMcpCall: cloneSerializable(session.lastMcpCall),
      lastError: cloneSerializable(session.lastError),
      lastCompaction: cloneSerializable(session.lastCompaction),
      recentMessages: cloneSerializable(session.recentMessages),
      recentReasoning: cloneSerializable(session.recentReasoning),
      recentCommands: cloneSerializable(session.recentCommands),
      recentPatches: cloneSerializable(session.recentPatches),
      recentWebSearches: cloneSerializable(session.recentWebSearches),
      recentMcpCalls: cloneSerializable(session.recentMcpCalls),
      recentErrors: cloneSerializable(session.recentErrors),
      recentEvents: cloneSerializable(session.recentEvents),
      activityCounts: cloneSerializable(session.activityCounts),
      toolUsage: cloneSerializable(session.toolUsage),
      commandStats: cloneSerializable(session.commandStats),
      patchStats: cloneSerializable(session.patchStats),
      searchStats: cloneSerializable(session.searchStats),
      mcpStats: cloneSerializable(session.mcpStats),
      errorCount: session.errorCount,
      lastActivity: cloneSerializable(session.lastActivity),
      analytics: buildSessionAnalytics(session),
    };
  }

  _setCurrentState(nextState, atMs = Date.now()) {
    this.currentState = nextState;
    this.currentStateAt = atMs;
  }

  _clearAutoReturn() {
    if (!this._autoReturnTimer) return;
    clearTimeout(this._autoReturnTimer);
    this._autoReturnTimer = null;
  }

  _scheduleAutoReturn(fromState, sessionId) {
    this._clearAutoReturn();
    const delay = this._oneshotMs[fromState];
    if (!delay) return;
    this._autoReturnTimer = setTimeout(() => {
      this._autoReturnTimer = null;
      this._setCurrentState(this.resolveDisplayState());
      this._emitTransition({
        sessionId,
        event: "auto-return",
        rawState: fromState,
        state: this.currentState,
        cwd: "",
        permissionDetail: null,
        removed: false,
        autoReturnFrom: fromState,
      });
    }, delay);
  }

  _emitTransition(meta) {
    const transition = {
      at: new Date().toISOString(),
      sessionId: meta.sessionId,
      event: meta.event,
      rawState: meta.rawState,
      state: meta.state,
      currentState: this.currentState,
      resolvedState: this.resolveDisplayState(),
      sessionCount: this.sessions.size,
      cwd: meta.cwd || "",
      permissionDetail: meta.permissionDetail || null,
      removed: meta.removed === true,
    };
    if (meta.autoReturnFrom) transition.autoReturnFrom = meta.autoReturnFrom;
    this.emit("transition", transition);
    this.emit("snapshot", this.getSnapshot());
    return transition;
  }
}

module.exports = {
  CodexStateMachine,
  STATE_PRIORITY,
  ONESHOT_STATES,
  DEFAULT_ONESHOT_MS,
  normalizeState,
};
