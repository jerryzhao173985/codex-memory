"use strict";

const DEFAULT_HISTORY_REFRESH_MS = 10000;

function resolveHistoryRefreshMs(value, fallback = DEFAULT_HISTORY_REFRESH_MS) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function createHistoryStoreRuntime(options = {}) {
  const refreshMs = resolveHistoryRefreshMs(options.refreshMs);
  const buildIndex = typeof options.buildPersistentHistoryIndex === "function"
    ? options.buildPersistentHistoryIndex
    : (() => ({ catalog: null, manifest: null }));
  const buildOptions = options.buildOptions && typeof options.buildOptions === "object"
    ? options.buildOptions
    : {};
  const decorateBuiltCatalog = typeof options.decorateBuiltCatalog === "function"
    ? options.decorateBuiltCatalog
    : (() => {});
  const decorateCatalog = typeof options.decorateCatalog === "function"
    ? options.decorateCatalog
    : (() => {});
  const getSessionFromCatalog = typeof options.getSessionFromCatalog === "function"
    ? options.getSessionFromCatalog
    : (() => null);

  let cache = null;
  let manifest = null;
  let builtAt = 0;

  function invalidateBuildCache() {
    cache = null;
    manifest = null;
    builtAt = 0;
  }

  function build(force = false, buildOverrides = null) {
    const now = Date.now();
    const hasOverrides = buildOverrides && typeof buildOverrides === "object";
    if (!force && !hasOverrides && cache && now - builtAt <= refreshMs) {
      return { catalog: cache, manifest };
    }
    const built = buildIndex(hasOverrides ? { ...buildOptions, ...buildOverrides } : buildOptions);
    cache = built.catalog;
    manifest = built.manifest;
    decorateBuiltCatalog(cache);
    builtAt = now;
    return built;
  }

  function getCatalog(force = false) {
    const catalog = build(force).catalog;
    decorateCatalog(catalog);
    return catalog;
  }

  function getManifest(force = false) {
    return build(force).manifest;
  }

  function getSessionContext(sessionId, filters = {}) {
    const catalog = getCatalog(Boolean(filters.refresh));
    return {
      generatedAt: catalog && typeof catalog.generatedAt === "string" && catalog.generatedAt
        ? catalog.generatedAt
        : new Date().toISOString(),
      session: getSessionFromCatalog(catalog, sessionId) || null,
    };
  }

  return {
    refreshMs,
    build,
    getCatalog,
    getManifest,
    getSessionContext,
    invalidateBuildCache,
    getCachedCatalog() {
      return cache;
    },
    getCachedManifest() {
      return manifest;
    },
  };
}

module.exports = {
  DEFAULT_HISTORY_REFRESH_MS,
  resolveHistoryRefreshMs,
  createHistoryStoreRuntime,
};
