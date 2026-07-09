const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  buildQuerySearchCandidates,
  findSearchCandidateMatches,
  getSessionQuerySearchCandidates,
} = require("../session-search");

describe("session search", () => {
  it("deduplicates escaped query variants and keeps the cleaner representation", () => {
    const candidates = buildQuerySearchCandidates([
      "matchedPathPatterns|AGENTS.md|transcriptByPathPattern|pathRole: \\\"search_scope\\\"|getCatalogTranscript\\(",
      "matchedPathPatterns|AGENTS.md|transcriptByPathPattern|pathRole: \"search_scope\"|getCatalogTranscript(",
      "matchedPathPatterns|AGENTS.md|transcriptByPathPattern|pathRole: \\\"search_scope\\\"|getCatalogTranscript(",
    ]);

    assert.strictEqual(candidates.length, 1);
    assert.strictEqual(
      candidates[0].value,
      "matchedPathPatterns|AGENTS.md|transcriptByPathPattern|pathRole: \"search_scope\"|getCatalogTranscript("
    );
  });

  it("prefers higher-signal search queries over noisy command regex candidates", () => {
    const sessionCandidates = getSessionQuerySearchCandidates({
      recentQueries: [
        {
          query: "site:developers.openai.com Codex hooks AGENTS MCP app server config shell",
          actionType: "search",
        },
        {
          query: "matchedPathPatterns|AGENTS.md|transcriptByPathPattern|pathRole: \"search_scope\"|getCatalogTranscript(",
          actionType: "command",
        },
      ],
      queryArtifacts: [
        "matchedPathPatterns|AGENTS.md|transcriptByPathPattern|pathRole: \\\"search_scope\\\"|getCatalogTranscript\\(",
      ],
    });

    const result = findSearchCandidateMatches(sessionCandidates, "AGNTS", "fuzzy", { limit: 3 });
    assert.ok(result.bestMatch);
    assert.strictEqual(
      result.bestMatch.text,
      "site:developers.openai.com Codex hooks AGENTS MCP app server config shell"
    );
  });

  it("prefers concise literal query hits over longer search-sentence matches when both explain the typo", () => {
    const sessionCandidates = getSessionQuerySearchCandidates({
      recentQueries: [
        {
          query: "site:github.com Claude Code local entry point script AGENTS.md /Users/jerzha01/claude-code-local",
          actionType: "search",
        },
        {
          query: "AGENTS.md",
          actionType: "command",
        },
      ],
    });

    const result = findSearchCandidateMatches(sessionCandidates, "AGNTS", "fuzzy", { limit: 3 });
    assert.ok(result.bestMatch);
    assert.strictEqual(result.bestMatch.text, "AGENTS.md");
  });
});
