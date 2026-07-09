"use strict";

const { prefixedSessionId } = require("./history-session-id");
const { normalizeBridgeThreadSourceKind } = require("./app-server-thread-contract");

function ownValue(obj, ...keys) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  }
  return undefined;
}

function normalizeSourceText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSourceKey(value) {
  return normalizeSourceText(value).replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function normalizeCustomSessionSource(value) {
  const custom = normalizeSourceText(value);
  if (!custom) {
    return {
      source: "custom",
      sourceKind: "custom",
      sourceDetail: {
        type: "custom",
        value: null,
      },
    };
  }
  return {
    source: `custom:${custom}`,
    sourceKind: "custom",
    sourceDetail: {
      type: "custom",
      value: custom,
    },
  };
}

function normalizeThreadSpawnSource(value) {
  const spawn = value && typeof value === "object" ? value : {};
  const parentThreadId = prefixedSessionId(
    ownValue(spawn, "parentThreadId", "parent_thread_id")
  ) || null;
  const depth = Number.isInteger(spawn.depth) ? spawn.depth : null;
  return {
    source: "subAgentThreadSpawn",
    sourceKind: "subAgentThreadSpawn",
    sourceDetail: {
      type: "subAgent",
      variant: "threadSpawn",
      parentThreadId,
      depth,
      agentPath: normalizeSourceText(ownValue(spawn, "agentPath", "agent_path")) || null,
      agentNickname: normalizeSourceText(ownValue(spawn, "agentNickname", "agent_nickname")) || null,
      agentRole: normalizeSourceText(ownValue(spawn, "agentRole", "agent_role", "agent_type")) || null,
    },
  };
}

function normalizeSubAgentVariant(value) {
  const key = normalizeSourceKey(value);
  if (key === "review") {
    return {
      source: "subAgentReview",
      sourceKind: "subAgentReview",
      sourceDetail: {
        type: "subAgent",
        variant: "review",
      },
    };
  }
  if (key === "compact") {
    return {
      source: "subAgentCompact",
      sourceKind: "subAgentCompact",
      sourceDetail: {
        type: "subAgent",
        variant: "compact",
      },
    };
  }
  if (key === "memoryconsolidation") {
    return {
      source: "subAgent",
      sourceKind: "subAgent",
      sourceDetail: {
        type: "subAgent",
        variant: "memoryConsolidation",
      },
    };
  }
  if (key === "other") {
    return {
      source: "subAgentOther",
      sourceKind: "subAgentOther",
      sourceDetail: {
        type: "subAgent",
        variant: "other",
      },
    };
  }
  return {
    source: "subAgent",
    sourceKind: "subAgent",
    sourceDetail: {
      type: "subAgent",
      variant: normalizeSourceText(value) || "unknown",
    },
  };
}

function normalizeSubAgentSessionSource(value) {
  if (typeof value === "string" && value.trim()) {
    return normalizeSubAgentVariant(value);
  }

  if (!value || typeof value !== "object") {
    return {
      source: "subAgent",
      sourceKind: "subAgent",
      sourceDetail: {
        type: "subAgent",
        variant: "unknown",
      },
    };
  }

  if (Object.prototype.hasOwnProperty.call(value, "review")) {
    return normalizeSubAgentVariant("review");
  }
  if (Object.prototype.hasOwnProperty.call(value, "compact")) {
    return normalizeSubAgentVariant("compact");
  }

  const memoryConsolidation = ownValue(value, "memoryConsolidation", "memory_consolidation");
  if (memoryConsolidation !== undefined) {
    return normalizeSubAgentVariant("memoryConsolidation");
  }

  const threadSpawn = ownValue(value, "threadSpawn", "thread_spawn");
  if (threadSpawn !== undefined) {
    return normalizeThreadSpawnSource(threadSpawn);
  }

  if (Object.prototype.hasOwnProperty.call(value, "other")) {
    const other = normalizeSourceText(value.other);
    return {
      source: "subAgentOther",
      sourceKind: "subAgentOther",
      sourceDetail: {
        type: "subAgent",
        variant: "other",
        value: other || null,
      },
    };
  }

  return {
    source: "subAgent",
    sourceKind: "subAgent",
    sourceDetail: {
      type: "subAgent",
      variant: "unknown",
      raw: value,
    },
  };
}

function normalizeSessionSource(value) {
  if (typeof value === "string" && value.trim()) {
    const raw = value.trim();
    const sourceKind = normalizeBridgeThreadSourceKind(raw);
    return {
      source: sourceKind || raw,
      sourceKind: sourceKind || null,
      sourceDetail: null,
    };
  }

  if (!value || typeof value !== "object") {
    return {
      source: null,
      sourceKind: null,
      sourceDetail: null,
    };
  }

  const custom = ownValue(value, "custom");
  if (custom !== undefined) return normalizeCustomSessionSource(custom);

  const subAgent = ownValue(value, "subAgent", "subagent");
  if (subAgent !== undefined) return normalizeSubAgentSessionSource(subAgent);

  return {
    source: "unknown",
    sourceKind: "unknown",
    sourceDetail: {
      type: "raw",
      value,
    },
  };
}

module.exports = {
  normalizeSessionSource,
};
