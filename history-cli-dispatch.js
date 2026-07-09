"use strict";

function createHistoryCliDispatch(deps = {}) {
  const {
    createHistoryCliError,
    runHistoryBridgeCommand,
    buildOverviewResult,
    buildCatalogQueryFilters,
    buildCatalogArtifactContextFilters,
    buildStructuredMatchFilters,
    buildAnnotationPatchFromArgs,
    hasAnnotationPatch,
    printOverview,
    printSessionList,
    printAreaList,
    printAreaDetail,
    printSchemaProfile,
    printBridgeThreadList,
    printBridgeLoadedThreads,
    printBridgeThread,
    printBridgeThreadLifecycle,
    printPruneCandidates,
    printPrunePreview,
    printForkPrune,
    printTranscript,
    printResume,
    printTurnDetail,
    printTurnSearch,
    printArtifactTurnList,
    printPathThread,
    printRelatedSessions,
    printFamilyDetail,
    printWorkstreamDetail,
    printProjectList,
    printProjectDetail,
    printArtifactList,
    printArtifactDetail,
    printSessionDetail,
    printAnnotationUpdate,
    printTurnList,
    printEventList,
    printStats,
    printDoctor,
  } = deps;

  function requireValue(value, message) {
    if (!value) throw createHistoryCliError(message);
    return value;
  }

  function requireResult(value, message) {
    if (!value) throw createHistoryCliError(message);
    return value;
  }

  async function runHistoryCliCommand(store, args, options = {}) {
    const resultShape = args.json && args.compact ? "compact" : "";
    const bridgeOutput = await runHistoryBridgeCommand(store, args, {
      errorFactory: createHistoryCliError,
    });
    if (bridgeOutput !== undefined) return bridgeOutput;

    if (args.command === "overview") {
      return buildOverviewResult(store, args, { invocationCommand: options.invocationCommand });
    }

    if (args.command === "search" || args.command === "list") {
      return store.listSessions({
        limit: args.limit,
        offset: args.offset,
        ...buildCatalogQueryFilters(args, { includeQMode: true, includeShape: true }),
        shape: resultShape,
        refresh: true,
      });
    }

    if (args.command === "areas") {
      return store.listAreas({
        limit: args.limit,
        offset: args.offset,
        ...buildCatalogQueryFilters(args, { includeShape: true, includeArea: true }),
        shape: resultShape,
        refresh: true,
      });
    }

    if (args.command === "area") {
      const projectCwd = requireValue(args.cwd || args.target, "project cwd is required");
      const areaRoot = requireValue(args.area || args.target2, "area root is required");
      return requireResult(
        store.getArea(projectCwd, areaRoot, {
          limit: args.limit,
          turnLimit: args.turnLimit,
          ...buildCatalogQueryFilters(args),
          refresh: true,
        }),
        `project not found: ${projectCwd}`
      );
    }

    if (args.command === "schema") {
      return store.getSchemaProfile({
        limit: args.limit,
        q: args.q,
        refresh: true,
      });
    }

    if (args.command === "transcript") {
      const sessionId = requireValue(args.target, "session id is required");
      return requireResult(
        await store.getTranscriptResolved(sessionId, {
          limit: args.limit,
          ...buildStructuredMatchFilters(args, { includeKind: true, includeTurn: true }),
          source: args.source,
          historyMode: args.historyMode,
          refresh: true,
        }),
        `session not found: ${sessionId}`
      );
    }

    if (args.command === "resume") {
      const sessionId = requireValue(args.target, "session id is required");
      return requireResult(
        await store.getResumeResolved(sessionId, {
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
          ...buildStructuredMatchFilters(args, { includeTurn: true, includeStatus: true }),
          source: args.source,
          historyMode: args.historyMode,
          refresh: true,
        }),
        `session not found: ${sessionId}`
      );
    }

    if (args.command === "turn") {
      const sessionId = requireValue(args.target, "session id and turn id are required");
      const turnId = requireValue(args.turn || args.target2, "session id and turn id are required");
      return requireResult(
        store.getTurn(sessionId, turnId, {
          limit: args.limit,
          ...buildStructuredMatchFilters(args, { includeKind: true }),
          historyMode: args.historyMode,
          refresh: true,
        }),
        `turn not found: ${sessionId} ${turnId}`
      );
    }

    if (args.command === "turn-search") {
      return store.searchTurns({
        limit: args.limit,
        offset: args.offset,
        ...buildCatalogQueryFilters(args, { includeShape: true, includeStatus: true, includeTurn: true }),
        shape: resultShape,
        refresh: true,
      });
    }

    if (args.command === "artifact-turns") {
      requireValue(args.kind && args.value, "artifact kind and value are required");
      return requireResult(
        store.getArtifactTurns(args.kind, args.value, {
          limit: args.limit,
          offset: args.offset,
          ...buildCatalogArtifactContextFilters(args, {
            includeShape: true,
            includeSessionKey: true,
            includePathRole: true,
            includeCommandOpSignal: true,
            includeStatus: true,
          }),
          shape: resultShape,
          refresh: true,
        }),
        `artifact not found: ${args.kind} ${args.value}`
      );
    }

    if (args.command === "path-thread") {
      const pathValue = requireValue(args.value, "path value is required");
      return requireResult(
        store.getPathThread(pathValue, {
          limit: args.limit,
          eventLimit: args.eventLimit,
          ...buildCatalogArtifactContextFilters(args, {
            includeSessionKey: true,
            includePathRole: true,
            includeTurn: true,
            includeStatus: true,
          }),
          refresh: true,
        }),
        `path not found: ${pathValue}`
      );
    }

    if (args.command === "related") {
      const sessionId = requireValue(args.sessionId || args.target, "session id is required");
      return requireResult(
        store.getRelatedSessions(sessionId, {
          limit: args.limit,
          offset: args.offset,
          cwd: args.cwd,
          shape: resultShape,
          forkedFrom: args.forkedFrom,
          parentThread: args.parentThread,
          lineageRoot: args.lineageRoot,
          memoryMode: args.memoryMode,
          eventMode: args.eventMode,
          qualityClass: args.qualityClass,
          has: args.has,
          bookmarked: args.bookmarked,
          manualTags: args.manualTags,
          historyMode: args.historyMode,
          refresh: true,
        }),
        `session not found: ${sessionId}`
      );
    }

    if (args.command === "family") {
      const sessionRef = requireValue(args.sessionId || args.target, "session id is required");
      return requireResult(
        store.getFamily(sessionRef, {
          limit: args.limit,
          turnLimit: args.turnLimit,
          ...buildCatalogQueryFilters(args),
          refresh: true,
        }),
        `family not found: ${sessionRef}`
      );
    }

    if (args.command === "workstream") {
      const sessionRef = requireValue(args.sessionId || args.target, "session id is required");
      return requireResult(
        store.getWorkstream(sessionRef, {
          limit: args.limit,
          offset: args.offset,
          familyLimit: args.familyLimit,
          familyOffset: args.familyOffset,
          turnLimit: args.turnLimit,
          ...buildCatalogQueryFilters(args, { includeArea: true, includeShape: true }),
          shape: resultShape,
          refresh: true,
        }),
        `workstream not found: ${sessionRef}`
      );
    }

    if (args.command === "projects") {
      return store.listProjects({
        limit: args.limit,
        offset: args.offset,
        ...buildCatalogQueryFilters(args, { includeShape: true }),
        shape: resultShape,
        refresh: true,
      });
    }

    if (args.command === "project") {
      const projectCwd = requireValue(args.cwd || args.target, "project cwd is required");
      return requireResult(
        store.getProject(projectCwd, {
          limit: args.limit,
          turnLimit: args.turnLimit,
          ...buildCatalogQueryFilters(args, { includeArea: true }),
          refresh: true,
        }),
        `project not found: ${projectCwd}`
      );
    }

    if (args.command === "artifacts") {
      return store.listArtifacts({
        limit: args.limit,
        offset: args.offset,
        ...buildCatalogArtifactContextFilters(args, {
          includeQ: true,
          includeShape: true,
          includeKind: true,
          includeSessionKey: true,
          includePathPattern: true,
          includePathRole: true,
          includeCommandOpSignal: true,
        }),
        shape: resultShape,
        refresh: true,
      });
    }

    if (args.command === "artifact") {
      requireValue(args.kind && args.value, "artifact kind and value are required");
      return requireResult(
        store.getArtifact(args.kind, args.value, {
          limit: args.limit,
          offset: args.offset,
          turnLimit: args.turnLimit,
          ...buildCatalogArtifactContextFilters(args, {
            includeShape: true,
            includeSessionKey: true,
            includePathPattern: true,
            includePathRole: true,
            includeCommandOpSignal: true,
          }),
          shape: resultShape,
          refresh: true,
        }),
        `artifact not found: ${args.kind} ${args.value}`
      );
    }

    if (args.command === "session") {
      const sessionId = requireValue(args.target, "session id is required");
      return requireResult(
        store.getSession(sessionId, {
          historyMode: args.historyMode,
          refresh: true,
        }),
        `session not found: ${sessionId}`
      );
    }

    if (args.command === "annotate-session") {
      const sessionId = requireValue(args.sessionId || args.target, "session id is required");
      const patch = buildAnnotationPatchFromArgs(args);
      if (!hasAnnotationPatch(patch)) throw createHistoryCliError("annotation change is required");
      return requireResult(
        store.setSessionAnnotation(sessionId, patch, { refresh: true }),
        `session not found: ${sessionId}`
      );
    }

    if (args.command === "annotate-turn") {
      const sessionId = requireValue(args.sessionId || args.target, "session id and turn id are required");
      const turnId = requireValue(args.turn || args.target2, "session id and turn id are required");
      const patch = buildAnnotationPatchFromArgs(args);
      if (!hasAnnotationPatch(patch)) throw createHistoryCliError("annotation change is required");
      return requireResult(
        store.setTurnAnnotation(sessionId, turnId, patch, { refresh: true }),
        `turn not found: ${sessionId} ${turnId}`
      );
    }

    if (args.command === "turns") {
      const sessionId = requireValue(args.target, "session id is required");
      return requireResult(
        store.getTurns(sessionId, {
          historyMode: args.historyMode,
          refresh: true,
        }),
        `session not found: ${sessionId}`
      );
    }

    if (args.command === "events") {
      const sessionId = requireValue(args.target, "session id is required");
      return requireResult(
        store.getEvents(sessionId, {
          limit: args.limit,
          ...buildStructuredMatchFilters(args, { includeKind: true, includeTurn: true }),
          historyMode: args.historyMode,
          refresh: true,
        }),
        `session not found: ${sessionId}`
      );
    }

    if (args.command === "stats") {
      return store.getStats(true);
    }

    if (args.command === "doctor") {
      return store.getDoctor({
        limit: args.limit,
        offset: args.offset,
        q: args.q,
        status: args.status,
        reason: args.reason,
        sessionKey: args.sessionKey,
        liveWindowMs: args.liveWindowMs,
        rebuild: args.rebuild === true,
        refresh: true,
      });
    }

    throw createHistoryCliError(`unknown command: ${args.command}`);
  }

  function renderHistoryCliCommandResult(args, output, options = {}) {
    if (args.command === "overview") {
      printOverview(output);
      return {};
    }
    if (args.command === "search" || args.command === "list") {
      printSessionList(output);
      return {};
    }
    if (args.command === "areas") {
      printAreaList(output);
      return {};
    }
    if (args.command === "area") {
      printAreaDetail(output);
      return {};
    }
    if (args.command === "schema") {
      printSchemaProfile(output);
      return {};
    }
    if (args.command === "threads") {
      printBridgeThreadList(output, { invocationCommand: options.invocationCommand });
      return {};
    }
    if (args.command === "loaded") {
      printBridgeLoadedThreads(output);
      return {};
    }
    if (args.command === "thread" || args.command === "name" || args.command === "metadata") {
      printBridgeThread(output);
      return {};
    }
    if (args.command === "archive" || args.command === "memory-mode") {
      printBridgeThreadLifecycle(output);
      return {};
    }
    if (args.command === "unarchive") {
      printBridgeThread(output);
      return {};
    }
    if (args.command === "prune-turns") {
      printPruneCandidates(output);
      return {};
    }
    if (args.command === "prune-preview") {
      printPrunePreview(output);
      return {};
    }
    if (args.command === "fork-prune") {
      printForkPrune(output);
      return {};
    }
    if (args.command === "transcript") {
      printTranscript(output);
      return {};
    }
    if (args.command === "resume") {
      const blocked = output && output.reloadSafety && output.reloadSafety.allowed === false;
      printResume(output, { includeText: !blocked });
      return { exitCode: blocked ? 2 : 0 };
    }
    if (args.command === "turn") {
      printTurnDetail(output);
      return {};
    }
    if (args.command === "turn-search") {
      printTurnSearch(output);
      return {};
    }
    if (args.command === "artifact-turns") {
      printArtifactTurnList(output);
      return {};
    }
    if (args.command === "path-thread") {
      printPathThread(output);
      return {};
    }
    if (args.command === "related") {
      printRelatedSessions(output);
      return {};
    }
    if (args.command === "family") {
      printFamilyDetail(output);
      return {};
    }
    if (args.command === "workstream") {
      printWorkstreamDetail(output);
      return {};
    }
    if (args.command === "projects") {
      printProjectList(output);
      return {};
    }
    if (args.command === "project") {
      printProjectDetail(output);
      return {};
    }
    if (args.command === "artifacts") {
      printArtifactList(output);
      return {};
    }
    if (args.command === "artifact") {
      printArtifactDetail(output);
      return {};
    }
    if (args.command === "session") {
      printSessionDetail(output);
      return {};
    }
    if (args.command === "annotate-session" || args.command === "annotate-turn") {
      printAnnotationUpdate(output);
      return {};
    }
    if (args.command === "turns") {
      printTurnList(output);
      return {};
    }
    if (args.command === "events") {
      printEventList(output);
      return {};
    }
    if (args.command === "stats") {
      printStats(output);
      return {};
    }
    if (args.command === "doctor") {
      printDoctor(output);
      return {};
    }

    console.log(JSON.stringify(output, null, 2));
    return {};
  }

  return {
    runHistoryCliCommand,
    renderHistoryCliCommandResult,
  };
}

module.exports = {
  createHistoryCliDispatch,
};
