"use strict";

// Adapted from ../hooks/server-config.js for the standalone Codex backend.

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const BACKEND_SERVER_ID = "clawd-codex-backend";
const BACKEND_SERVER_HEADER = "x-codex-backend";
const DEFAULT_SERVER_PORT = 24633;
const SERVER_PORT_COUNT = 5;
const SERVER_PORTS = Array.from({ length: SERVER_PORT_COUNT }, (_, index) => DEFAULT_SERVER_PORT + index);
const HEALTH_PATH = "/health";
const STATE_PATH = "/state";
const RUNTIME_CONFIG_PATH = path.join(os.homedir(), ".clawd-codex", "runtime.json");

function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function readRuntimeConfig(filePath = RUNTIME_CONFIG_PATH) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    const port = normalizePort(raw.port);
    return port ? { port } : null;
  } catch {
    return null;
  }
}

function readRuntimePort(filePath = RUNTIME_CONFIG_PATH) {
  const config = readRuntimeConfig(filePath);
  return config ? config.port : null;
}

function writeRuntimeConfig(port, filePath = RUNTIME_CONFIG_PATH) {
  const safePort = normalizePort(port);
  if (!safePort) return false;

  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.runtime.${process.pid}.${Date.now()}.tmp`);
  const body = JSON.stringify({ app: BACKEND_SERVER_ID, port: safePort }, null, 2);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(tmpPath, body, "utf8");
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch {
    try { fs.unlinkSync(tmpPath); } catch {}
    return false;
  }
}

function clearRuntimeConfig(filePath = RUNTIME_CONFIG_PATH) {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function getPortCandidates(preferredPort, options = {}) {
  const ports = [];
  const seen = new Set();
  const runtimePort = normalizePort(
    Object.prototype.hasOwnProperty.call(options, "runtimePort")
      ? options.runtimePort
      : readRuntimePort(options.runtimeConfigPath || RUNTIME_CONFIG_PATH)
  );

  const add = (value) => {
    const port = normalizePort(value);
    if (!port || seen.has(port)) return;
    seen.add(port);
    ports.push(port);
  };

  if (Array.isArray(preferredPort)) preferredPort.forEach(add);
  else add(preferredPort);
  add(runtimePort);
  SERVER_PORTS.forEach(add);
  return ports;
}

function splitPortCandidates(preferredPort, options = {}) {
  const runtimePort = normalizePort(
    Object.prototype.hasOwnProperty.call(options, "runtimePort")
      ? options.runtimePort
      : readRuntimePort(options.runtimeConfigPath || RUNTIME_CONFIG_PATH)
  );
  const all = getPortCandidates(preferredPort, { ...options, runtimePort });
  const direct = [];
  const fallback = [];
  const directSeen = new Set();

  const addDirect = (port) => {
    if (!port || directSeen.has(port)) return;
    directSeen.add(port);
    direct.push(port);
  };

  if (Array.isArray(preferredPort)) preferredPort.forEach((port) => addDirect(normalizePort(port)));
  else addDirect(normalizePort(preferredPort));
  addDirect(runtimePort);

  for (const port of all) {
    if (directSeen.has(port)) continue;
    fallback.push(port);
  }

  return { direct, fallback, all };
}

function readHeader(res, headerName) {
  const value = res.headers && res.headers[headerName];
  return Array.isArray(value) ? value[0] : value;
}

function isBackendResponse(res, body) {
  if (readHeader(res, BACKEND_SERVER_HEADER) === BACKEND_SERVER_ID) return true;
  if (!body) return false;
  try {
    const data = JSON.parse(body);
    return data && data.app === BACKEND_SERVER_ID;
  } catch {
    return false;
  }
}

function probePort(port, timeoutMs, callback, options = {}) {
  const httpGet = options.httpGet || http.get;
  const req = httpGet(
    { hostname: "127.0.0.1", port, path: HEALTH_PATH, timeout: timeoutMs },
    (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        if (body.length < 256) body += chunk;
      });
      res.on("end", () => callback(isBackendResponse(res, body)));
    }
  );

  req.on("error", () => callback(false));
  req.on("timeout", () => {
    req.destroy();
    callback(false);
  });
}

function postJsonToPort(port, payload, timeoutMs, callback, options = {}) {
  const httpRequest = options.httpRequest || http.request;
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const req = httpRequest(
    {
      hostname: "127.0.0.1",
      port,
      path: STATE_PATH,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      },
      timeout: timeoutMs
    },
    (res) => {
      if (readHeader(res, BACKEND_SERVER_HEADER) === BACKEND_SERVER_ID) {
        res.resume();
        callback(true, port);
        return;
      }

      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        if (responseBody.length < 256) responseBody += chunk;
      });
      res.on("end", () => callback(isBackendResponse(res, responseBody), port));
    }
  );

  req.on("error", () => callback(false, port));
  req.on("timeout", () => {
    req.destroy();
    callback(false, port);
  });
  req.end(body);
}

function postJsonToRunningServer(body, options, callback) {
  const timeoutMs = options && options.timeoutMs ? options.timeoutMs : 100;
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const { direct, fallback } = splitPortCandidates(options && options.preferredPort, options);
  const probe = options && options.probePort ? options.probePort : probePort;
  const post = options && options.postJsonToPort ? options.postJsonToPort : postJsonToPort;
  let directIndex = 0;
  let fallbackIndex = 0;

  const tryFallback = () => {
    if (fallbackIndex >= fallback.length) {
      callback(false, null);
      return;
    }

    const port = fallback[fallbackIndex++];
    probe(port, timeoutMs, (ok) => {
      if (!ok) {
        tryFallback();
        return;
      }
      post(port, payload, timeoutMs, (posted, confirmedPort) => {
        if (posted) {
          callback(true, confirmedPort);
          return;
        }
        tryFallback();
      }, options);
    }, options);
  };

  const tryDirect = () => {
    if (directIndex >= direct.length) {
      tryFallback();
      return;
    }

    const port = direct[directIndex++];
    post(port, payload, timeoutMs, (posted, confirmedPort) => {
      if (posted) {
        callback(true, confirmedPort);
        return;
      }
      tryDirect();
    }, options);
  };

  tryDirect();
}

module.exports = {
  BACKEND_SERVER_ID,
  BACKEND_SERVER_HEADER,
  DEFAULT_SERVER_PORT,
  SERVER_PORTS,
  HEALTH_PATH,
  STATE_PATH,
  RUNTIME_CONFIG_PATH,
  normalizePort,
  readRuntimeConfig,
  readRuntimePort,
  writeRuntimeConfig,
  clearRuntimeConfig,
  getPortCandidates,
  splitPortCandidates,
  probePort,
  postJsonToPort,
  postJsonToRunningServer
};
