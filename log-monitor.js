"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { EventEmitter } = require("events");
const {
  normalizeRecordObject,
  createSyntheticPermissionRecord,
} = require("./parser");

const APPROVAL_HEURISTIC_MS = 2000;
const MAX_TRACKED_FILES = 50;
const MAX_PARTIAL_BYTES = 65536;
const RECENT_DAY_DIR_CACHE_MS = 60 * 60 * 1000;
const DEFAULT_BACKFILL_RECENT_MS = 15 * 60 * 1000;
const DEFAULT_INITIAL_TAIL_BYTES = 512 * 1024;

class CodexLogMonitor extends EventEmitter {
  constructor(agentConfig, onStateChange, options = {}) {
    super();
    this._config = agentConfig;
    this._onStateChange = onStateChange;
    this._interval = null;
    this._tracked = new Map();
    this._baseDir = this._resolveBaseDir();
    this._recentDayDirsCache = [];
    this._recentDayDirsCacheAt = 0;
    this._recentDayDirsDateKey = "";
    this._startedAtMs = Date.now();
    this._approvalHeuristicMs = options.approvalHeuristicMs ?? APPROVAL_HEURISTIC_MS;
    this._backfillRecentMs = options.backfillRecentMs ?? DEFAULT_BACKFILL_RECENT_MS;
    this._initialTailBytes = options.initialTailBytes ?? DEFAULT_INITIAL_TAIL_BYTES;
  }

  _resolveBaseDir() {
    const dir = this._config.logConfig.sessionDir;
    if (dir.startsWith("~")) return path.join(os.homedir(), dir.slice(1));
    return dir;
  }

  start() {
    if (this._interval) return;
    this._startedAtMs = Date.now();
    this.pollOnce();
    this._interval = setInterval(
      () => this._poll(),
      this._config.logConfig.pollIntervalMs || 1500
    );
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    for (const tracked of this._tracked.values()) {
      if (tracked.approvalTimer) clearTimeout(tracked.approvalTimer);
    }
    this._tracked.clear();
  }

  pollOnce() {
    this._poll();
  }

  _poll() {
    const dirs = this._getSessionDirs();
    for (const dir of dirs) {
      let files;
      try {
        files = fs.readdirSync(dir);
      } catch {
        continue;
      }

      const now = Date.now();
      for (const file of files) {
        if (!file.startsWith("rollout-") || !file.endsWith(".jsonl")) continue;
        const filePath = path.join(dir, file);
        if (!this._tracked.has(filePath)) {
          try {
            const mtime = fs.statSync(filePath).mtimeMs;
            if (now - mtime > 120000) continue;
          } catch {
            continue;
          }
        }
        this._pollFile(filePath, file);
      }
    }
    this._cleanStaleFiles();
  }

  _getSessionDirs() {
    const dirs = [];
    const seen = new Set();
    const addDir = (dir) => {
      if (!dir || seen.has(dir)) return;
      seen.add(dir);
      dirs.push(dir);
    };

    const now = new Date();
    for (let daysAgo = 0; daysAgo <= 2; daysAgo++) {
      const day = new Date(now);
      day.setDate(day.getDate() - daysAgo);
      const yyyy = day.getFullYear();
      const mm = String(day.getMonth() + 1).padStart(2, "0");
      const dd = String(day.getDate()).padStart(2, "0");
      addDir(path.join(this._baseDir, String(yyyy), mm, dd));
    }

    addDir(this._baseDir);
    for (const dir of this._getCachedRecentExistingDayDirs(7)) addDir(dir);
    return dirs;
  }

  _getCachedRecentExistingDayDirs(limit = 7) {
    const now = Date.now();
    const dateKey = this._getLocalDateKey();
    const cacheStale = now - this._recentDayDirsCacheAt > RECENT_DAY_DIR_CACHE_MS;
    const dayChanged = dateKey !== this._recentDayDirsDateKey;
    if (!this._recentDayDirsCache.length || cacheStale || dayChanged) {
      this._recentDayDirsCache = this._getRecentExistingDayDirs(limit);
      this._recentDayDirsCacheAt = now;
      this._recentDayDirsDateKey = dateKey;
    }
    return this._recentDayDirsCache.slice(0, limit);
  }

  _getLocalDateKey() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  _getRecentExistingDayDirs(limit = 7) {
    const out = [];
    let years;
    try {
      years = fs.readdirSync(this._baseDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => b.localeCompare(a));
    } catch {
      return out;
    }

    for (const year of years) {
      const yearPath = path.join(this._baseDir, year);
      let months;
      try {
        months = fs.readdirSync(yearPath, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && /^\d{2}$/.test(entry.name))
          .map((entry) => entry.name)
          .sort((a, b) => b.localeCompare(a));
      } catch {
        continue;
      }

      for (const month of months) {
        const monthPath = path.join(yearPath, month);
        let days;
        try {
          days = fs.readdirSync(monthPath, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && /^\d{2}$/.test(entry.name))
            .map((entry) => entry.name)
            .sort((a, b) => b.localeCompare(a));
        } catch {
          continue;
        }

        for (const day of days) {
          out.push(path.join(monthPath, day));
          if (out.length >= limit) return out;
        }
      }
    }

    return out;
  }

  _pollFile(filePath, fileName) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }

    let tracked = this._tracked.get(filePath);
    if (!tracked) {
      const sessionId = this._extractSessionId(fileName);
      if (!sessionId) return;
      if (this._tracked.size >= MAX_TRACKED_FILES) {
        this._cleanStaleFiles();
        if (this._tracked.size >= MAX_TRACKED_FILES) return;
      }
      tracked = {
        offset: 0,
        sessionId: "codex:" + sessionId,
        filePath,
        cwd: "",
        lastEventTime: Date.now(),
        lastState: null,
        partial: "",
        hadToolUse: false,
        agentPid: null,
        approvalTimer: null,
        initialBackfill: stat.mtimeMs < this._startedAtMs - 1000,
        dropLeadingPartial: false,
      };
      if (tracked.initialBackfill && stat.size > this._initialTailBytes) {
        tracked.offset = Math.max(0, stat.size - this._initialTailBytes);
        tracked.dropLeadingPartial = tracked.offset > 0;
      }
      this._tracked.set(filePath, tracked);
    }

    if (stat.size <= tracked.offset) return;

    let buf;
    try {
      const fd = fs.openSync(filePath, "r");
      const readLen = stat.size - tracked.offset;
      buf = Buffer.alloc(readLen);
      fs.readSync(fd, buf, 0, readLen, tracked.offset);
      fs.closeSync(fd);
    } catch {
      return;
    }
    tracked.offset = stat.size;

    const text = tracked.partial + buf.toString("utf8");
    const lines = text.split("\n");
    const remainder = lines.pop() || "";
    tracked.partial = remainder.length > MAX_PARTIAL_BYTES ? "" : remainder;

    if (tracked.dropLeadingPartial && lines.length) {
      lines.shift();
      tracked.dropLeadingPartial = false;
    }

    const isBackfill = tracked.initialBackfill === true;
    for (const line of lines) {
      if (!line.trim()) continue;
      this._processLine(line, tracked, { isBackfill });
    }
    tracked.initialBackfill = false;
  }

  _emitRecord(tracked, record, options = {}) {
    if (record.cwd && !tracked.cwd) tracked.cwd = record.cwd;
    const timestampMs = record && typeof record.timestamp === "string" ? Date.parse(record.timestamp) : null;
    const extra = {
      cwd: tracked.cwd || record.cwd || "",
      sourcePid: tracked.agentPid || null,
      agentPid: tracked.agentPid || null,
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : null,
      isBackfill: options.isBackfill === true,
      record,
    };
    this.emit("record", tracked.sessionId, record, extra);
    return extra;
  }

  _processLine(line, tracked, options = {}) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return;
    }

    if (obj && typeof obj.timestamp === "string") {
      const ts = Date.parse(obj.timestamp);
      if (Number.isFinite(ts)) {
        if (options.isBackfill) {
          if (ts < this._startedAtMs - this._backfillRecentMs) return;
        } else if (ts < this._startedAtMs - 1500) {
          return;
        }
      }
    }

    const record = normalizeRecordObject(obj, {
      logEventMap: this._config.logEventMap,
      defaultCwd: tracked.cwd,
    });
    if (record.cwd && !tracked.cwd) tracked.cwd = record.cwd;
    this._emitRecord(tracked, record, options);

    if (
      record.key === "event_msg:exec_command_end" ||
      record.key === "response_item:function_call_output" ||
      record.key === "event_msg:dynamic_tool_call_response"
    ) {
      if (tracked.approvalTimer) {
        clearTimeout(tracked.approvalTimer);
        tracked.approvalTimer = null;
      }
    }

    if (record.kind === "turn_lifecycle" && record.lifecycle === "started") {
      tracked.hadToolUse = false;
    }

    if (
      record.key === "response_item:function_call" ||
      record.key === "response_item:custom_tool_call" ||
      record.key === "response_item:web_search_call" ||
      record.key === "event_msg:dynamic_tool_call_request" ||
      record.key === "event_msg:mcp_tool_call_end"
    ) {
      tracked.hadToolUse = true;
    }

    const state = record.stateSignal;
    if (state === undefined || state === null) return;

    const recordTimestampMs = record.timestamp ? Date.parse(record.timestamp) : null;
    const recordAgeMs = Number.isFinite(recordTimestampMs) ? Date.now() - recordTimestampMs : 0;
    const staleEphemeralBackfill = options.isBackfill && recordAgeMs > 5000;

    if (state === "codex-turn-end") {
      if (tracked.approvalTimer) {
        clearTimeout(tracked.approvalTimer);
        tracked.approvalTimer = null;
      }
      if (staleEphemeralBackfill) {
        tracked.hadToolUse = false;
        return;
      }
      const resolved = tracked.hadToolUse ? "attention" : "idle";
      tracked.hadToolUse = false;
      tracked.lastState = resolved;
      tracked.lastEventTime = Date.now();
      const agentPid = this._resolveTrackedAgentPid(tracked);
      this._onStateChange(tracked.sessionId, resolved, record.key, {
        cwd: tracked.cwd,
        sourcePid: agentPid,
        agentPid,
        timestampMs: Number.isFinite(recordTimestampMs) ? recordTimestampMs : null,
        isBackfill: options.isBackfill === true,
        record,
      });
      return;
    }

    if (record.key === "response_item:function_call" && record.command) {
      if (tracked.approvalTimer) clearTimeout(tracked.approvalTimer);
      if (this._isExplicitApprovalRequest(record.toolArgs)) {
        const permissionRecord = createSyntheticPermissionRecord(record.command, obj.payload);
        this._emitRecord(tracked, permissionRecord, options);
        const agentPid = this._resolveTrackedAgentPid(tracked);
        tracked.lastEventTime = Date.now();
        this._onStateChange(tracked.sessionId, "codex-permission", record.key, {
          cwd: tracked.cwd,
          sourcePid: agentPid,
          agentPid,
          timestampMs: Number.isFinite(recordTimestampMs) ? recordTimestampMs : null,
          isBackfill: options.isBackfill === true,
          permissionDetail: permissionRecord.permissionDetail,
          record: permissionRecord,
        });
        return;
      }

      if (!options.isBackfill) {
        tracked.approvalTimer = setTimeout(() => {
          tracked.approvalTimer = null;
          const permissionRecord = createSyntheticPermissionRecord(record.command, obj.payload);
          this._emitRecord(tracked, permissionRecord, options);
          const agentPid = this._resolveTrackedAgentPid(tracked);
          tracked.lastEventTime = Date.now();
          this._onStateChange(tracked.sessionId, "codex-permission", record.key, {
            cwd: tracked.cwd,
            sourcePid: agentPid,
            agentPid,
            timestampMs: Number.isFinite(recordTimestampMs) ? recordTimestampMs : null,
            isBackfill: options.isBackfill === true,
            permissionDetail: permissionRecord.permissionDetail,
            record: permissionRecord,
          });
        }, this._approvalHeuristicMs);
      }
    }

    if (staleEphemeralBackfill && (state === "notification" || state === "sweeping" || state === "error")) {
      return;
    }

    if (state === tracked.lastState && state === "working") return;
    tracked.lastState = state;
    tracked.lastEventTime = Date.now();

    const agentPid = this._resolveTrackedAgentPid(tracked);
    this._onStateChange(tracked.sessionId, state, record.key, {
      cwd: tracked.cwd,
      sourcePid: agentPid,
      agentPid,
      timestampMs: Number.isFinite(recordTimestampMs) ? recordTimestampMs : null,
      isBackfill: options.isBackfill === true,
      record,
    });
  }

  _isExplicitApprovalRequest(toolArgs) {
    if (!toolArgs || typeof toolArgs !== "object") return false;
    if (toolArgs.sandbox_permissions === "require_escalated") return true;
    if (typeof toolArgs.justification === "string" && toolArgs.justification.trim()) return true;
    return false;
  }

  _extractSessionId(fileName) {
    const base = fileName.replace(".jsonl", "");
    const parts = base.split("-");
    if (parts.length < 10) return null;
    return parts.slice(-5).join("-");
  }

  _resolveTrackedAgentPid(tracked) {
    if (tracked.agentPid && this._isProcessAlive(tracked.agentPid)) {
      return tracked.agentPid;
    }
    const pid = this._findCodexWriterPid(tracked.filePath);
    tracked.agentPid = pid || null;
    return tracked.agentPid;
  }

  _isProcessAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return err && err.code === "EPERM";
    }
  }

  _findCodexWriterPid(filePath) {
    if (process.platform !== "linux" || !filePath) return null;
    let procEntries;
    try {
      procEntries = fs.readdirSync("/proc", { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of procEntries) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const pid = Number(entry.name);
      if (!Number.isFinite(pid) || pid <= 1) continue;
      try {
        const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
        if (!cmd.includes("codex")) continue;
      } catch {
        continue;
      }
      let fds;
      try {
        fds = fs.readdirSync(`/proc/${pid}/fd`);
      } catch {
        continue;
      }
      for (const fd of fds) {
        try {
          const target = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
          if (target === filePath) return pid;
        } catch {}
      }
    }

    return null;
  }

  _cleanStaleFiles() {
    const now = Date.now();
    for (const [filePath, tracked] of this._tracked) {
      const age = now - tracked.lastEventTime;
      if (age > 300000) {
        if (tracked.approvalTimer) clearTimeout(tracked.approvalTimer);
        this._onStateChange(tracked.sessionId, "sleeping", "stale-cleanup", {
          cwd: tracked.cwd,
          sourcePid: tracked.agentPid,
          agentPid: tracked.agentPid,
        });
        this._tracked.delete(filePath);
      }
    }
  }
}

module.exports = CodexLogMonitor;
