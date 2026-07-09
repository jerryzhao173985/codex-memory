"use strict";

function createHistoryCliCatalogView(deps = {}) {
  const {
    path: pathModule = require("path"),
    formatPathPatternKindLabel,
    formatCommandOpSignalLabel,
    formatQuerySignalLabel,
    formatPathRoleLabel,
    formatPathRoleSummary,
    formatPathRoleList,
    formatValueList,
    formatPathValueList,
    formatQueryValueList,
    printAnnotationLines,
    getEntityCommandOps,
    getMatchedCommandOps,
    getMatchedFiles,
    getMatchedPaths,
    getMatchedPathPatterns,
    getMatchedQueries,
  } = deps;

  function formatFocusRootLabel(item) {
    if (!item || !item.root) return "";
    if (Number.isFinite(item.score) && item.score !== item.count) {
      return `${item.root} (score=${item.score}, hits=${item.count})`;
    }
    return `${item.root} (${item.count})`;
  }

  function formatAreaRecentSession(item, areaRoot) {
    if (!item || !item.sessionId) return "";
    const text = [item.sessionId];
    if (item.sessionFocusRoot && item.sessionFocusRoot !== areaRoot) {
      text.push(`[session-focus=${item.sessionFocusRoot}]`);
    }
    return text.join(" ");
  }

  function getArtifactSignalLabel(kind, signalTier) {
    if (kind === "command_op" && signalTier) {
      return formatCommandOpSignalLabel(signalTier) || signalTier;
    }
    if (kind === "query" && signalTier) {
      return formatQuerySignalLabel(signalTier) || signalTier;
    }
    return "";
  }

  function printArtifactList(result) {
    if (result.historyMode) {
      console.log(`history mode: ${result.historyMode}`);
      console.log("");
    }
    for (const artifact of result.artifacts) {
      const artifactSignal = getArtifactSignalLabel(artifact.kind, artifact.signalTier);
      console.log([
        artifact.kind,
        artifact.kind === "path_pattern" && artifact.patternKind
          ? `pattern=${formatPathPatternKindLabel(artifact.patternKind) || artifact.patternKind}`
          : "",
        artifactSignal ? `signal=${artifactSignal}` : "",
        `sessions=${artifact.sessionCount}`,
        artifact.lastSeenAt || "",
      ].filter(Boolean).join(" | "));
      console.log(artifact.value);
      if (artifact.pathRoles && artifact.pathRoles.length) {
        console.log(`roles: ${formatPathRoleList(artifact.pathRoles)}`);
      }
      if (artifact.sessions.length) {
        console.log(`refs: ${artifact.sessions.map((item) => `${item.sessionId}${item.cwd ? ` @ ${item.cwd}` : ""}`).join(" | ")}`);
      }
      console.log("");
    }
  }

  function printArtifactDetail(result) {
    const artifactSignal = getArtifactSignalLabel(result.kind, result.signalTier);
    console.log([
      result.kind,
      result.kind === "path_pattern" && result.patternKind
        ? `pattern=${formatPathPatternKindLabel(result.patternKind) || result.patternKind}`
        : "",
      artifactSignal ? `signal=${artifactSignal}` : "",
      result.value,
      result.historyMode ? `history=${result.historyMode}` : "",
    ].filter(Boolean).join(" | "));
    console.log([
      `sessions=${result.sessionCount}`,
      `turns=${result.turnCount}`,
      result.lastSeenAt ? `last_seen=${result.lastSeenAt}` : "",
    ].filter(Boolean).join("  "));
    if (result.pathRoles && result.pathRoles.length) {
      console.log(`roles: ${formatPathRoleList(result.pathRoles)}`);
    }
    console.log("");

    for (const session of result.sessions) {
      console.log([
        session.sessionId,
        session.updatedAt || session.startedAt || "",
        session.cwd || "",
        session.model ? `model=${session.model}` : "",
        `turns=${session.turnMatchCount}`,
      ].filter(Boolean).join(" | "));
      if (session.lastUserPreview) console.log(`user: ${session.lastUserPreview}`);
      if (session.finalAnswerPreview) console.log(`answer: ${session.finalAnswerPreview}`);
      else if (session.commentaryPreview) console.log(`commentary: ${session.commentaryPreview}`);

      for (const turn of session.turns) {
        console.log(`  ${turn.turnId} | ${turn.status} | ${turn.startedAt || turn.endedAt || ""}`);
        if (turn.matchValues && turn.matchValues.length) console.log(`  matches: ${turn.matchValues.join(" | ")}`);
        if (turn.matchRoles && turn.matchRoles.length) console.log(`  roles: ${formatPathRoleList(turn.matchRoles)}`);
        if (turn.userPromptPreview) console.log(`  user: ${turn.userPromptPreview}`);
        if (turn.finalAnswerPreview) console.log(`  answer: ${turn.finalAnswerPreview}`);
        else if (turn.commentaryPreview) console.log(`  commentary: ${turn.commentaryPreview}`);
        else if (turn.summary) console.log(`  summary: ${turn.summary}`);
      }
      console.log("");
    }
  }

  function printArtifactTurnList(result) {
    const artifactSignal = getArtifactSignalLabel(result.kind, result.signalTier);
    console.log([
      result.kind,
      result.kind === "path_pattern" && result.patternKind
        ? `pattern=${formatPathPatternKindLabel(result.patternKind) || result.patternKind}`
        : "",
      artifactSignal ? `signal=${artifactSignal}` : "",
      result.value,
      result.historyMode ? `history=${result.historyMode}` : "",
      `sessions=${result.sessionCount}`,
      `turns=${result.turnCount}`,
      result.lastSeenAt ? `last_seen=${result.lastSeenAt}` : "",
    ].filter(Boolean).join(" | "));
    if (result.pathRoles && result.pathRoles.length) {
      console.log(`roles: ${formatPathRoleList(result.pathRoles)}`);
    }
    console.log("");

    for (const turn of result.turns) {
      console.log([
        turn.sessionId,
        turn.sessionKey ? `rollout=${turn.sessionKey}` : "",
        turn.turnId,
        turn.status,
        turn.startedAt || turn.endedAt || "",
        turn.cwd || "",
        turn.model ? `model=${turn.model}` : "",
      ].filter(Boolean).join(" | "));
      if (turn.matchValues && turn.matchValues.length) console.log(`matches: ${turn.matchValues.join(" | ")}`);
      if (turn.matchRoles && turn.matchRoles.length) console.log(`roles: ${formatPathRoleList(turn.matchRoles)}`);
      if (turn.userPromptPreview) console.log(`user: ${turn.userPromptPreview}`);
      if (turn.finalAnswerPreview) console.log(`answer: ${turn.finalAnswerPreview}`);
      else if (turn.commentaryPreview) console.log(`commentary: ${turn.commentaryPreview}`);
      else if (turn.summary) console.log(`summary: ${turn.summary}`);
      console.log("");
    }
  }

  function printPathThread(result) {
    console.log([
      result.path,
      result.historyMode ? `history=${result.historyMode}` : "",
      result.pathRole ? `role=${formatPathRoleLabel(result.pathRole)}` : "",
      `sessions=${result.sessionCount}`,
      `turns=${result.turnCount}`,
      `event_limit=${result.eventLimit}`,
    ].join(" | "));
    console.log("");

    for (const thread of result.threads) {
      console.log([
        thread.sessionId,
        thread.turnId,
        thread.status,
        thread.startedAt || thread.endedAt || "",
        thread.cwd || "",
        thread.model ? `model=${thread.model}` : "",
      ].filter(Boolean).join(" | "));
      if (thread.userPromptPreview) console.log(`user: ${thread.userPromptPreview}`);
      if (thread.finalAnswerPreview) console.log(`answer: ${thread.finalAnswerPreview}`);
      else if (thread.commentaryPreview) console.log(`commentary: ${thread.commentaryPreview}`);
      if (thread.actions && thread.actions.length) console.log(`actions: ${thread.actions.join(", ")}`);
      if (thread.matchRoles && thread.matchRoles.length) console.log(`roles: ${formatPathRoleList(thread.matchRoles)}`);
      if (thread.commands && thread.commands.length) console.log(`commands: ${thread.commands.join(" | ")}`);
      console.log(`events: ${thread.matchedEvents} (direct=${thread.directEventCount})${thread.truncated ? " [truncated]" : ""}`);
      if (thread.events.length) {
        for (const event of thread.events) {
          const header = [
            event.timestamp || `#${event.index}`,
            event.kind,
            event.includedInFinalHistory === false ? "rolled_back" : "",
            event.toolName ? `tool=${event.toolName}` : "",
            event.commandSource ? `source=${event.commandSource}` : "",
            event.exitCode != null ? `exit=${event.exitCode}` : "",
          ].filter(Boolean).join(" | ");
          console.log(`  ${header}`);
          if (event.command) console.log(`  command: ${event.command}`);
          if (event.commandTypes && event.commandTypes.length) console.log(`  command-types: ${event.commandTypes.join(", ")}`);
          if (event.commandTypeHints && event.commandTypeHints.length) console.log(`  command-type-hints: ${event.commandTypeHints.join(", ")}`);
          const eventPathRoles = formatPathRoleSummary(
            event.pathRoles,
            2,
            thread.cwd || (pathModule.isAbsolute(result.path || "") ? pathModule.dirname(result.path) : "")
          );
          if (eventPathRoles) console.log(`  path-roles: ${eventPathRoles}`);
          if (event.commandPaths && event.commandPaths.length) console.log(`  paths: ${formatPathValueList(event.commandPaths, thread.cwd || "", event.commandPaths.length)}`);
          if (event.commandPathPatterns && event.commandPathPatterns.length) console.log(`  path-patterns: ${event.commandPathPatterns.join(", ")}`);
          if (event.commandQueries && event.commandQueries.length) console.log(`  command-queries: ${formatQueryValueList(event.commandQueries, 6)}`);
          if (event.shellCommands && event.shellCommands.length) console.log(`  shell-commands: ${event.shellCommands.join(", ")}`);
          if (event.filesTouched && event.filesTouched.length) console.log(`  files: ${formatPathValueList(event.filesTouched, thread.cwd || "", event.filesTouched.length)}`);
          if (event.detail && event.detail !== event.command) console.log(`  detail: ${event.detail}`);
        }
      }
      console.log("");
    }
  }

  function printRelatedSessions(result) {
    console.log([
      result.source.sessionId,
      result.historyMode ? `history=${result.historyMode}` : "",
      result.scopeCwd ? `scope=${result.scopeCwd}` : "",
      `related=${result.total}`,
    ].filter(Boolean).join(" | "));
    if (result.source.cwd) console.log(`cwd: ${result.source.cwd}`);
    if (result.source.lastUserPreview) console.log(`user: ${result.source.lastUserPreview}`);
    if (result.source.finalAnswerPreview) console.log(`answer: ${result.source.finalAnswerPreview}`);
    else if (result.source.commentaryPreview) console.log(`commentary: ${result.source.commentaryPreview}`);
    console.log("");

    for (const session of result.sessions) {
      console.log([
        session.sessionId,
        session.sessionKey ? `rollout=${session.sessionKey}` : "",
        session.updatedAt || session.startedAt || "",
        session.cwd || "",
        session.model ? `model=${session.model}` : "",
        `score=${session.relatedScore}`,
        `turns=${session.matchedTurnCount}`,
      ].filter(Boolean).join(" | "));
      if (session.lastUserPreview) console.log(`user: ${session.lastUserPreview}`);
      if (session.finalAnswerPreview) console.log(`answer: ${session.finalAnswerPreview}`);
      else if (session.commentaryPreview) console.log(`commentary: ${session.commentaryPreview}`);
      if (session.relatedReasons && session.relatedReasons.length) console.log(`reasons: ${session.relatedReasons.join(", ")}`);
      if (session.shared.files && session.shared.files.length) console.log(`shared files: ${session.shared.files.join(", ")}`);
      if (session.shared.paths && session.shared.paths.length) console.log(`shared paths: ${session.shared.paths.join(", ")}`);
      if (session.shared.queries && session.shared.queries.length) console.log(`shared queries: ${formatQueryValueList(session.shared.queries, 6)}`);
      if (session.shared.commands && session.shared.commands.length) console.log(`shared commands: ${session.shared.commands.join(" | ")}`);
      if (session.shared.tools && session.shared.tools.length) console.log(`shared tools: ${session.shared.tools.join(", ")}`);
      for (const turn of session.turns || []) {
        console.log(`  ${turn.turnId} | ${turn.status} | ${turn.startedAt || turn.endedAt || ""} | ${turn.matchKinds.join(", ")}`);
        if (turn.userPromptPreview) console.log(`  user: ${turn.userPromptPreview}`);
        if (turn.finalAnswerPreview) console.log(`  answer: ${turn.finalAnswerPreview}`);
        else if (turn.commentaryPreview) console.log(`  commentary: ${turn.commentaryPreview}`);
      }
      console.log("");
    }
  }

  function printProjectList(result) {
    if (result.historyMode) {
      console.log(`history mode: ${result.historyMode}`);
      if (result.queryMode) console.log(`query-mode: ${result.queryMode}`);
      console.log("");
    } else if (result.queryMode) {
      console.log(`query-mode: ${result.queryMode}`);
      console.log("");
    }
    if (!Array.isArray(result.projects) || !result.projects.length) {
      console.log("No projects found.");
      return;
    }
    for (const project of result.projects) {
      console.log([project.cwd, project.updatedAt || project.startedAt || ""].filter(Boolean).join(" | "));
      console.log([
        `sessions=${project.sessionCount}`,
        `turns=${project.turnCount}`,
        project.counts.commands ? `cmd=${project.counts.commands}` : "",
        project.counts.searches ? `search=${project.counts.searches}` : "",
        project.counts.patches ? `patch=${project.counts.patches}` : "",
        project.counts.errors ? `error=${project.counts.errors}` : "",
        project.tags.length ? `tags=${project.tags.join(",")}` : "",
      ].filter(Boolean).join("  "));
      if (project.topTools.length) {
        console.log(`tools: ${project.topTools.slice(0, 4).map((item) => `${item.tool} (${item.count})`).join(" | ")}`);
      }
      if (project.topFiles.length) {
        console.log(`files: ${project.topFiles.slice(0, 4).map((item) => `${item.displayFile || item.file} (${item.count})`).join(" | ")}`);
      }
      if (Array.isArray(project.topFocusRoots) && project.topFocusRoots.length) {
        console.log(`focus-roots: ${project.topFocusRoots.slice(0, 4).map(formatFocusRootLabel).join(" | ")}`);
      }
      const projectLocalPaths = Array.isArray(project.topProjectPaths) && project.topProjectPaths.length
        ? project.topProjectPaths
        : (project.topPaths || []).filter((item) => item.scope !== "external");
      if (projectLocalPaths.length) {
        console.log(`paths: ${projectLocalPaths.slice(0, 4).map((item) => `${item.displayPath || item.path} (${item.count})`).join(" | ")}`);
      }
      const projectExternalPaths = Array.isArray(project.topExternalPaths) ? project.topExternalPaths : [];
      if (projectExternalPaths.length) {
        console.log(`external-paths: ${projectExternalPaths.slice(0, 3).map((item) => `${item.displayPath || item.path} (${item.count})`).join(" | ")}`);
      }
      if (project.manualCounts && (
        project.manualCounts.annotatedSessions ||
        project.manualCounts.annotatedTurns ||
        project.manualCounts.bookmarkedSessions ||
        project.manualCounts.bookmarkedTurns
      )) {
        console.log([
          `manual_sessions=${project.manualCounts.annotatedSessions || 0}`,
          `bookmarked_sessions=${project.manualCounts.bookmarkedSessions || 0}`,
          `manual_turns=${project.manualCounts.annotatedTurns || 0}`,
          `bookmarked_turns=${project.manualCounts.bookmarkedTurns || 0}`,
        ].join("  "));
        if (Array.isArray(project.topManualTags) && project.topManualTags.length) {
          console.log(`manual tags: ${project.topManualTags.map((entry) => `${entry.tag}(${entry.count})`).join(", ")}`);
        }
      }
      if (project.matchedManualCounts && (
        project.matchedManualCounts.annotatedSessions ||
        project.matchedManualCounts.annotatedTurns ||
        project.matchedManualCounts.bookmarkedSessions ||
        project.matchedManualCounts.bookmarkedTurns
      )) {
        console.log([
          `matched_manual_sessions=${project.matchedManualCounts.annotatedSessions || 0}`,
          `matched_bookmarked_sessions=${project.matchedManualCounts.bookmarkedSessions || 0}`,
          `matched_manual_turns=${project.matchedManualCounts.annotatedTurns || 0}`,
          `matched_bookmarked_turns=${project.matchedManualCounts.bookmarkedTurns || 0}`,
        ].join("  "));
        if (Array.isArray(project.matchedTopManualTags) && project.matchedTopManualTags.length) {
          console.log(`matched manual tags: ${project.matchedTopManualTags.map((entry) => `${entry.tag}(${entry.count})`).join(", ")}`);
        }
      }
      if (project.matchReasons && project.matchReasons.length) {
        console.log(`match: ${project.matchReasons.join(", ")}`);
      }
      console.log("");
    }
  }

  function printAreaList(result) {
    if (result.historyMode) {
      console.log(`history mode: ${result.historyMode}`);
      if (result.queryMode) console.log(`query-mode: ${result.queryMode}`);
      console.log("");
    } else if (result.queryMode) {
      console.log(`query-mode: ${result.queryMode}`);
      console.log("");
    }
    if (!Array.isArray(result.areas) || !result.areas.length) {
      console.log("No areas found.");
      return;
    }
    for (const area of result.areas) {
      console.log([
        area.cwd,
        area.root,
        area.updatedAt || "",
      ].filter(Boolean).join(" | "));
      console.log([
        `sessions=${area.sessionCount}`,
        `turns=${area.turnCount}`,
        area.counts && area.counts.commands ? `cmd=${area.counts.commands}` : "",
        area.counts && area.counts.writes ? `write=${area.counts.writes}` : "",
        area.counts && area.counts.searches ? `search=${area.counts.searches}` : "",
        area.counts && area.counts.errors ? `error=${area.counts.errors}` : "",
        Array.isArray(area.matchReasons) && area.matchReasons.length ? `reasons=${area.matchReasons.join(",")}` : "",
      ].filter(Boolean).join("  "));
      if (Array.isArray(area.topTools) && area.topTools.length) {
        console.log(`tools: ${area.topTools.slice(0, 4).map((item) => `${item.tool} (${item.count})`).join(" | ")}`);
      }
      if (Array.isArray(area.topFiles) && area.topFiles.length) {
        console.log(`files: ${area.topFiles.slice(0, 4).map((item) => `${item.displayFile || item.file} (${item.count})`).join(" | ")}`);
      }
      if (Array.isArray(area.topPaths) && area.topPaths.length) {
        console.log(`paths: ${area.topPaths.slice(0, 4).map((item) => `${item.displayPath || item.path} (${item.count})`).join(" | ")}`);
      }
      if (Array.isArray(area.recentSessions) && area.recentSessions.length) {
        console.log(`recent: ${area.recentSessions.slice(0, 3).map((item) => formatAreaRecentSession(item, area.root)).filter(Boolean).join(" | ")}`);
      }
      if (area.manualCounts && (
        area.manualCounts.annotatedSessions ||
        area.manualCounts.annotatedTurns ||
        area.manualCounts.bookmarkedSessions ||
        area.manualCounts.bookmarkedTurns
      )) {
        console.log([
          `manual_sessions=${area.manualCounts.annotatedSessions || 0}`,
          `bookmarked_sessions=${area.manualCounts.bookmarkedSessions || 0}`,
          `manual_turns=${area.manualCounts.annotatedTurns || 0}`,
          `bookmarked_turns=${area.manualCounts.bookmarkedTurns || 0}`,
        ].join("  "));
        if (Array.isArray(area.topManualTags) && area.topManualTags.length) {
          console.log(`manual tags: ${area.topManualTags.map((entry) => `${entry.tag}(${entry.count})`).join(", ")}`);
        }
      }
      console.log("");
    }
  }

  function printAreaDetail(result) {
    if (result.queryMode) console.log(`query-mode: ${result.queryMode}`);
    console.log([
      result.cwd,
      result.root || "",
      result.projectUpdatedAt || result.projectStartedAt || "",
      result.historyMode ? `history=${result.historyMode}` : "",
      result.areaMatched === false ? "matched=false" : "",
    ].filter(Boolean).join(" | "));
    console.log([
      `project_sessions=${result.projectSessionCount}`,
      `project_turns=${result.projectTurnCount}`,
      `matched_sessions=${result.matchedSessionCount}`,
      `matched_turns=${result.matchedTurnCount}`,
    ].join("  "));
    if (result.area && result.area.counts) {
      console.log([
        `commands=${result.area.counts.commands || 0}`,
        `writes=${result.area.counts.writes || 0}`,
        `searches=${result.area.counts.searches || 0}`,
        `errors=${result.area.counts.errors || 0}`,
      ].join("  "));
      if (Array.isArray(result.area.topTools) && result.area.topTools.length) {
        console.log(`tools: ${result.area.topTools.map((item) => `${item.tool} (${item.count})`).join(" | ")}`);
      }
      if (Array.isArray(result.area.topFiles) && result.area.topFiles.length) {
        console.log(`files: ${result.area.topFiles.map((item) => `${item.displayFile || item.file} (${item.count})`).join(" | ")}`);
      }
      if (Array.isArray(result.area.topPaths) && result.area.topPaths.length) {
        console.log(`paths: ${result.area.topPaths.map((item) => `${item.displayPath || item.path} (${item.count})`).join(" | ")}`);
      }
      if (Array.isArray(result.area.recentSessions) && result.area.recentSessions.length) {
        console.log(`recent: ${result.area.recentSessions.slice(0, 3).map((item) => formatAreaRecentSession(item, result.root)).filter(Boolean).join(" | ")}`);
      }
    } else {
      console.log("area summary unavailable for the current matched slice");
    }
    if (result.manual && (
      result.manual.annotatedSessions ||
      result.manual.annotatedTurns ||
      result.manual.bookmarkedSessions ||
      result.manual.bookmarkedTurns
    )) {
      console.log([
        `manual_sessions=${result.manual.annotatedSessions || 0}`,
        `bookmarked_sessions=${result.manual.bookmarkedSessions || 0}`,
        `manual_turns=${result.manual.annotatedTurns || 0}`,
        `bookmarked_turns=${result.manual.bookmarkedTurns || 0}`,
      ].join("  "));
      if (Array.isArray(result.manual.topTags) && result.manual.topTags.length) {
        console.log(`manual tags: ${result.manual.topTags.map((entry) => `${entry.tag}(${entry.count})`).join(", ")}`);
      }
    }
    console.log("");

    if (result.manual && Array.isArray(result.manual.sessionHighlights) && result.manual.sessionHighlights.length) {
      console.log("manual session highlights:");
      for (const session of result.manual.sessionHighlights) {
        console.log(`  ${[
          session.sessionId,
          session.updatedAt || session.startedAt || "",
          session.model ? `model=${session.model}` : "",
        ].filter(Boolean).join(" | ")}`);
        if (session.lastUserPreview) console.log(`  user: ${session.lastUserPreview}`);
        if (session.finalAnswerPreview) console.log(`  answer: ${session.finalAnswerPreview}`);
        else if (session.commentaryPreview) console.log(`  commentary: ${session.commentaryPreview}`);
        printAnnotationLines(session.annotation, "  manual");
        console.log("");
      }
      if ((result.manual.sessionHighlightCount || 0) > result.manual.sessionHighlights.length) console.log("  ...");
    }

    if (result.manual && Array.isArray(result.manual.turnHighlights) && result.manual.turnHighlights.length) {
      console.log("manual turn highlights:");
      for (const turn of result.manual.turnHighlights) {
        console.log(`  ${[
          turn.sessionId,
          turn.turnId,
          turn.status,
          turn.startedAt || turn.endedAt || "",
        ].filter(Boolean).join(" | ")}`);
        if (turn.userPromptPreview) console.log(`  user: ${turn.userPromptPreview}`);
        if (turn.finalAnswerPreview) console.log(`  answer: ${turn.finalAnswerPreview}`);
        else if (turn.commentaryPreview) console.log(`  commentary: ${turn.commentaryPreview}`);
        else if (turn.summary) console.log(`  summary: ${turn.summary}`);
        printAnnotationLines(turn.annotation, "  manual");
        console.log("");
      }
      if ((result.manual.turnHighlightCount || 0) > result.manual.turnHighlights.length) console.log("  ...");
    }

    if (result.sessions.length) {
      console.log("sessions:");
      for (const session of result.sessions) {
        console.log(`  ${[
          session.sessionId,
          session.updatedAt || session.startedAt || "",
          session.model ? `model=${session.model}` : "",
          session.focusRoot ? `focus=${session.focusRoot}` : "",
        ].filter(Boolean).join(" | ")}`);
        if (session.lastUserPreview) console.log(`  user: ${session.lastUserPreview}`);
        if (session.finalAnswerPreview) console.log(`  answer: ${session.finalAnswerPreview}`);
        else if (session.commentaryPreview) console.log(`  commentary: ${session.commentaryPreview}`);
        printAnnotationLines(session.annotation, "  manual");
        const matchedSessionFiles = getMatchedFiles(session);
        if (matchedSessionFiles.length) console.log(`  matched-files: ${formatPathValueList(matchedSessionFiles, session.cwd || result.cwd || "", 6)}`);
        const matchedSessionPaths = getMatchedPaths(session);
        if (matchedSessionPaths.length) console.log(`  matched-paths: ${formatPathValueList(matchedSessionPaths, session.cwd || result.cwd || "", 6)}`);
        const matchedSessionPathPatterns = getMatchedPathPatterns(session);
        if (matchedSessionPathPatterns.length) console.log(`  matched-path-patterns: ${formatValueList(matchedSessionPathPatterns, 6)}`);
        const matchedSessionCommandOps = getMatchedCommandOps(session);
        if (matchedSessionCommandOps.length) console.log(`  matched-command-ops: ${formatValueList(matchedSessionCommandOps, 6)}`);
        const matchedSessionQueries = getMatchedQueries(session);
        if (matchedSessionQueries.length) console.log(`  matched-queries: ${formatQueryValueList(matchedSessionQueries, 6)}`);
        const sessionCommandOps = getEntityCommandOps(session);
        if (sessionCommandOps.length) console.log(`  command-ops: ${formatValueList(sessionCommandOps, 6)}`);
      }
      if (result.truncatedSessions) console.log("  ...");
      console.log("");
    }

    if (result.turns.length) {
      console.log("turns:");
      for (const turn of result.turns) {
        console.log(`  ${[
          turn.sessionId,
          turn.turnId,
          turn.status,
          turn.focusRoot ? `focus=${turn.focusRoot}` : "",
          turn.startedAt || turn.endedAt || "",
        ].filter(Boolean).join(" | ")}`);
        if (turn.userPromptPreview) console.log(`  user: ${turn.userPromptPreview}`);
        if (turn.finalAnswerPreview) console.log(`  answer: ${turn.finalAnswerPreview}`);
        else if (turn.commentaryPreview) console.log(`  commentary: ${turn.commentaryPreview}`);
        else if (turn.summary) console.log(`  summary: ${turn.summary}`);
        printAnnotationLines(turn.annotation, "  manual");
        if (turn.filesTouched.length) console.log(`  files: ${formatPathValueList(turn.filesTouched, turn.cwd || result.cwd || "", turn.filesTouched.length)}`);
        const matchedTurnFiles = getMatchedFiles(turn);
        if (matchedTurnFiles.length) console.log(`  matched-files: ${formatPathValueList(matchedTurnFiles, turn.cwd || result.cwd || "", 6)}`);
        if (turn.pathsReferenced && turn.pathsReferenced.length) console.log(`  paths: ${formatPathValueList(turn.pathsReferenced, turn.cwd || result.cwd || "", turn.pathsReferenced.length)}`);
        const matchedTurnPaths = getMatchedPaths(turn);
        if (matchedTurnPaths.length) console.log(`  matched-paths: ${formatPathValueList(matchedTurnPaths, turn.cwd || result.cwd || "", 6)}`);
        const matchedTurnPathPatterns = getMatchedPathPatterns(turn);
        if (matchedTurnPathPatterns.length) console.log(`  matched-path-patterns: ${formatValueList(matchedTurnPathPatterns, 6)}`);
        const turnPathRoles = formatPathRoleSummary(turn.pathRoles, 2, turn.cwd || result.cwd || "");
        if (turnPathRoles) console.log(`  path-roles: ${turnPathRoles}`);
        if (turn.toolsUsed.length) console.log(`  tools: ${turn.toolsUsed.join(", ")}`);
        if (turn.commandTypes && turn.commandTypes.length) console.log(`  command-types: ${turn.commandTypes.join(", ")}`);
        const matchedTurnCommandOps = getMatchedCommandOps(turn);
        if (matchedTurnCommandOps.length) console.log(`  matched-command-ops: ${formatValueList(matchedTurnCommandOps, 6)}`);
        const matchedTurnQueries = getMatchedQueries(turn);
        if (matchedTurnQueries.length) console.log(`  matched-queries: ${formatQueryValueList(matchedTurnQueries, 6)}`);
        const turnCommandOps = getEntityCommandOps(turn);
        if (turnCommandOps.length) console.log(`  command-ops: ${formatValueList(turnCommandOps, 6)}`);
        if (turn.matchReasons && turn.matchReasons.length) console.log(`  match: ${turn.matchReasons.join(", ")}`);
      }
      if (result.truncatedTurns) console.log("  ...");
    }
  }

  function printProjectDetail(project) {
    if (project.queryMode) console.log(`query-mode: ${project.queryMode}`);
    console.log([project.cwd, project.updatedAt || project.startedAt || "", project.historyMode ? `history=${project.historyMode}` : ""].filter(Boolean).join(" | "));
    console.log([
      `sessions=${project.sessionCount}`,
      `matched_sessions=${project.matchedSessionCount}`,
      `turns=${project.turnCount}`,
      `matched_turns=${project.matchedTurnCount}`,
    ].join("  "));
    console.log([
      `commands=${project.counts.commands}`,
      `patches=${project.counts.patches}`,
      `searches=${project.counts.searches}`,
      `mcp=${project.counts.mcp}`,
      `errors=${project.counts.errors}`,
    ].join("  "));
    if (project.tags.length) console.log(`tags: ${project.tags.join(", ")}`);
    if (project.models.length) {
      console.log(`models: ${project.models.map((item) => `${item.model} (${item.count})`).join(" | ")}`);
    }
    if (project.topTools.length) {
      console.log(`tools: ${project.topTools.map((item) => `${item.tool} (${item.count})`).join(" | ")}`);
    }
    if (project.topFiles.length) {
      console.log(`files: ${project.topFiles.map((item) => `${item.displayFile || item.file} (${item.count})`).join(" | ")}`);
    }
    if (Array.isArray(project.topFocusRoots) && project.topFocusRoots.length) {
      console.log(`focus-roots: ${project.topFocusRoots.map(formatFocusRootLabel).join(" | ")}`);
    }
    const projectLocalPaths = Array.isArray(project.topProjectPaths) && project.topProjectPaths.length
      ? project.topProjectPaths
      : (project.topPaths || []).filter((item) => item.scope !== "external");
    if (projectLocalPaths.length) {
      console.log(`paths: ${projectLocalPaths.map((item) => `${item.displayPath || item.path} (${item.count})`).join(" | ")}`);
    }
    const projectExternalPaths = Array.isArray(project.topExternalPaths) ? project.topExternalPaths : [];
    if (projectExternalPaths.length) {
      console.log(`external-paths: ${projectExternalPaths.map((item) => `${item.displayPath || item.path} (${item.count})`).join(" | ")}`);
    }
    if (project.topErrors.length) {
      console.log(`errors: ${project.topErrors.map((item) => `${item.error} (${item.count})`).join(" | ")}`);
    }
    if (project.selectedArea) {
      console.log(`selected-area: ${project.selectedArea}${project.selectedAreaMatched === false ? " (no matched area)" : ""}`);
    }
    if (Array.isArray(project.areas) && project.areas.length) {
      console.log([
        `areas=${project.areaCount || project.areas.length}`,
        project.unscopedAreaCounts && (project.unscopedAreaCounts.sessions || project.unscopedAreaCounts.turns)
          ? `unscoped_sessions=${project.unscopedAreaCounts.sessions || 0}`
          : "",
        project.unscopedAreaCounts && (project.unscopedAreaCounts.sessions || project.unscopedAreaCounts.turns)
          ? `unscoped_turns=${project.unscopedAreaCounts.turns || 0}`
          : "",
      ].filter(Boolean).join("  "));
      for (const area of project.areas) {
        console.log(`  ${[
          area.root,
          `sessions=${area.sessionCount}`,
          `turns=${area.turnCount}`,
          area.counts && area.counts.commands ? `cmd=${area.counts.commands}` : "",
          area.counts && area.counts.writes ? `write=${area.counts.writes}` : "",
          area.counts && area.counts.searches ? `search=${area.counts.searches}` : "",
          area.counts && area.counts.errors ? `error=${area.counts.errors}` : "",
        ].filter(Boolean).join(" | ")}`);
        if (Array.isArray(area.topTools) && area.topTools.length) {
          console.log(`  tools: ${area.topTools.map((item) => `${item.tool} (${item.count})`).join(" | ")}`);
        }
        if (Array.isArray(area.topFiles) && area.topFiles.length) {
          console.log(`  files: ${area.topFiles.map((item) => `${item.displayFile || item.file} (${item.count})`).join(" | ")}`);
        }
        if (Array.isArray(area.topPaths) && area.topPaths.length) {
          console.log(`  paths: ${area.topPaths.map((item) => `${item.displayPath || item.path} (${item.count})`).join(" | ")}`);
        }
      }
      if (project.truncatedAreas) console.log("  ...");
      console.log("");
    }
    if (project.unscopedAreaReasons && (
      (Array.isArray(project.unscopedAreaReasons.sessions) && project.unscopedAreaReasons.sessions.length) ||
      (Array.isArray(project.unscopedAreaReasons.turns) && project.unscopedAreaReasons.turns.length)
    )) {
      if (Array.isArray(project.unscopedAreaReasons.sessions) && project.unscopedAreaReasons.sessions.length) {
        console.log(`unscoped session reasons: ${project.unscopedAreaReasons.sessions.map((item) => `${item.reason} (${item.count})`).join(" | ")}`);
      }
      if (Array.isArray(project.unscopedAreaReasons.turns) && project.unscopedAreaReasons.turns.length) {
        console.log(`unscoped turn reasons: ${project.unscopedAreaReasons.turns.map((item) => `${item.reason} (${item.count})`).join(" | ")}`);
      }
      console.log("");
    }
    if (project.unscopedAreaSamples && Array.isArray(project.unscopedAreaSamples.sessions) && project.unscopedAreaSamples.sessions.length) {
      console.log("unscoped sessions:");
      for (const session of project.unscopedAreaSamples.sessions) {
        console.log(`  ${[
          session.sessionId,
          session.updatedAt || "",
          session.model ? `model=${session.model}` : "",
          session.reason ? `reason=${session.reason}` : "",
          Number.isInteger(session.turnCount) ? `turns=${session.turnCount}` : "",
        ].filter(Boolean).join(" | ")}`);
        if (session.preview) console.log(`  preview: ${session.preview}`);
        console.log("");
      }
    }
    if (project.unscopedAreaSamples && Array.isArray(project.unscopedAreaSamples.turns) && project.unscopedAreaSamples.turns.length) {
      console.log("unscoped turns:");
      for (const turn of project.unscopedAreaSamples.turns) {
        console.log(`  ${[
          turn.sessionId,
          turn.turnId,
          turn.startedAt || turn.endedAt || "",
          turn.status ? `status=${turn.status}` : "",
          turn.reason ? `reason=${turn.reason}` : "",
        ].filter(Boolean).join(" | ")}`);
        if (turn.preview) console.log(`  preview: ${turn.preview}`);
        console.log("");
      }
    }
    if (project.manual && (
      project.manual.annotatedSessions ||
      project.manual.annotatedTurns ||
      project.manual.bookmarkedSessions ||
      project.manual.bookmarkedTurns
    )) {
      console.log([
        `manual_sessions=${project.manual.annotatedSessions || 0}`,
        `bookmarked_sessions=${project.manual.bookmarkedSessions || 0}`,
        `manual_turns=${project.manual.annotatedTurns || 0}`,
        `bookmarked_turns=${project.manual.bookmarkedTurns || 0}`,
      ].join("  "));
      if (Array.isArray(project.manual.topTags) && project.manual.topTags.length) {
        console.log(`manual tags: ${project.manual.topTags.map((entry) => `${entry.tag}(${entry.count})`).join(", ")}`);
      }
    }
    console.log("");

    if (project.manual && Array.isArray(project.manual.sessionHighlights) && project.manual.sessionHighlights.length) {
      console.log("manual session highlights:");
      for (const session of project.manual.sessionHighlights) {
        console.log(`  ${[
          session.sessionId,
          session.updatedAt || session.startedAt || "",
          session.model ? `model=${session.model}` : "",
        ].filter(Boolean).join(" | ")}`);
        if (session.lastUserPreview) console.log(`  user: ${session.lastUserPreview}`);
        if (session.finalAnswerPreview) console.log(`  answer: ${session.finalAnswerPreview}`);
        else if (session.commentaryPreview) console.log(`  commentary: ${session.commentaryPreview}`);
        printAnnotationLines(session.annotation, "  manual");
        console.log("");
      }
      if ((project.manual.sessionHighlightCount || 0) > project.manual.sessionHighlights.length) console.log("  ...");
    }

    if (project.manual && Array.isArray(project.manual.turnHighlights) && project.manual.turnHighlights.length) {
      console.log("manual turn highlights:");
      for (const turn of project.manual.turnHighlights) {
        console.log(`  ${[
          turn.sessionId,
          turn.turnId,
          turn.status,
          turn.startedAt || turn.endedAt || "",
        ].filter(Boolean).join(" | ")}`);
        if (turn.userPromptPreview) console.log(`  user: ${turn.userPromptPreview}`);
        if (turn.finalAnswerPreview) console.log(`  answer: ${turn.finalAnswerPreview}`);
        else if (turn.commentaryPreview) console.log(`  commentary: ${turn.commentaryPreview}`);
        else if (turn.summary) console.log(`  summary: ${turn.summary}`);
        printAnnotationLines(turn.annotation, "  manual");
        console.log("");
      }
      if ((project.manual.turnHighlightCount || 0) > project.manual.turnHighlights.length) console.log("  ...");
    }

    if (project.sessions.length) {
      console.log("sessions:");
      for (const session of project.sessions) {
        console.log(`  ${[
          session.sessionId,
          session.updatedAt || session.startedAt || "",
          session.model ? `model=${session.model}` : "",
          session.focusRoot ? `focus=${session.focusRoot}` : "",
        ].filter(Boolean).join(" | ")}`);
        if (session.lineageRootId && session.lineageRootId !== session.sessionId) {
          console.log(`  lineage: root=${session.lineageRootId}${session.lineageDepth ? ` depth=${session.lineageDepth}` : ""}`);
        }
        if (session.lastUserPreview) console.log(`  user: ${session.lastUserPreview}`);
        if (session.finalAnswerPreview) console.log(`  answer: ${session.finalAnswerPreview}`);
        else if (session.commentaryPreview) console.log(`  commentary: ${session.commentaryPreview}`);
        printAnnotationLines(session.annotation, "  manual");
        const matchedSessionFiles = getMatchedFiles(session);
        if (matchedSessionFiles.length) console.log(`  matched-files: ${formatValueList(matchedSessionFiles, 6)}`);
        const matchedSessionPaths = getMatchedPaths(session);
        if (matchedSessionPaths.length) console.log(`  matched-paths: ${formatValueList(matchedSessionPaths, 6)}`);
        const matchedSessionPathPatterns = getMatchedPathPatterns(session);
        if (matchedSessionPathPatterns.length) console.log(`  matched-path-patterns: ${formatValueList(matchedSessionPathPatterns, 6)}`);
        const matchedSessionCommandOps = getMatchedCommandOps(session);
        if (matchedSessionCommandOps.length) console.log(`  matched-command-ops: ${formatValueList(matchedSessionCommandOps, 6)}`);
        const matchedSessionQueries = getMatchedQueries(session);
        if (matchedSessionQueries.length) console.log(`  matched-queries: ${formatQueryValueList(matchedSessionQueries, 6)}`);
        const sessionCommandOps = getEntityCommandOps(session);
        if (sessionCommandOps.length) console.log(`  command-ops: ${formatValueList(sessionCommandOps, 6)}`);
      }
      if (project.truncatedSessions) console.log("  ...");
      console.log("");
    }

    if (project.turns.length) {
      console.log("turns:");
      for (const turn of project.turns) {
        console.log(`  ${[
          turn.sessionId,
          turn.turnId,
          turn.status,
          turn.focusRoot ? `focus=${turn.focusRoot}` : "",
          turn.startedAt || turn.endedAt || "",
        ].filter(Boolean).join(" | ")}`);
        if (turn.lineageRootId && turn.lineageRootId !== turn.sessionId) {
          console.log(`  lineage: root=${turn.lineageRootId}${turn.lineageDepth ? ` depth=${turn.lineageDepth}` : ""}`);
        }
        if (turn.userPromptPreview) console.log(`  user: ${turn.userPromptPreview}`);
        if (turn.finalAnswerPreview) console.log(`  answer: ${turn.finalAnswerPreview}`);
        else if (turn.commentaryPreview) console.log(`  commentary: ${turn.commentaryPreview}`);
        else if (turn.summary) console.log(`  summary: ${turn.summary}`);
        printAnnotationLines(turn.annotation, "  manual");
        if (turn.filesTouched.length) console.log(`  files: ${turn.filesTouched.join(", ")}`);
        const matchedTurnFiles = getMatchedFiles(turn);
        if (matchedTurnFiles.length) console.log(`  matched-files: ${formatValueList(matchedTurnFiles, 6)}`);
        if (turn.pathsReferenced && turn.pathsReferenced.length) console.log(`  paths: ${turn.pathsReferenced.join(", ")}`);
        const matchedTurnPaths = getMatchedPaths(turn);
        if (matchedTurnPaths.length) console.log(`  matched-paths: ${formatValueList(matchedTurnPaths, 6)}`);
        const matchedTurnPathPatterns = getMatchedPathPatterns(turn);
        if (matchedTurnPathPatterns.length) console.log(`  matched-path-patterns: ${formatValueList(matchedTurnPathPatterns, 6)}`);
        const turnPathRoles = formatPathRoleSummary(turn.pathRoles, 2, turn.cwd || project.cwd || "");
        if (turnPathRoles) console.log(`  path-roles: ${turnPathRoles}`);
        if (turn.toolsUsed.length) console.log(`  tools: ${turn.toolsUsed.join(", ")}`);
        if (turn.commandTypes && turn.commandTypes.length) console.log(`  command-types: ${turn.commandTypes.join(", ")}`);
        const matchedTurnCommandOps = getMatchedCommandOps(turn);
        if (matchedTurnCommandOps.length) console.log(`  matched-command-ops: ${formatValueList(matchedTurnCommandOps, 6)}`);
        const matchedTurnQueries = getMatchedQueries(turn);
        if (matchedTurnQueries.length) console.log(`  matched-queries: ${formatQueryValueList(matchedTurnQueries, 6)}`);
        const turnCommandOps = getEntityCommandOps(turn);
        if (turnCommandOps.length) console.log(`  command-ops: ${formatValueList(turnCommandOps, 6)}`);
        if (turn.matchReasons && turn.matchReasons.length) console.log(`  match: ${turn.matchReasons.join(", ")}`);
      }
      if (project.truncatedTurns) console.log("  ...");
    }
  }

  function printTurnSearch(result) {
    console.log([
      `turns=${result.total}`,
      `sessions=${result.sessionCount}`,
      result.historyMode ? `history=${result.historyMode}` : "",
      result.queryMode ? `query-mode=${result.queryMode}` : "",
    ].filter(Boolean).join("  "));
    console.log("");

    for (const turn of result.turns) {
      console.log([
        turn.sessionId,
        turn.sessionKey ? `rollout=${turn.sessionKey}` : "",
        turn.lineageRootId && turn.lineageRootId !== turn.sessionId ? `root=${turn.lineageRootId}` : "",
        turn.lineageDepth ? `depth=${turn.lineageDepth}` : "",
        turn.turnId,
        turn.status,
        turn.startedAt || turn.endedAt || "",
        turn.cwd || "",
        turn.model ? `model=${turn.model}` : "",
      ].filter(Boolean).join(" | "));
      if (turn.userPromptPreview) console.log(`user: ${turn.userPromptPreview}`);
      if (turn.finalAnswerPreview) console.log(`answer: ${turn.finalAnswerPreview}`);
      else if (turn.commentaryPreview) console.log(`commentary: ${turn.commentaryPreview}`);
      else if (turn.summary) console.log(`summary: ${turn.summary}`);
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
      if (turn.toolsUsed.length) console.log(`tools: ${turn.toolsUsed.join(", ")}`);
      if (turn.commandTypes && turn.commandTypes.length) console.log(`command-types: ${turn.commandTypes.join(", ")}`);
      const matchedTurnCommandOps = getMatchedCommandOps(turn);
      if (matchedTurnCommandOps.length) console.log(`matched-command-ops: ${formatValueList(matchedTurnCommandOps, 6)}`);
      const matchedTurnQueries = getMatchedQueries(turn);
      if (matchedTurnQueries.length) console.log(`matched-queries: ${formatQueryValueList(matchedTurnQueries, 6)}`);
      const turnCommandOps = getEntityCommandOps(turn);
      if (turnCommandOps.length) console.log(`command-ops: ${formatValueList(turnCommandOps, 6)}`);
      if (turn.matchReasons && turn.matchReasons.length) console.log(`match: ${turn.matchReasons.join(", ")}`);
      console.log("");
    }
  }

  function printFamilyDetail(result) {
    if (result.queryMode) console.log(`query-mode: ${result.queryMode}`);
    console.log([
      result.lineageRootId,
      result.sourceSessionId ? `source=${result.sourceSessionId}` : "",
      `sessions=${result.familySessionCount}`,
      `matched_sessions=${result.matchedSessionCount}`,
      `matched_turns=${result.matchedTurnCount}`,
      result.historyMode ? `history=${result.historyMode}` : "",
    ].filter(Boolean).join(" | "));
    if (result.rootSession) {
      console.log([
        result.rootSession.cwd ? `cwd=${result.rootSession.cwd}` : "",
        result.rootSession.model ? `model=${result.rootSession.model}` : "",
        result.rootSession.updatedAt || result.rootSession.startedAt || "",
      ].filter(Boolean).join("  "));
      if (result.rootSession.lastUserPreview) console.log(`root user: ${result.rootSession.lastUserPreview}`);
      if (result.rootSession.finalAnswerPreview) console.log(`root answer: ${result.rootSession.finalAnswerPreview}`);
      else if (result.rootSession.commentaryPreview) console.log(`root commentary: ${result.rootSession.commentaryPreview}`);
    }
    console.log([
      `forked=${result.counts.forked}`,
      `subagents=${result.counts.subagents}`,
      `max_depth=${result.counts.maxDepth}`,
    ].join("  "));
    console.log("");

    if (result.sessions.length) {
      console.log("sessions:");
      for (const session of result.sessions) {
        console.log(`  ${[
          session.sessionId,
          session.sessionKey ? `rollout=${session.sessionKey}` : "",
          session.updatedAt || session.startedAt || "",
          session.model ? `model=${session.model}` : "",
        ].filter(Boolean).join(" | ")}`);
        console.log(`  lineage: root=${session.lineageRootId || session.sessionId}${session.lineageDepth ? ` depth=${session.lineageDepth}` : ""}${session.forkedFromId ? ` forked_from=${session.forkedFromId}` : ""}${session.parentThreadId ? ` parent=${session.parentThreadId}` : ""}`);
        if (session.lastUserPreview) console.log(`  user: ${session.lastUserPreview}`);
        if (session.finalAnswerPreview) console.log(`  answer: ${session.finalAnswerPreview}`);
        else if (session.commentaryPreview) console.log(`  commentary: ${session.commentaryPreview}`);
        const matchedSessionFiles = getMatchedFiles(session);
        if (matchedSessionFiles.length) console.log(`  matched-files: ${formatPathValueList(matchedSessionFiles, session.cwd || "", 6)}`);
        const matchedSessionPaths = getMatchedPaths(session);
        if (matchedSessionPaths.length) console.log(`  matched-paths: ${formatPathValueList(matchedSessionPaths, session.cwd || "", 6)}`);
        const matchedSessionPathPatterns = getMatchedPathPatterns(session);
        if (matchedSessionPathPatterns.length) console.log(`  matched-path-patterns: ${formatValueList(matchedSessionPathPatterns, 6)}`);
        const matchedSessionCommandOps = getMatchedCommandOps(session);
        if (matchedSessionCommandOps.length) console.log(`  matched-command-ops: ${formatValueList(matchedSessionCommandOps, 6)}`);
        const matchedSessionQueries = getMatchedQueries(session);
        if (matchedSessionQueries.length) console.log(`  matched-queries: ${formatQueryValueList(matchedSessionQueries, 6)}`);
        console.log("");
      }
      if (result.truncatedSessions) console.log("  ...");
    }

    if (result.turns.length) {
      console.log("turns:");
      for (const turn of result.turns) {
        console.log(`  ${[
          turn.sessionId,
          turn.turnId,
          turn.status,
          turn.startedAt || turn.endedAt || "",
        ].filter(Boolean).join(" | ")}`);
        if (turn.lineageRootId && turn.lineageRootId !== turn.sessionId) {
          console.log(`  lineage: root=${turn.lineageRootId}${turn.lineageDepth ? ` depth=${turn.lineageDepth}` : ""}`);
        }
        if (turn.userPromptPreview) console.log(`  user: ${turn.userPromptPreview}`);
        if (turn.finalAnswerPreview) console.log(`  answer: ${turn.finalAnswerPreview}`);
        else if (turn.commentaryPreview) console.log(`  commentary: ${turn.commentaryPreview}`);
        else if (turn.summary) console.log(`  summary: ${turn.summary}`);
        printAnnotationLines(turn.annotation, "  manual");
        const matchedTurnFiles = getMatchedFiles(turn);
        if (matchedTurnFiles.length) console.log(`  matched-files: ${formatPathValueList(matchedTurnFiles, turn.cwd || "", 6)}`);
        const matchedTurnPaths = getMatchedPaths(turn);
        if (matchedTurnPaths.length) console.log(`  matched-paths: ${formatPathValueList(matchedTurnPaths, turn.cwd || "", 6)}`);
        const matchedTurnPathPatterns = getMatchedPathPatterns(turn);
        if (matchedTurnPathPatterns.length) console.log(`  matched-path-patterns: ${formatValueList(matchedTurnPathPatterns, 6)}`);
        const matchedTurnCommandOps = getMatchedCommandOps(turn);
        if (matchedTurnCommandOps.length) console.log(`  matched-command-ops: ${formatValueList(matchedTurnCommandOps, 6)}`);
        const matchedTurnQueries = getMatchedQueries(turn);
        if (matchedTurnQueries.length) console.log(`  matched-queries: ${formatQueryValueList(matchedTurnQueries, 6)}`);
        console.log("");
      }
      if (result.truncatedTurns) console.log("  ...");
    }
  }

  function printWorkstreamDetail(result) {
    if (result.queryMode) console.log(`query-mode: ${result.queryMode}`);
    console.log([
      result.lineageRootId,
      result.sourceSessionId ? `source=${result.sourceSessionId}` : "",
      result.scopeCwd ? `cwd=${result.scopeCwd}` : "",
      result.selectedArea ? `area=${result.selectedArea}${result.selectedAreaMatched === false ? " (no matched area)" : ""}` : "",
      `family=${result.familySessionCount}`,
      `peers=${result.familyPeerCount != null ? result.familyPeerCount : result.familySessions.length}`,
      `context=${result.contextSessionCount}`,
      `turns=${result.matchedTurnCount}`,
      result.historyMode ? `history=${result.historyMode}` : "",
    ].filter(Boolean).join(" | "));
    if (result.rootSession) {
      console.log([
        result.rootSession.updatedAt || result.rootSession.startedAt || "",
        result.rootSession.model ? `model=${result.rootSession.model}` : "",
      ].filter(Boolean).join("  "));
      if (result.rootSession.lastUserPreview) console.log(`root user: ${result.rootSession.lastUserPreview}`);
      if (result.rootSession.finalAnswerPreview) console.log(`root answer: ${result.rootSession.finalAnswerPreview}`);
      else if (result.rootSession.commentaryPreview) console.log(`root commentary: ${result.rootSession.commentaryPreview}`);
      printAnnotationLines(result.rootSession.annotation, "root manual");
    }
    console.log([
      `forked=${result.counts.forked}`,
      `subagents=${result.counts.subagents}`,
      `max_depth=${result.counts.maxDepth}`,
      `context_roots=${result.counts.contextLineageRoots}`,
    ].join("  "));
    if (result.manual && (
      result.manual.annotatedSessions ||
      result.manual.annotatedTurns ||
      result.manual.bookmarkedSessions ||
      result.manual.bookmarkedTurns
    )) {
      console.log([
        `manual_sessions=${result.manual.annotatedSessions || 0}`,
        `bookmarked_sessions=${result.manual.bookmarkedSessions || 0}`,
        `manual_turns=${result.manual.annotatedTurns || 0}`,
        `bookmarked_turns=${result.manual.bookmarkedTurns || 0}`,
      ].join("  "));
      if (Array.isArray(result.manual.topTags) && result.manual.topTags.length) {
        console.log(`manual tags: ${result.manual.topTags.map((entry) => `${entry.tag}(${entry.count})`).join(", ")}`);
      }
    }
    const pageNotes = [];
    if ((result.familyPeerCount || 0) > 0) {
      pageNotes.push(`family_page=${result.familyOffset || 0}+${result.familySessions.length}/${result.familyPeerCount}`);
    }
    if ((result.contextSessionCount || 0) > 0) {
      pageNotes.push(`context_page=${result.offset || 0}+${result.contextSessions.length}/${result.contextSessionCount}`);
    }
    if (pageNotes.length) console.log(pageNotes.join("  "));
    console.log("");

    if (result.manual && Array.isArray(result.manual.sessionHighlights) && result.manual.sessionHighlights.length) {
      console.log("manual session highlights:");
      for (const session of result.manual.sessionHighlights) {
        console.log(`  ${[
          session.sessionId,
          session.workstreamRole || "",
          session.updatedAt || session.startedAt || "",
        ].filter(Boolean).join(" | ")}`);
        if (session.lastUserPreview) console.log(`  user: ${session.lastUserPreview}`);
        if (session.finalAnswerPreview) console.log(`  answer: ${session.finalAnswerPreview}`);
        else if (session.commentaryPreview) console.log(`  commentary: ${session.commentaryPreview}`);
        printAnnotationLines(session.annotation, "  manual");
        console.log("");
      }
      if ((result.manual.sessionHighlightCount || 0) > result.manual.sessionHighlights.length) console.log("  ...");
    }

    if (result.manual && Array.isArray(result.manual.turnHighlights) && result.manual.turnHighlights.length) {
      console.log("manual turn highlights:");
      for (const turn of result.manual.turnHighlights) {
        console.log(`  ${[
          turn.sessionId,
          turn.turnId,
          turn.workstreamRole || "",
          turn.startedAt || turn.endedAt || "",
        ].filter(Boolean).join(" | ")}`);
        if (turn.userPromptPreview) console.log(`  user: ${turn.userPromptPreview}`);
        if (turn.finalAnswerPreview) console.log(`  answer: ${turn.finalAnswerPreview}`);
        else if (turn.commentaryPreview) console.log(`  commentary: ${turn.commentaryPreview}`);
        else if (turn.summary) console.log(`  summary: ${turn.summary}`);
        printAnnotationLines(turn.annotation, "  manual");
        console.log("");
      }
      if ((result.manual.turnHighlightCount || 0) > result.manual.turnHighlights.length) console.log("  ...");
    }

    if (result.familySessions.length) {
      console.log("family peers:");
      for (const session of result.familySessions) {
        console.log(`  ${[
          session.sessionId,
          session.updatedAt || session.startedAt || "",
          session.sessionId === result.sourceSessionId ? "source" : "",
          session.workstreamRole || "family",
        ].filter(Boolean).join(" | ")}`);
        console.log(`  lineage: root=${session.lineageRootId || session.sessionId}${session.lineageDepth ? ` depth=${session.lineageDepth}` : ""}${session.forkedFromId ? ` forked_from=${session.forkedFromId}` : ""}${session.parentThreadId ? ` parent=${session.parentThreadId}` : ""}`);
        if (session.lastUserPreview) console.log(`  user: ${session.lastUserPreview}`);
        if (session.finalAnswerPreview) console.log(`  answer: ${session.finalAnswerPreview}`);
        else if (session.commentaryPreview) console.log(`  commentary: ${session.commentaryPreview}`);
        printAnnotationLines(session.annotation, "  manual");
        const matchedSessionFiles = getMatchedFiles(session);
        if (matchedSessionFiles.length) console.log(`  matched-files: ${formatPathValueList(matchedSessionFiles, session.cwd || result.scopeCwd || "", 6)}`);
        const matchedSessionPaths = getMatchedPaths(session);
        if (matchedSessionPaths.length) console.log(`  matched-paths: ${formatPathValueList(matchedSessionPaths, session.cwd || result.scopeCwd || "", 6)}`);
        const matchedSessionCommandOps = getMatchedCommandOps(session);
        if (matchedSessionCommandOps.length) console.log(`  matched-command-ops: ${formatValueList(matchedSessionCommandOps, 6)}`);
        const matchedSessionQueries = getMatchedQueries(session);
        if (matchedSessionQueries.length) console.log(`  matched-queries: ${formatQueryValueList(matchedSessionQueries, 6)}`);
        console.log("");
      }
      if (result.truncatedFamilySessions) console.log("  ...");
    }

    if (result.contextSessions.length) {
      console.log("context sessions:");
      for (const session of result.contextSessions) {
        console.log(`  ${[
          session.sessionId,
          session.updatedAt || session.startedAt || "",
          `related=${session.relatedScore || 0}`,
        ].filter(Boolean).join(" | ")}`);
        if (Array.isArray(session.linkedSessions) && session.linkedSessions.length) {
          console.log(`  linked: ${formatValueList(session.linkedSessions, 6)}`);
        }
        if (session.lastUserPreview) console.log(`  user: ${session.lastUserPreview}`);
        if (session.finalAnswerPreview) console.log(`  answer: ${session.finalAnswerPreview}`);
        else if (session.commentaryPreview) console.log(`  commentary: ${session.commentaryPreview}`);
        printAnnotationLines(session.annotation, "  manual");
        if (session.shared) {
          if (session.shared.files && session.shared.files.length) console.log(`  shared-files: ${formatPathValueList(session.shared.files, session.cwd || result.scopeCwd || "", 6)}`);
          if (session.shared.paths && session.shared.paths.length) console.log(`  shared-paths: ${formatPathValueList(session.shared.paths, session.cwd || result.scopeCwd || "", 6)}`);
          if (session.shared.queries && session.shared.queries.length) console.log(`  shared-queries: ${formatQueryValueList(session.shared.queries, 6)}`);
          if (session.shared.commands && session.shared.commands.length) console.log(`  shared-commands: ${formatValueList(session.shared.commands, 4)}`);
        }
        console.log("");
      }
      if (result.truncatedContextSessions) console.log("  ...");
    }

    if (result.turns.length) {
      console.log("timeline:");
      for (const turn of result.turns) {
        console.log(`  ${[
          turn.sessionId,
          turn.turnId,
          turn.status,
          turn.workstreamRole || "",
          turn.startedAt || turn.endedAt || "",
        ].filter(Boolean).join(" | ")}`);
        if (Array.isArray(turn.relatedKinds) && turn.relatedKinds.length) {
          console.log(`  related: ${turn.relatedKinds.join(", ")}`);
        }
        if (turn.userPromptPreview) console.log(`  user: ${turn.userPromptPreview}`);
        if (turn.finalAnswerPreview) console.log(`  answer: ${turn.finalAnswerPreview}`);
        else if (turn.commentaryPreview) console.log(`  commentary: ${turn.commentaryPreview}`);
        else if (turn.summary) console.log(`  summary: ${turn.summary}`);
        printAnnotationLines(turn.annotation, "  manual");
        const matchedTurnFiles = getMatchedFiles(turn);
        if (matchedTurnFiles.length) console.log(`  matched-files: ${formatPathValueList(matchedTurnFiles, turn.cwd || result.scopeCwd || "", 6)}`);
        const matchedTurnPaths = getMatchedPaths(turn);
        if (matchedTurnPaths.length) console.log(`  matched-paths: ${formatPathValueList(matchedTurnPaths, turn.cwd || result.scopeCwd || "", 6)}`);
        const matchedTurnCommandOps = getMatchedCommandOps(turn);
        if (matchedTurnCommandOps.length) console.log(`  matched-command-ops: ${formatValueList(matchedTurnCommandOps, 6)}`);
        const matchedTurnQueries = getMatchedQueries(turn);
        if (matchedTurnQueries.length) console.log(`  matched-queries: ${formatQueryValueList(matchedTurnQueries, 6)}`);
        console.log("");
      }
      if (result.truncatedTurns) console.log("  ...");
    }
  }

  return {
    printArtifactList,
    printArtifactDetail,
    printArtifactTurnList,
    printPathThread,
    printRelatedSessions,
    printProjectList,
    printAreaList,
    printAreaDetail,
    printProjectDetail,
    printTurnSearch,
    printFamilyDetail,
    printWorkstreamDetail,
  };
}

module.exports = {
  createHistoryCliCatalogView,
};
