"use strict";

function createHistoryCliHistoryView(deps = {}) {
  const {
    getQueryMatchSignalTier,
    classifyQuerySignal,
    summarizeLowSignalQueryMatches,
    formatCommandSummary,
    formatQuerySummary,
    formatValueList,
    formatQueryDisplayValue,
    formatQueryValueList,
    formatPathValueList,
    printAnnotationLines,
    formatRolloutPersistenceSummary,
    printSourceSelectionDetails,
    printRolloutPersistenceDetails,
    printHistoryQualityDetails,
    printReloadSafetyDetails,
    formatPathRoleSummary,
    getEntityCommandOps,
    getMatchedCommandOps,
    getMatchedFiles,
    getMatchedPaths,
    getMatchedPathPatterns,
    getMatchedQueries,
  } = deps;

  function formatSearchMatch(match) {
    if (!match || typeof match !== "object") return "";
    const kind = typeof match.kind === "string" ? match.kind.trim() : "";
    const text = typeof match.text === "string" ? match.text.trim() : "";
    if (!text) return "";
    const displayText = kind === "query"
      ? formatQueryDisplayValue(text)
      : text;
    const querySignal = getQueryMatchSignalTier(match) || (kind === "query" ? classifyQuerySignal(text) : "");
    const suffix = querySignal === "low" ? " [low-signal]" : "";
    return kind ? `${kind}=${displayText}${suffix}` : `${displayText}${suffix}`;
  }

  function printSessionList(result) {
    if (result.historyMode) {
      console.log(`history mode: ${result.historyMode}`);
      console.log("");
    }
    for (const session of result.sessions) {
      const counts = session.counts;
      const firstLine = [
        session.sessionId,
        session.updatedAt || session.startedAt || "",
        session.cwd || "",
      ].filter(Boolean).join(" | ");
      console.log(firstLine);

      const secondLine = [
        session.sessionKey ? `rollout=${session.sessionKey}` : "",
        session.forkedFromId ? `forked_from=${session.forkedFromId}` : "",
        session.parentThreadId ? `parent=${session.parentThreadId}` : "",
        session.lineageRootId && session.lineageRootId !== session.sessionId ? `root=${session.lineageRootId}` : "",
        session.lineageDepth ? `depth=${session.lineageDepth}` : "",
        session.lineageFamilyCount > 1 ? `family=${session.lineageFamilyCount}` : "",
        session.model ? `model=${session.model}` : "",
        session.qualityClass ? `quality=${session.qualityClass}` : "",
        session.turnCount ? `turns=${session.turnCount}` : "",
        counts.commands ? `cmd=${counts.commands}` : "",
        counts.searches ? `search=${counts.searches}` : "",
        counts.patches ? `patch=${counts.patches}` : "",
        counts.errors ? `error=${counts.errors}` : "",
        session.tags.length ? `tags=${session.tags.join(",")}` : "",
      ].filter(Boolean).join("  ");
      if (secondLine) console.log(secondLine);

      if (session.lastUserPreview) console.log(`user: ${session.lastUserPreview}`);
      if (session.finalAnswerPreview) console.log(`answer: ${session.finalAnswerPreview}`);
      else if (session.commentaryPreview) console.log(`commentary: ${session.commentaryPreview}`);
      printAnnotationLines(session.annotation);
      const rolloutSummary = formatRolloutPersistenceSummary(session.rolloutPersistence);
      if (rolloutSummary) console.log(rolloutSummary);
      const matchSummary = formatSearchMatch(session.match);
      if (matchSummary) {
        console.log(`match: ${matchSummary}`);
        if (session.matchReasons && session.matchReasons.length) {
          console.log(`match-reasons: ${session.matchReasons.join(", ")}`);
        }
      } else if (session.matchReasons && session.matchReasons.length) {
        console.log(`match: ${session.matchReasons.join(", ")}`);
      }
      if (session.filesTouched.length) {
        console.log(`files: ${formatPathValueList(session.filesTouched, session.cwd || "", 4)}`);
      }
      const matchedSessionFiles = getMatchedFiles(session);
      if (matchedSessionFiles.length) console.log(`matched-files: ${formatPathValueList(matchedSessionFiles, session.cwd || "", 4)}`);
      if (session.pathsReferenced && session.pathsReferenced.length) {
        console.log(`paths: ${formatPathValueList(session.pathsReferenced, session.cwd || "", 4)}`);
      }
      const matchedSessionPaths = getMatchedPaths(session);
      if (matchedSessionPaths.length) console.log(`matched-paths: ${formatPathValueList(matchedSessionPaths, session.cwd || "", 4)}`);
      const matchedSessionPathPatterns = getMatchedPathPatterns(session);
      if (matchedSessionPathPatterns.length) console.log(`matched-path-patterns: ${formatValueList(matchedSessionPathPatterns, 4)}`);
      const matchedSessionCommandOps = getMatchedCommandOps(session);
      if (matchedSessionCommandOps.length) console.log(`matched-command-ops: ${formatValueList(matchedSessionCommandOps, 6)}`);
      const matchedSessionQueries = getMatchedQueries(session);
      if (matchedSessionQueries.length) console.log(`matched-queries: ${formatQueryValueList(matchedSessionQueries, 6)}`);
      const sessionCommandOps = getEntityCommandOps(session);
      if (sessionCommandOps.length) console.log(`command-ops: ${formatValueList(sessionCommandOps, 8)}`);
      console.log("");
    }

    if (result && result.queryMode === "fuzzy") {
      const lowSignal = result.querySignalSummary || summarizeLowSignalQueryMatches(result.sessions);
      if (lowSignal.onlyLowSignal) {
        const exampleText = lowSignal.examples.length
          ? `, for example ${lowSignal.examples.map((value) => formatQueryDisplayValue(value)).join(", ")}`
          : "";
        console.log(`Note: these fuzzy query hits are low-signal filename/glob filters${exampleText}.`);
        console.log("Try: add --cwd to narrow, use --query-mode exact for a literal captured query, or use search --q ... --q-mode fuzzy for broader session text.");
        console.log("");
      }
    }
  }

  function printSessionDetail(session) {
    console.log([
      session.sessionId,
      session.sessionKey ? `rollout=${session.sessionKey}` : "",
      session.forkedFromId ? `forked_from=${session.forkedFromId}` : "",
      session.parentThreadId ? `parent=${session.parentThreadId}` : "",
      session.lineageRootId && session.lineageRootId !== session.sessionId ? `root=${session.lineageRootId}` : "",
      session.lineageDepth ? `depth=${session.lineageDepth}` : "",
      session.updatedAt || session.startedAt || "",
      session.historyMode ? `history=${session.historyMode}` : "",
    ].filter(Boolean).join(" | "));
    if (session.cwd) console.log(`cwd: ${session.cwd}`);
    console.log([
      session.model ? `model=${session.model}` : "",
      session.cliVersion ? `cli=${session.cliVersion}` : "",
      session.modelProvider ? `provider=${session.modelProvider}` : "",
      session.qualityClass ? `quality=${session.qualityClass}` : "",
      session.approvalPolicy ? `approval=${session.approvalPolicy}` : "",
      session.sandboxMode ? `sandbox=${session.sandboxMode}` : "",
    ].filter(Boolean).join("  "));
    console.log([
      `turns=${session.turnCount}`,
      `events=${session.eventCount}`,
      `commands=${session.counts.commands}`,
      `patches=${session.counts.patches}`,
      `searches=${session.counts.searches}`,
      `mcp=${session.counts.mcp}`,
      `errors=${session.counts.errors}`,
      session.lineageFamilyCount > 1 ? `family=${session.lineageFamilyCount}` : "",
    ].join("  "));
    if (session.lastUserPreview) console.log(`last user: ${session.lastUserPreview}`);
    if (session.finalAnswerPreview) console.log(`last answer: ${session.finalAnswerPreview}`);
    printAnnotationLines(session.annotation);
    if (session.filesTouched.length) console.log(`files: ${formatPathValueList(session.filesTouched, session.cwd || "", 8)}`);
    const sessionMatchSummary = formatSearchMatch(session.match);
    if (sessionMatchSummary) {
      console.log(`match: ${sessionMatchSummary}`);
      if (session.matchReasons && session.matchReasons.length) console.log(`match-reasons: ${session.matchReasons.join(", ")}`);
    } else if (session.matchReasons && session.matchReasons.length) {
      console.log(`match: ${session.matchReasons.join(", ")}`);
    }
    const matchedSessionFiles = getMatchedFiles(session);
    if (matchedSessionFiles.length) console.log(`matched-files: ${formatPathValueList(matchedSessionFiles, session.cwd || "", 8)}`);
    if (session.pathsReferenced && session.pathsReferenced.length) console.log(`paths: ${formatPathValueList(session.pathsReferenced, session.cwd || "", 8)}`);
    const matchedSessionPaths = getMatchedPaths(session);
    if (matchedSessionPaths.length) console.log(`matched-paths: ${formatPathValueList(matchedSessionPaths, session.cwd || "", 8)}`);
    const matchedSessionPathPatterns = getMatchedPathPatterns(session);
    if (matchedSessionPathPatterns.length) console.log(`matched-path-patterns: ${formatValueList(matchedSessionPathPatterns, 8)}`);
    const sessionPathRoles = formatPathRoleSummary(session.pathRoles, 2, session.cwd || "");
    if (sessionPathRoles) console.log(`path-roles: ${sessionPathRoles}`);
    if (session.commandTypes && session.commandTypes.length) console.log(`command-types: ${formatValueList(session.commandTypes, 8)}`);
    if (Array.isArray(session.replayedSessionIds) && session.replayedSessionIds.length) {
      console.log(`replayed-session-ids: ${formatValueList(session.replayedSessionIds, 8)}`);
    }
    const matchedSessionCommandOps = getMatchedCommandOps(session);
    if (matchedSessionCommandOps.length) console.log(`matched-command-ops: ${formatValueList(matchedSessionCommandOps, 8)}`);
    const matchedSessionQueries = getMatchedQueries(session);
    if (matchedSessionQueries.length) console.log(`matched-queries: ${formatQueryValueList(matchedSessionQueries, 8)}`);
    const sessionCommandOps = getEntityCommandOps(session);
    if (sessionCommandOps.length) console.log(`command-ops: ${formatValueList(sessionCommandOps, 8)}`);
    if (session.toolsUsed.length) console.log(`tools: ${formatValueList(session.toolsUsed, 8)}`);
    printRolloutPersistenceDetails(session.rolloutPersistence);
    console.log("");

    for (const turn of session.turns) {
      console.log(`${turn.turnId} | ${turn.status} | ${turn.startedAt || turn.endedAt || ""}`);
      if (turn.userPromptPreview) console.log(`user: ${turn.userPromptPreview}`);
      if (turn.finalAnswerPreview) console.log(`answer: ${turn.finalAnswerPreview}`);
      else if (turn.commentaryPreview) console.log(`commentary: ${turn.commentaryPreview}`);
      printAnnotationLines(turn.annotation);
      if (turn.commands.length) {
        console.log(`commands: ${turn.commands.map(formatCommandSummary).slice(0, 3).join(" | ")}`);
      }
      if (turn.filesTouched.length) console.log(`files: ${formatPathValueList(turn.filesTouched, turn.cwd || session.cwd || "", 6)}`);
      const matchedTurnFiles = getMatchedFiles(turn);
      if (matchedTurnFiles.length) console.log(`matched-files: ${formatPathValueList(matchedTurnFiles, turn.cwd || session.cwd || "", 6)}`);
      if (turn.pathsReferenced && turn.pathsReferenced.length) console.log(`paths: ${formatPathValueList(turn.pathsReferenced, turn.cwd || session.cwd || "", 6)}`);
      const matchedTurnPaths = getMatchedPaths(turn);
      if (matchedTurnPaths.length) console.log(`matched-paths: ${formatPathValueList(matchedTurnPaths, turn.cwd || session.cwd || "", 6)}`);
      const matchedTurnPathPatterns = getMatchedPathPatterns(turn);
      if (matchedTurnPathPatterns.length) console.log(`matched-path-patterns: ${formatValueList(matchedTurnPathPatterns, 6)}`);
      const turnPathRoles = formatPathRoleSummary(turn.pathRoles, 2, turn.cwd || session.cwd || "");
      if (turnPathRoles) console.log(`path-roles: ${turnPathRoles}`);
      if (turn.commandTypes && turn.commandTypes.length) console.log(`command-types: ${formatValueList(turn.commandTypes, 6)}`);
      const matchedTurnCommandOps = getMatchedCommandOps(turn);
      if (matchedTurnCommandOps.length) console.log(`matched-command-ops: ${formatValueList(matchedTurnCommandOps, 6)}`);
      const matchedTurnQueries = getMatchedQueries(turn);
      if (matchedTurnQueries.length) console.log(`matched-queries: ${formatQueryValueList(matchedTurnQueries, 6)}`);
      const turnCommandOps = getEntityCommandOps(turn);
      if (turnCommandOps.length) console.log(`command-ops: ${formatValueList(turnCommandOps, 6)}`);
      if (turn.queries.length) console.log(`queries: ${formatQueryValueList(turn.queries.map(formatQuerySummary).filter(Boolean), 6)}`);
      if (turn.errors.length) console.log(`errors: ${formatValueList(turn.errors.map((item) => item.message).filter(Boolean), 6)}`);
      console.log("");
    }
  }

  function printTurnList(result) {
    console.log(`${result.sessionId} | turns=${result.turnCount}${result.historyMode ? ` | history=${result.historyMode}` : ""}`);
    console.log("");

    for (const turn of result.turns) {
      console.log(`${turn.turnId} | ${turn.status} | ${turn.startedAt || turn.endedAt || ""}`);
      if (turn.userPromptPreview) console.log(`user: ${turn.userPromptPreview}`);
      if (turn.finalAnswerPreview) console.log(`answer: ${turn.finalAnswerPreview}`);
      else if (turn.commentaryPreview) console.log(`commentary: ${turn.commentaryPreview}`);
      printAnnotationLines(turn.annotation);
      if (turn.commands.length) {
        console.log(`commands: ${turn.commands.map(formatCommandSummary).slice(0, 3).join(" | ")}`);
      }
      if (turn.filesTouched.length) console.log(`files: ${formatPathValueList(turn.filesTouched, turn.cwd || "", turn.filesTouched.length)}`);
      const matchedTurnFiles = getMatchedFiles(turn);
      if (matchedTurnFiles.length) console.log(`matched-files: ${formatPathValueList(matchedTurnFiles, turn.cwd || "", 6)}`);
      if (turn.pathsReferenced && turn.pathsReferenced.length) console.log(`paths: ${formatPathValueList(turn.pathsReferenced, turn.cwd || "", turn.pathsReferenced.length)}`);
      const matchedTurnPaths = getMatchedPaths(turn);
      if (matchedTurnPaths.length) console.log(`matched-paths: ${formatPathValueList(matchedTurnPaths, turn.cwd || "", 6)}`);
      const matchedTurnPathPatterns = getMatchedPathPatterns(turn);
      if (matchedTurnPathPatterns.length) console.log(`matched-path-patterns: ${formatValueList(matchedTurnPathPatterns, 6)}`);
      const turnPathRoles = formatPathRoleSummary(turn.pathRoles, 2, turn.cwd || "");
      if (turnPathRoles) console.log(`path-roles: ${turnPathRoles}`);
      if (turn.commandTypes && turn.commandTypes.length) console.log(`command-types: ${turn.commandTypes.join(", ")}`);
      const matchedTurnCommandOps = getMatchedCommandOps(turn);
      if (matchedTurnCommandOps.length) console.log(`matched-command-ops: ${formatValueList(matchedTurnCommandOps, 6)}`);
      const matchedTurnQueries = getMatchedQueries(turn);
      if (matchedTurnQueries.length) console.log(`matched-queries: ${formatQueryValueList(matchedTurnQueries, 6)}`);
      const turnCommandOps = getEntityCommandOps(turn);
      if (turnCommandOps.length) console.log(`command-ops: ${formatValueList(turnCommandOps, 6)}`);
      if (turn.queries.length) console.log(`queries: ${formatQueryValueList(turn.queries.map(formatQuerySummary).filter(Boolean), 6)}`);
      if (turn.errors.length) console.log(`errors: ${turn.errors.map((item) => item.message).join(" | ")}`);
      console.log("");
    }
  }

  function printTurnDetail(result) {
    const turn = result.turn;
    console.log([
      result.sessionId,
      turn.turnId,
      turn.status,
      turn.startedAt || turn.endedAt || "",
      turn.cwd || "",
      turn.model ? `model=${turn.model}` : "",
      result.historyMode ? `history=${result.historyMode}` : "",
    ].filter(Boolean).join(" | "));
    console.log([
      `events=${result.matchedEvents}`,
      turn.commands.length ? `commands=${turn.commands.length}` : "",
      turn.queries.length ? `queries=${turn.queries.length}` : "",
      turn.errors.length ? `errors=${turn.errors.length}` : "",
      result.queryMode ? `query-mode=${result.queryMode}` : "",
    ].filter(Boolean).join("  "));
    if (turn.userPromptPreview) console.log(`user: ${turn.userPromptPreview}`);
    if (turn.finalAnswerPreview) console.log(`answer: ${turn.finalAnswerPreview}`);
    else if (turn.commentaryPreview) console.log(`commentary: ${turn.commentaryPreview}`);
    else if (turn.summary) console.log(`summary: ${turn.summary}`);
    printAnnotationLines(turn.annotation);
    if (turn.filesTouched.length) console.log(`files: ${formatPathValueList(turn.filesTouched, turn.cwd || "", turn.filesTouched.length)}`);
    const matchedTurnFiles = getMatchedFiles(turn);
    if (matchedTurnFiles.length) console.log(`matched-files: ${formatPathValueList(matchedTurnFiles, turn.cwd || "", 8)}`);
    if (turn.pathsReferenced && turn.pathsReferenced.length) console.log(`paths: ${formatPathValueList(turn.pathsReferenced, turn.cwd || "", turn.pathsReferenced.length)}`);
    const matchedTurnPaths = getMatchedPaths(turn);
    if (matchedTurnPaths.length) console.log(`matched-paths: ${formatPathValueList(matchedTurnPaths, turn.cwd || "", 8)}`);
    const matchedTurnPathPatterns = getMatchedPathPatterns(turn);
    if (matchedTurnPathPatterns.length) console.log(`matched-path-patterns: ${formatValueList(matchedTurnPathPatterns, 8)}`);
    const turnPathRoles = formatPathRoleSummary(turn.pathRoles, 3, turn.cwd || "");
    if (turnPathRoles) console.log(`path-roles: ${turnPathRoles}`);
    if (turn.commandTypes && turn.commandTypes.length) console.log(`command-types: ${turn.commandTypes.join(", ")}`);
    const matchedTurnCommandOps = getMatchedCommandOps(turn);
    if (matchedTurnCommandOps.length) console.log(`matched-command-ops: ${formatValueList(matchedTurnCommandOps, 8)}`);
    const matchedTurnQueries = getMatchedQueries(turn);
    if (matchedTurnQueries.length) console.log(`matched-queries: ${formatQueryValueList(matchedTurnQueries, 8)}`);
    const turnCommandOps = getEntityCommandOps(turn);
    if (turnCommandOps.length) console.log(`command-ops: ${formatValueList(turnCommandOps, 8)}`);
    if (turn.toolsUsed.length) console.log(`tools: ${turn.toolsUsed.join(", ")}`);
    if (turn.queries.length) console.log(`queries: ${formatQueryValueList(turn.queries.map(formatQuerySummary).filter(Boolean), 6)}`);
    if (turn.errors.length) console.log(`errors: ${turn.errors.map((item) => item.message).join(" | ")}`);
    console.log("");

    if (result.events.length) {
      console.log("timeline:");
      for (const event of result.events) {
        const header = [
          event.timestamp || `#${event.index}`,
          `line=${event.lineNumber}`,
          event.kind,
          event.includedInFinalHistory === false ? "rolled_back" : "",
          event.role ? `role=${event.role}` : "",
          event.phase ? `phase=${event.phase}` : "",
          event.toolName ? `tool=${event.toolName}` : "",
          event.commandSource ? `source=${event.commandSource}` : "",
          event.exitCode != null ? `exit=${event.exitCode}` : "",
          event.statusCode != null ? `status=${event.statusCode}` : "",
        ].filter(Boolean).join(" | ");
        console.log(`  ${header}`);
        if (event.command) console.log(`  command: ${event.command}`);
        if (event.commandTypes && event.commandTypes.length) console.log(`  command-types: ${event.commandTypes.join(", ")}`);
        if (event.matchedFiles && event.matchedFiles.length) console.log(`  matched-files: ${formatPathValueList(event.matchedFiles, turn.cwd || event.cwd || "", 6)}`);
        if (event.matchedPaths && event.matchedPaths.length) console.log(`  matched-paths: ${formatPathValueList(event.matchedPaths, turn.cwd || event.cwd || "", 6)}`);
        if (event.matchedPathPatterns && event.matchedPathPatterns.length) console.log(`  matched-path-patterns: ${formatValueList(event.matchedPathPatterns, 6)}`);
        if (event.matchedCommandOps && event.matchedCommandOps.length) console.log(`  matched-command-ops: ${formatValueList(event.matchedCommandOps, 6)}`);
        if (event.matchedQueries && event.matchedQueries.length) console.log(`  matched-queries: ${formatQueryValueList(event.matchedQueries, 6)}`);
        const eventPathRoles = formatPathRoleSummary(event.pathRoles, 2, turn.cwd || event.cwd || "");
        if (eventPathRoles) console.log(`  path-roles: ${eventPathRoles}`);
        if (event.commandPaths && event.commandPaths.length) console.log(`  paths: ${formatPathValueList(event.commandPaths, turn.cwd || event.cwd || "", event.commandPaths.length)}`);
        if (event.commandPathPatterns && event.commandPathPatterns.length) console.log(`  path-patterns: ${event.commandPathPatterns.join(", ")}`);
        if (event.commandQueries && event.commandQueries.length) console.log(`  command-queries: ${formatQueryValueList(event.commandQueries, 6)}`);
        if (event.query) console.log(`  query: ${formatQueryDisplayValue(event.query)}`);
        else if (event.queries && event.queries.length) console.log(`  queries: ${formatQueryValueList(event.queries, 6)}`);
        if (event.filesTouched && event.filesTouched.length) console.log(`  files: ${formatPathValueList(event.filesTouched, turn.cwd || event.cwd || "", event.filesTouched.length)}`);
        if (event.detail && event.detail !== event.command && event.detail !== event.query) console.log(`  detail: ${event.detail}`);
        console.log("");
      }
    }
  }

  function printTranscript(result) {
    const session = result.session;
    console.log([
      session.sessionId,
      session.updatedAt || session.startedAt || "",
      session.cwd || "",
      session.model ? `model=${session.model}` : "",
      result.source && result.source.used ? `source=${result.source.used}` : "",
      result.historyMode ? `history=${result.historyMode}` : "",
      `items=${result.matchedItems}`,
    ].filter(Boolean).join(" | "));
    console.log(`file: ${session.filePath}`);
    if (result.queryMode) {
      console.log(`query-mode: ${result.queryMode}`);
    }
    if (result.source && result.source.bridgeError) {
      console.log(`bridge fallback: ${result.source.bridgeError}`);
    }
    printSourceSelectionDetails(result.source);
    printRolloutPersistenceDetails(session.rolloutPersistence);
    printHistoryQualityDetails(result.quality);
    if (result.truncated) {
      console.log(`showing last ${result.items.length} matching items`);
    }
    console.log("");

    let previousTurnId = null;
    for (const item of result.items) {
      if (item.turnId && item.turnId !== previousTurnId) {
        if (previousTurnId !== null) console.log("");
        console.log(`# ${item.turnId}`);
        previousTurnId = item.turnId;
      }

      const header = [
        item.timestamp || `#${item.index}`,
        item.type,
        item.includedInFinalHistory === false ? "rolled_back" : "",
        item.toolName ? `tool=${item.toolName}` : "",
        item.commandSource ? `source=${item.commandSource}` : "",
        item.exitCode != null ? `exit=${item.exitCode}` : "",
        item.statusCode != null ? `status=${item.statusCode}` : "",
      ].filter(Boolean).join(" | ");
      console.log(header);

      if (item.command) console.log(`command: ${item.command}`);
      if (item.commandTypes && item.commandTypes.length) console.log(`command-types: ${item.commandTypes.join(", ")}`);
      if (item.commandTypeHints && item.commandTypeHints.length) console.log(`command-type-hints: ${item.commandTypeHints.join(", ")}`);
      if (item.matchedFiles && item.matchedFiles.length) console.log(`matched-files: ${formatPathValueList(item.matchedFiles, item.cwd || session.cwd || "", 6)}`);
      if (item.matchedPaths && item.matchedPaths.length) console.log(`matched-paths: ${formatPathValueList(item.matchedPaths, item.cwd || session.cwd || "", 6)}`);
      if (item.matchedPathPatterns && item.matchedPathPatterns.length) console.log(`matched-path-patterns: ${formatValueList(item.matchedPathPatterns, 6)}`);
      if (item.matchedCommandOps && item.matchedCommandOps.length) console.log(`matched-command-ops: ${formatValueList(item.matchedCommandOps, 6)}`);
      if (item.matchedQueries && item.matchedQueries.length) console.log(`matched-queries: ${formatQueryValueList(item.matchedQueries, 6)}`);
      const itemPathRoles = formatPathRoleSummary(item.pathRoles, 2, item.cwd || session.cwd || "");
      if (itemPathRoles) console.log(`path-roles: ${itemPathRoles}`);
      if (item.commandPaths && item.commandPaths.length) console.log(`paths: ${formatPathValueList(item.commandPaths, item.cwd || session.cwd || "", item.commandPaths.length)}`);
      if (item.commandPathPatterns && item.commandPathPatterns.length) console.log(`path-patterns: ${item.commandPathPatterns.join(", ")}`);
      if (item.commandQueries && item.commandQueries.length) console.log(`command-queries: ${formatQueryValueList(item.commandQueries, 6)}`);
      if (item.shellCommands && item.shellCommands.length) console.log(`shell-commands: ${item.shellCommands.join(", ")}`);
      if (item.query) console.log(`query: ${formatQueryDisplayValue(item.query)}`);
      else if (item.queries && item.queries.length) console.log(`queries: ${formatQueryValueList(item.queries, 6)}`);
      if (item.filesTouched && item.filesTouched.length) console.log(`files: ${formatPathValueList(item.filesTouched, item.cwd || session.cwd || "", item.filesTouched.length)}`);
      if (item.text) console.log(`text: ${item.text}`);
      console.log("");
    }
  }

  function printResume(result, options = {}) {
    const session = result.session;
    const turnLabel = result.totalTurnCount && result.totalTurnCount !== result.turnCount
      ? `${result.turnCount}/${result.totalTurnCount}`
      : `${result.turnCount}`;
    console.log([
      session.sessionId,
      session.updatedAt || session.startedAt || "",
      session.cwd || "",
      session.model ? `model=${session.model}` : "",
      result.source && result.source.used ? `source=${result.source.used}` : "",
      result.historyMode ? `history=${result.historyMode}` : "",
      `turns=${turnLabel}`,
    ].filter(Boolean).join(" | "));
    console.log([
      `tool-text=${result.shaping.toolTextMode}`,
      `trim=${result.shaping.trimStrategy}`,
      `budget=${result.shaping.totalChars}`,
      `item=${result.shaping.itemChars}`,
      `tool=${result.shaping.toolChars}`,
      `lines=${result.shaping.lineLimit}`,
    ].join("  "));
    if (result.queryMode) {
      console.log(`query-mode: ${result.queryMode}`);
    }
    if (result.compactions.count > 0) {
      console.log(`compactions=${result.compactions.count}${result.compactions.lastTimestamp ? ` last=${result.compactions.lastTimestamp}` : ""}`);
    }
    if (result.source && result.source.bridgeError) {
      console.log(`bridge fallback: ${result.source.bridgeError}`);
    }
    printSourceSelectionDetails(result.source);
    printRolloutPersistenceDetails(session.rolloutPersistence);
    printHistoryQualityDetails(result.quality);
    printReloadSafetyDetails(result.reloadSafety);
    if (result.truncated) {
      const budget = result.shaping && Number.isInteger(result.shaping.totalChars) && result.shaping.totalChars > 0
        ? `${result.shaping.totalChars}-char`
        : "character";
      console.log(`resume was shortened to fit the ${budget} budget.`);
    }
    console.log("");
    if (options.includeText === false) {
      console.log("resume text withheld by reload safety policy");
    } else {
      console.log(result.text);
    }
  }

  function printEventList(result) {
    console.log([
      result.sessionId,
      result.filePath,
      result.historyMode ? `history=${result.historyMode}` : "",
      result.queryMode ? `query-mode=${result.queryMode}` : "",
    ].filter(Boolean).join(" | "));
    console.log(
      `${result.matchedEvents} matched events (${result.totalEvents} total)` +
      (result.truncated ? `, showing last ${result.events.length}` : "")
    );
    console.log("");

    for (const event of result.events) {
      const header = [
        event.timestamp || `#${event.index}`,
        `line=${event.lineNumber}`,
        event.kind,
        event.includedInFinalHistory === false ? "rolled_back" : "",
        event.role ? `role=${event.role}` : "",
        event.phase ? `phase=${event.phase}` : "",
        event.turnId ? `turn=${event.turnId}` : "",
        event.toolName ? `tool=${event.toolName}` : "",
        event.commandSource ? `source=${event.commandSource}` : "",
        event.exitCode != null ? `exit=${event.exitCode}` : "",
        event.statusCode != null ? `status=${event.statusCode}` : "",
      ].filter(Boolean).join(" | ");
      console.log(header);

      if (event.command) console.log(`command: ${event.command}`);
      if (event.commandTypes && event.commandTypes.length) console.log(`command-types: ${event.commandTypes.join(", ")}`);
      if (event.commandTypeHints && event.commandTypeHints.length) console.log(`command-type-hints: ${event.commandTypeHints.join(", ")}`);
      if (event.matchedFiles && event.matchedFiles.length) console.log(`matched-files: ${formatPathValueList(event.matchedFiles, event.cwd || "", 6)}`);
      if (event.matchedPaths && event.matchedPaths.length) console.log(`matched-paths: ${formatPathValueList(event.matchedPaths, event.cwd || "", 6)}`);
      if (event.matchedPathPatterns && event.matchedPathPatterns.length) console.log(`matched-path-patterns: ${formatValueList(event.matchedPathPatterns, 6)}`);
      if (event.matchedCommandOps && event.matchedCommandOps.length) console.log(`matched-command-ops: ${formatValueList(event.matchedCommandOps, 6)}`);
      if (event.matchedQueries && event.matchedQueries.length) console.log(`matched-queries: ${formatQueryValueList(event.matchedQueries, 6)}`);
      const eventPathRoles = formatPathRoleSummary(event.pathRoles, 2, event.cwd || "");
      if (eventPathRoles) console.log(`path-roles: ${eventPathRoles}`);
      if (event.commandPaths && event.commandPaths.length) console.log(`paths: ${formatPathValueList(event.commandPaths, event.cwd || "", event.commandPaths.length)}`);
      if (event.commandPathPatterns && event.commandPathPatterns.length) console.log(`path-patterns: ${event.commandPathPatterns.join(", ")}`);
      if (event.commandQueries && event.commandQueries.length) console.log(`command-queries: ${formatQueryValueList(event.commandQueries, 6)}`);
      if (event.shellCommands && event.shellCommands.length) console.log(`shell-commands: ${event.shellCommands.join(", ")}`);
      if (event.query) console.log(`query: ${formatQueryDisplayValue(event.query)}`);
      else if (event.queries && event.queries.length) console.log(`queries: ${formatQueryValueList(event.queries, 6)}`);
      if (event.filesTouched && event.filesTouched.length) {
        console.log(`files: ${formatPathValueList(event.filesTouched, event.cwd || "", event.filesTouched.length)}`);
      }

      const detailText = event.detail && event.detail !== event.command && event.detail !== event.query
        ? event.detail
        : "";
      const detailLabel = event.kind === "tool_output"
        ? "output"
        : (event.kind === "message" || event.kind === "reasoning" ? "text" : "detail");
      if (detailText) console.log(`${detailLabel}: ${detailText}`);
      console.log("");
    }
  }

  return {
    printSessionList,
    printSessionDetail,
    printTurnList,
    printTurnDetail,
    printTranscript,
    printResume,
    printEventList,
  };
}

module.exports = {
  createHistoryCliHistoryView,
};
