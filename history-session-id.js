"use strict";

function prefixedSessionId(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.startsWith("codex:") ? text : `codex:${text}`;
}

function unprefixedSessionId(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.startsWith("codex:") ? text.slice("codex:".length) : text;
}

module.exports = {
  prefixedSessionId,
  unprefixedSessionId,
};
