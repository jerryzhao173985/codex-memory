"use strict";

const http = require("http");
const { URL } = require("url");
const {
  BACKEND_SERVER_HEADER,
  BACKEND_SERVER_ID,
  DEFAULT_SERVER_PORT,
  clearRuntimeConfig,
  getPortCandidates,
  readRuntimePort,
  writeRuntimeConfig
} = require("./runtime-config");
const {
  normalizeBridgeGitInfoPatch,
  normalizeBridgeThreadListParams,
  normalizeBridgeThreadMemoryMode,
} = require("./app-server-thread-contract");
const {
  getRepeatedQueryValues,
  readCatalogFilterQuerySource,
  buildCatalogCommonFilters,
  buildCatalogQueryFilters,
  buildCatalogArtifactContextFilters,
  buildStructuredMatchFilters,
} = require("./catalog-filters");
const {
  readOptionalQueryInteger: baseReadOptionalQueryInteger,
  readOptionalBodyInteger: baseReadOptionalBodyInteger,
} = require("./input-validation");

function createCodexServer(options = {}) {
  const stateMachine = options.stateMachine;
  if (!stateMachine) throw new Error("stateMachine is required");
  const catalogStore = options.catalogStore || null;

  const host = options.host || "127.0.0.1";
  const preferredPort = options.preferredPort;
  const runtimeConfigPath = options.runtimeConfigPath;

  let httpServer = null;
  let activePort = null;

  function sendJson(res, statusCode, body) {
    const payload = JSON.stringify(body);
    res.writeHead(statusCode, {
      "Content-Type": "application/json",
      [BACKEND_SERVER_HEADER]: BACKEND_SERVER_ID
    });
    res.end(payload);
  }

  function sendCatalogAsync(res, producer, notFoundMessage) {
    Promise.resolve().then(() => (
      typeof producer === "function"
        ? producer()
        : producer
    )).then(
      (result) => {
        if (!result) {
          sendJson(res, 404, { ok: false, error: notFoundMessage });
          return;
        }
        sendJson(res, 200, result);
      },
      (err) => {
        sendJson(res, 502, { ok: false, error: err && err.message ? err.message : String(err) });
      }
    );
  }

  function createBadRequestError(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
  }

  function readOptionalQueryInteger(searchParams, names = [], options = {}) {
    return baseReadOptionalQueryInteger(searchParams, names, {
      ...options,
      errorFactory: createBadRequestError,
    });
  }

  function readOptionalBodyInteger(data, names = [], options = {}) {
    return baseReadOptionalBodyInteger(data, names, {
      ...options,
      errorFactory: createBadRequestError,
    });
  }

  function normalizeOptionalBoolean(value) {
    if (value === true || value === false) return value;
    if (typeof value === "string") {
      const text = value.trim().toLowerCase();
      if (text === "1" || text === "true" || text === "yes") return true;
      if (text === "0" || text === "false" || text === "no") return false;
    }
    return null;
  }

  function collectStringArray(value) {
    if (Array.isArray(value)) return value.filter((item) => typeof item === "string" && item.trim());
    if (typeof value === "string" && value.trim()) return [value];
    return [];
  }

  function buildAnnotationPatch(data = {}) {
    const patch = {};
    const bookmarked = normalizeOptionalBoolean(data.bookmarked ?? data.bookmark);
    if (bookmarked !== null) patch.bookmarked = bookmarked;

    const addTags = [
      ...collectStringArray(data.tags),
      ...collectStringArray(data.add_tags ?? data.addTags),
      ...collectStringArray(data.tag),
    ];
    if (addTags.length) patch.addTags = addTags;

    const removeTags = [
      ...collectStringArray(data.remove_tags ?? data.removeTags),
      ...collectStringArray(data.remove_tag ?? data.removeTag),
    ];
    if (removeTags.length) patch.removeTags = removeTags;

    if (typeof data.note === "string") patch.note = data.note;
    if (normalizeOptionalBoolean(data.clear_note ?? data.clearNote) === true) patch.clearNote = true;
    if (normalizeOptionalBoolean(data.clear_tags ?? data.clearTags) === true) patch.clearTags = true;
    return patch;
  }

  function hasAnnotationPatch(patch = {}) {
    return (
      patch.bookmarked === true ||
      patch.bookmarked === false ||
      (typeof patch.note === "string") ||
      patch.clearNote === true ||
      patch.clearTags === true ||
      (Array.isArray(patch.addTags) && patch.addTags.length > 0) ||
      (Array.isArray(patch.removeTags) && patch.removeTags.length > 0)
    );
  }

  function buildThreadMetadataPatch(data = {}) {
    const rawGitInfo = data.gitInfo && typeof data.gitInfo === "object" ? data.gitInfo : {};
    const gitInfo = normalizeBridgeGitInfoPatch({
      branch: normalizeOptionalBoolean(data.clear_git_branch ?? data.clearGitBranch) === true
        ? null
        : (data.git_branch ?? data.gitBranch ?? rawGitInfo.branch),
      sha: normalizeOptionalBoolean(data.clear_git_sha ?? data.clearGitSha) === true
        ? null
        : (data.git_sha ?? data.gitSha ?? rawGitInfo.sha),
      originUrl: normalizeOptionalBoolean(data.clear_git_origin_url ?? data.clearGitOriginUrl) === true
        ? null
        : (data.git_origin_url ?? data.gitOriginUrl ?? rawGitInfo.originUrl),
    });

    return gitInfo ? { gitInfo } : null;
  }

  function getBridgeThreadListParams(searchParams) {
    const modelProviders = getRepeatedQueryValues(searchParams, ["model_provider", "modelProvider"]);
    const sourceKinds = getRepeatedQueryValues(searchParams, ["source_kind", "sourceKind"]);
    const sortKey = searchParams.has("sort_key") || searchParams.has("sortKey") || searchParams.has("sort")
      ? (searchParams.get("sort_key") || searchParams.get("sortKey") || searchParams.get("sort") || "")
      : undefined;
    return normalizeBridgeThreadListParams({
      limit: readOptionalQueryInteger(searchParams, ["limit"], { label: "limit", positive: true }),
      cursor: searchParams.get("cursor") || "",
      q: searchParams.get("q") || "",
      cwd: searchParams.get("cwd") || "",
      archived: searchParams.get("archived") || "",
      sortKey,
      modelProviders: modelProviders.length
        ? modelProviders
        : (searchParams.has("model_provider") || searchParams.has("modelProvider")
          ? (searchParams.get("model_provider") || searchParams.get("modelProvider") || "")
          : undefined),
      sourceKinds: sourceKinds.length
        ? sourceKinds
        : (searchParams.has("source_kind") || searchParams.has("sourceKind")
          ? (searchParams.get("source_kind") || searchParams.get("sourceKind") || "")
          : undefined),
    });
  }

  function readJsonBody(req, maxBytes = 65536) {
    return new Promise((resolve, reject) => {
      let body = "";
      let bodySize = 0;
      let tooLarge = false;

      req.on("data", (chunk) => {
        if (tooLarge) return;
        bodySize += chunk.length;
        if (bodySize > maxBytes) {
          tooLarge = true;
          return;
        }
        body += chunk;
      });

      req.on("end", () => {
        if (tooLarge) {
          const err = new Error("payload too large");
          err.statusCode = 413;
          reject(err);
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch {
          const err = new Error("bad json");
          err.statusCode = 400;
          reject(err);
        }
      });

      req.on("error", reject);
    });
  }

  function handlePostState(req, res) {
    readJsonBody(req).then((data) => {
      try {
        const sessionId = typeof data.session_id === "string" ? data.session_id : data.sessionId;
        const context = {
          cwd: typeof data.cwd === "string" ? data.cwd : "",
          sourcePid: data.source_pid,
          agentPid: data.agent_pid ?? data.codex_pid,
          host: typeof data.host === "string" ? data.host : "",
          timestampMs: Number.isFinite(data.timestamp_ms) ? data.timestamp_ms : null,
        };

        if (data.record && typeof data.record === "object") {
          stateMachine.observeRecord(sessionId, data.record, context);
        }

        let transition = null;
        if (typeof data.state === "string" && data.state) {
          transition = stateMachine.handleEvent({
            session_id: sessionId,
            state: data.state,
            raw_state: typeof data.raw_state === "string" ? data.raw_state : "",
            event: typeof data.event === "string" ? data.event : "",
            cwd: context.cwd,
            source_pid: context.sourcePid,
            agent_pid: context.agentPid,
            timestamp_ms: context.timestampMs,
            host: context.host,
            permission_detail: data.permission_detail && typeof data.permission_detail === "object"
              ? data.permission_detail
              : null,
          });
        }

        if (!transition && !(data.record && typeof data.record === "object")) {
          throw new Error("state or record is required");
        }

        sendJson(res, 200, { ok: true, transition, snapshot: stateMachine.getSnapshot() });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
    }, (err) => {
      sendJson(res, err && err.statusCode ? err.statusCode : 400, {
        ok: false,
        error: err && err.message ? err.message : "bad json",
      });
    });
  }

  function start() {
    return new Promise((resolve, reject) => {
      const listenPorts = getPortCandidates(preferredPort, {
        runtimePort: readRuntimePort(runtimeConfigPath),
        runtimeConfigPath
      });
      let listenIndex = 0;
      let settled = false;

      const server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://${host}:${activePort || preferredPort || DEFAULT_SERVER_PORT}`);
        const pathname = url.pathname;
        const filterSource = readCatalogFilterQuerySource(url.searchParams);
        const historyMode = filterSource.historyMode;

        try {

        if (req.method === "GET" && pathname === "/health") {
          sendJson(res, 200, {
            ok: true,
            app: BACKEND_SERVER_ID,
            port: activePort || readRuntimePort(runtimeConfigPath) || DEFAULT_SERVER_PORT
          });
          return;
        }

        if (req.method === "GET" && pathname === "/state") {
          sendJson(res, 200, stateMachine.getSnapshot());
          return;
        }

        if (req.method === "GET" && pathname === "/sessions") {
          sendJson(res, 200, {
            sessionCount: stateMachine.sessions.size,
            sessions: stateMachine.listSessions()
          });
          return;
        }

        if (req.method === "GET" && pathname === "/events") {
          sendJson(res, 200, {
            eventCount: stateMachine.recentEvents.length,
            events: stateMachine.recentEvents,
          });
          return;
        }

        if (req.method === "GET" && pathname === "/analytics") {
          sendJson(res, 200, stateMachine.getAnalytics());
          return;
        }

        if (req.method === "GET" && pathname === "/catalog" && catalogStore) {
          sendJson(res, 200, catalogStore.listSessions({
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            offset: readOptionalQueryInteger(url.searchParams, ["offset"], { label: "offset", nonNegative: true }),
            ...buildCatalogQueryFilters(filterSource, { includeQMode: true, includeShape: true }),
            refresh: filterSource.refresh,
          }));
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/turn-search" && catalogStore && typeof catalogStore.searchTurns === "function") {
          sendJson(res, 200, catalogStore.searchTurns({
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            offset: readOptionalQueryInteger(url.searchParams, ["offset"], { label: "offset", nonNegative: true }),
            ...buildCatalogQueryFilters(filterSource, { includeShape: true, includeStatus: true, includeTurn: true }),
            refresh: filterSource.refresh,
          }));
          return;
        }

        if (req.method === "GET" && pathname === "/bridge/threads" && catalogStore && typeof catalogStore.listBridgeThreads === "function") {
          let threadListParams;
          try {
            threadListParams = getBridgeThreadListParams(url.searchParams);
          } catch (err) {
            sendJson(res, 400, {
              ok: false,
              error: err && err.message ? err.message : "bad request",
            });
            return;
          }
          sendCatalogAsync(res, () => catalogStore.listBridgeThreads(
            threadListParams
          ), "threads unavailable");
          return;
        }

        if (req.method === "GET" && pathname === "/bridge/loaded" && catalogStore && typeof catalogStore.listLoadedThreads === "function") {
          sendCatalogAsync(res, () => catalogStore.listLoadedThreads({
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            cursor: url.searchParams.get("cursor") || "",
          }), "threads unavailable");
          return;
        }

        if (req.method === "GET" && pathname === "/bridge/thread" && catalogStore && typeof catalogStore.getBridgeThread === "function") {
          const sessionId = url.searchParams.get("session_id") || url.searchParams.get("sessionId") || "";
          if (!sessionId) {
            sendJson(res, 400, { ok: false, error: "session_id is required" });
            return;
          }
          sendCatalogAsync(res, () => catalogStore.getBridgeThread(sessionId, {
            includeTurns: url.searchParams.get("include_turns") !== "0" && url.searchParams.get("includeTurns") !== "0",
          }), "thread not found");
          return;
        }

        if (req.method === "GET" && pathname === "/bridge/prune-turns" && catalogStore && typeof catalogStore.listPruneCandidates === "function") {
          const sessionId = url.searchParams.get("session_id") || url.searchParams.get("sessionId") || "";
          if (!sessionId) {
            sendJson(res, 400, { ok: false, error: "session_id is required" });
            return;
          }
          sendCatalogAsync(res, () => catalogStore.listPruneCandidates(sessionId, {
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            refresh: url.searchParams.get("refresh") === "1",
          }), "thread not found");
          return;
        }

        if (req.method === "POST" && pathname === "/bridge/thread/name" && catalogStore && typeof catalogStore.setBridgeThreadName === "function") {
          readJsonBody(req).then((data) => {
            const sessionId = typeof data.session_id === "string" ? data.session_id : data.sessionId;
            const name = typeof data.name === "string" ? data.name : "";
            if (!sessionId) {
              sendJson(res, 400, { ok: false, error: "session_id is required" });
              return;
            }
            if (!name.trim()) {
              sendJson(res, 400, { ok: false, error: "name is required" });
              return;
            }
            sendCatalogAsync(res, () => catalogStore.setBridgeThreadName(sessionId, name), "thread not found");
          }, (err) => {
            sendJson(res, err && err.statusCode ? err.statusCode : 400, {
              ok: false,
              error: err && err.message ? err.message : "bad json",
            });
          });
          return;
        }

        if (req.method === "POST" && pathname === "/bridge/thread/metadata" && catalogStore && typeof catalogStore.updateBridgeThreadMetadata === "function") {
          readJsonBody(req).then((data) => {
            try {
              const sessionId = typeof data.session_id === "string" ? data.session_id : data.sessionId;
              const patch = buildThreadMetadataPatch(data);
              if (!sessionId) {
                sendJson(res, 400, { ok: false, error: "session_id is required" });
                return;
              }
              if (!patch) {
                sendJson(res, 400, { ok: false, error: "metadata patch is required" });
                return;
              }
              sendCatalogAsync(res, () => catalogStore.updateBridgeThreadMetadata(sessionId, patch), "thread not found");
            } catch (err) {
              sendJson(res, 400, { ok: false, error: err && err.message ? err.message : "bad request" });
            }
          }, (err) => {
            sendJson(res, err && err.statusCode ? err.statusCode : 400, {
              ok: false,
              error: err && err.message ? err.message : "bad json",
            });
          });
          return;
        }

        if (req.method === "POST" && pathname === "/bridge/thread/memory-mode" && catalogStore && typeof catalogStore.setBridgeThreadMemoryMode === "function") {
          readJsonBody(req).then((data) => {
            try {
              const sessionId = typeof data.session_id === "string" ? data.session_id : data.sessionId;
              const rawMode = data.mode ?? data.memory_mode ?? data.memoryMode ?? data.value;
              if (!sessionId) {
                sendJson(res, 400, { ok: false, error: "session_id is required" });
                return;
              }
              if (rawMode === undefined || rawMode === null || (typeof rawMode === "string" && !rawMode.trim())) {
                sendJson(res, 400, { ok: false, error: "mode is required" });
                return;
              }
              const mode = normalizeBridgeThreadMemoryMode(rawMode);
              sendCatalogAsync(res, () => catalogStore.setBridgeThreadMemoryMode(sessionId, mode), "thread not found");
            } catch (err) {
              sendJson(res, 400, { ok: false, error: err && err.message ? err.message : "bad request" });
            }
          }, (err) => {
            sendJson(res, err && err.statusCode ? err.statusCode : 400, {
              ok: false,
              error: err && err.message ? err.message : "bad json",
            });
          });
          return;
        }

        if (req.method === "POST" && pathname === "/bridge/thread/archive" && catalogStore && typeof catalogStore.archiveBridgeThread === "function") {
          readJsonBody(req).then((data) => {
            const sessionId = typeof data.session_id === "string" ? data.session_id : data.sessionId;
            if (!sessionId) {
              sendJson(res, 400, { ok: false, error: "session_id is required" });
              return;
            }
            sendCatalogAsync(res, () => catalogStore.archiveBridgeThread(sessionId), "thread not found");
          }, (err) => {
            sendJson(res, err && err.statusCode ? err.statusCode : 400, {
              ok: false,
              error: err && err.message ? err.message : "bad json",
            });
          });
          return;
        }

        if (req.method === "POST" && pathname === "/bridge/thread/unarchive" && catalogStore && typeof catalogStore.unarchiveBridgeThread === "function") {
          readJsonBody(req).then((data) => {
            const sessionId = typeof data.session_id === "string" ? data.session_id : data.sessionId;
            if (!sessionId) {
              sendJson(res, 400, { ok: false, error: "session_id is required" });
              return;
            }
            sendCatalogAsync(res, () => catalogStore.unarchiveBridgeThread(sessionId), "thread not found");
          }, (err) => {
            sendJson(res, err && err.statusCode ? err.statusCode : 400, {
              ok: false,
              error: err && err.message ? err.message : "bad json",
            });
          });
          return;
        }

        if (req.method === "GET" && pathname === "/bridge/prune-preview" && catalogStore && typeof catalogStore.getPrunePreview === "function") {
          const sessionId = url.searchParams.get("session_id") || url.searchParams.get("sessionId") || "";
          const dropLast = readOptionalQueryInteger(url.searchParams, ["drop_last", "dropLast"], {
            label: "drop_last",
            positive: true,
          });
          const throughTurn = url.searchParams.get("through_turn") || url.searchParams.get("throughTurn") || "";
          if (!sessionId) {
            sendJson(res, 400, { ok: false, error: "session_id is required" });
            return;
          }
          if (!(Number.isInteger(dropLast) && dropLast > 0) && !throughTurn) {
            sendJson(res, 400, { ok: false, error: "drop_last or through_turn is required" });
            return;
          }
          sendCatalogAsync(res, () => catalogStore.getPrunePreview(sessionId, {
            dropLastTurns: dropLast,
            throughTurn,
            budgetChars: readOptionalQueryInteger(url.searchParams, ["budget_chars", "budgetChars"], { label: "budget_chars", positive: true }),
            itemChars: readOptionalQueryInteger(url.searchParams, ["item_chars", "itemChars"], { label: "item_chars", positive: true }),
            toolChars: readOptionalQueryInteger(url.searchParams, ["tool_chars", "toolChars"], { label: "tool_chars", positive: true }),
            lineLimit: readOptionalQueryInteger(url.searchParams, ["line_limit", "lineLimit"], { label: "line_limit", positive: true }),
            turnLimit: readOptionalQueryInteger(url.searchParams, ["turn_limit", "turnLimit"], { label: "turn_limit", positive: true }),
            itemLimit: readOptionalQueryInteger(url.searchParams, ["item_limit", "itemLimit"], { label: "item_limit", positive: true }),
            highlightLimit: readOptionalQueryInteger(url.searchParams, ["highlight_limit", "highlightLimit"], { label: "highlight_limit", positive: true }),
            trimStrategy: url.searchParams.get("trim_strategy") || url.searchParams.get("trimStrategy") || "",
            toolText: url.searchParams.get("tool_text") || url.searchParams.get("toolText") || "",
            reloadPolicy: url.searchParams.get("reload_policy") || url.searchParams.get("reloadPolicy") || "",
            refresh: url.searchParams.get("refresh") === "1",
          }), "thread not found");
          return;
        }

        if (req.method === "POST" && pathname === "/bridge/thread/fork-prune" && catalogStore && typeof catalogStore.forkPruneThread === "function") {
          readJsonBody(req).then((data) => {
            try {
              const sessionId = typeof data.session_id === "string" ? data.session_id : data.sessionId;
              const dropLast = readOptionalBodyInteger(data, ["drop_last", "dropLast"], {
                label: "drop_last",
                positive: true,
              });
              const throughTurn = typeof data.through_turn === "string" ? data.through_turn : data.throughTurn;
              if (!sessionId) {
                sendJson(res, 400, { ok: false, error: "session_id is required" });
                return;
              }
              if (!(Number.isInteger(dropLast) && dropLast > 0) && !(typeof throughTurn === "string" && throughTurn.trim())) {
                sendJson(res, 400, { ok: false, error: "drop_last or through_turn is required" });
                return;
              }
              sendCatalogAsync(res, () => catalogStore.forkPruneThread(sessionId, {
                dropLastTurns: dropLast,
                throughTurn,
                name: typeof data.name === "string" ? data.name : "",
                budgetChars: readOptionalBodyInteger(data, ["budget_chars", "budgetChars"], { label: "budget_chars", positive: true }),
                itemChars: readOptionalBodyInteger(data, ["item_chars", "itemChars"], { label: "item_chars", positive: true }),
                toolChars: readOptionalBodyInteger(data, ["tool_chars", "toolChars"], { label: "tool_chars", positive: true }),
                lineLimit: readOptionalBodyInteger(data, ["line_limit", "lineLimit"], { label: "line_limit", positive: true }),
                turnLimit: readOptionalBodyInteger(data, ["turn_limit", "turnLimit"], { label: "turn_limit", positive: true }),
                itemLimit: readOptionalBodyInteger(data, ["item_limit", "itemLimit"], { label: "item_limit", positive: true }),
                highlightLimit: readOptionalBodyInteger(data, ["highlight_limit", "highlightLimit"], { label: "highlight_limit", positive: true }),
                trimStrategy: typeof data.trim_strategy === "string" ? data.trim_strategy : data.trimStrategy,
                toolText: typeof data.tool_text === "string" ? data.tool_text : data.toolText,
                reloadPolicy: typeof data.reload_policy === "string" ? data.reload_policy : data.reloadPolicy,
                refresh: data.refresh === true || data.refresh === 1 || data.refresh === "1",
              }), "thread not found");
            } catch (err) {
              sendJson(res, err && err.statusCode ? err.statusCode : 400, {
                ok: false,
                error: err && err.message ? err.message : "bad request",
              });
            }
          }, (err) => {
            sendJson(res, err && err.statusCode ? err.statusCode : 400, {
              ok: false,
              error: err && err.message ? err.message : "bad json",
            });
          });
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/transcript" && catalogStore && typeof catalogStore.getTranscript === "function") {
          const sessionId = url.searchParams.get("session_id") || url.searchParams.get("sessionId") || "";
          if (!sessionId) {
            sendJson(res, 400, { ok: false, error: "session_id is required" });
            return;
          }
          const transcriptPromise = typeof catalogStore.getTranscriptResolved === "function"
            ? catalogStore.getTranscriptResolved(sessionId, {
              limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
              ...buildStructuredMatchFilters(filterSource, { includeKind: true, includeTurn: true }),
              source: filterSource.source,
              historyMode,
              refresh: filterSource.refresh,
            })
            : catalogStore.getTranscript(sessionId, {
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            ...buildStructuredMatchFilters(filterSource, { includeKind: true, includeTurn: true }),
            historyMode,
            refresh: filterSource.refresh,
          });
          sendCatalogAsync(res, () => transcriptPromise, "session not found");
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/resume" && catalogStore && typeof catalogStore.getResume === "function") {
          const sessionId = url.searchParams.get("session_id") || url.searchParams.get("sessionId") || "";
          if (!sessionId) {
            sendJson(res, 400, { ok: false, error: "session_id is required" });
            return;
          }
          const resumePromise = typeof catalogStore.getResumeResolved === "function"
            ? catalogStore.getResumeResolved(sessionId, {
              budgetChars: readOptionalQueryInteger(url.searchParams, ["budget_chars", "budgetChars"], { label: "budget_chars", positive: true }),
              itemChars: readOptionalQueryInteger(url.searchParams, ["item_chars", "itemChars"], { label: "item_chars", positive: true }),
              toolChars: readOptionalQueryInteger(url.searchParams, ["tool_chars", "toolChars"], { label: "tool_chars", positive: true }),
              lineLimit: readOptionalQueryInteger(url.searchParams, ["line_limit", "lineLimit"], { label: "line_limit", positive: true }),
              turnLimit: readOptionalQueryInteger(url.searchParams, ["turn_limit", "turnLimit"], { label: "turn_limit", positive: true }),
              itemLimit: readOptionalQueryInteger(url.searchParams, ["item_limit", "itemLimit"], { label: "item_limit", positive: true }),
              highlightLimit: readOptionalQueryInteger(url.searchParams, ["highlight_limit", "highlightLimit"], { label: "highlight_limit", positive: true }),
              trimStrategy: url.searchParams.get("trim_strategy") || url.searchParams.get("trimStrategy") || "",
              toolText: url.searchParams.get("tool_text") || url.searchParams.get("toolText") || "",
              reloadPolicy: url.searchParams.get("reload_policy") || url.searchParams.get("reloadPolicy") || "",
              ...buildStructuredMatchFilters(filterSource, { includeTurn: true, includeStatus: true }),
              source: filterSource.source,
              historyMode,
              refresh: filterSource.refresh,
            })
            : catalogStore.getResume(sessionId, {
            budgetChars: readOptionalQueryInteger(url.searchParams, ["budget_chars", "budgetChars"], { label: "budget_chars", positive: true }),
            itemChars: readOptionalQueryInteger(url.searchParams, ["item_chars", "itemChars"], { label: "item_chars", positive: true }),
            toolChars: readOptionalQueryInteger(url.searchParams, ["tool_chars", "toolChars"], { label: "tool_chars", positive: true }),
            lineLimit: readOptionalQueryInteger(url.searchParams, ["line_limit", "lineLimit"], { label: "line_limit", positive: true }),
            turnLimit: readOptionalQueryInteger(url.searchParams, ["turn_limit", "turnLimit"], { label: "turn_limit", positive: true }),
            itemLimit: readOptionalQueryInteger(url.searchParams, ["item_limit", "itemLimit"], { label: "item_limit", positive: true }),
            highlightLimit: readOptionalQueryInteger(url.searchParams, ["highlight_limit", "highlightLimit"], { label: "highlight_limit", positive: true }),
            trimStrategy: url.searchParams.get("trim_strategy") || url.searchParams.get("trimStrategy") || "",
            toolText: url.searchParams.get("tool_text") || url.searchParams.get("toolText") || "",
            reloadPolicy: url.searchParams.get("reload_policy") || url.searchParams.get("reloadPolicy") || "",
            ...buildStructuredMatchFilters(filterSource, { includeTurn: true, includeStatus: true }),
            historyMode,
            refresh: filterSource.refresh,
          });
          sendCatalogAsync(res, () => resumePromise, "session not found");
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/turn" && catalogStore && typeof catalogStore.getTurn === "function") {
          const sessionId = url.searchParams.get("session_id") || url.searchParams.get("sessionId") || "";
          const turnId = url.searchParams.get("turn") || "";
          if (!sessionId || !turnId) {
            sendJson(res, 400, { ok: false, error: "session_id and turn are required" });
            return;
          }
          const turn = catalogStore.getTurn(sessionId, turnId, {
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            ...buildStructuredMatchFilters(filterSource, { includeKind: true }),
            historyMode,
            refresh: filterSource.refresh,
          });
          if (!turn) {
            sendJson(res, 404, { ok: false, error: "turn not found" });
            return;
          }
          sendJson(res, 200, turn);
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/artifact-turns" && catalogStore && typeof catalogStore.getArtifactTurns === "function") {
          const kind = url.searchParams.get("kind") || "";
          const value = url.searchParams.get("value") || "";
          if (!kind || !value) {
            sendJson(res, 400, { ok: false, error: "kind and value are required" });
            return;
          }
          const turns = catalogStore.getArtifactTurns(kind, value, {
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            offset: readOptionalQueryInteger(url.searchParams, ["offset"], { label: "offset", nonNegative: true }),
            ...buildCatalogArtifactContextFilters(filterSource, {
              includeShape: true,
              includeSessionKey: true,
              includePathRole: true,
              includeCommandOpSignal: true,
              includeStatus: true,
            }),
            refresh: filterSource.refresh,
          });
          if (!turns) {
            sendJson(res, 404, { ok: false, error: "artifact not found" });
            return;
          }
          sendJson(res, 200, turns);
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/path-thread" && catalogStore && typeof catalogStore.getPathThread === "function") {
          const value = url.searchParams.get("value") || "";
          if (!value) {
            sendJson(res, 400, { ok: false, error: "value is required" });
            return;
          }
          const thread = catalogStore.getPathThread(value, {
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            eventLimit: readOptionalQueryInteger(url.searchParams, ["event_limit", "eventLimit"], { label: "event_limit", positive: true }),
            ...buildCatalogArtifactContextFilters(filterSource, {
              includeSessionKey: true,
              includePathRole: true,
              includeTurn: true,
              includeStatus: true,
            }),
            refresh: filterSource.refresh,
          });
          if (!thread) {
            sendJson(res, 404, { ok: false, error: "path not found" });
            return;
          }
          sendJson(res, 200, thread);
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/related" && catalogStore && typeof catalogStore.getRelatedSessions === "function") {
          const sessionId = url.searchParams.get("session_id") || url.searchParams.get("sessionId") || "";
          if (!sessionId) {
            sendJson(res, 400, { ok: false, error: "session_id is required" });
            return;
          }
          const { sessionId: ignoredSessionId, ...relatedFilters } = buildCatalogCommonFilters(filterSource);
          const related = catalogStore.getRelatedSessions(sessionId, {
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            offset: readOptionalQueryInteger(url.searchParams, ["offset"], { label: "offset", nonNegative: true }),
            shape: filterSource.shape,
            ...relatedFilters,
            refresh: filterSource.refresh,
          });
          if (!related) {
            sendJson(res, 404, { ok: false, error: "session not found" });
            return;
          }
          sendJson(res, 200, related);
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/family" && catalogStore && typeof catalogStore.getFamily === "function") {
          const sessionId = url.searchParams.get("session_id") || url.searchParams.get("sessionId") || "";
          if (!sessionId) {
            sendJson(res, 400, { ok: false, error: "session_id is required" });
            return;
          }
          const family = catalogStore.getFamily(sessionId, {
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            turnLimit: readOptionalQueryInteger(url.searchParams, ["turn_limit", "turnLimit"], { label: "turn_limit", positive: true }),
            ...buildCatalogQueryFilters(filterSource),
            refresh: filterSource.refresh,
          });
          if (!family) {
            sendJson(res, 404, { ok: false, error: "family not found" });
            return;
          }
          sendJson(res, 200, family);
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/workstream" && catalogStore && typeof catalogStore.getWorkstream === "function") {
          const sessionId = url.searchParams.get("session_id") || url.searchParams.get("sessionId") || "";
          if (!sessionId) {
            sendJson(res, 400, { ok: false, error: "session_id is required" });
            return;
          }
          const workstream = catalogStore.getWorkstream(sessionId, {
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            offset: readOptionalQueryInteger(url.searchParams, ["offset"], { label: "offset", nonNegative: true }),
            familyLimit: readOptionalQueryInteger(url.searchParams, ["family_limit", "familyLimit"], { label: "family_limit", positive: true }),
            familyOffset: readOptionalQueryInteger(url.searchParams, ["family_offset", "familyOffset"], { label: "family_offset", nonNegative: true }),
            turnLimit: readOptionalQueryInteger(url.searchParams, ["turn_limit", "turnLimit"], { label: "turn_limit", positive: true }),
            ...buildCatalogQueryFilters(filterSource, { includeArea: true, includeShape: true }),
            refresh: filterSource.refresh,
          });
          if (!workstream) {
            sendJson(res, 404, { ok: false, error: "workstream not found" });
            return;
          }
          sendJson(res, 200, workstream);
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/projects" && catalogStore && typeof catalogStore.listProjects === "function") {
          sendJson(res, 200, catalogStore.listProjects({
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            offset: readOptionalQueryInteger(url.searchParams, ["offset"], { label: "offset", nonNegative: true }),
            ...buildCatalogQueryFilters(filterSource, { includeShape: true }),
            refresh: filterSource.refresh,
          }));
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/areas" && catalogStore && typeof catalogStore.listAreas === "function") {
          sendJson(res, 200, catalogStore.listAreas({
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            offset: readOptionalQueryInteger(url.searchParams, ["offset"], { label: "offset", nonNegative: true }),
            ...buildCatalogQueryFilters(filterSource, { includeShape: true, includeArea: true }),
            refresh: filterSource.refresh,
          }));
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/project" && catalogStore && typeof catalogStore.getProject === "function") {
          const cwd = url.searchParams.get("cwd") || "";
          if (!cwd) {
            sendJson(res, 400, { ok: false, error: "cwd is required" });
            return;
          }
          const project = catalogStore.getProject(cwd, {
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            turnLimit: readOptionalQueryInteger(url.searchParams, ["turn_limit", "turnLimit"], { label: "turn_limit", positive: true }),
            ...buildCatalogQueryFilters(filterSource, { includeArea: true }),
            refresh: filterSource.refresh,
          });
          if (!project) {
            sendJson(res, 404, { ok: false, error: "project not found" });
            return;
          }
          sendJson(res, 200, project);
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/area" && catalogStore && typeof catalogStore.getArea === "function") {
          const cwd = url.searchParams.get("cwd") || "";
          const area = filterSource.area || url.searchParams.get("focusRoot") || "";
          if (!cwd) {
            sendJson(res, 400, { ok: false, error: "cwd is required" });
            return;
          }
          if (!area) {
            sendJson(res, 400, { ok: false, error: "area is required" });
            return;
          }
          const detail = catalogStore.getArea(cwd, area, {
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            turnLimit: readOptionalQueryInteger(url.searchParams, ["turn_limit", "turnLimit"], { label: "turn_limit", positive: true }),
            ...buildCatalogQueryFilters(filterSource),
            refresh: filterSource.refresh,
          });
          if (!detail) {
            sendJson(res, 404, { ok: false, error: "area not found" });
            return;
          }
          sendJson(res, 200, detail);
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/artifacts" && catalogStore && typeof catalogStore.listArtifacts === "function") {
          sendJson(res, 200, catalogStore.listArtifacts({
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            offset: readOptionalQueryInteger(url.searchParams, ["offset"], { label: "offset", nonNegative: true }),
            ...buildCatalogArtifactContextFilters(filterSource, {
              includeQ: true,
              includeShape: true,
              includeKind: true,
              includeSessionKey: true,
              includePathPattern: true,
              includePathRole: true,
              includeCommandOpSignal: true,
            }),
            refresh: filterSource.refresh,
          }));
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/artifact" && catalogStore && typeof catalogStore.getArtifact === "function") {
          const kind = url.searchParams.get("kind") || "";
          const value = url.searchParams.get("value") || "";
          if (!kind || !value) {
            sendJson(res, 400, { ok: false, error: "kind and value are required" });
            return;
          }
          const artifact = catalogStore.getArtifact(kind, value, {
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            offset: readOptionalQueryInteger(url.searchParams, ["offset"], { label: "offset", nonNegative: true }),
            turnLimit: readOptionalQueryInteger(url.searchParams, ["turn_limit", "turnLimit"], { label: "turn_limit", positive: true }),
            ...buildCatalogArtifactContextFilters(filterSource, {
              includeShape: true,
              includeSessionKey: true,
              includePathPattern: true,
              includePathRole: true,
              includeCommandOpSignal: true,
            }),
            refresh: filterSource.refresh,
          });
          if (!artifact) {
            sendJson(res, 404, { ok: false, error: "artifact not found" });
            return;
          }
          sendJson(res, 200, artifact);
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/session" && catalogStore) {
          const sessionId = url.searchParams.get("session_id") || url.searchParams.get("sessionId");
          const session = catalogStore.getSession(sessionId, {
            historyMode,
            refresh: filterSource.refresh,
          });
          if (!session) {
            sendJson(res, 404, { ok: false, error: "session not found" });
            return;
          }
          sendJson(res, 200, session);
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/turns" && catalogStore) {
          const sessionId = url.searchParams.get("session_id") || url.searchParams.get("sessionId");
          const turns = catalogStore.getTurns(sessionId, {
            historyMode,
            refresh: filterSource.refresh,
          });
          if (!turns) {
            sendJson(res, 404, { ok: false, error: "session not found" });
            return;
          }
          sendJson(res, 200, turns);
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/events" && catalogStore) {
          const sessionId = url.searchParams.get("session_id") || url.searchParams.get("sessionId");
          const events = catalogStore.getEvents(sessionId, {
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            ...buildStructuredMatchFilters(filterSource, { includeKind: true, includeTurn: true }),
            historyMode,
            refresh: filterSource.refresh,
          });
          if (!events) {
            sendJson(res, 404, { ok: false, error: "session not found" });
            return;
          }
          sendJson(res, 200, events);
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/stats" && catalogStore && typeof catalogStore.getStats === "function") {
          sendJson(res, 200, catalogStore.getStats(filterSource.refresh));
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/doctor" && catalogStore && typeof catalogStore.getDoctor === "function") {
          sendJson(res, 200, catalogStore.getDoctor({
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            offset: readOptionalQueryInteger(url.searchParams, ["offset"], { label: "offset", nonNegative: true }),
            q: filterSource.q,
            status: filterSource.status,
            reason: filterSource.reason,
            sessionKey: filterSource.sessionKey,
            liveWindowMs: readOptionalQueryInteger(url.searchParams, ["live_window_ms", "liveWindowMs"], { label: "live_window_ms", positive: true }),
            rebuild: url.searchParams.get("rebuild") === "1" || url.searchParams.get("rebuild") === "true",
            refresh: filterSource.refresh,
          }));
          return;
        }

        if (req.method === "GET" && pathname === "/catalog/schema" && catalogStore && typeof catalogStore.getSchemaProfile === "function") {
          sendJson(res, 200, catalogStore.getSchemaProfile({
            limit: readOptionalQueryInteger(url.searchParams, ["limit"], { label: "limit", positive: true }),
            q: filterSource.q,
            refresh: filterSource.refresh,
          }));
          return;
        }

        if (req.method === "POST" && pathname === "/catalog/annotate/session" && catalogStore && typeof catalogStore.setSessionAnnotation === "function") {
          readJsonBody(req).then((data) => {
            const sessionId = typeof data.session_id === "string" ? data.session_id : data.sessionId;
            const patch = buildAnnotationPatch(data);
            if (!sessionId) {
              sendJson(res, 400, { ok: false, error: "session_id is required" });
              return;
            }
            if (!hasAnnotationPatch(patch)) {
              sendJson(res, 400, { ok: false, error: "annotation change is required" });
              return;
            }
            sendCatalogAsync(res, () => catalogStore.setSessionAnnotation(sessionId, patch, {
              refresh: data.refresh === true || data.refresh === 1 || data.refresh === "1",
            }), "session not found");
          }, (err) => {
            sendJson(res, err && err.statusCode ? err.statusCode : 400, {
              ok: false,
              error: err && err.message ? err.message : "bad json",
            });
          });
          return;
        }

        if (req.method === "POST" && pathname === "/catalog/annotate/turn" && catalogStore && typeof catalogStore.setTurnAnnotation === "function") {
          readJsonBody(req).then((data) => {
            const sessionId = typeof data.session_id === "string" ? data.session_id : data.sessionId;
            const turnId = typeof data.turn_id === "string" ? data.turn_id : data.turnId;
            const patch = buildAnnotationPatch(data);
            if (!sessionId || !turnId) {
              sendJson(res, 400, { ok: false, error: "session_id and turn_id are required" });
              return;
            }
            if (!hasAnnotationPatch(patch)) {
              sendJson(res, 400, { ok: false, error: "annotation change is required" });
              return;
            }
            sendCatalogAsync(res, () => catalogStore.setTurnAnnotation(sessionId, turnId, patch, {
              refresh: data.refresh === true || data.refresh === 1 || data.refresh === "1",
            }), "turn not found");
          }, (err) => {
            sendJson(res, err && err.statusCode ? err.statusCode : 400, {
              ok: false,
              error: err && err.message ? err.message : "bad json",
            });
          });
          return;
        }

        if (req.method === "POST" && pathname === "/state") {
          handlePostState(req, res);
          return;
        }

        sendJson(res, 404, { ok: false, error: "not found" });
        } catch (err) {
          sendJson(res, err && err.statusCode ? err.statusCode : 500, {
            ok: false,
            error: err && err.message ? err.message : "internal server error",
          });
        }
      });

      server.on("error", (err) => {
        if (!activePort && err.code === "EADDRINUSE" && listenIndex < listenPorts.length - 1) {
          listenIndex += 1;
          server.listen(listenPorts[listenIndex], host);
          return;
        }
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      server.on("listening", () => {
        activePort = listenPorts[listenIndex];
        writeRuntimeConfig(activePort, runtimeConfigPath);
        httpServer = server;
        if (!settled) {
          settled = true;
          resolve({ port: activePort, url: `http://${host}:${activePort}` });
        }
      });

      server.listen(listenPorts[listenIndex], host);
    });
  }

  function stop() {
    return new Promise((resolve) => {
      clearRuntimeConfig(runtimeConfigPath);
      if (!httpServer) {
        activePort = null;
        Promise.resolve(catalogStore && typeof catalogStore.close === "function" ? catalogStore.close() : null).finally(resolve);
        return;
      }
      const server = httpServer;
      httpServer = null;
      activePort = null;
      server.close(() => {
        Promise.resolve(catalogStore && typeof catalogStore.close === "function" ? catalogStore.close() : null).finally(resolve);
      });
    });
  }

  return {
    start,
    stop,
    getPort: () => activePort,
    getUrl: () => activePort ? `http://${host}:${activePort}` : null
  };
}

module.exports = { createCodexServer };
