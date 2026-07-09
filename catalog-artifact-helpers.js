"use strict";

const path = require("path");
const { looksLikeGlobPath } = require("./parser");

const HIGH_SIGNAL_COMMAND_OPS = new Set([
  "ack",
  "ag",
  "awk",
  "fd",
  "find",
  "grep",
  "jq",
  "perl",
  "pt",
  "rg",
  "rga",
  "sed",
]);

const LOW_SIGNAL_COMMAND_OPS = new Set([
  "basename",
  "cat",
  "cut",
  "date",
  "dirname",
  "echo",
  "head",
  "ls",
  "mkdir",
  "nl",
  "printf",
  "ps",
  "pwd",
  "readlink",
  "realpath",
  "sort",
  "stat",
  "tail",
  "tee",
  "tr",
  "uniq",
  "wc",
]);

function normalizeCwdValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePathComparisonValue(value) {
  return typeof value === "string"
    ? value.trim().replace(/\\/g, "/").toLowerCase()
    : "";
}

function hasEmbeddedExcludeSegment(value) {
  return typeof value === "string" && /(^|[\\/])![^\\/]/.test(value);
}

function normalizePathPatternCore(value) {
  const text = normalizeCwdValue(value);
  if (!text) return "";
  if (text.startsWith("!")) return text.slice(1);
  if (hasEmbeddedExcludeSegment(text)) {
    return text.replace(/(^|[\\/])!([^\\/])/, "$1$2");
  }
  return text;
}

function getPathPatternLeafName(value) {
  const core = normalizePathPatternCore(value);
  if (!core) return "";
  const parts = core.split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

function pathValueHasSeparator(value) {
  return typeof value === "string" && /[\\/]/.test(value);
}

function normalizeArtifactValue(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function matchesArtifactValue(candidate, value) {
  return normalizeArtifactValue(candidate) === normalizeArtifactValue(value);
}

function classifyPathPatternValue(value) {
  const text = normalizeCwdValue(value);
  if (!text) return "";
  const core = normalizePathPatternCore(text);
  if (!core) return text.startsWith("!") ? "exclude_pattern" : "";

  const hasGlob = looksLikeGlobPath(core);
  const hasSeparator = pathValueHasSeparator(core) || path.isAbsolute(core);

  if (text.startsWith("!") || hasEmbeddedExcludeSegment(text)) return "exclude_pattern";
  if (!hasSeparator && !hasGlob) return "basename_filter";
  if (hasGlob) return "glob_scope";
  if (hasSeparator) return "scoped_filter";
  return "pattern";
}

function getPathPatternQuerySortScore(value, query, cwd = "") {
  const queryText = normalizeCwdValue(query);
  if (!queryText) return 0;

  const kind = classifyPathPatternValue(value);
  const coreQuery = normalizePathPatternCore(queryText);
  const queryHasSeparator = pathValueHasSeparator(coreQuery) || path.isAbsolute(coreQuery);
  const queryHasGlob = looksLikeGlobPath(coreQuery);
  const isExcludeQuery = queryText.startsWith("!");
  const normalizedQuery = normalizeArtifactValue(coreQuery);
  const normalizedLeaf = normalizeArtifactValue(getPathPatternLeafName(value));
  let score = 0;

  if (matchesArtifactValue(value, queryText)) score += 200;
  else if (matchesArtifactValue(normalizePathPatternCore(value), coreQuery)) score += 180;
  if (matchesPathValue(value, queryText, cwd)) score += 80;
  if (normalizedQuery && normalizedLeaf === normalizedQuery) score += 25;

  if (isExcludeQuery) {
    if (kind === "exclude_pattern") score += 40;
  } else if (!queryHasSeparator && !queryHasGlob) {
    if (kind === "basename_filter") score += 40;
    else if (kind === "scoped_filter") score += 20;
    else if (kind === "glob_scope") score += 10;
    else if (kind === "exclude_pattern") score += 5;
  } else if (queryHasGlob) {
    if (kind === "glob_scope") score += 30;
    else if (kind === "exclude_pattern") score += 15;
    else if (kind === "scoped_filter") score += 10;
    else if (kind === "basename_filter") score += 5;
  } else if (queryHasSeparator) {
    if (kind === "scoped_filter") score += 30;
    else if (kind === "glob_scope") score += 20;
    else if (kind === "exclude_pattern") score += 10;
    else if (kind === "basename_filter") score += 5;
  }

  if (kind === "exclude_pattern" && !isExcludeQuery) score -= 5;
  return score;
}

function getQueryArtifactSortScore(value, query) {
  const text = typeof value === "string" ? value.trim() : "";
  const queryText = typeof query === "string" ? query.trim() : "";
  if (!text || !queryText) return 0;
  const normalizedValue = normalizeArtifactValue(text);
  const normalizedQuery = normalizeArtifactValue(queryText);
  if (!normalizedQuery) return 0;
  const index = normalizedValue.indexOf(normalizedQuery);
  if (index < 0) return 0;

  let score = 0;
  if (normalizedValue === normalizedQuery) score += 250;
  if (index === 0) score += 100;
  else score += Math.max(0, 60 - Math.min(index, 60));
  score += Math.max(0, 80 - Math.min(text.length - queryText.length, 80));
  return score;
}

function normalizeCommandOpValue(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function classifyCommandOpSignal(value) {
  const normalized = normalizeCommandOpValue(value);
  if (!normalized) return "";
  if (HIGH_SIGNAL_COMMAND_OPS.has(normalized)) return "high";
  if (LOW_SIGNAL_COMMAND_OPS.has(normalized)) return "low";
  return "medium";
}

function getCommandOpSignalRank(value) {
  const signalTier = classifyCommandOpSignal(value);
  if (signalTier === "high") return 0;
  if (signalTier === "medium") return 1;
  if (signalTier === "low") return 2;
  return 3;
}

function sortCommandOpValues(values) {
  if (!Array.isArray(values) || !values.length) return [];
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim())))
    .sort((left, right) => {
      const rankDiff = getCommandOpSignalRank(left) - getCommandOpSignalRank(right);
      if (rankDiff !== 0) return rankDiff;
      return left.localeCompare(right);
    });
}

function buildPathLookupVariants(value, cwd = "") {
  const text = normalizeCwdValue(value);
  if (!text) return [];

  const variants = [];
  const seen = new Set();
  const addVariant = (candidate) => {
    const normalized = normalizePathComparisonValue(candidate);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    variants.push(normalized);
  };

  addVariant(text);
  if (text.startsWith("~") || text.startsWith("$")) return variants;

  const normalizedRelative = path.normalize(text);
  if (normalizedRelative && normalizedRelative !== ".") addVariant(normalizedRelative);

  const baseCwd = normalizeCwdValue(cwd);
  if (baseCwd && path.isAbsolute(baseCwd)) {
    if (!path.isAbsolute(text)) {
      addVariant(path.resolve(baseCwd, normalizedRelative || text));
    } else {
      const relativeToCwd = path.relative(baseCwd, text);
      if (
        relativeToCwd &&
        relativeToCwd !== "." &&
        !relativeToCwd.startsWith(`..${path.sep}`) &&
        relativeToCwd !== ".." &&
        !path.isAbsolute(relativeToCwd)
      ) {
        addVariant(relativeToCwd);
      }
    }
  }

  return variants;
}

function matchesPathValue(candidate, value, cwd = "") {
  const candidateText = normalizePathComparisonValue(candidate);
  if (!candidateText) return false;

  const lookupText = normalizeCwdValue(value);
  const baseCwd = normalizeCwdValue(cwd);
  const variants = buildPathLookupVariants(value, cwd);

  for (const variant of variants) {
    if (candidateText === variant) return true;
  }

  if (baseCwd && path.isAbsolute(baseCwd) && lookupText && !path.isAbsolute(lookupText)) {
    return false;
  }

  for (const variant of variants) {
    if (pathValueHasSeparator(variant) && candidateText.endsWith(`/${variant}`)) {
      return true;
    }
  }

  return false;
}

function matchesPathNeedle(candidate, value, cwd = "") {
  const candidateText = normalizePathComparisonValue(candidate);
  if (!candidateText) return false;

  for (const variant of buildPathLookupVariants(value, cwd)) {
    if (!variant) continue;
    if (candidateText.includes(variant)) return true;
    if (pathValueHasSeparator(variant) && candidateText.endsWith(`/${variant}`)) {
      return true;
    }
  }

  return false;
}

function normalizeArtifactKind(kind) {
  const value = String(kind || "").trim().toLowerCase();
  if (!value) return null;
  if (value === "file" || value === "files") return "file";
  if (value === "path" || value === "paths") return "path";
  if (
    value === "path_pattern" ||
    value === "path-pattern" ||
    value === "pathpattern" ||
    value === "path_patterns" ||
    value === "path-patterns" ||
    value === "pathpatterns" ||
    value === "scope_pattern" ||
    value === "scope-pattern" ||
    value === "scopepattern" ||
    value === "scope_patterns" ||
    value === "scope-patterns" ||
    value === "scopepatterns" ||
    value === "pattern" ||
    value === "patterns"
  ) return "path_pattern";
  if (value === "tool" || value === "tools") return "tool";
  if (value === "command" || value === "commands") return "command";
  if (
    value === "command_op" ||
    value === "command-op" ||
    value === "commandop" ||
    value === "command_ops" ||
    value === "command-ops" ||
    value === "commandops" ||
    value === "shell_command" ||
    value === "shell-command" ||
    value === "shellcommand" ||
    value === "shell_commands" ||
    value === "shell-commands" ||
    value === "shellcommands" ||
    value === "op" ||
    value === "ops"
  ) return "command_op";
  if (value === "query" || value === "queries" || value === "search" || value === "searches") return "query";
  if (value === "error" || value === "errors") return "error";
  return null;
}

module.exports = {
  normalizeArtifactKind,
  normalizeArtifactValue,
  matchesArtifactValue,
  normalizePathComparisonValue,
  classifyPathPatternValue,
  getPathPatternQuerySortScore,
  getQueryArtifactSortScore,
  classifyCommandOpSignal,
  getCommandOpSignalRank,
  sortCommandOpValues,
  matchesPathValue,
  matchesPathNeedle,
};
