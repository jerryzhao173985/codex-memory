"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeArtifactKind,
  classifyPathPatternValue,
  getPathPatternQuerySortScore,
  classifyCommandOpSignal,
  sortCommandOpValues,
  matchesPathValue,
  matchesPathNeedle,
} = require("../catalog-artifact-helpers");

test("catalog artifact helpers normalize artifact aliases and command-op signal ordering", () => {
  assert.strictEqual(normalizeArtifactKind("scope-patterns"), "path_pattern");
  assert.strictEqual(normalizeArtifactKind("shell_commands"), "command_op");
  assert.strictEqual(normalizeArtifactKind("searches"), "query");

  assert.strictEqual(classifyCommandOpSignal("rg"), "high");
  assert.strictEqual(classifyCommandOpSignal("ls"), "low");
  assert.strictEqual(classifyCommandOpSignal("python"), "medium");
  assert.deepStrictEqual(sortCommandOpValues(["ls", "python", "rg", "rg", "cat"]), ["rg", "python", "cat", "ls"]);
});

test("catalog artifact helpers prefer stronger path-pattern matches and resolve cwd-relative paths", () => {
  assert.strictEqual(classifyPathPatternValue("AGENTS.md"), "basename_filter");
  assert.strictEqual(classifyPathPatternValue("src/**/*.js"), "glob_scope");
  assert.strictEqual(classifyPathPatternValue("!dist/**"), "exclude_pattern");

  const basenameScore = getPathPatternQuerySortScore("AGENTS.md", "AGENTS.md", "/repo/app");
  const globScore = getPathPatternQuerySortScore("**/AGENTS.md", "AGENTS.md", "/repo/app");
  assert.ok(basenameScore > globScore);

  assert.equal(matchesPathValue("/repo/app/src/file.js", "src/file.js", "/repo/app"), true);
  assert.equal(matchesPathValue("/repo/app/src/file.js", "file.js", "/repo/app"), false);
  assert.equal(matchesPathNeedle("/repo/app/src/file.js", "src/file.js", "/repo/app"), true);
  assert.equal(matchesPathNeedle("/repo/app/src/file.js", "file.js", "/repo/app"), true);
});
