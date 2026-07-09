"use strict";

function createHistoryCliMetaView(deps = {}) {
  const {
    buildCatalogCommonFilters,
    getHistoryCliInvocationCommand,
    formatPathPatternKindLabel,
    formatCommandOpSignalLabel,
    formatQuerySignalLabel,
    formatQueryDisplayValue,
    printAnnotationLines,
  } = deps;

  function formatInlinePreview(value, max = 220) {
    const text = typeof value === "string"
      ? value.replace(/\s+/g, " ").trim()
      : "";
    if (!text) return "";
    return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
  }

  function formatCountSummary(counts) {
    if (!counts || typeof counts !== "object") return "";
    const parts = Object.keys(counts)
      .sort()
      .map((key) => `${key}=${counts[key]}`);
    return parts.join(" | ");
  }

  function printSchemaProfile(profile) {
    console.log(`generated: ${profile.generatedAt}`);
    console.log(`session dir: ${profile.sessionDir}`);
    console.log([
      `files=${profile.fileCount}`,
      `records=${profile.recordCount}`,
      `keys=${profile.totalKeys}`,
      `matched=${profile.totalMatchedKeys}`,
    ].join("  "));
    console.log("");

    for (const entry of profile.keys) {
      console.log([
        entry.key,
        `kind=${entry.kind}`,
        `count=${entry.count}`,
        entry.firstSeenAt ? `first=${entry.firstSeenAt}` : "",
        entry.lastSeenAt ? `last=${entry.lastSeenAt}` : "",
      ].filter(Boolean).join(" | "));
      if (entry.samplePreview) console.log(`sample: ${entry.samplePreview}`);
      if (entry.sampleFilePath) console.log(`sample file: ${entry.sampleFilePath}`);
      if (entry.rawFields && entry.rawFields.length) {
        console.log(`raw fields: ${entry.rawFields.map((field) => `${field.path} (${field.count})`).join(" | ")}`);
      }
      if (entry.normalizedFields && entry.normalizedFields.length) {
        console.log(`normalized: ${entry.normalizedFields.map((field) => `${field.path} (${field.count})`).join(" | ")}`);
      }
      console.log("");
    }
  }

  function printStats(stats) {
    console.log(`generated: ${stats.generatedAt}`);
    console.log(`session dir: ${stats.sessionDir}`);
    console.log(`index dir: ${stats.indexRoot}`);
    if (stats.sessionDocSchemaVersion != null) {
      console.log(`session doc schema: ${stats.sessionDocSchemaVersion}`);
    }
    console.log([
      `sessions=${stats.sessionCount}`,
      `projects=${stats.projectCount || 0}`,
      `files=${stats.fileCount}`,
      `fork_families=${stats.forkFamilies || 0}`,
      `forked_sessions=${stats.forkedSessions || 0}`,
      `subagents=${stats.subagentSessions || 0}`,
      `reuse_candidates=${stats.reuseCandidates || 0}`,
      `reused=${stats.reusedFiles}`,
      `reuse_failures=${stats.reuseFailures || 0}`,
      `rebuilt=${stats.rebuiltFiles}`,
      `skipped=${stats.skippedFiles}`,
      `removed=${stats.removedFiles}`,
      `annotated_sessions=${stats.annotatedSessions || 0}`,
      `bookmarked_sessions=${stats.bookmarkedSessions || 0}`,
      `annotated_turns=${stats.annotatedTurns || 0}`,
      `bookmarked_turns=${stats.bookmarkedTurns || 0}`,
    ].join("  "));
    console.log([
      `artifacts.files=${stats.artifactCounts.file || 0}`,
      `artifacts.paths=${stats.artifactCounts.path || 0}`,
      `artifacts.path_patterns=${stats.artifactCounts.path_pattern || 0}`,
      `artifacts.tools=${stats.artifactCounts.tool || 0}`,
      `artifacts.commands=${stats.artifactCounts.command || 0}`,
      `artifacts.command_ops=${stats.artifactCounts.command_op || 0}`,
      `artifacts.queries=${stats.artifactCounts.query || 0}`,
      `artifacts.errors=${stats.artifactCounts.error || 0}`,
    ].join("  "));
    if (stats.persistenceDegraded) {
      const firstError = Array.isArray(stats.persistenceErrors) && stats.persistenceErrors.length
        ? stats.persistenceErrors[0]
        : null;
      console.log(`persistence: degraded${firstError && firstError.code ? ` (${firstError.code})` : ""}`);
    }
    if (Number.isInteger(stats.extendedEventSessions)) {
      console.log(`extended-event-sessions=${stats.extendedEventSessions}`);
    }
    const memoryModes = formatCountSummary(stats.memoryModeCounts);
    if (memoryModes) console.log(`memory-modes: ${memoryModes}`);
    const eventModes = formatCountSummary(stats.eventModeCounts);
    if (eventModes) console.log(`event-modes: ${eventModes}`);
    const qualityClasses = formatCountSummary(stats.qualityClassCounts);
    if (qualityClasses) console.log(`session-quality-classes: ${qualityClasses}`);
    const reuseFailures = formatCountSummary(stats.reuseFailureCounts);
    if (reuseFailures) console.log(`reuse-failures: ${reuseFailures}`);
    console.log("");

    const reuseFailureSamples = stats.reuseFailureSamples && typeof stats.reuseFailureSamples === "object"
      ? Object.keys(stats.reuseFailureSamples)
        .sort()
        .slice(0, 5)
        .map((key) => `${key} -> ${stats.reuseFailureSamples[key]}`)
      : [];
    if (reuseFailureSamples.length) {
      console.log(`reuse-failure-samples: ${reuseFailureSamples.join(" | ")}`);
    }

    if (stats.topFiles && stats.topFiles.length) {
      console.log(`top files (session coverage): ${stats.topFiles.map((item) => `${item.file} (${item.count})`).join(" | ")}`);
    }
    if (stats.topActiveFiles && stats.topActiveFiles.length) {
      console.log(`top active files (turn activity): ${stats.topActiveFiles.map((item) => `${item.file} (${item.count})`).join(" | ")}`);
    }
    if (stats.topPaths && stats.topPaths.length) {
      console.log(`top paths (session coverage): ${stats.topPaths.map((item) => `${item.path} (${item.count})`).join(" | ")}`);
    }
    if (stats.topActivePaths && stats.topActivePaths.length) {
      console.log(`top active paths (turn activity): ${stats.topActivePaths.map((item) => `${item.path} (${item.count})`).join(" | ")}`);
    }
    if (stats.topPathPatterns && stats.topPathPatterns.length) {
      console.log(`top path patterns: ${stats.topPathPatterns.map((item) => {
        const label = formatPathPatternKindLabel(item.patternKind) || item.patternKind || "";
        return label ? `${item.pattern} [${label}] (${item.count})` : `${item.pattern} (${item.count})`;
      }).join(" | ")}`);
    }
    if (stats.topCommandOps && stats.topCommandOps.length) {
      console.log(`top command ops: ${stats.topCommandOps.map((item) => {
        const label = formatCommandOpSignalLabel(item.signalTier) || item.signalTier || "";
        return label ? `${item.commandOp} [${label}] (${item.count})` : `${item.commandOp} (${item.count})`;
      }).join(" | ")}`);
    }
    if (stats.topHighSignalCommandOps && stats.topHighSignalCommandOps.length) {
      console.log(`top high-signal command ops: ${stats.topHighSignalCommandOps.map((item) => `${item.commandOp} (${item.count})`).join(" | ")}`);
    }
    if (stats.topQueries && stats.topQueries.length) {
      console.log(`top semantic queries: ${stats.topQueries.map((item) => {
        const label = formatQuerySignalLabel(item.signalTier) || item.signalTier || "";
        return label
          ? `${formatQueryDisplayValue(item.query)} [${label}] (${item.count})`
          : `${formatQueryDisplayValue(item.query)} (${item.count})`;
      }).join(" | ")}`);
    }
    if (stats.topLowSignalQueries && stats.topLowSignalQueries.length) {
      console.log(`top low-signal query filters: ${stats.topLowSignalQueries.map((item) => `${formatQueryDisplayValue(item.query)} (${item.count})`).join(" | ")}`);
    }
    if (stats.topTools && stats.topTools.length) {
      console.log(`top tools (session coverage): ${stats.topTools.map((item) => `${item.tool} (${item.count})`).join(" | ")}`);
    }
    if (stats.topActiveTools && stats.topActiveTools.length) {
      console.log(`top active tools (turn activity): ${stats.topActiveTools.map((item) => `${item.tool} (${item.count})`).join(" | ")}`);
    }
    if (stats.topProjects && stats.topProjects.length) {
      console.log(`top projects (session coverage): ${stats.topProjects.map((item) => `${item.cwd} (${item.count})`).join(" | ")}`);
    }
    if (stats.topActiveProjects && stats.topActiveProjects.length) {
      console.log(`top active projects (turn activity): ${stats.topActiveProjects.map((item) => `${item.cwd} (${item.count})`).join(" | ")}`);
    }
    if (stats.topManualTags && stats.topManualTags.length) {
      console.log(`top manual tags: ${stats.topManualTags.map((item) => `${item.tag} (${item.count})`).join(" | ")}`);
    }
    if (Number.isInteger(stats.manualProjectCount) || Number.isInteger(stats.bookmarkedProjectCount)) {
      console.log([
        `manual-projects=${stats.manualProjectCount || 0}`,
        `bookmarked-projects=${stats.bookmarkedProjectCount || 0}`,
      ].join("  "));
    }
    if ((stats.orphanSessionAnnotations || 0) > 0 || (stats.orphanTurnAnnotations || 0) > 0) {
      console.log([
        `orphan-session-annotations=${stats.orphanSessionAnnotations || 0}`,
        `orphan-turn-annotations=${stats.orphanTurnAnnotations || 0}`,
      ].join("  "));
    }
    if (stats.topManualProjects && stats.topManualProjects.length) {
      console.log(`top manual projects: ${stats.topManualProjects.map((item) => {
        const tags = Array.isArray(item.topTags) && item.topTags.length
          ? ` tags=${item.topTags.map((tag) => `${tag.tag}:${tag.count}`).join(",")}`
          : "";
        return `${item.cwd} [s=${item.annotatedSessions || 0}, bs=${item.bookmarkedSessions || 0}, t=${item.annotatedTurns || 0}, bt=${item.bookmarkedTurns || 0}]${tags}`;
      }).join(" | ")}`);
    }
  }

  function printDoctor(result) {
    console.log(`generated: ${result.generatedAt}`);
    console.log(`session dir: ${result.sessionDir}`);
    console.log(`index dir: ${result.indexRoot}`);
    if (result.sessionDocSchemaVersion != null) {
      console.log(`session doc schema: ${result.sessionDocSchemaVersion}`);
    }
    console.log([
      `sessions=${result.sessionCount}`,
      `files=${result.fileCount}`,
      `matched=${result.total}`,
      `reused=${result.counts && result.counts.reused != null ? result.counts.reused : 0}`,
      `rebuilt=${result.counts && result.counts.rebuilt != null ? result.counts.rebuilt : 0}`,
      `live=${result.counts && result.counts.live != null ? result.counts.live : 0}`,
      `duplicates=${result.counts && result.counts.duplicates != null ? result.counts.duplicates : 0}`,
      `forked=${result.counts && result.counts.forked != null ? result.counts.forked : 0}`,
      `subagents=${result.counts && result.counts.subagent != null ? result.counts.subagent : 0}`,
    ].join("  "));
    if (result.persistenceDegraded) {
      const firstError = Array.isArray(result.persistenceErrors) && result.persistenceErrors.length
        ? result.persistenceErrors[0]
        : null;
      console.log(`persistence: degraded${firstError && firstError.code ? ` (${firstError.code})` : ""}`);
    }
    console.log(`live-window-ms=${result.liveWindowMs}`);
    console.log("");

    if (Array.isArray(result.duplicates) && result.duplicates.length) {
      console.log("duplicate session ids:");
      for (const entry of result.duplicates.slice(0, 5)) {
        const rollouts = (entry.rollouts || []).slice(0, 3).map((rollout) => rollout.sessionKey).join(", ");
        console.log(`  ${entry.sessionId} (${entry.count})${rollouts ? ` -> ${rollouts}` : ""}`);
      }
      console.log("");
    }

    if (Array.isArray(result.forkFamilies) && result.forkFamilies.length) {
      console.log("fork families:");
      for (const entry of result.forkFamilies.slice(0, 5)) {
        const rollouts = (entry.rollouts || []).slice(0, 3).map((rollout) => rollout.sessionKey).join(", ");
        console.log(`  ${entry.rootSessionId} (${entry.count})${rollouts ? ` -> ${rollouts}` : ""}`);
      }
      console.log("");
    }

    for (const file of result.files || []) {
      console.log([
        file.sessionId,
        file.sessionKey ? `rollout=${file.sessionKey}` : "",
        file.forkedFromId ? `forked_from=${file.forkedFromId}` : "",
        file.parentThreadId ? `parent=${file.parentThreadId}` : "",
        file.buildStatus || "",
        file.liveCandidate ? "live" : "",
        file.duplicateSessionId ? `duplicate=${file.duplicateCount}` : "",
      ].filter(Boolean).join(" | "));
      console.log([
        file.updatedAt || file.startedAt || "",
        file.cwd || "",
        file.buildReason ? `reason=${file.buildReason}` : "",
        Number.isInteger(file.turnCount) ? `turns=${file.turnCount}` : "",
        Number.isInteger(file.eventCount) ? `events=${file.eventCount}` : "",
      ].filter(Boolean).join(" | "));
      if (file.filePath) console.log(`file: ${file.filePath}`);
      if (file.docPath) console.log(`doc: ${file.docPath}`);
      console.log("");
    }
  }

  function buildOverviewBaseFilters(args = {}) {
    return {
      q: args.q,
      query: args.query,
      ...buildCatalogCommonFilters(args),
    };
  }

  function buildOverviewResult(store, args = {}, options = {}) {
    const bucketLimit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 3;
    const invocationCommand = typeof options.invocationCommand === "string" && options.invocationCommand
      ? options.invocationCommand
      : getHistoryCliInvocationCommand(options);
    const summary = store.getStats(true);
    const baseFilters = {
      ...buildOverviewBaseFilters(args),
      shape: "compact",
      refresh: false,
    };

    const richExtended = store.listSessions({
      ...baseFilters,
      limit: bucketLimit,
      qualityClass: "rich_extended",
    });
    const usefulLimited = store.listSessions({
      ...baseFilters,
      limit: bucketLimit,
      qualityClass: "useful_limited",
    });
    const partialInvestigation = store.listSessions({
      ...baseFilters,
      limit: bucketLimit,
      qualityClass: "partial_investigation",
    });
    const errorOnly = store.listSessions({
      ...baseFilters,
      limit: bucketLimit,
      qualityClass: "error_only",
    });
    const abortedEmpty = store.listSessions({
      ...baseFilters,
      limit: bucketLimit,
      qualityClass: "aborted_empty",
    });

    const suggestedSession = (
      richExtended.sessions[0] ||
      usefulLimited.sessions[0] ||
      partialInvestigation.sessions[0] ||
      errorOnly.sessions[0] ||
      abortedEmpty.sessions[0] ||
      null
    );

    const recommendedCommands = [];
    if (suggestedSession) {
      recommendedCommands.push(`${invocationCommand} transcript ${suggestedSession.sessionId}`);
      recommendedCommands.push(`${invocationCommand} resume ${suggestedSession.sessionId} --reload-policy strict`);
      if (suggestedSession.cwd) {
        recommendedCommands.push(`${invocationCommand} project --cwd ${JSON.stringify(suggestedSession.cwd)}`);
      }
    } else {
      recommendedCommands.push(`${invocationCommand} list --limit 10`);
      recommendedCommands.push(`${invocationCommand} stats`);
    }

    const scope = Object.fromEntries(
      Object.entries(buildOverviewBaseFilters(args)).filter(([, value]) => {
        if (Array.isArray(value)) return value.length > 0;
        return Boolean(value);
      })
    );

    return {
      generatedAt: summary.generatedAt,
      historyMode: args.historyMode || "effective",
      bucketLimit,
      scope,
      summary: {
        sessionCount: summary.sessionCount || 0,
        projectCount: summary.projectCount || 0,
        extendedEventSessions: summary.extendedEventSessions || 0,
        qualityClassCounts: summary.qualityClassCounts || {},
      },
      buckets: {
        richExtended,
        usefulLimited,
        partialInvestigation,
        errorOnly,
        abortedEmpty,
      },
      recommendedCommands,
    };
  }

  function printOverviewSessionBucket(label, result) {
    if (!result || !Array.isArray(result.sessions) || !result.sessions.length) return;
    console.log(`${label} (${result.total})`);
    for (const session of result.sessions) {
      const parts = [
        session.sessionId,
        session.cwd || "",
        session.qualityClass ? `quality=${session.qualityClass}` : "",
        session.turnCount ? `turns=${session.turnCount}` : "",
        session.counts && session.counts.commands ? `cmd=${session.counts.commands}` : "",
        session.counts && session.counts.patches ? `patch=${session.counts.patches}` : "",
        session.counts && session.counts.searches ? `search=${session.counts.searches}` : "",
        session.counts && session.counts.errors ? `error=${session.counts.errors}` : "",
      ].filter(Boolean);
      console.log(`  ${parts.join(" | ")}`);
      if (session.finalAnswerPreview) {
        console.log(`  answer: ${formatInlinePreview(session.finalAnswerPreview)}`);
      } else if (session.commentaryPreview) {
        console.log(`  commentary: ${formatInlinePreview(session.commentaryPreview)}`);
      } else if (session.lastUserPreview) {
        console.log(`  user: ${formatInlinePreview(session.lastUserPreview)}`);
      }
    }
    console.log("");
  }

  function printOverview(result) {
    console.log(`overview | sessions=${result.summary.sessionCount} | projects=${result.summary.projectCount} | extended=${result.summary.extendedEventSessions}`);
    if (result.scope && Object.keys(result.scope).length) {
      const scopeText = Object.entries(result.scope)
        .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(",") : value}`)
        .join(" | ");
      console.log(`scope: ${scopeText}`);
    }
    const qualityOrder = [
      "rich_extended",
      "useful_limited",
      "partial_investigation",
      "error_only",
      "aborted_empty",
      "answer_only",
      "other_low_signal",
    ];
    const qualitySummary = qualityOrder
      .filter((key) => Number(result.summary.qualityClassCounts && result.summary.qualityClassCounts[key]) > 0)
      .map((key) => `${key}=${result.summary.qualityClassCounts[key]}`)
      .join(" | ");
    if (qualitySummary) {
      console.log(`quality: ${qualitySummary}`);
    }
    console.log("");

    printOverviewSessionBucket("Best revisit", result.buckets.richExtended);
    printOverviewSessionBucket("Good limited sessions", result.buckets.usefulLimited);
    printOverviewSessionBucket("Interrupted investigations", result.buckets.partialInvestigation);
    printOverviewSessionBucket("Errors only", result.buckets.errorOnly);
    printOverviewSessionBucket("Aborted or empty", result.buckets.abortedEmpty);

    if (Array.isArray(result.recommendedCommands) && result.recommendedCommands.length) {
      console.log("next:");
      for (const command of result.recommendedCommands) {
        console.log(`  ${command}`);
      }
    }
  }

  function printAnnotationUpdate(result) {
    const parts = [
      result.sessionId || "",
      result.turnId || "",
      result.sessionKey ? `rollout=${result.sessionKey}` : "",
    ].filter(Boolean);
    console.log(parts.join(" | "));
    if (result.annotation) {
      printAnnotationLines(result.annotation, "annotation");
    } else {
      console.log("annotation cleared");
    }
  }

  return {
    buildOverviewResult,
    printSchemaProfile,
    printStats,
    printDoctor,
    printOverview,
    printAnnotationUpdate,
  };
}

module.exports = {
  createHistoryCliMetaView,
};
