const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  createHistoryViewResolver,
  normalizeViewSource,
  transcriptStructuredFiltersRequested,
  resumeScopedFiltersRequested,
} = require("../history-store-resolution");

describe("history store resolution", () => {
  it("normalizes requested view sources and filter scopes", () => {
    assert.strictEqual(normalizeViewSource("rollout"), "rollout");
    assert.strictEqual(normalizeViewSource("app-server"), "app_server");
    assert.strictEqual(normalizeViewSource("appserver"), "app_server");
    assert.strictEqual(normalizeViewSource("AUTO"), "auto");

    assert.strictEqual(transcriptStructuredFiltersRequested({ query: "needle" }), true);
    assert.strictEqual(transcriptStructuredFiltersRequested({ manualTags: ["keep"] }), true);
    assert.strictEqual(transcriptStructuredFiltersRequested({}), false);

    assert.strictEqual(resumeScopedFiltersRequested({ bookmarked: true }), true);
    assert.strictEqual(resumeScopedFiltersRequested({ q: "recent" }), true);
    assert.strictEqual(resumeScopedFiltersRequested({}), false);
  });

  it("prefers app-server views in auto mode and avoids rollout hydration when not needed", async () => {
    const bridgeCalls = [];
    let catalogReads = 0;
    const resolver = createHistoryViewResolver({
      bridgeStore: {
        async buildAppServerView(sessionId, filters, options) {
          bridgeCalls.push({ sessionId, filters, options });
          return {
            generatedAt: "2026-04-16T12:00:00.000Z",
            view: {
              session: {
                sessionId,
                turns: [],
              },
            },
          };
        },
      },
      getCatalog() {
        catalogReads += 1;
        return { shouldNotBeUsed: true };
      },
    });

    const result = await resolver.resolveHistoryView("codex:app-server-only", {
      source: "auto",
    }, {
      buildAppServerResult(_built, source) {
        return {
          session: { sessionId: "codex:app-server-only", turns: [] },
          matchedItems: 1,
          source,
        };
      },
      buildRolloutResult() {
        throw new Error("rollout result should not be built");
      },
    });

    assert.strictEqual(bridgeCalls.length, 1);
    assert.strictEqual(bridgeCalls[0].options.includeSessionContext, false);
    assert.strictEqual(catalogReads, 0);
    assert.strictEqual(result.source.used, "app_server");
    assert.strictEqual(result.source.selectionReason, "auto_preferred_app_server");
  });

  it("falls back to rollout with explicit filter-miss semantics and annotation-aware bridge hydration", async () => {
    const bridgeCalls = [];
    const catalogReads = [];
    const resolver = createHistoryViewResolver({
      bridgeStore: {
        async buildAppServerView(sessionId, filters, options) {
          bridgeCalls.push({ sessionId, filters, options });
          return {
            generatedAt: "2026-04-16T12:00:00.000Z",
            view: {
              session: {
                sessionId,
                turns: [],
              },
            },
          };
        },
      },
      getCatalog(force) {
        const catalog = {
          generatedAt: "2026-04-16T12:05:00.000Z",
          sessionDir: "/sessions",
          sessions: [],
        };
        catalogReads.push({ force, catalog });
        return catalog;
      },
    });

    const result = await resolver.resolveHistoryView("codex:fallback", {
      source: "auto",
      manualTags: ["keep"],
      refresh: true,
    }, {
      purpose: "transcript",
      filterScope: "transcript",
      buildAppServerResult(_built, source) {
        return {
          session: { sessionId: "codex:fallback", turns: [] },
          matchedItems: 0,
          source,
        };
      },
      shouldFallbackToRollout(appServerResult) {
        return appServerResult.matchedItems === 0;
      },
      buildRolloutResult(catalog) {
        return {
          session: {
            sessionId: "codex:fallback",
            turns: [],
          },
          matchedItems: 2,
          items: [],
          catalogSeen: catalog,
        };
      },
    });

    assert.strictEqual(bridgeCalls.length, 1);
    assert.strictEqual(bridgeCalls[0].options.includeSessionContext, true);
    assert.strictEqual(catalogReads.length, 1);
    assert.strictEqual(catalogReads[0].force, true);
    assert.strictEqual(result.catalogSeen, catalogReads[0].catalog);
    assert.strictEqual(result.source.used, "rollout");
    assert.strictEqual(result.source.selectionReason, "auto_fallback_filter_miss");
    assert.match(result.source.selectionNote, /structured transcript filters/i);
    assert.ok(result.quality);
  });

  it("falls back to rollout on bridge errors and rejects raw app-server requests", async () => {
    const resolver = createHistoryViewResolver({
      bridgeStore: {
        async buildAppServerView() {
          throw new Error("bridge unavailable");
        },
      },
      getCatalog() {
        return {
          generatedAt: "2026-04-16T12:05:00.000Z",
          sessionDir: "/sessions",
        };
      },
    });

    await assert.rejects(
      resolver.resolveHistoryView("codex:raw", {
        source: "app_server",
        historyMode: "raw",
      }, {}),
      (error) => error && error.code === "RAW_HISTORY_REQUIRES_ROLLOUT"
    );

    const result = await resolver.resolveHistoryView("codex:error-fallback", {
      source: "auto",
    }, {
      purpose: "resume",
      buildRolloutResult() {
        return {
          session: {
            sessionId: "codex:error-fallback",
            turns: [],
          },
          turnCount: 1,
          items: [],
        };
      },
    });

    assert.strictEqual(result.source.used, "rollout");
    assert.strictEqual(result.source.selectionReason, "auto_fallback_bridge_error");
    assert.strictEqual(result.source.bridgeError, "bridge unavailable");
    assert.ok(result.quality);
  });
});
