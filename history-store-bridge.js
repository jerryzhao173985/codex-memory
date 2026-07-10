"use strict";

const { prefixedSessionId } = require("./history-session-id");
const {
  attachBridgeOperationSource,
  normalizeBridgeListResponse,
  normalizeBridgeSearchResponse,
  normalizeBridgeTurnsListResponse,
  normalizeBridgeGoal,
  normalizeBridgeLoadedResponse,
  normalizeBridgeThreadLifecycleResult,
  normalizeBridgeThreadMemoryModeResult,
  buildBridgeThreadViewResult,
  buildBridgeThreadSessionView,
} = require("./history-bridge-thread");
const {
  buildPruneTurnCandidates,
  buildPrunePreviewResult,
  buildForkPruneResult,
} = require("./history-bridge-prune");
const { createAppServerBridge } = require("./app-server-bridge");
const {
  normalizeBridgeThreadListParams,
  normalizeBridgeLoadedListParams,
} = require("./app-server-thread-contract");

function createUnavailableBridgeError() {
  const err = new Error("Codex app-server bridge is unavailable");
  err.code = "APP_SERVER_UNAVAILABLE";
  return err;
}

function createHistoryStoreBridge(options = {}) {
  const appServerEnabled = options.appServer !== false;
  let appServer = options.appServer && typeof options.appServer === "object" ? options.appServer : null;
  const getSessionContext = typeof options.getSessionContext === "function"
    ? options.getSessionContext
    : (() => ({ session: null, generatedAt: new Date().toISOString() }));
  const invalidateBuildCache = typeof options.invalidateBuildCache === "function"
    ? options.invalidateBuildCache
    : (() => {});

  function getAppServer() {
    if (!appServerEnabled) return null;
    if (appServer) return appServer;
    appServer = createAppServerBridge(options.appServerOptions || {});
    return appServer;
  }

  async function readBridgeThreadRequired(sessionId, readOptions = {}) {
    const bridge = readOptions.bridge || getAppServer();
    if (!bridge || typeof bridge.readThread !== "function") throw createUnavailableBridgeError();

    const response = await bridge.readThread(sessionId, {
      includeTurns: readOptions.includeTurns !== false,
    });
    if (!response || !response.thread || typeof response.thread !== "object") {
      if (readOptions.allowNull) return null;
      const err = new Error(readOptions.emptyMessage || "thread/read returned an empty thread payload");
      err.code = "APP_SERVER_INVALID_RESPONSE";
      throw err;
    }
    return response.thread;
  }

  async function buildAppServerView(sessionId, filters = {}, viewOptions = {}) {
    const thread = await readBridgeThreadRequired(sessionId, {
      includeTurns: true,
      emptyMessage: "thread/read returned an empty thread view",
    });
    const includeSessionContext = viewOptions.includeSessionContext !== false;
    const context = includeSessionContext
      ? (getSessionContext(sessionId, filters) || {})
      : null;
    const view = buildBridgeThreadSessionView(thread, context && context.session ? context.session : null);
    if (!view) {
      const err = new Error("thread/read returned an empty thread view");
      err.code = "APP_SERVER_INVALID_RESPONSE";
      throw err;
    }

    return {
      generatedAt: context && typeof context.generatedAt === "string" && context.generatedAt
        ? context.generatedAt
        : new Date().toISOString(),
      view,
    };
  }

  return {
    close() {
      return Promise.resolve(appServer && typeof appServer.close === "function" ? appServer.close() : null);
    },
    buildAppServerView,
    async listBridgeThreads(filters = {}) {
      const bridge = getAppServer();
      if (!bridge || typeof bridge.listThreads !== "function") throw createUnavailableBridgeError();

      const response = await bridge.listThreads(normalizeBridgeThreadListParams(filters));
      return attachBridgeOperationSource(normalizeBridgeListResponse(response));
    },
    async listLoadedThreads(filters = {}) {
      const bridge = getAppServer();
      if (!bridge || typeof bridge.listLoadedThreads !== "function") throw createUnavailableBridgeError();

      const response = await bridge.listLoadedThreads(normalizeBridgeLoadedListParams(filters));
      return attachBridgeOperationSource(normalizeBridgeLoadedResponse(response));
    },
    async searchBridgeThreads(filters = {}) {
      const bridge = getAppServer();
      if (!bridge || typeof bridge.searchThreads !== "function") throw createUnavailableBridgeError();

      const response = await bridge.searchThreads(filters);
      return attachBridgeOperationSource(normalizeBridgeSearchResponse(response));
    },
    async listBridgeThreadTurns(sessionId, filters = {}) {
      const bridge = getAppServer();
      if (!bridge || typeof bridge.listThreadTurns !== "function") throw createUnavailableBridgeError();

      const response = await bridge.listThreadTurns(sessionId, filters);
      const normalized = normalizeBridgeTurnsListResponse(response);
      // A turns/list page is Turn[] with the same item shape as thread/read's
      // turns, so reuse the full app-server thread-view mapper to turn the raw
      // page into rich per-turn summaries (prompts, answers, commands, files).
      const view = buildBridgeThreadSessionView(
        { id: prefixedSessionId(sessionId), turns: normalized.turns },
        null
      );
      // The mapper re-sorts turns chronologically; restore the server's page
      // order (newest-first by default) so cursor paging stays coherent.
      const summaryByTurnId = new Map(
        (view && view.session && Array.isArray(view.session.turns) ? view.session.turns : [])
          .map((turn) => [turn.turnId, turn])
      );
      const turns = normalized.turns
        .map((rawTurn) => summaryByTurnId.get(rawTurn && rawTurn.id))
        .filter(Boolean);
      return attachBridgeOperationSource({
        total: normalized.total,
        nextCursor: normalized.nextCursor,
        backwardsCursor: normalized.backwardsCursor,
        turns,
      });
    },
    async getBridgeThreadGoal(sessionId) {
      const bridge = getAppServer();
      if (!bridge || typeof bridge.getThreadGoal !== "function") throw createUnavailableBridgeError();

      const response = await bridge.getThreadGoal(sessionId);
      return attachBridgeOperationSource({
        goal: normalizeBridgeGoal(response && response.goal),
      });
    },
    async setBridgeThreadGoal(sessionId, patch = {}) {
      const bridge = getAppServer();
      if (!bridge || typeof bridge.setThreadGoal !== "function") throw createUnavailableBridgeError();

      const response = await bridge.setThreadGoal(sessionId, patch);
      return attachBridgeOperationSource({
        goal: normalizeBridgeGoal(response && response.goal),
      });
    },
    async clearBridgeThreadGoal(sessionId) {
      const bridge = getAppServer();
      if (!bridge || typeof bridge.clearThreadGoal !== "function") throw createUnavailableBridgeError();

      const response = await bridge.clearThreadGoal(sessionId);
      return attachBridgeOperationSource({
        cleared: Boolean(response && response.cleared),
      });
    },
    async getBridgeThread(sessionId, filters = {}) {
      const thread = await readBridgeThreadRequired(sessionId, {
        includeTurns: filters.includeTurns !== false,
        allowNull: true,
      });
      if (!thread) return null;
      return buildBridgeThreadViewResult(thread);
    },
    async listPruneCandidates(sessionId, filters = {}) {
      const thread = await readBridgeThreadRequired(sessionId, {
        includeTurns: true,
        allowNull: true,
      });
      if (!thread) return null;
      return buildPruneTurnCandidates(thread, null, filters);
    },
    async getPrunePreview(sessionId, filters = {}) {
      const thread = await readBridgeThreadRequired(sessionId, {
        includeTurns: true,
        allowNull: true,
      });
      if (!thread) return null;
      return buildPrunePreviewResult(thread, null, filters);
    },
    async setBridgeThreadName(sessionId, name) {
      const bridge = getAppServer();
      if (!bridge || typeof bridge.setThreadName !== "function") throw createUnavailableBridgeError();

      const response = await bridge.setThreadName(sessionId, name);
      if (!response || !response.thread || typeof response.thread !== "object") return null;
      return buildBridgeThreadViewResult(response.thread);
    },
    async updateBridgeThreadMetadata(sessionId, patch = {}) {
      const bridge = getAppServer();
      if (!bridge || typeof bridge.updateThreadMetadata !== "function") throw createUnavailableBridgeError();

      const response = await bridge.updateThreadMetadata(sessionId, patch);
      if (!response || !response.thread || typeof response.thread !== "object") return null;
      return buildBridgeThreadViewResult(response.thread);
    },
    async setBridgeThreadMemoryMode(sessionId, mode) {
      const bridge = getAppServer();
      if (!bridge || typeof bridge.setThreadMemoryMode !== "function") throw createUnavailableBridgeError();

      const response = await bridge.setThreadMemoryMode(sessionId, mode);
      invalidateBuildCache();
      return attachBridgeOperationSource(normalizeBridgeThreadMemoryModeResult(response));
    },
    async archiveBridgeThread(sessionId) {
      const bridge = getAppServer();
      if (!bridge || typeof bridge.archiveThread !== "function") throw createUnavailableBridgeError();

      const response = await bridge.archiveThread(sessionId);
      return attachBridgeOperationSource(normalizeBridgeThreadLifecycleResult(response));
    },
    async unarchiveBridgeThread(sessionId) {
      const bridge = getAppServer();
      if (!bridge || typeof bridge.unarchiveThread !== "function") throw createUnavailableBridgeError();

      const response = await bridge.unarchiveThread(sessionId);
      if (!response || !response.thread || typeof response.thread !== "object") return null;
      return buildBridgeThreadViewResult(response.thread);
    },
    async forkPruneThread(sessionId, filters = {}) {
      const bridge = getAppServer();
      if (
        !bridge ||
        typeof bridge.readThread !== "function" ||
        typeof bridge.forkThread !== "function" ||
        typeof bridge.rollbackThread !== "function"
      ) {
        throw createUnavailableBridgeError();
      }

      const sourceThread = await readBridgeThreadRequired(sessionId, {
        bridge,
        includeTurns: true,
        allowNull: true,
      });
      if (!sourceThread) return null;

      const preview = buildPrunePreviewResult(sourceThread, null, filters);
      if (preview.appliedDropTurns < 1) {
        throw new Error("thread has no turns to drop");
      }

      // Prefer the modern one-shot prune: thread/fork with lastTurnId forks
      // through that turn inclusive. thread/rollback is deprecated upstream
      // and only used as a fallback for servers that ignore lastTurnId or
      // when every turn is dropped (no boundary turn to fork through).
      const forkOptions = { ephemeral: false };
      if (preview.lastKeptTurnId) forkOptions.lastTurnId = preview.lastKeptTurnId;

      const forkResponse = await bridge.forkThread(sessionId, forkOptions);
      const forkSessionId = prefixedSessionId(forkResponse && forkResponse.thread && forkResponse.thread.id);
      if (!forkSessionId) {
        throw new Error("thread/fork response missing thread id");
      }

      const requestedName = typeof filters.name === "string" ? filters.name.trim() : "";
      if (requestedName && typeof bridge.setThreadName === "function") {
        await bridge.setThreadName(forkSessionId, requestedName);
      }

      const forkThread = await readBridgeThreadRequired(forkSessionId, {
        bridge,
        includeTurns: true,
        emptyMessage: "thread/read returned an empty fork",
      });

      let prunedVia = "fork_last_turn_id";
      let forkPreview = preview;
      let finalThread = forkThread;
      const forkTurnCount = Array.isArray(forkThread.turns) ? forkThread.turns.length : 0;
      if (forkTurnCount > preview.keepCount) {
        forkPreview = buildPrunePreviewResult(forkThread, null, filters);
        if (forkPreview.appliedDropTurns < 1) {
          throw new Error("forked thread has no turns to drop");
        }
        try {
          await bridge.rollbackThread(forkSessionId, forkPreview.appliedDropTurns);
        } catch (err) {
          err.message = `${err.message} (fork created: ${forkSessionId})`;
          throw err;
        }
        prunedVia = "fork_rollback";
        finalThread = await readBridgeThreadRequired(forkSessionId, {
          bridge,
          includeTurns: true,
          emptyMessage: "thread/read returned an empty pruned fork",
        });
      }

      return buildForkPruneResult(finalThread, preview, forkPreview, filters, {
        forkSessionId,
        renamed: Boolean(requestedName),
        prunedVia,
      });
    },
  };
}

module.exports = {
  createHistoryStoreBridge,
};
