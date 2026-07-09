const { describe, it } = require("node:test");
const assert = require("node:assert");

const { createHistoryCatalogStore, resolveForceAndFilters } = require("../history-store-catalog");

describe("history store catalog", () => {
  it("normalizes force-or-filter inputs for session-scoped lookups", () => {
    assert.deepStrictEqual(resolveForceAndFilters(true), {
      force: true,
      filters: {},
    });
    assert.deepStrictEqual(resolveForceAndFilters(false), {
      force: false,
      filters: {},
    });
    assert.deepStrictEqual(resolveForceAndFilters({ refresh: true, q: "needle" }), {
      force: true,
      filters: { refresh: true, q: "needle" },
    });
  });

  it("forwards refresh-scoped list and artifact lookups through the catalog api", () => {
    const catalogReads = [];
    const store = createHistoryCatalogStore({
      getCatalog(force) {
        const catalog = { force, call: catalogReads.length + 1 };
        catalogReads.push(catalog);
        return catalog;
      },
      catalogApi: {
        listCatalogSessions(catalog, filters) {
          return { method: "listSessions", catalog, filters };
        },
        searchCatalogTurns(catalog, filters) {
          return { method: "searchTurns", catalog, filters };
        },
        getCatalogArtifact(catalog, kind, value, filters) {
          return { method: "getArtifact", catalog, kind, value, filters };
        },
        getCatalogProject(catalog, cwd, filters) {
          return { method: "getProject", catalog, cwd, filters };
        },
      },
    });

    const sessions = store.listSessions({ refresh: true, q: "resume" });
    const turns = store.searchTurns({ refresh: false, tool: "rg" });
    const artifact = store.getArtifact("query", "history infra", { refresh: true });
    const project = store.getProject("/repo/a", { refresh: false, q: "tests" });

    assert.deepStrictEqual(sessions, {
      method: "listSessions",
      catalog: catalogReads[0],
      filters: { refresh: true, q: "resume" },
    });
    assert.deepStrictEqual(turns, {
      method: "searchTurns",
      catalog: catalogReads[1],
      filters: { refresh: false, tool: "rg" },
    });
    assert.deepStrictEqual(artifact, {
      method: "getArtifact",
      catalog: catalogReads[2],
      kind: "query",
      value: "history infra",
      filters: { refresh: true },
    });
    assert.deepStrictEqual(project, {
      method: "getProject",
      catalog: catalogReads[3],
      cwd: "/repo/a",
      filters: { refresh: false, q: "tests" },
    });
    assert.deepStrictEqual(catalogReads.map((item) => item.force), [true, false, true, false]);
  });

  it("preserves boolean force semantics for session and turn getters", () => {
    const catalogReads = [];
    const store = createHistoryCatalogStore({
      getCatalog(force) {
        const catalog = { force, call: catalogReads.length + 1 };
        catalogReads.push(catalog);
        return catalog;
      },
      catalogApi: {
        getCatalogSession(catalog, sessionId, filters) {
          return { method: "getSession", catalog, sessionId, filters };
        },
        getCatalogTurns(catalog, sessionId, filters) {
          return { method: "getTurns", catalog, sessionId, filters };
        },
      },
    });

    const forcedSession = store.getSession("codex:forced", true);
    const filteredTurns = store.getTurns("codex:filtered", {
      refresh: true,
      turn: "turn-1",
    });
    const plainSession = store.getSession("codex:plain", false);

    assert.deepStrictEqual(forcedSession, {
      method: "getSession",
      catalog: catalogReads[0],
      sessionId: "codex:forced",
      filters: {},
    });
    assert.deepStrictEqual(filteredTurns, {
      method: "getTurns",
      catalog: catalogReads[1],
      sessionId: "codex:filtered",
      filters: { refresh: true, turn: "turn-1" },
    });
    assert.deepStrictEqual(plainSession, {
      method: "getSession",
      catalog: catalogReads[2],
      sessionId: "codex:plain",
      filters: {},
    });
    assert.deepStrictEqual(catalogReads.map((item) => item.force), [true, true, false]);
  });

  it("forwards family, event, transcript, and resume views without altering arguments", () => {
    const catalogReads = [];
    const store = createHistoryCatalogStore({
      getCatalog(force) {
        const catalog = { force, call: catalogReads.length + 1 };
        catalogReads.push(catalog);
        return catalog;
      },
      catalogApi: {
        getCatalogFamily(catalog, sessionRef, filters) {
          return { method: "getFamily", catalog, sessionRef, filters };
        },
        getCatalogWorkstream(catalog, sessionRef, filters) {
          return { method: "getWorkstream", catalog, sessionRef, filters };
        },
        getCatalogEvents(catalog, sessionId, filters) {
          return { method: "getEvents", catalog, sessionId, filters };
        },
        getCatalogTranscript(catalog, sessionId, filters) {
          return { method: "getTranscript", catalog, sessionId, filters };
        },
        getCatalogResume(catalog, sessionId, filters) {
          return { method: "getResume", catalog, sessionId, filters };
        },
      },
    });

    const family = store.getFamily("codex:root", { refresh: true, lineage: true });
    const workstream = store.getWorkstream("codex:root", { refresh: false, q: "fix" });
    const events = store.getEvents("codex:root", { refresh: true, limit: 5 });
    const transcript = store.getTranscript("codex:root", { refresh: false, limit: 10 });
    const resume = store.getResume("codex:root", { refresh: true, limit: 3 });

    assert.deepStrictEqual(family, {
      method: "getFamily",
      catalog: catalogReads[0],
      sessionRef: "codex:root",
      filters: { refresh: true, lineage: true },
    });
    assert.deepStrictEqual(workstream, {
      method: "getWorkstream",
      catalog: catalogReads[1],
      sessionRef: "codex:root",
      filters: { refresh: false, q: "fix" },
    });
    assert.deepStrictEqual(events, {
      method: "getEvents",
      catalog: catalogReads[2],
      sessionId: "codex:root",
      filters: { refresh: true, limit: 5 },
    });
    assert.deepStrictEqual(transcript, {
      method: "getTranscript",
      catalog: catalogReads[3],
      sessionId: "codex:root",
      filters: { refresh: false, limit: 10 },
    });
    assert.deepStrictEqual(resume, {
      method: "getResume",
      catalog: catalogReads[4],
      sessionId: "codex:root",
      filters: { refresh: true, limit: 3 },
    });
    assert.deepStrictEqual(catalogReads.map((item) => item.force), [true, false, true, false, true]);
  });
});
