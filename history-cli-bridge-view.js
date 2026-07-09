"use strict";

function createHistoryCliBridgeView(deps = {}) {
  const {
    quoteShellArg,
    getHistoryCliInvocationCommand,
    shouldPrintSourceSelection,
    printSourceSelectionDetails,
    printHistoryQualityDetails,
    formatValueList,
  } = deps;

  function formatBridgeThreadSource(thread = {}) {
    const source = typeof thread.source === "string" && thread.source ? thread.source : "";
    const sourceKind = typeof thread.sourceKind === "string" && thread.sourceKind ? thread.sourceKind : "";
    const value = source || sourceKind;
    return value ? `source=${value}` : "";
  }

  function buildBridgeThreadListHints(result, options = {}) {
    const invocationCommand = typeof options.invocationCommand === "string" && options.invocationCommand.trim()
      ? options.invocationCommand.trim()
      : getHistoryCliInvocationCommand(options);
    const hints = [];
    const firstThread = result && Array.isArray(result.threads) && result.threads.length ? result.threads[0] : null;
    const target = firstThread && (firstThread.sessionId || firstThread.threadId);
    if (target) {
      hints.push(`${invocationCommand} thread ${quoteShellArg(target)}`);
      hints.push(`${invocationCommand} transcript ${quoteShellArg(target)} --source app-server`);
      hints.push(`${invocationCommand} resume ${quoteShellArg(target)} --source app-server --reload-policy strict`);
    }
    if (result && result.nextCursor) {
      hints.push(`${invocationCommand} threads --cursor ${quoteShellArg(result.nextCursor)}`);
    }
    return hints;
  }

  function printBridgeThreadList(result, options = {}) {
    printSourceSelectionDetails(result.source);
    if (shouldPrintSourceSelection(result.source) && result.threads.length) console.log("");
    for (const thread of result.threads) {
      console.log([
        thread.sessionId || thread.threadId,
        thread.updatedAt || thread.createdAt || "",
        thread.cwd || "",
        thread.name ? `name=${thread.name}` : "",
        thread.status && thread.status.label ? `status=${thread.status.label}` : "",
      ].filter(Boolean).join(" | "));
      console.log([
        thread.modelProvider ? `provider=${thread.modelProvider}` : "",
        formatBridgeThreadSource(thread),
        thread.cliVersion ? `cli=${thread.cliVersion}` : "",
        thread.ephemeral ? "ephemeral=true" : "",
        thread.turnCount ? `turns=${thread.turnCount}` : "",
      ].filter(Boolean).join("  "));
      if (thread.previewShort) console.log(`preview: ${thread.previewShort}`);
      if (thread.sourceDetail && thread.sourceDetail.type === "subAgent" && thread.sourceDetail.variant === "threadSpawn") {
        console.log([
          thread.sourceDetail.parentThreadId ? `parent=${thread.sourceDetail.parentThreadId}` : "",
          Number.isInteger(thread.sourceDetail.depth) ? `depth=${thread.sourceDetail.depth}` : "",
        ].filter(Boolean).join("  "));
      }
      if (thread.gitInfo && (thread.gitInfo.branch || thread.gitInfo.sha)) {
        console.log(`git: ${(thread.gitInfo.branch || "").trim()}${thread.gitInfo.sha ? ` @ ${thread.gitInfo.sha.slice(0, 12)}` : ""}`.trim());
      }
      console.log("");
    }
    if (result.nextCursor) console.log(`next cursor: ${result.nextCursor}`);
    const hints = buildBridgeThreadListHints(result, options);
    if (hints.length) {
      console.log("");
      console.log("next:");
      for (const hint of hints) console.log(`  ${hint}`);
    }
  }

  function printBridgeLoadedThreads(result) {
    console.log(`loaded=${result.total}`);
    printSourceSelectionDetails(result.source);
    console.log("");
    for (const thread of result.threads) {
      console.log(thread.sessionId || thread.threadId);
    }
    if (result.nextCursor) {
      console.log("");
      console.log(`next cursor: ${result.nextCursor}`);
    }
  }

  function printBridgeThread(result) {
    const thread = result.thread;
    console.log([
      thread.sessionId || thread.threadId,
      thread.updatedAt || thread.createdAt || "",
      thread.cwd || "",
      thread.name ? `name=${thread.name}` : "",
      thread.status && thread.status.label ? `status=${thread.status.label}` : "",
    ].filter(Boolean).join(" | "));
    console.log([
      thread.modelProvider ? `provider=${thread.modelProvider}` : "",
      formatBridgeThreadSource(thread),
      thread.cliVersion ? `cli=${thread.cliVersion}` : "",
      thread.ephemeral ? "ephemeral=true" : "",
      thread.turnCount ? `turns=${thread.turnCount}` : "",
    ].filter(Boolean).join("  "));
    if (thread.path) console.log(`path: ${thread.path}`);
    if (thread.forkedFromId) console.log(`forked from: ${thread.forkedFromId}`);
    if (thread.agentNickname || thread.agentRole) {
      console.log(`agent: ${(thread.agentNickname || "").trim()}${thread.agentRole ? ` (${thread.agentRole})` : ""}`.trim());
    }
    if (thread.sourceDetail && thread.sourceDetail.type === "custom" && thread.sourceDetail.value) {
      console.log(`source detail: ${thread.sourceDetail.value}`);
    }
    if (thread.sourceDetail && thread.sourceDetail.type === "subAgent") {
      const sourceDetail = thread.sourceDetail;
      const bits = [
        sourceDetail.variant ? `variant=${sourceDetail.variant}` : "",
        sourceDetail.parentThreadId ? `parent=${sourceDetail.parentThreadId}` : "",
        Number.isInteger(sourceDetail.depth) ? `depth=${sourceDetail.depth}` : "",
        sourceDetail.value ? `value=${sourceDetail.value}` : "",
      ].filter(Boolean);
      if (bits.length) console.log(`source detail: ${bits.join("  ")}`);
    }
    if (thread.preview) console.log(`preview: ${thread.preview}`);
    if (thread.gitInfo && (thread.gitInfo.branch || thread.gitInfo.sha || thread.gitInfo.originUrl)) {
      console.log([
        thread.gitInfo.branch ? `branch=${thread.gitInfo.branch}` : "",
        thread.gitInfo.sha ? `sha=${thread.gitInfo.sha}` : "",
        thread.gitInfo.originUrl ? `origin=${thread.gitInfo.originUrl}` : "",
      ].filter(Boolean).join("  "));
    }
    if (thread.itemTypes && thread.itemTypes.length) console.log(`item-types: ${thread.itemTypes.join(", ")}`);
    if (thread.turnStatusCounts && Object.keys(thread.turnStatusCounts).length) {
      console.log(`turn-statuses: ${Object.entries(thread.turnStatusCounts).map(([key, count]) => `${key} (${count})`).join(" | ")}`);
    }
    printSourceSelectionDetails(result.source);
  }

  function printPrunedTurnList(label, turns) {
    if (!Array.isArray(turns) || !turns.length) return;
    console.log(`${label}:`);
    for (const turn of turns) {
      console.log(`  ${[turn.turnId, turn.status, turn.startedAt || turn.endedAt || ""].filter(Boolean).join(" | ")}`);
      if (turn.userPromptPreview) console.log(`  user: ${turn.userPromptPreview}`);
      if (turn.finalAnswerPreview) console.log(`  answer: ${turn.finalAnswerPreview}`);
      else if (turn.commentaryPreview) console.log(`  commentary: ${turn.commentaryPreview}`);
      else if (turn.summary) console.log(`  summary: ${turn.summary}`);
      if (turn.filesTouched && turn.filesTouched.length) console.log(`  files: ${formatValueList(turn.filesTouched)}`);
      if (turn.pathsReferenced && turn.pathsReferenced.length) console.log(`  paths: ${formatValueList(turn.pathsReferenced)}`);
      if (turn.toolsUsed && turn.toolsUsed.length) console.log(`  tools: ${formatValueList(turn.toolsUsed)}`);
      console.log("");
    }
  }

  function printPruneCandidates(result) {
    const thread = result.originalThread || {};
    console.log([
      result.originalSessionId || thread.sessionId || thread.threadId || "",
      `turns=${result.originalTurnCount}`,
      `candidates=${result.candidateCount}`,
    ].filter(Boolean).join(" | "));
    if (thread.name) console.log(`name: ${thread.name}`);
    if (thread.path) console.log(`path: ${thread.path}`);
    printSourceSelectionDetails(result.source);
    printHistoryQualityDetails(result.quality);
    for (const warning of result.warnings || []) console.log(`warning: ${warning}`);
    console.log("");

    for (const turn of result.candidates || []) {
      console.log([
        `keep-through=${turn.turnId}`,
        `remaining=${turn.remainingTurnCount}`,
        `drop=${turn.newerTurns}`,
        turn.status || "",
        turn.startedAt || turn.endedAt || "",
      ].filter(Boolean).join(" | "));
      if (turn.userPromptPreview) console.log(`  user: ${turn.userPromptPreview}`);
      if (turn.finalAnswerPreview) console.log(`  answer: ${turn.finalAnswerPreview}`);
      else if (turn.commentaryPreview) console.log(`  commentary: ${turn.commentaryPreview}`);
      else if (turn.summary) console.log(`  summary: ${turn.summary}`);
      if (turn.filesTouched && turn.filesTouched.length) console.log(`  files: ${formatValueList(turn.filesTouched)}`);
      if (turn.pathsReferenced && turn.pathsReferenced.length) console.log(`  paths: ${formatValueList(turn.pathsReferenced)}`);
      if (turn.toolsUsed && turn.toolsUsed.length) console.log(`  tools: ${formatValueList(turn.toolsUsed)}`);
      console.log("");
    }
  }

  function printPrunePreview(result) {
    const thread = result.originalThread || {};
    console.log([
      result.originalSessionId || thread.sessionId || thread.threadId || "",
      `turns=${result.originalTurnCount}`,
      `drop=${result.appliedDropTurns}`,
      `remaining=${result.remainingTurnCount}`,
    ].filter(Boolean).join(" | "));
    if (thread.name) console.log(`name: ${thread.name}`);
    if (thread.path) console.log(`path: ${thread.path}`);
    if (result.selectionMode === "through_turn" && result.throughTurnId) {
      console.log(`keep-through: ${result.throughTurnId}`);
    }
    if (result.selectedTurn && result.selectedTurn.turnId) {
      const selected = [
        result.selectedTurn.turnId,
        result.selectedTurn.status || "",
        result.selectedTurn.startedAt || result.selectedTurn.endedAt || "",
      ].filter(Boolean).join(" | ");
      console.log(`selected turn: ${selected}`);
    }
    printSourceSelectionDetails(result.source);
    printHistoryQualityDetails(result.quality);
    for (const warning of result.warnings || []) console.log(`warning: ${warning}`);
    console.log("");

    printPrunedTurnList("dropped turns", result.droppedTurns);
    printPrunedTurnList("remaining tail", result.remainingTurns);

    console.log("resume:");
    console.log("");
    console.log(result.resume.text);
  }

  function printForkPrune(result) {
    const thread = result.thread || {};
    console.log([
      result.forkedSessionId || thread.sessionId || thread.threadId || "",
      result.originalSessionId ? `forked_from=${result.originalSessionId}` : "",
      `drop=${result.appliedDropTurns}`,
      `remaining=${result.remainingTurnCount}`,
    ].filter(Boolean).join(" | "));
    if (thread.name) console.log(`name: ${thread.name}`);
    if (thread.path) console.log(`path: ${thread.path}`);
    if (result.selectionMode === "through_turn" && result.throughTurnId) {
      console.log(`keep-through: ${result.throughTurnId}`);
    }
    if (result.prunedVia) console.log(`pruned via: ${result.prunedVia}`);
    printSourceSelectionDetails(result.source);
    printHistoryQualityDetails(result.quality);
    for (const warning of result.warnings || []) console.log(`warning: ${warning}`);
    console.log("");

    printPrunedTurnList("dropped turns", result.droppedTurns);
    printPrunedTurnList("remaining tail", result.remainingTurns);

    console.log("resume:");
    console.log("");
    console.log(result.resume.text);
  }

  function printBridgeThreadLifecycle(result) {
    if (!result) return;
    console.log([
      result.sessionId || result.threadId || "",
      result.archived === true ? "archived=true" : "",
      result.memoryMode ? `memory=${result.memoryMode}` : "",
    ].filter(Boolean).join(" | "));
    printSourceSelectionDetails(result.source);
  }

  return {
    buildBridgeThreadListHints,
    printBridgeThreadList,
    printBridgeLoadedThreads,
    printBridgeThread,
    printPruneCandidates,
    printPrunePreview,
    printForkPrune,
    printBridgeThreadLifecycle,
  };
}

module.exports = {
  createHistoryCliBridgeView,
};
