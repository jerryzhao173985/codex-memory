"use strict";

const {
  normalizeBridgeGitInfoPatch,
  normalizeBridgeThreadMemoryMode,
} = require("./app-server-thread-contract");

const BRIDGE_HISTORY_COMMANDS = new Set([
  "threads",
  "loaded",
  "thread",
  "name",
  "metadata",
  "memory-mode",
  "archive",
  "unarchive",
  "prune-turns",
  "prune-preview",
  "fork-prune",
]);

function buildBridgeMetadataPatchFromArgs(args = {}) {
  const gitInfo = normalizeBridgeGitInfoPatch({
    branch: args.clearGitBranch === true ? null : args.gitBranch,
    sha: args.clearGitSha === true ? null : args.gitSha,
    originUrl: args.clearGitOriginUrl === true ? null : args.gitOriginUrl,
  });
  return gitInfo ? { gitInfo } : null;
}

function normalizeBridgeThreadMemoryModeArgument(value) {
  return normalizeBridgeThreadMemoryMode(value);
}

function createFallbackBridgeError(message) {
  const err = new Error(message);
  err.code = "HISTORY_INVALID_ARGUMENT";
  return err;
}

function createBridgeErrorFactory(errorFactory) {
  return typeof errorFactory === "function" ? errorFactory : createFallbackBridgeError;
}

function requireBridgeSessionId(args, makeError) {
  if (!args || !args.target) {
    throw makeError("session id is required");
  }
  return args.target;
}

function requirePruneSelection(args, makeError) {
  if (
    !(
      Number.isInteger(args && args.dropLast) &&
      args.dropLast > 0
    ) &&
    !(
      typeof (args && args.throughTurn) === "string" &&
      args.throughTurn.trim()
    )
  ) {
    throw makeError("either drop_last or through_turn is required");
  }
}

function buildPruneOptions(args = {}) {
  return {
    dropLastTurns: args.dropLast,
    throughTurn: args.throughTurn,
    budgetChars: args.budgetChars,
    itemChars: args.itemChars,
    toolChars: args.toolChars,
    lineLimit: args.lineLimit,
    turnLimit: args.turnLimit,
    itemLimit: args.itemLimit,
    highlightLimit: args.highlightLimit,
    trimStrategy: args.trimStrategy,
    toolText: args.toolText,
    reloadPolicy: args.reloadPolicy,
    refresh: true,
  };
}

async function runHistoryBridgeCommand(store, args = {}, options = {}) {
  if (!BRIDGE_HISTORY_COMMANDS.has(args.command)) return undefined;
  const makeError = createBridgeErrorFactory(options.errorFactory);

  if (args.command === "threads") {
    return store.listBridgeThreads({
      limit: args.limit,
      cursor: args.cursor,
      sortKey: args.sortKey,
      sortDirection: args.sortDirection,
      useStateDbOnly: args.useStateDbOnly,
      q: args.q,
      cwd: args.cwd,
      archived: args.archived,
      modelProviders: args.modelProviders,
      sourceKinds: args.sourceKinds,
    });
  }

  if (args.command === "loaded") {
    return store.listLoadedThreads({
      limit: args.limit,
      cursor: args.cursor,
    });
  }

  if (args.command === "thread") {
    const sessionId = requireBridgeSessionId(args, makeError);
    const output = await store.getBridgeThread(sessionId, {
      includeTurns: true,
    });
    if (!output) throw makeError(`thread not found: ${sessionId}`);
    return output;
  }

  if (args.command === "name") {
    const sessionId = requireBridgeSessionId(args, makeError);
    if (!args.value) {
      throw makeError("thread name is required; use --value");
    }
    const output = await store.setBridgeThreadName(sessionId, args.value);
    if (!output) throw makeError(`thread not found: ${sessionId}`);
    return output;
  }

  if (args.command === "metadata") {
    const sessionId = requireBridgeSessionId(args, makeError);
    const patch = buildBridgeMetadataPatchFromArgs(args);
    if (!patch) {
      throw makeError(
        "metadata patch is required; use --git-branch, --git-sha, --git-origin-url, or --clear-git-*"
      );
    }
    const output = await store.updateBridgeThreadMetadata(sessionId, patch);
    if (!output) throw makeError(`thread not found: ${sessionId}`);
    return output;
  }

  if (args.command === "memory-mode") {
    const sessionId = requireBridgeSessionId(args, makeError);
    const rawMode = typeof args.mode === "string" && args.mode.trim()
      ? args.mode
      : args.value;
    if (!rawMode) {
      throw makeError("memory mode is required; use --mode enabled|disabled");
    }
    const output = await store.setBridgeThreadMemoryMode(
      sessionId,
      normalizeBridgeThreadMemoryModeArgument(rawMode)
    );
    if (!output) throw makeError(`thread not found: ${sessionId}`);
    return output;
  }

  if (args.command === "archive") {
    const sessionId = requireBridgeSessionId(args, makeError);
    const output = await store.archiveBridgeThread(sessionId);
    if (!output) throw makeError(`thread not found: ${sessionId}`);
    return output;
  }

  if (args.command === "unarchive") {
    const sessionId = requireBridgeSessionId(args, makeError);
    const output = await store.unarchiveBridgeThread(sessionId);
    if (!output) throw makeError(`thread not found: ${sessionId}`);
    return output;
  }

  if (args.command === "prune-turns") {
    const sessionId = requireBridgeSessionId(args, makeError);
    const output = await store.listPruneCandidates(sessionId, {
      limit: args.limit,
      refresh: true,
    });
    if (!output) throw makeError(`thread not found: ${sessionId}`);
    return output;
  }

  if (args.command === "prune-preview") {
    const sessionId = requireBridgeSessionId(args, makeError);
    requirePruneSelection(args, makeError);
    const output = await store.getPrunePreview(sessionId, buildPruneOptions(args));
    if (!output) throw makeError(`thread not found: ${sessionId}`);
    return output;
  }

  if (args.command === "fork-prune") {
    const sessionId = requireBridgeSessionId(args, makeError);
    requirePruneSelection(args, makeError);
    const output = await store.forkPruneThread(sessionId, {
      ...buildPruneOptions(args),
      name: args.name || "",
    });
    if (!output) throw makeError(`thread not found: ${sessionId}`);
    return output;
  }

  return undefined;
}

module.exports = {
  buildBridgeMetadataPatchFromArgs,
  normalizeBridgeThreadMemoryModeArgument,
  runHistoryBridgeCommand,
};
