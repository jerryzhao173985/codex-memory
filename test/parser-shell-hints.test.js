const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  inferCommandHints,
  inferShellCommandStructure,
  looksLikeGlobPath,
} = require("../parser-shell-hints");

describe("parser shell hints", () => {
  it("detects glob-like path values", () => {
    assert.strictEqual(looksLikeGlobPath("src/**/*.js"), true);
    assert.strictEqual(looksLikeGlobPath("AGENTS.md"), false);
  });

  it("infers command hints for raw search and list command families", () => {
    assert.deepStrictEqual(
      inferCommandHints("rg --glob '*.test.js' --glob '!dist/*' foo src"),
      {
        types: ["search"],
        paths: ["src"],
        patterns: ["*.test.js", "!dist/*"],
        queries: ["foo"],
      }
    );

    assert.deepStrictEqual(
      inferCommandHints("git ls-files --exclude target src"),
      {
        types: ["list_files"],
        paths: ["src"],
        patterns: ["target"],
        queries: [],
      }
    );
  });

  it("filters heredoc bodies and shell scaffolding from shell structure", () => {
    const structure = inferShellCommandStructure(
      "set -euo pipefail\n" +
      "cd /repo\n" +
      "repo=\"$(pwd)\"\n" +
      "while IFS= read -r p; do\n" +
      "  if [ -z \"$p\" ]; then continue; fi\n" +
      "  if [ -e \"$p\" ]; then\n" +
      "    python3 - <<'PY' \"$repo\" \"$p\"\n" +
      "print(1)\n" +
      "PY\n" +
      "  fi\n" +
      "done < \"$existing\" | sort -u | sed -n '1,40p'"
    );

    assert.deepStrictEqual(structure.shellCommands, ["python3", "sort", "sed"]);
    assert.deepStrictEqual(structure.commandTypeHints, ["read"]);
  });

  it("captures command substitutions without turning assignment operands into fake commands", () => {
    const structure = inferShellCommandStructure(
      "latest=$(find \"$HOME/.codex/sessions\" -name 'rollout-*.jsonl' | sort | tail -n 1)\n" +
      "echo \"$latest\"\n" +
      "node codex/inspect.js \"$latest\" | head -n 8"
    );

    assert.deepStrictEqual(
      [...structure.shellCommands].sort(),
      ["echo", "find", "head", "node", "sort", "tail"]
    );
    assert.deepStrictEqual(structure.commandTypeHints, ["read", "search"]);
  });
});
