"use strict";

const {
  DEFAULT_APP_SERVER_COMMAND,
  DEFAULT_APP_SERVER_ARGS,
  DEFAULT_START_TIMEOUT_MS,
  CodexAppServerTransport,
  createAppServerTransport,
} = require("./app-server-transport");
const { prefixedSessionId } = require("./history-session-id");
const {
  normalizeBridgeThreadId,
  requireBridgeThreadId,
  normalizeBridgeThreadMemoryMode,
  requireBridgeGitInfoPatch,
  normalizeBridgeThreadListParams,
  normalizeBridgeThreadSearchParams,
  normalizeBridgeTurnsListParams,
  normalizeBridgeGoalSetPatch,
  normalizeBridgeLoadedListParams,
  normalizeBridgeRollbackTurns,
  normalizeBridgeThreadName,
  requireBridgeThreadPayload,
} = require("./app-server-thread-contract");

class CodexAppServerBridge {
  constructor(options = {}) {
    this.transport = options.transport && typeof options.transport === "object"
      ? options.transport
      : createAppServerTransport(options);
  }

  get notifications() {
    return this.transport && Array.isArray(this.transport.notifications)
      ? this.transport.notifications
      : [];
  }

  async ensureStarted() {
    return this.transport.ensureStarted();
  }

  async request(method, params = {}) {
    return this.transport.request(method, params);
  }

  async call(method, params = {}) {
    return this.transport.call(method, params);
  }

  async readThread(sessionId, options = {}) {
    const threadId = requireBridgeThreadId(sessionId);
    const includeTurns = options.includeTurns !== false;
    const response = await this.request("thread/read", {
      threadId,
      includeTurns,
    });
    requireBridgeThreadPayload(response, "thread/read");
    return response;
  }

  async listThreads(params = {}) {
    return this.request("thread/list", normalizeBridgeThreadListParams(params));
  }

  async listLoadedThreads(params = {}) {
    return this.request("thread/loaded/list", normalizeBridgeLoadedListParams(params));
  }

  // Server-side ripgrep full-text search over rollout contents (experimental;
  // the transport opts in to experimentalApi by default).
  async searchThreads(params = {}) {
    return this.request("thread/search", normalizeBridgeThreadSearchParams(params));
  }

  // Paged turn history without resuming; works for stored and archived threads.
  async listThreadTurns(sessionId, params = {}) {
    const threadId = requireBridgeThreadId(sessionId);
    return this.request("thread/turns/list", {
      threadId,
      ...normalizeBridgeTurnsListParams(params),
    });
  }

  async getThreadGoal(sessionId) {
    const threadId = requireBridgeThreadId(sessionId);
    return this.request("thread/goal/get", { threadId });
  }

  async setThreadGoal(sessionId, patch = {}) {
    const threadId = requireBridgeThreadId(sessionId);
    return this.request("thread/goal/set", {
      threadId,
      ...normalizeBridgeGoalSetPatch(patch),
    });
  }

  async clearThreadGoal(sessionId) {
    const threadId = requireBridgeThreadId(sessionId);
    return this.request("thread/goal/clear", { threadId });
  }

  async updateThreadMetadata(sessionId, patch = {}) {
    const threadId = requireBridgeThreadId(sessionId);

    const rawGitInfo = patch && typeof patch === "object" && patch.gitInfo && typeof patch.gitInfo === "object"
      ? patch.gitInfo
      : patch;
    const gitInfo = requireBridgeGitInfoPatch(rawGitInfo);

    const response = await this.request("thread/metadata/update", {
      threadId,
      gitInfo,
    });
    requireBridgeThreadPayload(response, "thread/metadata/update");
    return response;
  }

  async setThreadMemoryMode(sessionId, mode) {
    const threadId = requireBridgeThreadId(sessionId);
    const normalizedMode = normalizeBridgeThreadMemoryMode(mode);

    await this.request("thread/memoryMode/set", {
      threadId,
      mode: normalizedMode,
    });
    return {
      threadId,
      sessionId: prefixedSessionId(threadId),
      memoryMode: normalizedMode,
    };
  }

  async archiveThread(sessionId) {
    const threadId = requireBridgeThreadId(sessionId);
    await this.request("thread/archive", {
      threadId,
    });
    return {
      threadId,
      sessionId: prefixedSessionId(threadId),
      archived: true,
    };
  }

  async unarchiveThread(sessionId) {
    const threadId = requireBridgeThreadId(sessionId);
    const response = await this.request("thread/unarchive", {
      threadId,
    });
    requireBridgeThreadPayload(response, "thread/unarchive");
    return response;
  }

  async forkThread(sessionId, options = {}) {
    const threadId = requireBridgeThreadId(sessionId);
    const params = {
      threadId,
    };
    if (options && options.ephemeral === true) params.ephemeral = true;
    if (options && typeof options.lastTurnId === "string" && options.lastTurnId.trim()) {
      // Fork through this turn (inclusive); newer turns are omitted from the fork.
      params.lastTurnId = options.lastTurnId.trim();
    }
    return this.request("thread/fork", params);
  }

  async rollbackThread(sessionId, numTurns) {
    const threadId = requireBridgeThreadId(sessionId);
    const normalizedTurns = normalizeBridgeRollbackTurns(numTurns);
    return this.request("thread/rollback", {
      threadId,
      numTurns: normalizedTurns,
    });
  }

  async setThreadName(sessionId, name) {
    const threadId = requireBridgeThreadId(sessionId);
    const normalizedName = normalizeBridgeThreadName(name);
    await this.request("thread/name/set", {
      threadId,
      name: normalizedName,
    });
    return this.readThread(threadId, { includeTurns: false });
  }

  close() {
    return this.transport.close();
  }

}

function createAppServerBridge(options = {}) {
  return new CodexAppServerBridge(options);
}

module.exports = {
  DEFAULT_APP_SERVER_COMMAND,
  DEFAULT_APP_SERVER_ARGS,
  DEFAULT_START_TIMEOUT_MS,
  normalizeBridgeThreadId,
  CodexAppServerTransport,
  CodexAppServerBridge,
  createAppServerTransport,
  createAppServerBridge,
};
