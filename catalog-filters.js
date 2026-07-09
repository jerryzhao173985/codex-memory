"use strict";

function getRepeatedQueryValues(searchParams, names = []) {
  const values = [];
  for (const name of names) {
    for (const value of searchParams.getAll(name)) {
      if (typeof value === "string" && value) values.push(value);
    }
  }
  return values;
}

function readCatalogFilterQuerySource(searchParams) {
  const manualTagValues = getRepeatedQueryValues(searchParams, ["manual_tag", "manualTag"]);
  const hasValues = getRepeatedQueryValues(searchParams, ["has"]);
  return {
    q: searchParams.get("q") || "",
    qMode: searchParams.get("q_mode") || searchParams.get("qMode") || "",
    query: searchParams.get("query") || "",
    queryMode: searchParams.get("query_mode") || searchParams.get("queryMode") || "",
    shape: searchParams.get("shape") || (searchParams.get("compact") === "1" ? "compact" : ""),
    cwd: searchParams.get("cwd") || "",
    area: searchParams.get("area") || "",
    kind: searchParams.get("kind") || "",
    turn: searchParams.get("turn") || "",
    status: searchParams.get("status") || "",
    reason: searchParams.get("reason") || "",
    source: searchParams.get("source") || "",
    sessionId: searchParams.get("session_id") || searchParams.get("sessionId") || "",
    sessionKey: searchParams.get("session_key") || searchParams.get("sessionKey") || "",
    forkedFrom: searchParams.get("forked_from") || searchParams.get("forkedFrom") || "",
    parentThread: searchParams.get("parent_thread") || searchParams.get("parentThread") || "",
    lineageRoot: searchParams.get("lineage_root") || searchParams.get("lineageRoot") || searchParams.get("root_session") || searchParams.get("rootSession") || "",
    tool: searchParams.get("tool") || "",
    file: searchParams.get("file") || "",
    path: searchParams.get("path") || "",
    pathPattern: searchParams.get("path_pattern") || searchParams.get("pathPattern") || "",
    pathRole: searchParams.get("path_role") || searchParams.get("pathRole") || "",
    commandOp: searchParams.get("command_op") || searchParams.get("commandOp") || "",
    commandOpSignal: searchParams.get("command_op_signal") || searchParams.get("commandOpSignal") || "",
    commandType: searchParams.get("command_type") || searchParams.get("commandType") || "",
    memoryMode: searchParams.get("memory_mode") || searchParams.get("memoryMode") || "",
    eventMode: searchParams.get("event_mode") || searchParams.get("eventMode") || "",
    qualityClass: searchParams.get("quality_class") || searchParams.get("qualityClass") || "",
    error: searchParams.get("error") || "",
    bookmarked: searchParams.get("bookmarked") || "",
    manualTags: manualTagValues.length
      ? manualTagValues
      : (searchParams.get("manual_tag") || searchParams.get("manualTag") || ""),
    has: hasValues.length ? hasValues : (searchParams.get("has") || ""),
    historyMode: searchParams.get("history_mode") || searchParams.get("historyMode") || "",
    refresh: searchParams.get("refresh") === "1",
  };
}

function buildCatalogCommonFilters(source = {}) {
  return {
    cwd: source.cwd,
    sessionId: source.sessionId,
    sessionKey: source.sessionKey,
    forkedFrom: source.forkedFrom,
    parentThread: source.parentThread,
    lineageRoot: source.lineageRoot,
    bookmarked: source.bookmarked,
    manualTags: source.manualTags,
    tool: source.tool,
    file: source.file,
    path: source.path,
    pathPattern: source.pathPattern,
    pathRole: source.pathRole,
    commandOp: source.commandOp,
    commandOpSignal: source.commandOpSignal,
    commandType: source.commandType,
    memoryMode: source.memoryMode,
    eventMode: source.eventMode,
    qualityClass: source.qualityClass,
    error: source.error,
    has: source.has,
    historyMode: source.historyMode,
  };
}

function buildCatalogQueryFilters(source = {}, options = {}) {
  const filters = {
    q: source.q,
    query: source.query,
    queryMode: source.queryMode,
    ...buildCatalogCommonFilters(source),
  };
  if (options.includeQMode) filters.qMode = source.qMode;
  if (options.includeShape) filters.shape = source.shape;
  if (options.includeArea) filters.area = source.area;
  if (options.includeKind) filters.kind = source.kind;
  if (options.includeTurn) filters.turn = source.turn;
  if (options.includeStatus) filters.status = source.status;
  return filters;
}

function buildCatalogArtifactContextFilters(source = {}, options = {}) {
  const filters = {
    cwd: source.cwd,
    sessionId: source.sessionId,
    forkedFrom: source.forkedFrom,
    parentThread: source.parentThread,
    lineageRoot: source.lineageRoot,
    memoryMode: source.memoryMode,
    eventMode: source.eventMode,
    qualityClass: source.qualityClass,
    bookmarked: source.bookmarked,
    manualTags: source.manualTags,
    has: source.has,
    historyMode: source.historyMode,
  };
  if (options.includeQ) filters.q = source.q;
  if (options.includeShape) filters.shape = source.shape;
  if (options.includeKind) filters.kind = source.kind;
  if (options.includeStatus) filters.status = source.status;
  if (options.includeTurn) filters.turn = source.turn;
  if (options.includeSessionKey) filters.sessionKey = source.sessionKey;
  if (options.includePathPattern) filters.pathPattern = source.pathPattern;
  if (options.includePathRole) filters.pathRole = source.pathRole;
  if (options.includeCommandOpSignal) filters.commandOpSignal = source.commandOpSignal;
  return filters;
}

function buildStructuredMatchFilters(source = {}, options = {}) {
  const filters = {
    q: source.q,
    query: source.query,
    queryMode: source.queryMode,
    tool: source.tool,
    file: source.file,
    path: source.path,
    pathPattern: source.pathPattern,
    pathRole: source.pathRole,
    commandOp: source.commandOp,
    commandOpSignal: source.commandOpSignal,
    commandType: source.commandType,
    qualityClass: source.qualityClass,
    error: source.error,
    bookmarked: source.bookmarked,
    manualTags: source.manualTags,
  };
  if (options.includeKind) filters.kind = source.kind;
  if (options.includeTurn) filters.turn = source.turn;
  if (options.includeStatus) filters.status = source.status;
  return filters;
}

module.exports = {
  getRepeatedQueryValues,
  readCatalogFilterQuerySource,
  buildCatalogCommonFilters,
  buildCatalogQueryFilters,
  buildCatalogArtifactContextFilters,
  buildStructuredMatchFilters,
};
