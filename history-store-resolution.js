"use strict";

const {
  normalizeHistoryMode,
  getCatalogTranscript,
  getCatalogResume,
  hasAnnotationScopedFilters,
  buildTranscriptResultFromSessionData,
  buildResumeResultFromSessionData,
  buildHistoryViewSource,
  buildHistoryQuality,
} = require("./catalog");

function normalizeViewSource(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "rollout") return "rollout";
  if (text === "app_server" || text === "app-server" || text === "appserver") return "app_server";
  return "auto";
}

function transcriptStructuredFiltersRequested(filters = {}) {
  return Boolean(
    filters.query ||
    filters.file ||
    filters.path ||
    filters.pathPattern ||
    filters.path_pattern ||
    filters.pathRole ||
    filters.path_role ||
    filters.commandOp ||
    filters.command_op ||
    filters.commandOpSignal ||
    filters.command_op_signal ||
    filters.commandType ||
    filters.error ||
    hasAnnotationScopedFilters(filters)
  );
}

function resumeScopedFiltersRequested(filters = {}) {
  return Boolean(
    transcriptStructuredFiltersRequested(filters) ||
    (typeof filters.q === "string" && filters.q.trim()) ||
    filters.turn ||
    filters.status ||
    filters.tool ||
    filters.bookmarked !== undefined ||
    filters.bookmark !== undefined ||
    filters.manualTag ||
    filters.manual_tag ||
    (Array.isArray(filters.manualTags) && filters.manualTags.length)
  );
}

function createHistoryViewResolver(options = {}) {
  const bridgeStore = options.bridgeStore && typeof options.bridgeStore === "object"
    ? options.bridgeStore
    : {};
  const getCatalog = typeof options.getCatalog === "function"
    ? options.getCatalog
    : () => null;

  async function resolveHistoryView(sessionId, filters = {}, viewOptions = {}) {
    const source = normalizeViewSource(filters.source);
    const historyMode = normalizeHistoryMode(filters.historyMode);
    let bridgeError = null;
    let sourceSelectionReason = source === "rollout" ? "requested_rollout" : "";
    let sourceFilterScope = "";

    if (historyMode === "raw") {
      if (source === "app_server") {
        const err = new Error("history_mode=raw is only supported with rollout source");
        err.code = "RAW_HISTORY_REQUIRES_ROLLOUT";
        throw err;
      }
      if (source === "auto") sourceSelectionReason = "raw_history_requires_rollout";
    } else if (source !== "rollout") {
      try {
        const built = await bridgeStore.buildAppServerView(sessionId, filters, {
          includeSessionContext: hasAnnotationScopedFilters(filters),
        });
        if (!built) return null;
        const appServerSource = buildHistoryViewSource(source, "app_server", {
          selectionReason: source === "auto" ? "auto_preferred_app_server" : "requested_app_server",
        });
        const appServerResult = typeof viewOptions.buildAppServerResult === "function"
          ? viewOptions.buildAppServerResult(built, appServerSource)
          : null;
        if (!appServerResult) return null;
        const shouldFallback = source === "auto" &&
          typeof viewOptions.shouldFallbackToRollout === "function" &&
          viewOptions.shouldFallbackToRollout(appServerResult, filters);
        if (!shouldFallback) return appServerResult;
        sourceSelectionReason = "auto_fallback_filter_miss";
        sourceFilterScope = typeof viewOptions.filterScope === "string" ? viewOptions.filterScope : "";
      } catch (err) {
        bridgeError = err && err.message ? err.message : String(err);
        if (source === "app_server") throw err;
        sourceSelectionReason = "auto_fallback_bridge_error";
      }
    }

    const result = typeof viewOptions.buildRolloutResult === "function"
      ? viewOptions.buildRolloutResult(getCatalog(Boolean(filters.refresh)))
      : null;
    if (result) {
      result.source = buildHistoryViewSource(source, "rollout", {
        bridgeError,
        historyMode,
        selectionReason: sourceSelectionReason || undefined,
        filterScope: sourceFilterScope,
        filterFallback: sourceSelectionReason === "auto_fallback_filter_miss",
      });
      result.quality = buildHistoryQuality(
        result.session,
        filters,
        result.source,
        typeof viewOptions.purpose === "string" && viewOptions.purpose ? viewOptions.purpose : "view"
      );
    }
    return result;
  }

  async function getTranscriptResolved(sessionId, filters = {}) {
    return resolveHistoryView(sessionId, filters, {
      purpose: "transcript",
      filterScope: "transcript",
      shouldFallbackToRollout(result) {
        return transcriptStructuredFiltersRequested(filters) && result.matchedItems === 0;
      },
      buildAppServerResult(built, source) {
        return buildTranscriptResultFromSessionData(
          built.view.session,
          built.view,
          built.generatedAt,
          filters,
          source
        );
      },
      buildRolloutResult(catalog) {
        return getCatalogTranscript(catalog, sessionId, filters);
      },
    });
  }

  async function getResumeResolved(sessionId, filters = {}) {
    return resolveHistoryView(sessionId, filters, {
      purpose: "resume",
      filterScope: "resume",
      shouldFallbackToRollout(result) {
        return resumeScopedFiltersRequested(filters) && result.turnCount === 0;
      },
      buildAppServerResult(built, source) {
        return buildResumeResultFromSessionData(
          built.view.session,
          built.view,
          built.generatedAt,
          filters,
          source
        );
      },
      buildRolloutResult(catalog) {
        return getCatalogResume(catalog, sessionId, filters);
      },
    });
  }

  return {
    resolveHistoryView,
    getTranscriptResolved,
    getResumeResolved,
  };
}

module.exports = {
  createHistoryViewResolver,
  normalizeViewSource,
  transcriptStructuredFiltersRequested,
  resumeScopedFiltersRequested,
};
