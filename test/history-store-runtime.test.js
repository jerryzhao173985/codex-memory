const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  DEFAULT_HISTORY_REFRESH_MS,
  resolveHistoryRefreshMs,
  createHistoryStoreRuntime,
} = require("../history-store-runtime");

describe("history store runtime", () => {
  it("normalizes refresh windows and falls back to the default", () => {
    assert.strictEqual(resolveHistoryRefreshMs(0), 0);
    assert.strictEqual(resolveHistoryRefreshMs(5000), 5000);
    assert.strictEqual(resolveHistoryRefreshMs(-1), DEFAULT_HISTORY_REFRESH_MS);
    assert.strictEqual(resolveHistoryRefreshMs("5000"), DEFAULT_HISTORY_REFRESH_MS);
    assert.strictEqual(resolveHistoryRefreshMs(undefined), DEFAULT_HISTORY_REFRESH_MS);
  });

  it("reuses cached builds until forced or invalidated", () => {
    const builds = [];
    const runtime = createHistoryStoreRuntime({
      refreshMs: 10000,
      buildPersistentHistoryIndex(buildOptions) {
        const built = {
          buildNumber: builds.length + 1,
          options: buildOptions,
        };
        builds.push(built);
        return {
          catalog: {
            generatedAt: `2026-04-16T12:00:0${built.buildNumber}.000Z`,
            buildNumber: built.buildNumber,
          },
          manifest: {
            buildNumber: built.buildNumber,
          },
        };
      },
      buildOptions: {
        indexRoot: "/index",
      },
    });

    const first = runtime.build(false);
    const second = runtime.build(false);
    const forced = runtime.build(true);

    runtime.invalidateBuildCache();
    const afterInvalidate = runtime.build(false);

    assert.strictEqual(builds.length, 3);
    assert.strictEqual(first.catalog.buildNumber, 1);
    assert.strictEqual(second.catalog.buildNumber, 1);
    assert.strictEqual(first.catalog, second.catalog);
    assert.strictEqual(forced.catalog.buildNumber, 2);
    assert.strictEqual(afterInvalidate.catalog.buildNumber, 3);
    assert.deepStrictEqual(builds[0].options, { indexRoot: "/index" });
  });

  it("applies built and read catalog decorators and exposes cached state", () => {
    const decorateBuiltCalls = [];
    const decorateReadCalls = [];
    const runtime = createHistoryStoreRuntime({
      refreshMs: 10000,
      buildPersistentHistoryIndex() {
        return {
          catalog: {
            generatedAt: "2026-04-16T12:00:00.000Z",
            buildDecorated: 0,
            readDecorated: 0,
          },
          manifest: {
            generatedAt: "2026-04-16T12:00:00.000Z",
          },
        };
      },
      decorateBuiltCatalog(catalog) {
        decorateBuiltCalls.push(catalog);
        catalog.buildDecorated += 1;
      },
      decorateCatalog(catalog) {
        decorateReadCalls.push(catalog);
        catalog.readDecorated += 1;
      },
    });

    const firstCatalog = runtime.getCatalog(false);
    const secondCatalog = runtime.getCatalog(false);

    assert.strictEqual(decorateBuiltCalls.length, 1);
    assert.strictEqual(decorateReadCalls.length, 2);
    assert.strictEqual(firstCatalog.buildDecorated, 1);
    assert.strictEqual(firstCatalog.readDecorated, 2);
    assert.strictEqual(firstCatalog, secondCatalog);
    assert.strictEqual(runtime.getCachedCatalog(), firstCatalog);
    assert.strictEqual(runtime.getCachedManifest().generatedAt, "2026-04-16T12:00:00.000Z");
  });

  it("builds bridge session context from the current catalog and honors refresh filters", () => {
    let buildCount = 0;
    const runtime = createHistoryStoreRuntime({
      refreshMs: 10000,
      buildPersistentHistoryIndex() {
        buildCount += 1;
        return {
          catalog: {
            generatedAt: `2026-04-16T12:00:0${buildCount}.000Z`,
            sessions: [
              {
                sessionId: "codex:session-a",
                title: `build-${buildCount}`,
              },
            ],
          },
          manifest: {
            buildCount,
          },
        };
      },
      getSessionFromCatalog(catalog, sessionId) {
        return (Array.isArray(catalog && catalog.sessions) ? catalog.sessions : [])
          .find((session) => session.sessionId === sessionId) || null;
      },
    });

    const firstContext = runtime.getSessionContext("codex:session-a", {});
    const cachedContext = runtime.getSessionContext("codex:session-a", {});
    const refreshedContext = runtime.getSessionContext("codex:session-a", { refresh: true });
    const missingContext = runtime.getSessionContext("codex:missing", {});

    assert.strictEqual(buildCount, 2);
    assert.strictEqual(firstContext.generatedAt, "2026-04-16T12:00:01.000Z");
    assert.deepStrictEqual(firstContext.session, {
      sessionId: "codex:session-a",
      title: "build-1",
    });
    assert.deepStrictEqual(cachedContext.session, {
      sessionId: "codex:session-a",
      title: "build-1",
    });
    assert.deepStrictEqual(refreshedContext.session, {
      sessionId: "codex:session-a",
      title: "build-2",
    });
    assert.strictEqual(missingContext.session, null);
  });
});
