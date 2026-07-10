"use strict";

const { unprefixedSessionId } = require("./history-session-id");

const BRIDGE_CANONICAL_THREAD_SORT_KEYS = Object.freeze([
  "created_at",
  "updated_at",
  "recency_at",
]);

const BRIDGE_CANONICAL_THREAD_SOURCE_KINDS = Object.freeze([
  "cli",
  "vscode",
  "exec",
  "appServer",
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
  "unknown",
]);

const BRIDGE_THREAD_SORT_KEYS = new Map([
  ["createdat", "created_at"],
  ["updatedat", "updated_at"],
  ["recencyat", "recency_at"],
]);

const BRIDGE_CANONICAL_THREAD_SORT_DIRECTIONS = Object.freeze([
  "asc",
  "desc",
]);

const BRIDGE_THREAD_SORT_DIRECTIONS = new Map([
  ["asc", "asc"],
  ["ascending", "asc"],
  ["desc", "desc"],
  ["descending", "desc"],
]);

const BRIDGE_THREAD_SOURCE_KINDS = new Map([
  ["cli", "cli"],
  ["vscode", "vscode"],
  ["exec", "exec"],
  ["appserver", "appServer"],
  ["mcp", "appServer"],
  ["subagent", "subAgent"],
  ["subagentreview", "subAgentReview"],
  ["subagentcompact", "subAgentCompact"],
  ["subagentthreadspawn", "subAgentThreadSpawn"],
  ["subagentother", "subAgentOther"],
  ["unknown", "unknown"],
]);

function createBridgeContractError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function normalizeBridgeIdentifier(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeBridgeIdentifierKey(value) {
  return normalizeBridgeIdentifier(value).replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function normalizeBridgeThreadId(value) {
  return unprefixedSessionId(value) || "";
}

function requireBridgeThreadId(value) {
  const threadId = normalizeBridgeThreadId(value);
  if (!threadId) {
    throw createBridgeContractError("thread id is required", "APP_SERVER_INVALID_THREAD");
  }
  return threadId;
}

function normalizeBridgeThreadMemoryMode(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "enabled" || text === "disabled") return text;
  throw createBridgeContractError(
    "memory mode must be enabled or disabled",
    "APP_SERVER_INVALID_MEMORY_MODE"
  );
}

function normalizeBridgeMetadataValue(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw createBridgeContractError(
      `${fieldName} must be a string or null`,
      "APP_SERVER_INVALID_METADATA"
    );
  }
  const text = value.trim();
  if (!text) {
    throw createBridgeContractError(
      `${fieldName} must be a non-empty string`,
      "APP_SERVER_INVALID_METADATA"
    );
  }
  return text;
}

function normalizeBridgeGitInfoPatch(patch = {}) {
  if (!patch || typeof patch !== "object") return null;

  const gitInfo = {};
  const branch = normalizeBridgeMetadataValue(patch.branch, "git branch");
  const sha = normalizeBridgeMetadataValue(patch.sha, "git sha");
  const originUrl = normalizeBridgeMetadataValue(patch.originUrl, "git origin url");

  if (branch !== undefined) gitInfo.branch = branch;
  if (sha !== undefined) gitInfo.sha = sha;
  if (originUrl !== undefined) gitInfo.originUrl = originUrl;

  return Object.keys(gitInfo).length ? gitInfo : null;
}

function requireBridgeGitInfoPatch(patch = {}) {
  const gitInfo = normalizeBridgeGitInfoPatch(patch);
  if (!gitInfo) {
    throw createBridgeContractError("metadata patch is required", "APP_SERVER_INVALID_METADATA");
  }
  return gitInfo;
}

function normalizeBridgeOptionalBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (!text) return null;
  if (text === "1" || text === "true" || text === "yes") return true;
  if (text === "0" || text === "false" || text === "no") return false;
  return null;
}

function collectBridgeStringList(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectBridgeStringList(item));
  }
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueBridgeStringList(values) {
  return Array.from(new Set(values));
}

function normalizeBridgeThreadListValues(value, fieldName, normalizer = null) {
  if (value === undefined) return undefined;
  if (value === null) return undefined;

  if (typeof value === "string") {
    if (!value.trim()) {
      throw createBridgeContractError(
        `${fieldName} value is required`,
        "APP_SERVER_INVALID_THREAD_LIST"
      );
    }
    const values = uniqueBridgeStringList(collectBridgeStringList(value));
    return normalizer ? uniqueBridgeStringList(values.map(normalizer)) : values;
  }

  if (Array.isArray(value)) {
    const values = uniqueBridgeStringList(collectBridgeStringList(value));
    if (value.length > 0 && values.length === 0) {
      throw createBridgeContractError(
        `${fieldName} value is required`,
        "APP_SERVER_INVALID_THREAD_LIST"
      );
    }
    return normalizer ? uniqueBridgeStringList(values.map(normalizer)) : values;
  }

  return undefined;
}

function normalizeBridgeRequiredScalarValue(value, fieldName, normalizer) {
  if (value === undefined || value === null) return undefined;
  const text = normalizeBridgeIdentifier(value);
  if (!text) {
    throw createBridgeContractError(
      `${fieldName} is required`,
      "APP_SERVER_INVALID_THREAD_LIST"
    );
  }
  return normalizer ? normalizer(text) : text;
}

function normalizeBridgeThreadSortKey(value) {
  const key = normalizeBridgeIdentifierKey(value);
  return BRIDGE_THREAD_SORT_KEYS.get(key) || null;
}

function requireBridgeThreadSortKey(value) {
  const sortKey = normalizeBridgeThreadSortKey(value);
  if (!sortKey) {
    throw createBridgeContractError(
      `sort key must be one of ${BRIDGE_CANONICAL_THREAD_SORT_KEYS.join(", ")}`,
      "APP_SERVER_INVALID_THREAD_LIST"
    );
  }
  return sortKey;
}

function normalizeBridgeThreadSortDirection(value) {
  const key = normalizeBridgeIdentifierKey(value);
  return BRIDGE_THREAD_SORT_DIRECTIONS.get(key) || null;
}

function requireBridgeThreadSortDirection(value) {
  const sortDirection = normalizeBridgeThreadSortDirection(value);
  if (!sortDirection) {
    throw createBridgeContractError(
      `sort direction must be one of ${BRIDGE_CANONICAL_THREAD_SORT_DIRECTIONS.join(", ")}`,
      "APP_SERVER_INVALID_THREAD_LIST"
    );
  }
  return sortDirection;
}

function normalizeBridgeThreadSourceKind(value) {
  const key = normalizeBridgeIdentifierKey(value);
  return BRIDGE_THREAD_SOURCE_KINDS.get(key) || null;
}

function requireBridgeThreadSourceKind(value) {
  const sourceKind = normalizeBridgeThreadSourceKind(value);
  if (!sourceKind) {
    throw createBridgeContractError(
      `source kind must be one of ${BRIDGE_CANONICAL_THREAD_SOURCE_KINDS.join(", ")}`,
      "APP_SERVER_INVALID_THREAD_LIST"
    );
  }
  return sourceKind;
}

function resolveBridgeListValue(params, primaryKey, aliases = []) {
  if (!params || typeof params !== "object") return undefined;
  for (const key of [primaryKey, ...aliases]) {
    if (Object.prototype.hasOwnProperty.call(params, key)) return params[key];
  }
  return undefined;
}

function normalizeBridgeThreadListParams(params = {}) {
  const sortValue = resolveBridgeListValue(params, "sortKey", ["sort", "sort_key"]);
  const sortDirectionValue = resolveBridgeListValue(params, "sortDirection", [
    "sort_direction",
    "direction",
  ]);
  const providerValue = resolveBridgeListValue(params, "modelProviders", [
    "modelProvider",
    "model_providers",
    "model_provider",
  ]);
  const sourceKindValue = resolveBridgeListValue(params, "sourceKinds", [
    "sourceKind",
    "source_kinds",
    "source_kind",
  ]);
  const searchTermValue = resolveBridgeListValue(params, "searchTerm", [
    "q",
    "search_term",
    "query",
  ]);

  const normalized = {
    cursor: normalizeBridgeIdentifier(params.cursor) || undefined,
    limit: Number.isInteger(params.limit) && params.limit > 0
      ? params.limit
      : (Number.isInteger(Number(params.limit)) && Number(params.limit) > 0 ? Number(params.limit) : undefined),
    sortKey: normalizeBridgeRequiredScalarValue(sortValue, "sort key", requireBridgeThreadSortKey),
    sortDirection: normalizeBridgeRequiredScalarValue(sortDirectionValue, "sort direction", requireBridgeThreadSortDirection),
    // Upstream useStateDbOnly is a plain bool (not nullable); omit when unset.
    useStateDbOnly: normalizeBridgeOptionalBoolean(
      resolveBridgeListValue(params, "useStateDbOnly", ["use_state_db_only", "state_db_only"])
    ) ?? undefined,
    modelProviders: normalizeBridgeThreadListValues(providerValue, "model-provider"),
    sourceKinds: normalizeBridgeThreadListValues(
      sourceKindValue,
      "source-kind",
      requireBridgeThreadSourceKind
    ),
    archived: normalizeBridgeOptionalBoolean(resolveBridgeListValue(params, "archived")),
    cwd: normalizeBridgeIdentifier(resolveBridgeListValue(params, "cwd")) || undefined,
    searchTerm: normalizeBridgeIdentifier(searchTermValue) || undefined,
  };

  return normalized;
}

// thread/search shares the list vocabulary but REQUIRES a search term and has
// no cwd/provider/state-db filters (upstream ThreadSearchParams, v2/thread.rs).
function normalizeBridgeThreadSearchParams(params = {}) {
  const searchTermValue = resolveBridgeListValue(params, "searchTerm", [
    "q",
    "search_term",
    "query",
  ]);
  const searchTerm = normalizeBridgeIdentifier(searchTermValue);
  if (!searchTerm) {
    throw createBridgeContractError(
      "search term is required",
      "APP_SERVER_INVALID_THREAD_SEARCH"
    );
  }
  const sortValue = resolveBridgeListValue(params, "sortKey", ["sort", "sort_key"]);
  const sortDirectionValue = resolveBridgeListValue(params, "sortDirection", [
    "sort_direction",
    "direction",
  ]);
  const sourceKindValue = resolveBridgeListValue(params, "sourceKinds", [
    "sourceKind",
    "source_kinds",
    "source_kind",
  ]);
  return {
    searchTerm,
    cursor: normalizeBridgeIdentifier(params.cursor) || undefined,
    limit: Number.isInteger(params.limit) && params.limit > 0
      ? params.limit
      : (Number.isInteger(Number(params.limit)) && Number(params.limit) > 0 ? Number(params.limit) : undefined),
    sortKey: normalizeBridgeRequiredScalarValue(sortValue, "sort key", requireBridgeThreadSortKey),
    sortDirection: normalizeBridgeRequiredScalarValue(sortDirectionValue, "sort direction", requireBridgeThreadSortDirection),
    sourceKinds: normalizeBridgeThreadListValues(
      sourceKindValue,
      "source-kind",
      requireBridgeThreadSourceKind
    ),
    archived: normalizeBridgeOptionalBoolean(resolveBridgeListValue(params, "archived")),
  };
}

const BRIDGE_CANONICAL_TURN_ITEMS_VIEWS = Object.freeze([
  "notLoaded",
  "summary",
  "full",
]);

const BRIDGE_TURN_ITEMS_VIEWS = new Map([
  ["notloaded", "notLoaded"],
  ["summary", "summary"],
  ["full", "full"],
]);

function normalizeBridgeTurnItemsView(value) {
  const key = normalizeBridgeIdentifierKey(value);
  return BRIDGE_TURN_ITEMS_VIEWS.get(key) || null;
}

function requireBridgeTurnItemsView(value) {
  const itemsView = normalizeBridgeTurnItemsView(value);
  if (!itemsView) {
    throw createBridgeContractError(
      `items view must be one of ${BRIDGE_CANONICAL_TURN_ITEMS_VIEWS.join(", ")}`,
      "APP_SERVER_INVALID_TURNS_LIST"
    );
  }
  return itemsView;
}

function normalizeBridgeTurnsListParams(params = {}) {
  const sortDirectionValue = resolveBridgeListValue(params, "sortDirection", [
    "sort_direction",
    "direction",
  ]);
  const itemsViewValue = resolveBridgeListValue(params, "itemsView", [
    "items_view",
    "view",
  ]);
  return {
    cursor: normalizeBridgeIdentifier(params.cursor) || undefined,
    limit: Number.isInteger(params.limit) && params.limit > 0
      ? params.limit
      : (Number.isInteger(Number(params.limit)) && Number(params.limit) > 0 ? Number(params.limit) : undefined),
    sortDirection: normalizeBridgeRequiredScalarValue(sortDirectionValue, "sort direction", requireBridgeThreadSortDirection),
    itemsView: normalizeBridgeRequiredScalarValue(itemsViewValue, "items view", requireBridgeTurnItemsView),
  };
}

const BRIDGE_CANONICAL_THREAD_GOAL_STATUSES = Object.freeze([
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
]);

const BRIDGE_THREAD_GOAL_STATUSES = new Map(
  BRIDGE_CANONICAL_THREAD_GOAL_STATUSES.map((status) => [status.toLowerCase(), status])
);

function normalizeBridgeThreadGoalStatus(value) {
  const key = normalizeBridgeIdentifierKey(value);
  return BRIDGE_THREAD_GOAL_STATUSES.get(key) || null;
}

function requireBridgeThreadGoalStatus(value) {
  const status = normalizeBridgeThreadGoalStatus(value);
  if (!status) {
    throw createBridgeContractError(
      `goal status must be one of ${BRIDGE_CANONICAL_THREAD_GOAL_STATUSES.join(", ")}`,
      "APP_SERVER_INVALID_GOAL"
    );
  }
  return status;
}

// thread/goal/set semantics: omitted fields keep their value; tokenBudget is a
// double-option upstream (omit = keep, null = clear).
function normalizeBridgeGoalSetPatch(patch = {}) {
  const normalized = {};
  if (patch.objective !== undefined) {
    if (typeof patch.objective !== "string" || !patch.objective.trim()) {
      throw createBridgeContractError("goal objective must be a non-empty string", "APP_SERVER_INVALID_GOAL");
    }
    normalized.objective = patch.objective.trim();
  }
  if (patch.status !== undefined) {
    normalized.status = requireBridgeThreadGoalStatus(patch.status);
  }
  if (patch.clearTokenBudget === true) {
    normalized.tokenBudget = null;
  } else if (patch.tokenBudget !== undefined) {
    const budget = Number(patch.tokenBudget);
    if (!Number.isInteger(budget) || budget <= 0) {
      throw createBridgeContractError("token budget must be a positive integer", "APP_SERVER_INVALID_GOAL");
    }
    normalized.tokenBudget = budget;
  }
  if (!Object.keys(normalized).length) {
    throw createBridgeContractError(
      "goal update needs --objective, --goal-status, --token-budget, or --clear-token-budget",
      "APP_SERVER_INVALID_GOAL"
    );
  }
  return normalized;
}

function normalizeBridgeLoadedListParams(params = {}) {
  return {
    cursor: normalizeBridgeIdentifier(params.cursor) || undefined,
    limit: Number.isInteger(params.limit) && params.limit > 0
      ? params.limit
      : (Number.isInteger(Number(params.limit)) && Number(params.limit) > 0 ? Number(params.limit) : undefined),
  };
}

function normalizeBridgeRollbackTurns(value) {
  const normalizedTurns = Number(value);
  if (!Number.isInteger(normalizedTurns) || normalizedTurns < 1) {
    throw createBridgeContractError(
      "num_turns must be a positive integer",
      "APP_SERVER_INVALID_ROLLBACK"
    );
  }
  return normalizedTurns;
}

function normalizeBridgeThreadName(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw createBridgeContractError("thread name is required", "APP_SERVER_INVALID_NAME");
  }
  return value.trim();
}

function requireBridgeThreadPayload(response, methodName) {
  if (!response || !response.thread || typeof response.thread !== "object") {
    throw createBridgeContractError(
      `${methodName} response missing thread payload`,
      "APP_SERVER_INVALID_RESPONSE"
    );
  }
  return response.thread;
}

module.exports = {
  BRIDGE_CANONICAL_THREAD_SORT_KEYS,
  BRIDGE_CANONICAL_THREAD_SORT_DIRECTIONS,
  BRIDGE_CANONICAL_THREAD_SOURCE_KINDS,
  BRIDGE_CANONICAL_TURN_ITEMS_VIEWS,
  BRIDGE_CANONICAL_THREAD_GOAL_STATUSES,
  normalizeBridgeThreadSearchParams,
  normalizeBridgeTurnsListParams,
  normalizeBridgeTurnItemsView,
  requireBridgeTurnItemsView,
  normalizeBridgeThreadGoalStatus,
  requireBridgeThreadGoalStatus,
  normalizeBridgeGoalSetPatch,
  normalizeBridgeOptionalBoolean,
  normalizeBridgeThreadId,
  requireBridgeThreadId,
  normalizeBridgeThreadMemoryMode,
  normalizeBridgeMetadataValue,
  normalizeBridgeGitInfoPatch,
  requireBridgeGitInfoPatch,
  normalizeBridgeThreadSortKey,
  requireBridgeThreadSortKey,
  normalizeBridgeThreadSortDirection,
  requireBridgeThreadSortDirection,
  normalizeBridgeThreadSourceKind,
  requireBridgeThreadSourceKind,
  normalizeBridgeThreadListParams,
  normalizeBridgeLoadedListParams,
  normalizeBridgeRollbackTurns,
  normalizeBridgeThreadName,
  requireBridgeThreadPayload,
};
