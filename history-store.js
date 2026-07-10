"use strict";

const path = require("path");
const {
  getCatalogSession,
} = require("./catalog");
const { createSchemaProfileStore } = require("./schema-profile");
const { createHistoryAnnotationStore } = require("./history-store-annotations");
const { createHistoryStoreBridge } = require("./history-store-bridge");
const { buildHistoryStats, buildHistoryDoctor } = require("./history-store-reporting");
const { createHistoryViewResolver } = require("./history-store-resolution");
const { createHistoryCatalogStore } = require("./history-store-catalog");
const { createHistoryStoreRuntime } = require("./history-store-runtime");
const {
  HISTORY_INDEX_VERSION,
  DEFAULT_HISTORY_INDEX_ROOT,
  resolveHistoryIndexRoot,
  buildCatalogFromSessions,
  buildPersistentHistoryIndex,
} = require("./history-store-index");

const ANNOTATION_STORE_VERSION = 1;
const ANNOTATION_STORE_FILE = "annotations.json";

function resolveAnnotationStorePath(indexRoot = DEFAULT_HISTORY_INDEX_ROOT) {
  return path.join(resolveHistoryIndexRoot(indexRoot), ANNOTATION_STORE_FILE);
}

function createHistoryStore(options = {}) {
  const annotationPath = resolveAnnotationStorePath(options.indexRoot);
  let annotationStore = null;
  // Derived-mode catalogs (history_mode=raw) are rebuilt inside catalog views;
  // this hook lets those rebuilds re-apply the annotation overlay so raw views
  // keep bookmarks/tags/notes.
  function attachDerivedCatalogDecorator(catalog) {
    if (!catalog || typeof catalog !== "object" || catalog._decorateDerivedCatalog) return;
    Object.defineProperty(catalog, "_decorateDerivedCatalog", {
      value(derivedCatalog) {
        if (annotationStore) annotationStore.applyCatalogAnnotations(derivedCatalog, false);
      },
      enumerable: false,
    });
  }
  const runtime = createHistoryStoreRuntime({
    refreshMs: options.refreshMs,
    buildPersistentHistoryIndex,
    buildOptions: options,
    decorateBuiltCatalog(catalog) {
      if (annotationStore) annotationStore.applyCatalogAnnotations(catalog, true);
      attachDerivedCatalogDecorator(catalog);
    },
    decorateCatalog(catalog) {
      if (annotationStore) annotationStore.applyCatalogAnnotations(catalog, false);
      attachDerivedCatalogDecorator(catalog);
    },
    getSessionFromCatalog(catalog, sessionId) {
      return getCatalogSession(catalog, sessionId) || null;
    },
  });
  const schemaStore = options.schemaStore || createSchemaProfileStore({
    sessionDir: options.sessionDir,
    refreshMs: runtime.refreshMs,
  });
  annotationStore = createHistoryAnnotationStore({
    annotationPath,
    annotationStoreVersion: ANNOTATION_STORE_VERSION,
    loadCatalog(force = false) {
      return runtime.getCatalog(force);
    },
    getCachedCatalog() {
      return runtime.getCachedCatalog();
    },
  });
  const bridgeStore = createHistoryStoreBridge({
    appServer: options.appServer,
    appServerOptions: options.appServerOptions,
    getSessionContext: runtime.getSessionContext,
    invalidateBuildCache: runtime.invalidateBuildCache,
  });
  const viewResolver = createHistoryViewResolver({
    bridgeStore,
    getCatalog: runtime.getCatalog,
  });
  const catalogStore = createHistoryCatalogStore({
    getCatalog: runtime.getCatalog,
  });

  function getStats(force = false) {
    const built = runtime.build(force);
    return buildHistoryStats({
      built,
      indexRoot: options.indexRoot,
      annotationStats: annotationStore.getAnnotationStats(built.catalog),
      manualProjectStats: annotationStore.getManualProjectStats(built.catalog),
    });
  }

  function getDoctor(filters = {}) {
    const rebuild = filters.rebuild === true || filters.rebuild === "true" || filters.rebuild === "1";
    return buildHistoryDoctor({
      built: runtime.build(
        rebuild || Boolean(filters.refresh),
        rebuild ? { forceRebuild: true } : null
      ),
      filters,
      indexRoot: options.indexRoot,
    });
  }

  return {
    build: runtime.build,
    getCatalog: runtime.getCatalog,
    getManifest: runtime.getManifest,
    close() {
      return bridgeStore.close();
    },
    getStats,
    getDoctor,
    setSessionAnnotation: annotationStore.setSessionAnnotation,
    setTurnAnnotation: annotationStore.setTurnAnnotation,
    ...catalogStore,
    listBridgeThreads: bridgeStore.listBridgeThreads,
    searchBridgeThreads: bridgeStore.searchBridgeThreads,
    listBridgeThreadTurns: bridgeStore.listBridgeThreadTurns,
    getBridgeThreadGoal: bridgeStore.getBridgeThreadGoal,
    setBridgeThreadGoal: bridgeStore.setBridgeThreadGoal,
    clearBridgeThreadGoal: bridgeStore.clearBridgeThreadGoal,
    listLoadedThreads: bridgeStore.listLoadedThreads,
    getBridgeThread: bridgeStore.getBridgeThread,
    listPruneCandidates: bridgeStore.listPruneCandidates,
    getPrunePreview: bridgeStore.getPrunePreview,
    setBridgeThreadName: bridgeStore.setBridgeThreadName,
    updateBridgeThreadMetadata: bridgeStore.updateBridgeThreadMetadata,
    setBridgeThreadMemoryMode: bridgeStore.setBridgeThreadMemoryMode,
    archiveBridgeThread: bridgeStore.archiveBridgeThread,
    unarchiveBridgeThread: bridgeStore.unarchiveBridgeThread,
    forkPruneThread: bridgeStore.forkPruneThread,
    getTranscriptResolved: viewResolver.getTranscriptResolved,
    getResumeResolved: viewResolver.getResumeResolved,
    getSchemaProfile(filters = {}) {
      return schemaStore.getProfile(filters);
    },
  };
}

module.exports = {
  HISTORY_INDEX_VERSION,
  DEFAULT_HISTORY_INDEX_ROOT,
  resolveHistoryIndexRoot,
  buildCatalogFromSessions,
  buildPersistentHistoryIndex,
  createHistoryStore,
};
