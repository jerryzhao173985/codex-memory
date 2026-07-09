"use strict";

const {
  inferCommandHints,
  inferShellCommandStructure,
  looksLikeGlobPath,
} = require("./parser-shell-hints");
const { createParserRecordNormalization } = require("./parser-record-normalization");

const DEFAULT_PREVIEW_LIMIT = 500;

function safeJsonParse(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim();
}

function captureText(value, limit = 4000) {
  const text = cleanText(value);
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

function summarizeText(value, limit = DEFAULT_PREVIEW_LIMIT) {
  const text = cleanText(value);
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}...`;
}

function extractTextFromContent(content) {
  if (!content) return "";
  if (typeof content === "string") return captureText(content);
  if (!Array.isArray(content)) return "";

  const parts = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.text === "string" && item.text) {
      parts.push(item.text);
      continue;
    }
    if (Array.isArray(item.content)) {
      const nested = extractTextFromContent(item.content);
      if (nested) parts.push(nested);
    }
  }
  return captureText(parts.join("\n\n"));
}

function extractReasoningSummary(summary) {
  if (!Array.isArray(summary)) return "";
  const parts = [];
  for (const item of summary) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.text === "string" && item.text) parts.push(item.text);
  }
  return captureText(parts.join("\n\n"));
}

function parseToolArguments(argumentsValue) {
  const parsed = safeJsonParse(argumentsValue);
  return parsed && typeof parsed === "object" ? parsed : null;
}

function parseDurationMs(duration) {
  if (!duration || typeof duration !== "object") return null;
  const secs = Number(duration.secs || 0);
  const nanos = Number(duration.nanos || 0);
  if (!Number.isFinite(secs) || !Number.isFinite(nanos)) return null;
  return Math.round((secs * 1000) + (nanos / 1e6));
}

const {
  parsePatchInput,
  summarizePatchChanges,
  parseWrappedCommandOutput,
  parseErrorMetadata,
  normalizeSessionMeta,
  normalizeTurnContext,
  deriveStateSignal,
  normalizeRecordObject,
  createSyntheticPermissionRecord,
  summarizeRecord,
} = createParserRecordNormalization({
  safeJsonParse,
  summarizeText,
  captureText,
  extractTextFromContent,
  extractReasoningSummary,
  parseToolArguments,
  parseDurationMs,
});

module.exports = {
  safeJsonParse,
  summarizeText,
  extractTextFromContent,
  extractReasoningSummary,
  parseToolArguments,
  parsePatchInput,
  summarizePatchChanges,
  parseWrappedCommandOutput,
  inferCommandHints,
  inferShellCommandStructure,
  looksLikeGlobPath,
  normalizeSessionMeta,
  normalizeTurnContext,
  deriveStateSignal,
  normalizeRecordObject,
  parseErrorMetadata,
  createSyntheticPermissionRecord,
  summarizeRecord,
};
