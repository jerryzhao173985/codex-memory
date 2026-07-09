"use strict";

function createCatalogHistoryPolicy(deps = {}) {
  const {
    normalizeHistoryMode,
    getSessionRolloutMemoryMode,
    getSessionRolloutEventMode,
  } = deps;

  function pushUniqueNote(list, value) {
    if (!Array.isArray(list) || typeof value !== "string") return;
    const text = value.trim();
    if (!text || list.includes(text)) return;
    list.push(text);
  }

  function normalizeHistoryViewSourceValue(value, fallback = "auto") {
    const text = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (text === "rollout") return "rollout";
    if (text === "app_server" || text === "app-server" || text === "appserver") return "app_server";
    return fallback;
  }

  function inferHistoryViewSelectionReason(requestedSource, usedSource, options = {}) {
    if (typeof options.selectionReason === "string" && options.selectionReason.trim()) {
      return options.selectionReason.trim();
    }
    if (options.historyMode === "raw" && usedSource === "rollout") return "raw_history_requires_rollout";
    if (options.filterFallback === true) return "auto_fallback_filter_miss";
    if (options.rolloutOnly === true && usedSource === "rollout" && requestedSource !== "rollout") {
      return "rollout_only_view";
    }
    if (requestedSource === "rollout") return "requested_rollout";
    if (requestedSource === "app_server") return "requested_app_server";
    if (requestedSource === "auto" && usedSource === "app_server") return "auto_preferred_app_server";
    if (requestedSource === "auto" && usedSource === "rollout" && options.bridgeError) return "auto_fallback_bridge_error";
    return usedSource === "app_server" ? "requested_app_server" : "requested_rollout";
  }

  function describeHistoryViewSelection(selectionReason, options = {}) {
    if (typeof options.selectionNote === "string" && options.selectionNote.trim()) {
      return options.selectionNote.trim();
    }
    switch (selectionReason) {
      case "requested_rollout":
        return "used rollout because source=rollout was requested.";
      case "requested_app_server":
        return "used app-server because source=app-server was requested.";
      case "auto_preferred_app_server":
        return "used app-server because it satisfied the request.";
      case "auto_fallback_bridge_error":
        return "fell back to rollout because the app-server bridge was unavailable or failed.";
      case "auto_fallback_filter_miss":
        if (options.filterScope === "resume") {
          return "fell back to rollout because the app-server view returned no matches for the requested resume filters.";
        }
        return "fell back to rollout because the app-server view returned no matches for the requested structured transcript filters.";
      case "app_server_only_operation":
        return "used app-server because this operation is exact bridge-only.";
      case "rollout_only_view":
        return "used rollout because this view only reads rollout-derived history.";
      case "raw_history_requires_rollout":
        return "used rollout because history_mode=raw is only available from rollout history.";
      default:
        return "";
    }
  }

  function buildHistoryViewSource(requested, used, options = {}) {
    const requestedSource = normalizeHistoryViewSourceValue(requested, "auto");
    const usedSource = normalizeHistoryViewSourceValue(used, "rollout");
    const bridgeError = typeof options.bridgeError === "string" && options.bridgeError.trim()
      ? options.bridgeError.trim()
      : null;
    const selectionReason = inferHistoryViewSelectionReason(requestedSource, usedSource, {
      ...options,
      bridgeError,
    });
    const selectionNote = describeHistoryViewSelection(selectionReason, {
      ...options,
      bridgeError,
    });
    return {
      requested: requestedSource,
      used: usedSource,
      bridgeError,
      selectionReason,
      selectionNote,
    };
  }

  function buildHistoryQuality(sessionLike, filters = {}, source = null, purpose = "view") {
    const historyMode = normalizeHistoryMode(filters.historyMode || (sessionLike && sessionLike.historyMode));
    const sourceRequested = source && typeof source.requested === "string" && source.requested
      ? source.requested
      : "auto";
    const sourceUsed = source && typeof source.used === "string" && source.used
      ? source.used
      : "rollout";
    const memoryMode = getSessionRolloutMemoryMode(sessionLike) || "";
    const eventMode = getSessionRolloutEventMode(sessionLike) || "";
    const warnings = [];
    const recommendations = [];
    let mode = "derived_limited_rollout";

    if (historyMode === "raw") {
      mode = "raw_rollout_forensic";
      pushUniqueNote(
        warnings,
        "raw rollout history includes rolled-back or superseded turns that Codex will not resume."
      );
      pushUniqueNote(
        recommendations,
        "use history_mode=effective before loading context back into Codex."
      );
    } else if (sourceUsed === "app_server") {
      mode = "app_server_thread_view";
      pushUniqueNote(
        warnings,
        "thread/read turn items can be lossy for tool and result detail compared to the rollout file; upstream no longer exposes a client flag to persist extended history."
      );
      pushUniqueNote(
        recommendations,
        "use source=rollout when you need full event fidelity; thread/read stays exact for turn structure and persisted mutations."
      );
    } else if (eventMode === "extended_observed") {
      mode = "derived_extended_rollout";
    } else {
      mode = "derived_limited_rollout";
      pushUniqueNote(
        warnings,
        "rollout-derived history may be missing tool or result detail when extended event persistence was not observed."
      );
      pushUniqueNote(
        recommendations,
        "prefer source=app-server before loading this session back into Codex when the bridge is available."
      );
    }

    if (memoryMode === "disabled") {
      pushUniqueNote(
        warnings,
        "session_meta recorded memory_mode=disabled for this session."
      );
    } else if (memoryMode === "polluted") {
      pushUniqueNote(
        warnings,
        "session_meta recorded memory_mode=polluted for this session."
      );
      pushUniqueNote(
        recommendations,
        "review summaries against the raw transcript before reusing this session as memory."
      );
    }

    if (purpose === "prune") {
      pushUniqueNote(
        recommendations,
        "keep saved history edits on Codex-native thread/fork, thread/rollback, or thread/inject_items operations instead of rewriting rollout JSONL directly."
      );
    }

    return {
      purpose,
      mode,
      sourceRequested,
      sourceUsed,
      historyMode,
      memoryMode: memoryMode || null,
      eventMode: eventMode || null,
      warnings,
      recommendations,
    };
  }

  function normalizeReloadPolicy(value) {
    const text = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (text === "strict" || text === "allow") return text;
    return "warn";
  }

  function escalateSafetySeverity(current, next) {
    const rank = { safe: 0, caution: 1, unsafe: 2 };
    return (rank[next] || 0) > (rank[current] || 0) ? next : current;
  }

  function buildResumeReloadSafety(quality, source = null, filters = {}) {
    const policy = normalizeReloadPolicy(filters.reloadPolicy || filters.reload_policy);
    const reasons = [];
    const recommendations = [];
    const suggestedFlags = [];
    let severity = "safe";
    let recommendedSource = quality && typeof quality.sourceUsed === "string" ? quality.sourceUsed : null;

    if (quality && quality.mode === "raw_rollout_forensic") {
      severity = "unsafe";
      reasons.push("raw rollout history can reintroduce rolled-back or superseded turns into reload text.");
      recommendations.push("rerun resume with history_mode=effective before loading it back into Codex.");
      suggestedFlags.push("--history-mode effective");
    } else if (quality && quality.mode === "derived_limited_rollout") {
      severity = "caution";
      reasons.push("rollout-derived history may omit tool or result detail because extended event persistence was not observed.");
      if (quality.sourceUsed === "rollout") {
        recommendedSource = "app_server";
        recommendations.push("prefer source=app-server when the bridge is available.");
        suggestedFlags.push("--source app-server");
      }
    } else if (quality && quality.mode === "app_server_thread_view") {
      recommendations.push("prefer source=rollout when you need richer tool or result detail; thread/read views stay exact for turn structure.");
    }

    if (quality && quality.memoryMode === "polluted") {
      severity = escalateSafetySeverity(severity, "caution");
      reasons.push("session_meta recorded memory_mode=polluted for this session.");
      recommendations.push("review the transcript before reusing this session as memory.");
    }

    if (source && typeof source.bridgeError === "string" && source.bridgeError) {
      reasons.push(`app-server bridge fallback occurred: ${source.bridgeError}`);
    }

    const allowed = policy === "allow"
      ? true
      : (policy === "strict" ? severity === "safe" : severity !== "unsafe");
    const decision = !allowed ? "blocked" : (severity === "caution" ? "caution" : "ready");

    if (!allowed && policy !== "allow") {
      suggestedFlags.push("--reload-policy allow");
    }

    return {
      policy,
      severity,
      decision,
      allowed,
      requiresOverride: !allowed,
      qualityMode: quality && quality.mode ? quality.mode : "unknown",
      recommendedSource,
      reasons,
      recommendations,
      suggestedFlags: Array.from(new Set(suggestedFlags)),
    };
  }

  return {
    buildHistoryViewSource,
    buildHistoryQuality,
    buildResumeReloadSafety,
  };
}

module.exports = {
  createCatalogHistoryPolicy,
};
