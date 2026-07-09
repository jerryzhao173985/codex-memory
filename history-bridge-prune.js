"use strict";

const {
  buildResumeResultFromSessionData,
  buildHistoryQuality,
} = require("./catalog");
const { prefixedSessionId } = require("./history-session-id");
const {
  buildBridgeOperationSource,
  buildBridgeThreadSessionView,
  normalizeBridgeThread,
} = require("./history-bridge-thread");

function normalizePositiveBridgeInt(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeBridgeTurnId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function summarizePrunedTurn(turn) {
  return {
    turnId: turn.turnId,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt,
    status: turn.status,
    userPromptPreview: turn.userPromptPreview,
    commentaryPreview: turn.commentaryPreview,
    finalAnswerPreview: turn.finalAnswerPreview,
    filesTouched: Array.isArray(turn.filesTouched) ? turn.filesTouched : [],
    pathsReferenced: Array.isArray(turn.pathsReferenced) ? turn.pathsReferenced : [],
    toolsUsed: Array.isArray(turn.toolsUsed) ? turn.toolsUsed : [],
    commandTypes: Array.isArray(turn.commandTypes) ? turn.commandTypes : [],
    queries: Array.isArray(turn.queries) ? turn.queries : [],
    errors: Array.isArray(turn.errors) ? turn.errors : [],
    summary: turn.summary || "",
  };
}

function resolvePruneSelection(rawTurns, filters = {}) {
  const throughTurnId = normalizeBridgeTurnId(
    filters.throughTurn ?? filters.keepThroughTurn ?? filters.dropAfterTurn
  );
  const requestedDropTurns = normalizePositiveBridgeInt(
    filters.dropLastTurns ?? filters.dropLast ?? filters.numTurns
  );

  if (throughTurnId && requestedDropTurns) {
    throw new Error("use either drop_last or through_turn, not both");
  }
  if (!throughTurnId && !requestedDropTurns) {
    throw new Error("drop_last or through_turn is required");
  }

  if (throughTurnId) {
    const keepCount = rawTurns.findIndex((turn) => normalizeBridgeTurnId(turn && turn.id) === throughTurnId);
    if (keepCount < 0) {
      throw new Error(`turn not found in thread: ${throughTurnId}`);
    }
    const resolvedKeepCount = keepCount + 1;
    return {
      mode: "through_turn",
      throughTurnId,
      requestedDropTurns: Math.max(0, rawTurns.length - resolvedKeepCount),
      appliedDropTurns: Math.max(0, rawTurns.length - resolvedKeepCount),
      keepCount: resolvedKeepCount,
    };
  }

  const appliedDropTurns = Math.min(requestedDropTurns, rawTurns.length);
  return {
    mode: "drop_last",
    throughTurnId: null,
    requestedDropTurns,
    appliedDropTurns,
    keepCount: Math.max(0, rawTurns.length - appliedDropTurns),
  };
}

function buildPruneTurnCandidates(thread, fallbackSession = null, filters = {}) {
  const rawTurns = Array.isArray(thread && thread.turns) ? thread.turns : [];
  const generatedAt = new Date().toISOString();
  const source = buildBridgeOperationSource();

  const originalView = buildBridgeThreadSessionView(thread, fallbackSession);
  if (!originalView) {
    throw new Error("thread/read returned an empty thread view");
  }

  const turnSummaryById = new Map(
    originalView.session.turns
      .filter((turn) => turn && typeof turn.turnId === "string" && turn.turnId)
      .map((turn) => [turn.turnId, turn])
  );

  const limit = normalizePositiveBridgeInt(filters.limit) || 10;
  const startIndex = Math.max(0, rawTurns.length - limit);
  const candidates = rawTurns
    .slice(startIndex)
    .map((turn, offset) => {
      const turnId = normalizeBridgeTurnId(turn && turn.id);
      const summary = turnSummaryById.get(turnId);
      if (!summary) return null;
      const absoluteIndex = startIndex + offset;
      return {
        position: absoluteIndex + 1,
        newerTurns: Math.max(0, rawTurns.length - absoluteIndex - 1),
        remainingTurnCount: absoluteIndex + 1,
        ...summarizePrunedTurn(summary),
      };
    })
    .filter(Boolean);

  return {
    generatedAt,
    source,
    quality: buildHistoryQuality(originalView.session, filters, source, "prune"),
    originalSessionId: prefixedSessionId(thread && thread.id) || null,
    originalThread: normalizeBridgeThread(thread),
    originalTurnCount: rawTurns.length,
    candidateCount: candidates.length,
    warnings: [
      "Selecting a cutoff turn keeps history through that turn and drops any newer turns.",
      "thread/rollback only changes Codex thread history; it does not revert file changes.",
    ],
    candidates,
  };
}

function buildPrunePreviewResult(thread, fallbackSession = null, filters = {}) {
  const rawTurns = Array.isArray(thread && thread.turns) ? thread.turns : [];
  const selection = resolvePruneSelection(rawTurns, filters);
  const { requestedDropTurns, appliedDropTurns, keepCount } = selection;
  const originalTurnCount = rawTurns.length;
  const generatedAt = new Date().toISOString();
  const source = buildBridgeOperationSource();

  const originalView = buildBridgeThreadSessionView(thread, fallbackSession);
  if (!originalView) {
    throw new Error("thread/read returned an empty thread view");
  }

  const prunedThread = {
    ...thread,
    turns: rawTurns.slice(0, keepCount),
  };
  const prunedView = buildBridgeThreadSessionView(prunedThread, fallbackSession);
  if (!prunedView) {
    throw new Error("failed to build a pruned thread view");
  }

  const turnSummaryById = new Map(
    originalView.session.turns
      .filter((turn) => turn && typeof turn.turnId === "string" && turn.turnId)
      .map((turn) => [turn.turnId, turn])
  );
  const keptTurnIds = new Set(rawTurns.slice(0, keepCount).map((turn) => turn && turn.id).filter(Boolean));
  const droppedTurnIds = new Set(rawTurns.slice(keepCount).map((turn) => turn && turn.id).filter(Boolean));
  const selectedTurnId = selection.throughTurnId || normalizeBridgeTurnId(rawTurns[keepCount - 1] && rawTurns[keepCount - 1].id);
  const selectedTurn = selectedTurnId ? turnSummaryById.get(selectedTurnId) || null : null;
  const warnings = [
    "thread/rollback only changes Codex thread history; it does not revert file changes.",
  ];
  if (selection.mode === "through_turn" && appliedDropTurns < 1) {
    warnings.push("selected turn is already the latest turn; rollback would be a no-op.");
  }

  return {
    generatedAt,
    source,
    quality: buildHistoryQuality(prunedView.session, filters, source, "prune"),
    originalSessionId: prefixedSessionId(thread && thread.id) || null,
    originalThread: normalizeBridgeThread(thread),
    originalTurnCount,
    selectionMode: selection.mode,
    throughTurnId: selection.throughTurnId,
    lastKeptTurnId: selectedTurnId || null,
    keepCount,
    selectedTurn: selectedTurn ? summarizePrunedTurn(selectedTurn) : null,
    requestedDropTurns,
    appliedDropTurns,
    remainingTurnCount: prunedView.session.turnCount,
    droppedAllTurns: appliedDropTurns > 0 && prunedView.session.turnCount === 0,
    warnings,
    droppedTurns: originalView.session.turns
      .filter((turn) => droppedTurnIds.has(turn.turnId))
      .map(summarizePrunedTurn),
    remainingTurns: prunedView.session.turns
      .filter((turn) => keptTurnIds.has(turn.turnId))
      .slice(-3)
      .map(summarizePrunedTurn),
    resume: buildResumeResultFromSessionData(
      prunedView.session,
      prunedView,
      generatedAt,
      filters,
      source
    ),
  };
}

function buildForkPruneResult(finalThread, preview, forkPreview, filters = {}, options = {}) {
  const finalView = buildBridgeThreadSessionView(finalThread, null);
  if (!finalView) {
    throw new Error("failed to build a pruned fork view");
  }

  const generatedAt = new Date().toISOString();
  const source = buildBridgeOperationSource();

  return {
    generatedAt,
    source,
    quality: buildHistoryQuality(finalView.session, filters, source, "prune"),
    operation: "fork_prune",
    originalSessionId: preview.originalSessionId,
    forkedSessionId: options.forkSessionId || null,
    selectionMode: forkPreview.selectionMode,
    throughTurnId: forkPreview.throughTurnId,
    selectedTurn: forkPreview.selectedTurn,
    requestedDropTurns: forkPreview.requestedDropTurns,
    appliedDropTurns: forkPreview.appliedDropTurns,
    renamed: options.renamed === true,
    prunedVia: options.prunedVia || "fork_last_turn_id",
    warnings: forkPreview.warnings,
    droppedTurns: forkPreview.droppedTurns,
    originalThread: preview.originalThread,
    thread: normalizeBridgeThread(finalThread),
    remainingTurnCount: finalView.session.turnCount,
    remainingTurns: finalView.session.turns.slice(-3).map(summarizePrunedTurn),
    resume: buildResumeResultFromSessionData(
      finalView.session,
      finalView,
      generatedAt,
      filters,
      source
    ),
  };
}

module.exports = {
  buildPruneTurnCandidates,
  buildPrunePreviewResult,
  buildForkPruneResult,
};
