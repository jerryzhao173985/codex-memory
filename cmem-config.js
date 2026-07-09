"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const codexConfig = require("./config");

const CMEM_CONFIG_VERSION = 1;
const DEFAULT_CMEM_HOME = path.join(os.homedir(), ".cmem");
const DEFAULT_SHARED_INDEX_DIR = "~/.codex/memories/clawd-codex-history";

function expandHome(value) {
  if (typeof value !== "string" || !value) return "";
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function resolveCmemHome(explicitHome = "") {
  return expandHome(explicitHome || process.env.CMEM_HOME || DEFAULT_CMEM_HOME);
}

function resolveCmemConfigPath(options = {}) {
  const explicit = options.configPath || process.env.CMEM_CONFIG || "";
  if (explicit) return expandHome(explicit);
  return path.join(resolveCmemHome(options.cmemHome), "config.json");
}

function createDefaultCmemConfig() {
  return {
    version: CMEM_CONFIG_VERSION,
    paths: {
      sessionDir: codexConfig.logConfig.sessionDir,
      indexDir: DEFAULT_SHARED_INDEX_DIR,
    },
    defaults: {
      cwd: "",
      qualityClass: "",
      limit: 10,
      source: "auto",
      historyMode: "effective",
      reloadPolicy: "strict",
    },
  };
}

function normalizeCmemConfig(raw) {
  const defaults = createDefaultCmemConfig();
  const config = raw && typeof raw === "object" ? raw : {};
  const pathConfig = config.paths && typeof config.paths === "object" ? config.paths : {};
  const defaultConfig = config.defaults && typeof config.defaults === "object" ? config.defaults : {};
  const limit = Number.isInteger(defaultConfig.limit) && defaultConfig.limit > 0
    ? defaultConfig.limit
    : defaults.defaults.limit;
  return {
    version: Number.isInteger(config.version) ? config.version : defaults.version,
    paths: {
      sessionDir: typeof pathConfig.sessionDir === "string" && pathConfig.sessionDir.trim()
        ? pathConfig.sessionDir.trim()
        : (typeof config.sessionDir === "string" && config.sessionDir.trim()
          ? config.sessionDir.trim()
          : defaults.paths.sessionDir),
      indexDir: typeof pathConfig.indexDir === "string" && pathConfig.indexDir.trim()
        ? pathConfig.indexDir.trim()
        : (typeof config.indexDir === "string" && config.indexDir.trim()
          ? config.indexDir.trim()
          : defaults.paths.indexDir),
    },
    defaults: {
      cwd: typeof defaultConfig.cwd === "string" ? defaultConfig.cwd : defaults.defaults.cwd,
      qualityClass: typeof defaultConfig.qualityClass === "string" ? defaultConfig.qualityClass : defaults.defaults.qualityClass,
      limit,
      source: typeof defaultConfig.source === "string" && defaultConfig.source.trim()
        ? defaultConfig.source.trim()
        : defaults.defaults.source,
      historyMode: typeof defaultConfig.historyMode === "string" && defaultConfig.historyMode.trim()
        ? defaultConfig.historyMode.trim()
        : defaults.defaults.historyMode,
      reloadPolicy: typeof defaultConfig.reloadPolicy === "string" && defaultConfig.reloadPolicy.trim()
        ? defaultConfig.reloadPolicy.trim()
        : defaults.defaults.reloadPolicy,
    },
  };
}

function readCmemConfig(options = {}) {
  const configPath = resolveCmemConfigPath(options);
  const cmemHome = path.dirname(configPath);
  const defaultConfig = createDefaultCmemConfig();
  let exists = false;
  let raw = null;
  let error = null;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    exists = true;
  } catch (err) {
    if (err && err.code !== "ENOENT") error = err;
  }
  const config = normalizeCmemConfig(raw || defaultConfig);
  return {
    cmemHome,
    configPath,
    exists,
    error,
    config,
    resolved: {
      sessionDir: expandHome(config.paths.sessionDir),
      indexDir: expandHome(config.paths.indexDir),
      cwd: expandHome(config.defaults.cwd),
      qualityClass: config.defaults.qualityClass,
      limit: config.defaults.limit,
      source: config.defaults.source,
      historyMode: config.defaults.historyMode,
      reloadPolicy: config.defaults.reloadPolicy,
    },
  };
}

function initCmemConfig(options = {}) {
  const force = options.force === true;
  const current = readCmemConfig(options);
  if (current.exists && !force) {
    return { ...current, created: false };
  }
  fs.mkdirSync(current.cmemHome, { recursive: true });
  fs.writeFileSync(current.configPath, `${JSON.stringify(current.config, null, 2)}\n`);
  return { ...readCmemConfig(options), created: true };
}

function writeCmemConfig(config, options = {}) {
  const configPath = resolveCmemConfigPath(options);
  const cmemHome = path.dirname(configPath);
  const normalized = normalizeCmemConfig(config);
  fs.mkdirSync(cmemHome, { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`);
  return readCmemConfig(options);
}

function updateCmemConfig(mutator, options = {}) {
  const current = readCmemConfig(options);
  if (current.error) throw current.error;
  const nextConfig = normalizeCmemConfig(mutator(JSON.parse(JSON.stringify(current.config))));
  return writeCmemConfig(nextConfig, options);
}

function applyCmemConfigDefaults(args = {}, runtime = readCmemConfig()) {
  const resolved = runtime.resolved || {};
  const next = { ...args };
  if (!next.sessionDir && resolved.sessionDir) next.sessionDir = resolved.sessionDir;
  if (!next.indexDir && resolved.indexDir) next.indexDir = resolved.indexDir;
  if (!next.cwd && resolved.cwd) next.cwd = resolved.cwd;
  if (!next.qualityClass && resolved.qualityClass) next.qualityClass = resolved.qualityClass;
  if (!(Number.isInteger(next.limit) && next.limit > 0) && Number.isInteger(resolved.limit) && resolved.limit > 0) {
    next.limit = resolved.limit;
  }
  if (!next.source && resolved.source) next.source = resolved.source;
  if (!next.historyMode && resolved.historyMode) next.historyMode = resolved.historyMode;
  if (!next.reloadPolicy && resolved.reloadPolicy) next.reloadPolicy = resolved.reloadPolicy;
  return next;
}

module.exports = {
  CMEM_CONFIG_VERSION,
  DEFAULT_CMEM_HOME,
  DEFAULT_SHARED_INDEX_DIR,
  createDefaultCmemConfig,
  resolveCmemHome,
  resolveCmemConfigPath,
  readCmemConfig,
  initCmemConfig,
  writeCmemConfig,
  updateCmemConfig,
  applyCmemConfigDefaults,
};
