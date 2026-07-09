"use strict";

const {
  listCatalogProjects,
  listCatalogProjectAreas,
  searchCatalogTurns,
  listCatalogSessions,
  listCatalogArtifacts,
  getCatalogArtifact,
  getCatalogArtifactTurns,
  getCatalogPathThread,
  getCatalogRelatedSessions,
  getCatalogTurn,
  getCatalogProject,
  getCatalogArea,
  getCatalogFamily,
  getCatalogWorkstream,
  getCatalogSession,
  getCatalogTurns,
  getCatalogEvents,
  getCatalogTranscript,
  getCatalogResume,
} = require("./catalog");

function resolveForceAndFilters(forceOrFilters = false) {
  const filters = forceOrFilters && typeof forceOrFilters === "object" ? forceOrFilters : {};
  const force = typeof forceOrFilters === "boolean"
    ? forceOrFilters
    : Boolean(filters.refresh);
  return { force, filters };
}

function createHistoryCatalogStore(options = {}) {
  const getCatalog = typeof options.getCatalog === "function"
    ? options.getCatalog
    : () => null;
  const catalogApi = options.catalogApi && typeof options.catalogApi === "object"
    ? options.catalogApi
    : {
      listCatalogProjects,
      listCatalogProjectAreas,
      searchCatalogTurns,
      listCatalogSessions,
      listCatalogArtifacts,
      getCatalogArtifact,
      getCatalogArtifactTurns,
      getCatalogPathThread,
      getCatalogRelatedSessions,
      getCatalogTurn,
      getCatalogProject,
      getCatalogArea,
      getCatalogFamily,
      getCatalogWorkstream,
      getCatalogSession,
      getCatalogTurns,
      getCatalogEvents,
      getCatalogTranscript,
      getCatalogResume,
    };

  function getCatalogForFilters(filters = {}) {
    return getCatalog(Boolean(filters.refresh));
  }

  return {
    listSessions(filters = {}) {
      return catalogApi.listCatalogSessions(getCatalogForFilters(filters), filters);
    },
    listProjects(filters = {}) {
      return catalogApi.listCatalogProjects(getCatalogForFilters(filters), filters);
    },
    listAreas(filters = {}) {
      return catalogApi.listCatalogProjectAreas(getCatalogForFilters(filters), filters);
    },
    searchTurns(filters = {}) {
      return catalogApi.searchCatalogTurns(getCatalogForFilters(filters), filters);
    },
    listArtifacts(filters = {}) {
      return catalogApi.listCatalogArtifacts(getCatalogForFilters(filters), filters);
    },
    getArtifact(kind, value, filters = {}) {
      return catalogApi.getCatalogArtifact(getCatalogForFilters(filters), kind, value, filters);
    },
    getArtifactTurns(kind, value, filters = {}) {
      return catalogApi.getCatalogArtifactTurns(getCatalogForFilters(filters), kind, value, filters);
    },
    getPathThread(value, filters = {}) {
      return catalogApi.getCatalogPathThread(getCatalogForFilters(filters), value, filters);
    },
    getRelatedSessions(sessionId, filters = {}) {
      return catalogApi.getCatalogRelatedSessions(getCatalogForFilters(filters), sessionId, filters);
    },
    getTurn(sessionId, turnId, filters = {}) {
      return catalogApi.getCatalogTurn(getCatalogForFilters(filters), sessionId, turnId, filters);
    },
    getProject(cwd, filters = {}) {
      return catalogApi.getCatalogProject(getCatalogForFilters(filters), cwd, filters);
    },
    getArea(cwd, area, filters = {}) {
      return catalogApi.getCatalogArea(getCatalogForFilters(filters), cwd, area, filters);
    },
    getFamily(sessionRef, filters = {}) {
      return catalogApi.getCatalogFamily(getCatalogForFilters(filters), sessionRef, filters);
    },
    getWorkstream(sessionRef, filters = {}) {
      return catalogApi.getCatalogWorkstream(getCatalogForFilters(filters), sessionRef, filters);
    },
    getSession(sessionId, forceOrFilters = false) {
      const { force, filters } = resolveForceAndFilters(forceOrFilters);
      return catalogApi.getCatalogSession(getCatalog(force), sessionId, filters);
    },
    getTurns(sessionId, forceOrFilters = false) {
      const { force, filters } = resolveForceAndFilters(forceOrFilters);
      return catalogApi.getCatalogTurns(getCatalog(force), sessionId, filters);
    },
    getEvents(sessionId, filters = {}) {
      return catalogApi.getCatalogEvents(getCatalogForFilters(filters), sessionId, filters);
    },
    getTranscript(sessionId, filters = {}) {
      return catalogApi.getCatalogTranscript(getCatalogForFilters(filters), sessionId, filters);
    },
    getResume(sessionId, filters = {}) {
      return catalogApi.getCatalogResume(getCatalogForFilters(filters), sessionId, filters);
    },
  };
}

module.exports = {
  createHistoryCatalogStore,
  resolveForceAndFilters,
};
