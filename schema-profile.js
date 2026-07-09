"use strict";

const fs = require("fs");
const { listRolloutFiles, resolveSessionDir, loadRolloutObjects } = require("./catalog");
const { normalizeRecordObject, summarizeText } = require("./parser");
const codexConfig = require("./config");

const DEFAULT_SCHEMA_REFRESH_MS = 60000;
const DEFAULT_SCHEMA_KEY_LIMIT = 25;
const DEFAULT_SCHEMA_FIELD_LIMIT = 20;
const DEFAULT_SCHEMA_SAMPLE_LIMIT = 3;

function toTimestampMs(value) {
  if (Number.isFinite(value)) return Number(value);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function summarizeValue(value, limit = 160) {
  if (value == null) return String(value);
  if (typeof value === "string") return summarizeText(value, limit);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return summarizeText(JSON.stringify(value), limit);
  } catch {
    return summarizeText(String(value), limit);
  }
}

function walkFieldPaths(value, prefix = "", out = []) {
  const path = prefix || "(root)";

  if (value == null || typeof value !== "object") {
    out.push({ path, sample: summarizeValue(value) });
    return out;
  }

  if (Array.isArray(value)) {
    if (!value.length) {
      out.push({ path, sample: "[]" });
      return out;
    }
    const hasObjectEntries = value.some((item) => item && typeof item === "object");
    if (!hasObjectEntries) {
      out.push({ path, sample: summarizeValue(value) });
      return out;
    }
    for (const item of value) {
      walkFieldPaths(item, `${path}[]`, out);
    }
    return out;
  }

  const entries = Object.entries(value);
  if (!entries.length) {
    out.push({ path, sample: "{}" });
    return out;
  }
  for (const [key, child] of entries) {
    walkFieldPaths(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

function createFieldStats() {
  return {
    count: 0,
    samples: [],
  };
}

function observeField(map, path, sample) {
  if (!path) return;
  let entry = map.get(path);
  if (!entry) {
    entry = createFieldStats();
    map.set(path, entry);
  }
  entry.count += 1;
  if (sample && !entry.samples.includes(sample) && entry.samples.length < DEFAULT_SCHEMA_SAMPLE_LIMIT) {
    entry.samples.push(sample);
  }
}

function finalizeFieldStats(map, total, limit = DEFAULT_SCHEMA_FIELD_LIMIT) {
  return Array.from(map.entries())
    .map(([path, entry]) => ({
      path,
      count: entry.count,
      coverage: total > 0 ? Number((entry.count / total).toFixed(4)) : 0,
      samples: entry.samples,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.path.localeCompare(b.path);
    })
    .slice(0, limit);
}

function extractRawFieldEntries(obj) {
  if (!obj || typeof obj !== "object") return [];
  const source = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "timestamp" || key === "type") continue;
    source[key] = value;
  }
  return walkFieldPaths(source).filter((entry) => entry.path && entry.path !== "(root)");
}

function extractNormalizedFieldEntries(record) {
  const source = {
    turnId: record.turnId || null,
    cwd: record.cwd || null,
    role: record.role || null,
    phase: record.phase || null,
    toolName: record.toolName || null,
    toolClass: record.toolClass || null,
    toolStatus: record.toolStatus || null,
    command: record.command || null,
    commandSource: record.commandSource || null,
    commandTypes: record.commandTypes || null,
    commandPaths: record.commandPaths || null,
    commandQueries: record.commandQueries || null,
    query: record.query || null,
    queries: record.queries || null,
    actionType: record.actionType || null,
    success: Object.prototype.hasOwnProperty.call(record, "success") ? record.success : null,
    text: record.text ? summarizeText(record.text, 160) : null,
    output: record.output || null,
    error: record.error || null,
    patch: record.patch || null,
    tokenUsage: record.tokenUsage || null,
    rateLimits: record.rateLimits || null,
    sessionMeta: record.sessionMeta || null,
    turnContext: record.turnContext || null,
    mcp: record.mcp || null,
    permissionDetail: record.permissionDetail || null,
  };
  return walkFieldPaths(source).filter((entry) => {
    if (!entry.path || entry.path === "(root)") return false;
    return entry.sample !== "null" && entry.sample !== "undefined" && entry.sample !== "";
  });
}

function createSchemaEntry(key, kind) {
  return {
    key,
    kind,
    count: 0,
    firstSeenAt: null,
    lastSeenAt: null,
    samplePreview: "",
    sampleFilePath: "",
    rawFields: new Map(),
    normalizedFields: new Map(),
  };
}

function entryMatches(entry, query) {
  const q = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!q) return true;
  if ((entry.key || "").toLowerCase().includes(q)) return true;
  if ((entry.kind || "").toLowerCase().includes(q)) return true;
  if ((entry.samplePreview || "").toLowerCase().includes(q)) return true;
  for (const field of entry.rawFields) {
    if (field.path.toLowerCase().includes(q)) return true;
    if (field.samples.some((sample) => sample.toLowerCase().includes(q))) return true;
  }
  for (const field of entry.normalizedFields) {
    if (field.path.toLowerCase().includes(q)) return true;
    if (field.samples.some((sample) => sample.toLowerCase().includes(q))) return true;
  }
  return false;
}

function collectSchemaProfile(options = {}) {
  const sessionDir = resolveSessionDir(options.sessionDir);
  const files = listRolloutFiles(sessionDir, options);
  const entries = new Map();
  let recordCount = 0;

  for (const filePath of files) {
    let text;
    try {
      text = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    for (const obj of loadRolloutObjects(filePath, text)) {
      if (!obj || typeof obj !== "object") continue;

      const record = normalizeRecordObject(obj, {
        logEventMap: codexConfig.logEventMap,
      });
      const key = record && typeof record.key === "string" ? record.key : `${obj.type || "unknown"}:unknown`;
      const kind = record && typeof record.kind === "string" ? record.kind : "unknown";
      let entry = entries.get(key);
      if (!entry) {
        entry = createSchemaEntry(key, kind);
        entries.set(key, entry);
      }

      entry.count += 1;
      recordCount += 1;
      const timestampMs = toTimestampMs(obj.timestamp);
      if (timestampMs != null) {
        const iso = new Date(timestampMs).toISOString();
        if (!entry.firstSeenAt || timestampMs < (toTimestampMs(entry.firstSeenAt) || Number.POSITIVE_INFINITY)) {
          entry.firstSeenAt = iso;
        }
        if (!entry.lastSeenAt || timestampMs > (toTimestampMs(entry.lastSeenAt) || 0)) {
          entry.lastSeenAt = iso;
        }
      }
      if (!entry.samplePreview) {
        entry.samplePreview = summarizeText(record && record.preview ? record.preview : key, 160);
        entry.sampleFilePath = filePath;
      }

      for (const field of extractRawFieldEntries(obj)) {
        observeField(entry.rawFields, field.path, field.sample);
      }
      for (const field of extractNormalizedFieldEntries(record)) {
        observeField(entry.normalizedFields, field.path, field.sample);
      }
    }
  }

  const finalized = Array.from(entries.values())
    .map((entry) => ({
      key: entry.key,
      kind: entry.kind,
      count: entry.count,
      firstSeenAt: entry.firstSeenAt,
      lastSeenAt: entry.lastSeenAt,
      samplePreview: entry.samplePreview,
      sampleFilePath: entry.sampleFilePath,
      rawFieldCount: entry.rawFields.size,
      normalizedFieldCount: entry.normalizedFields.size,
      rawFields: finalizeFieldStats(entry.rawFields, entry.count),
      normalizedFields: finalizeFieldStats(entry.normalizedFields, entry.count),
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.key.localeCompare(b.key);
    });

  const matched = finalized.filter((entry) => entryMatches(entry, options.q));

  return {
    generatedAt: new Date().toISOString(),
    sessionDir,
    fileCount: files.length,
    recordCount,
    totalKeys: finalized.length,
    totalMatchedKeys: matched.length,
    limit: DEFAULT_SCHEMA_KEY_LIMIT,
    truncated: false,
    keys: finalized,
  };
}

function filterSchemaProfile(profile, filters = {}) {
  const limit = Number.isInteger(filters.limit) && filters.limit > 0
    ? filters.limit
    : profile.limit;
  const matched = (profile.keys || []).filter((entry) => entryMatches(entry, filters.q));
  return {
    generatedAt: profile.generatedAt,
    sessionDir: profile.sessionDir,
    fileCount: profile.fileCount,
    recordCount: profile.recordCount,
    totalKeys: profile.totalKeys,
    totalMatchedKeys: matched.length,
    limit,
    truncated: matched.length > limit,
    keys: matched.slice(0, limit),
  };
}

function buildSchemaProfile(options = {}) {
  return filterSchemaProfile(collectSchemaProfile(options), options);
}

function createSchemaProfileStore(options = {}) {
  const refreshMs = Number.isInteger(options.refreshMs) && options.refreshMs >= 0
    ? options.refreshMs
    : DEFAULT_SCHEMA_REFRESH_MS;
  let cache = null;
  let builtAt = 0;

  function getProfile(filters = {}) {
    const now = Date.now();
    if (!filters.refresh && cache && now - builtAt <= refreshMs) {
      return filterSchemaProfile(cache, filters);
    }
    cache = collectSchemaProfile(options);
    builtAt = now;
    return filterSchemaProfile(cache, filters);
  }

  return {
    getProfile,
  };
}

module.exports = {
  buildSchemaProfile,
  createSchemaProfileStore,
};
