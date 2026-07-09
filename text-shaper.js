"use strict";

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n/g, "\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

function normalizeTrimStrategy(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "tail" || text === "end") return "tail";
  if (text === "middle" || text === "both" || text === "head_tail") return "middle";
  return "head";
}

function trimLines(text, maxLines, strategy = "head") {
  if (!Number.isInteger(maxLines) || maxLines <= 0) return text;
  const lines = normalizeText(text).split("\n");
  if (lines.length <= maxLines) return lines.join("\n");

  const mode = normalizeTrimStrategy(strategy);
  const available = Math.max(1, maxLines - 1);
  if (mode === "tail") {
    return `...\n${lines.slice(-available).join("\n")}`;
  }
  if (mode === "middle") {
    const headCount = Math.max(1, Math.ceil(available * 0.6));
    const tailCount = Math.max(1, available - headCount);
    return `${lines.slice(0, headCount).join("\n")}\n...\n${lines.slice(-tailCount).join("\n")}`;
  }
  return `${lines.slice(0, available).join("\n")}\n...`;
}

function trimChars(text, maxChars, strategy = "head") {
  const source = normalizeText(text);
  if (!Number.isInteger(maxChars) || maxChars <= 0) return source;
  if (source.length <= maxChars) return source;
  if (maxChars <= 3) return source.slice(0, maxChars);

  const mode = normalizeTrimStrategy(strategy);
  if (mode === "tail") {
    return `...${source.slice(-(maxChars - 3))}`;
  }
  if (mode === "middle") {
    const marker = "\n...\n";
    if (maxChars <= marker.length + 2) {
      return `${source.slice(0, maxChars - 3)}...`;
    }
    const remaining = maxChars - marker.length;
    const headChars = Math.max(1, Math.ceil(remaining * 0.6));
    const tailChars = Math.max(1, remaining - headChars);
    return `${source.slice(0, headChars)}${marker}${source.slice(-tailChars)}`;
  }
  return `${source.slice(0, maxChars - 3)}...`;
}

function shapeText(value, options = {}) {
  let text = normalizeText(value);
  if (!text) return "";
  const strategy = normalizeTrimStrategy(options.strategy);
  if (Number.isInteger(options.maxLines) && options.maxLines > 0) {
    text = trimLines(text, options.maxLines, strategy);
  }
  if (Number.isInteger(options.maxChars) && options.maxChars > 0) {
    text = trimChars(text, options.maxChars, strategy);
  }
  return text;
}

module.exports = {
  normalizeTrimStrategy,
  trimChars,
  trimLines,
  shapeText,
};
