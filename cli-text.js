"use strict";

function quoteShellArg(value) {
  const text = typeof value === "string" ? value : "";
  if (!text) return JSON.stringify(String(value ?? ""));
  return /^[A-Za-z0-9_./:-]+$/.test(text) ? text : JSON.stringify(text);
}

function formatChoiceList(values, conjunction = "or") {
  const items = Array.isArray(values)
    ? values.filter((value) => typeof value === "string" && value)
    : [];
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items[items.length - 1]}`;
}

module.exports = {
  quoteShellArg,
  formatChoiceList,
};
