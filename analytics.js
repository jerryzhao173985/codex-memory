"use strict";

const ACTIVITY_CATEGORIES = Object.freeze([
  "reasoning",
  "inspect",
  "search",
  "edit",
  "test",
  "build",
  "git",
  "run",
  "package",
  "error",
  "other",
]);

function createActivityCounts() {
  return {
    reasoning: 0,
    inspect: 0,
    search: 0,
    edit: 0,
    test: 0,
    build: 0,
    git: 0,
    run: 0,
    package: 0,
    error: 0,
    other: 0,
  };
}

function shortText(value, limit = 120) {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

function prefixedLabel(prefix, value, limit = 96) {
  const text = shortText(value, limit);
  if (!text) return "";
  const normalized = text.toLowerCase();
  const lowerPrefix = prefix.toLowerCase();
  if (normalized === lowerPrefix || normalized.startsWith(`${lowerPrefix} `)) return text;
  return `${prefix} ${text}`;
}

function incrementCounter(map, key, delta = 1) {
  if (!map || typeof map !== "object" || !key) return;
  map[key] = (map[key] || 0) + delta;
}

function toTimestampMs(value) {
  if (Number.isFinite(value)) return Number(value);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function categorizeCommand(command) {
  const text = shortText(command, 500).toLowerCase();
  if (!text) return "other";

  if (/^\s*git\b/.test(text)) return "git";

  if (
    /\b(node --test|npm test|pnpm test|yarn test|pytest|vitest|jest|playwright test|go test|cargo test)\b/.test(text) ||
    /^\s*(pytest|vitest|jest)\b/.test(text)
  ) return "test";

  if (
    /\b(npm run build|pnpm build|yarn build|vite build|next build|webpack|rollup|cargo build|go build|make build)\b/.test(text) ||
    /^\s*tsc\b/.test(text)
  ) return "build";

  if (
    /^\s*(npm|pnpm|yarn|bun|pip|uv|poetry|cargo)\b/.test(text) &&
    /\b(install|add|update|remove|uninstall|sync|lock)\b/.test(text)
  ) return "package";

  if (
    /^\s*(rg|grep|findstr)\b/.test(text) ||
    /\b(search_openai_docs|web_search|curl .*search|gh search)\b/.test(text)
  ) return "search";

  if (
    /\b(apply_patch)\b/.test(text) ||
    /\b(sed -i|perl -0pi|python -c)\b/.test(text)
  ) return "edit";

  if (
    /^\s*(ls|pwd|cat|sed|head|tail|wc|find|tree|stat|jq|awk|sort|uniq|basename|dirname|realpath|nl)\b/.test(text)
  ) return "inspect";

  if (/^\s*(node|python|python3|bun|deno|uv|docker|docker-compose|make|npm|pnpm|yarn)\b/.test(text)) {
    return "run";
  }

  return "other";
}

function categorizeRecord(record) {
  if (!record || typeof record !== "object") return null;

  if (record.kind === "reasoning") return "reasoning";
  if (record.kind === "error") return "error";
  if (record.kind === "patch") return "edit";
  if (record.kind === "web_search") return "search";

  if (record.kind === "mcp") {
    const label = `${record.mcp && record.mcp.server ? record.mcp.server : ""}:${record.mcp && record.mcp.tool ? record.mcp.tool : ""}`.toLowerCase();
    if (/\b(search|find|query|lookup|docs|list)\b/.test(label)) return "search";
    return "inspect";
  }

  if ((record.kind === "tool_call" || record.kind === "tool_output") && record.toolName === "apply_patch") {
    return "edit";
  }

  if ((record.kind === "tool_call" || record.kind === "tool_output") && record.command) {
    return categorizeCommand(record.command);
  }

  return null;
}

function updateActivityCounts(counts, category, delta = 1) {
  if (!category) return;
  const key = Object.prototype.hasOwnProperty.call(counts, category) ? category : "other";
  counts[key] += delta;
}

function noteToolUsage(toolUsage, record) {
  const toolName = record && typeof record.toolName === "string" && record.toolName
    ? record.toolName
    : (record && record.kind === "mcp" && record.mcp && record.mcp.tool
      ? `mcp:${record.mcp.tool}`
      : (record && record.kind === "web_search" ? "web_search" : ""));
  if (!toolName) return;
  incrementCounter(toolUsage, toolName, 1);
}

function buildTokenSummary(tokenUsage, rateLimits) {
  const totalTokens = tokenUsage && tokenUsage.total && Number.isInteger(tokenUsage.total.total_tokens)
    ? tokenUsage.total.total_tokens
    : null;
  const lastTokens = tokenUsage && tokenUsage.last && Number.isInteger(tokenUsage.last.total_tokens)
    ? tokenUsage.last.total_tokens
    : null;
  const contextWindow = tokenUsage && Number.isInteger(tokenUsage.modelContextWindow)
    ? tokenUsage.modelContextWindow
    : null;
  const windowTokens = contextWindow == null
    ? null
    : (lastTokens != null && lastTokens <= contextWindow
      ? lastTokens
      : (totalTokens != null && totalTokens <= contextWindow ? totalTokens : null));
  const utilizationPct = windowTokens != null && contextWindow
    ? Math.round((windowTokens / contextWindow) * 1000) / 10
    : null;
  return {
    totalTokens,
    lastTokens,
    contextWindow,
    windowTokens,
    utilizationPct,
    limitId: rateLimits && typeof rateLimits.limit_id === "string" ? rateLimits.limit_id : null,
    planType: rateLimits && typeof rateLimits.plan_type === "string" ? rateLimits.plan_type : null,
  };
}

function dominantActivity(counts) {
  let best = null;
  let bestValue = 0;
  for (const key of ACTIVITY_CATEGORIES) {
    const value = counts[key] || 0;
    if (value > bestValue) {
      best = key;
      bestValue = value;
    }
  }
  return best;
}

function countRecentActivity(session, limit = 12) {
  const counts = createActivityCounts();
  const events = Array.isArray(session && session.recentEvents) ? session.recentEvents.slice(-limit) : [];
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const category = typeof event.activityCategory === "string" ? event.activityCategory : null;
    if (!category) continue;
    updateActivityCounts(counts, category);
  }
  return counts;
}

function latestActivityCategory(session) {
  const events = Array.isArray(session && session.recentEvents) ? session.recentEvents : [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || typeof event !== "object") continue;
    if (typeof event.activityCategory === "string" && event.activityCategory) {
      return event.activityCategory;
    }
  }
  return session && session.lastActivity && typeof session.lastActivity.category === "string"
    ? session.lastActivity.category
    : null;
}

function latestCandidate(session) {
  const candidates = [];
  const add = (type, timestampValue, label) => {
    const timestampMs = toTimestampMs(timestampValue);
    if (timestampMs == null || !label) return;
    candidates.push({ type, timestampMs, label });
  };

  add("command", session.lastCommand && session.lastCommand.timestamp,
    session.lastCommand && session.lastCommand.command
      ? `${session.lastCommand.completed === false ? "running" : "command"} ${shortText(session.lastCommand.command, 96)}`
      : "");
  add("patch", session.lastPatch && session.lastPatch.timestamp,
    session.lastPatch && session.lastPatch.patch && Number.isInteger(session.lastPatch.patch.fileCount)
      ? `patch ${session.lastPatch.patch.fileCount} files`
      : "");
  add("search", session.lastWebSearch && session.lastWebSearch.timestamp,
    session.lastWebSearch && (session.lastWebSearch.query || session.lastWebSearch.preview)
      ? prefixedLabel("search", session.lastWebSearch.query || session.lastWebSearch.preview, 96)
      : "");
  add("mcp", session.lastMcpCall && session.lastMcpCall.timestamp,
    session.lastMcpCall ? `${session.lastMcpCall.server || "mcp"}:${session.lastMcpCall.tool || "tool"}` : "");
  add("error", session.lastError && session.lastError.timestamp,
    session.lastError ? shortText(session.lastError.preview || session.lastError.message, 96) : "");
  add("answer", session.lastFinalAnswer && session.lastFinalAnswer.timestamp,
    session.lastFinalAnswer && session.lastFinalAnswer.preview
      ? prefixedLabel("answer", session.lastFinalAnswer.preview, 96)
      : "");
  add("commentary", session.lastCommentary && session.lastCommentary.timestamp,
    session.lastCommentary && session.lastCommentary.preview
      ? prefixedLabel("commentary", session.lastCommentary.preview, 96)
      : "");
  add("reasoning", session.lastReasoning && session.lastReasoning.timestamp,
    session.lastReasoning && session.lastReasoning.preview
      ? prefixedLabel("reasoning", session.lastReasoning.preview, 96)
      : "");
  add("user", session.lastUserMessage && session.lastUserMessage.timestamp,
    session.lastUserMessage && session.lastUserMessage.preview
      ? prefixedLabel("user", session.lastUserMessage.preview, 96)
      : "");

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.timestampMs - a.timestampMs);
  return candidates[0];
}

function deriveIntent(session) {
  const counts = session.activityCounts || createActivityCounts();
  const recent = countRecentActivity(session);
  const latest = latestCandidate(session);
  const latestCategory = latestActivityCategory(session);
  const recentActionable = recent.inspect + recent.search + recent.edit + recent.test + recent.build + recent.git + recent.run + recent.package;
  const hasRecentSignal = Object.values(recent).some((value) => value > 0);

  if (session.permissionDetail && session.permissionDetail.command) return "awaiting-approval";
  if (latest && latest.type === "error") return "blocked";

  if (latestCategory === "edit" && (recent.test >= 1 || recent.inspect >= 2 || recent.run >= 1)) return "implementing";
  if (latestCategory === "edit") return "editing";
  if (latestCategory === "test") return "testing";
  if (latestCategory === "build" || latestCategory === "run") return "running";
  if (latestCategory === "git") return "git";
  if (latestCategory === "search") return "researching";
  if (latestCategory === "inspect" && recent.search === 0 && recent.edit === 0 && recent.test === 0 && recent.run === 0) {
    return "inspecting";
  }
  if (latestCategory === "reasoning") {
    if (recent.edit >= 1 || recent.test >= 1) return "implementing";
    if (recent.search >= 1) return "researching";
    return "reasoning";
  }

  if (recent.search >= 2 && recent.search >= recent.edit + recent.test) return "researching";
  if (recent.edit >= 1 && (recent.test >= 1 || recent.inspect >= 2 || recent.run >= 1)) return "implementing";
  if (recent.edit >= 1) return "editing";
  if (recent.test >= 1 && recent.test >= recent.inspect) return "testing";
  if (recent.build >= 1 || recent.run >= 1) return "running";
  if (recent.git >= 1 && recentActionable <= recent.git + 1) return "git";
  if (recent.inspect >= 2 && recentActionable === recent.inspect) return "inspecting";
  if (recent.reasoning >= 1 && recentActionable === 0) return "reasoning";
  if (hasRecentSignal) return "general";

  const actionable = counts.inspect + counts.search + counts.edit + counts.test + counts.build + counts.git + counts.run + counts.package;
  if (counts.edit >= 1 && (counts.test >= 1 || counts.inspect >= 2 || counts.run >= 1)) return "implementing";
  if (counts.edit >= 1) return "editing";
  if (counts.search >= 1) return "researching";
  if (counts.build >= 1 || counts.run >= 1) return "running";
  if (session.state === "thinking") return "reasoning";
  if (counts.inspect >= 2 && actionable === counts.inspect) return "inspecting";
  return "general";
}

function deriveFocus(session) {
  if (session.permissionDetail && session.permissionDetail.command) {
    return `approval ${shortText(session.permissionDetail.command, 96)}`;
  }
  const latest = latestCandidate(session);
  if (latest) return latest.label;
  return session.lastEvent || session.state || "idle";
}

function buildSessionAnalytics(session) {
  const counts = { ...createActivityCounts(), ...(session.activityCounts || {}) };
  const recentCounts = countRecentActivity(session);
  return {
    intent: deriveIntent(session),
    focus: deriveFocus(session),
    dominantActivity: dominantActivity(counts),
    currentActivity: latestActivityCategory(session),
    activityCounts: counts,
    recentActivityCounts: recentCounts,
    toolUsage: { ...(session.toolUsage || {}) },
    commandStats: { ...(session.commandStats || {}) },
    patchStats: { ...(session.patchStats || {}) },
    searchStats: { ...(session.searchStats || {}) },
    mcpStats: { ...(session.mcpStats || {}) },
    errorCount: session.errorCount || 0,
    tokens: buildTokenSummary(session.lastTokenCount, session.rateLimits),
  };
}

function buildGlobalAnalytics(sessions, meta = {}) {
  const intentCounts = {};
  const stateCounts = {};
  const activityTotals = createActivityCounts();
  const toolUsage = {};
  const totals = {
    commandsStarted: 0,
    commandsCompleted: 0,
    commandsFailed: 0,
    patches: 0,
    patchFilesTouched: 0,
    searches: 0,
    mcpCalls: 0,
    errors: 0,
  };
  let busiest = null;

  for (const session of sessions) {
    const analytics = session.analytics || buildSessionAnalytics(session);
    incrementCounter(intentCounts, analytics.intent, 1);
    incrementCounter(stateCounts, session.state, 1);

    for (const key of ACTIVITY_CATEGORIES) {
      activityTotals[key] += analytics.activityCounts && analytics.activityCounts[key]
        ? analytics.activityCounts[key]
        : 0;
    }

    for (const [toolName, count] of Object.entries(analytics.toolUsage || {})) {
      incrementCounter(toolUsage, toolName, count);
    }

    totals.commandsStarted += analytics.commandStats && analytics.commandStats.started ? analytics.commandStats.started : 0;
    totals.commandsCompleted += analytics.commandStats && analytics.commandStats.completed ? analytics.commandStats.completed : 0;
    totals.commandsFailed += analytics.commandStats && analytics.commandStats.failed ? analytics.commandStats.failed : 0;
    totals.patches += analytics.patchStats && analytics.patchStats.total ? analytics.patchStats.total : 0;
    totals.patchFilesTouched += analytics.patchStats && analytics.patchStats.filesTouched ? analytics.patchStats.filesTouched : 0;
    totals.searches += analytics.searchStats && analytics.searchStats.total ? analytics.searchStats.total : 0;
    totals.mcpCalls += analytics.mcpStats && analytics.mcpStats.total ? analytics.mcpStats.total : 0;
    totals.errors += analytics.errorCount || 0;

    const sessionActivity = Object.values(analytics.activityCounts || {}).reduce((sum, value) => sum + value, 0);
    if (!busiest || sessionActivity > busiest.activityCount) {
      busiest = {
        sessionId: session.sessionId,
        state: session.state,
        intent: analytics.intent,
        focus: analytics.focus,
        cwd: session.cwd,
        activityCount: sessionActivity,
      };
    }
  }

  const topTools = Object.entries(toolUsage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([toolName, count]) => ({ toolName, count }));

  return {
    state: meta.state || "idle",
    resolvedState: meta.resolvedState || meta.state || "idle",
    sessionCount: sessions.length,
    intentCounts,
    stateCounts,
    activityTotals,
    totals,
    topTools,
    busiestSession: busiest,
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId,
      state: session.state,
      intent: session.analytics ? session.analytics.intent : buildSessionAnalytics(session).intent,
      focus: session.analytics ? session.analytics.focus : buildSessionAnalytics(session).focus,
      cwd: session.cwd,
      updatedAt: session.updatedAt,
    })),
  };
}

module.exports = {
  ACTIVITY_CATEGORIES,
  createActivityCounts,
  categorizeCommand,
  categorizeRecord,
  updateActivityCounts,
  noteToolUsage,
  buildTokenSummary,
  countRecentActivity,
  latestActivityCategory,
  buildSessionAnalytics,
  buildGlobalAnalytics,
};
