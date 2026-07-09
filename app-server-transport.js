"use strict";

const { spawn } = require("child_process");

const DEFAULT_APP_SERVER_COMMAND = "codex";
const DEFAULT_APP_SERVER_ARGS = ["app-server", "--listen", "stdio://"];
const DEFAULT_START_TIMEOUT_MS = 8000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120000;
const MAX_STDERR_LINES = 20;

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(message);
      err.code = "APP_SERVER_TIMEOUT";
      reject(err);
    }, timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function resolveClientInfo(value) {
  if (value && typeof value === "object") {
    return {
      name: typeof value.name === "string" && value.name
        ? value.name
        : "clawd_codex_history",
      title: typeof value.title === "string" && value.title
        ? value.title
        : "Clawd Codex History",
      version: typeof value.version === "string" && value.version
        ? value.version
        : "0.0.0",
    };
  }

  return {
    name: "clawd_codex_history",
    title: "Clawd Codex History",
    version: "0.0.0",
  };
}

function resolveCapabilities(options = {}) {
  const requestedCapabilities = options.capabilities && typeof options.capabilities === "object"
    ? options.capabilities
    : {};
  const initializeCapabilities = {
    experimentalApi: Object.prototype.hasOwnProperty.call(requestedCapabilities, "experimentalApi")
      ? requestedCapabilities.experimentalApi === true
      : options.experimentalApi !== false,
  };
  const optOutNotificationMethods = Array.isArray(requestedCapabilities.optOutNotificationMethods)
    ? requestedCapabilities.optOutNotificationMethods
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim())
    : [];
  if (optOutNotificationMethods.length) {
    initializeCapabilities.optOutNotificationMethods = optOutNotificationMethods;
  }
  return initializeCapabilities;
}

class CodexAppServerTransport {
  constructor(options = {}) {
    this.command = typeof options.command === "string" && options.command
      ? options.command
      : DEFAULT_APP_SERVER_COMMAND;
    this.args = Array.isArray(options.args) && options.args.length
      ? options.args.slice()
      : DEFAULT_APP_SERVER_ARGS.slice();
    this.cwd = typeof options.cwd === "string" && options.cwd ? options.cwd : undefined;
    this.env = options.env && typeof options.env === "object" ? { ...options.env } : null;
    this.spawnImpl = typeof options.spawnImpl === "function" ? options.spawnImpl : spawn;
    this.startTimeoutMs = Number.isInteger(options.startTimeoutMs) && options.startTimeoutMs > 0
      ? options.startTimeoutMs
      : DEFAULT_START_TIMEOUT_MS;
    // Per-request deadline so a request the server accepts but never answers
    // cannot hang its caller forever. 0 disables.
    this.requestTimeoutMs = Number.isInteger(options.requestTimeoutMs) && options.requestTimeoutMs >= 0
      ? options.requestTimeoutMs
      : DEFAULT_REQUEST_TIMEOUT_MS;
    this.clientInfo = resolveClientInfo(options.clientInfo);
    this.capabilities = resolveCapabilities(options);

    this.child = null;
    this.startPromise = null;
    this.closed = false;
    this.nextRequestId = 1;
    this.stdoutBuffer = "";
    this.pendingRequests = new Map();
    this.stderrLines = [];
    this.notifications = [];
  }

  async ensureStarted() {
    if (this.closed) throw this.#makeError("Codex app-server bridge is closed", "APP_SERVER_CLOSED");
    if (!this.startPromise) {
      this.startPromise = this.#startInternal().catch((err) => {
        this.startPromise = null;
        throw err;
      });
    }
    return this.startPromise;
  }

  async request(method, params = {}) {
    await this.ensureStarted();
    return this.#sendRequest(method, params);
  }

  async call(method, params = {}) {
    return this.request(method, params);
  }

  close() {
    this.closed = true;
    this.#rejectAllPending(this.#makeError("Codex app-server bridge closed", "APP_SERVER_CLOSED"));

    const child = this.child;
    this.child = null;
    this.startPromise = null;
    this.stdoutBuffer = "";

    if (!child) return Promise.resolve();

    try {
      if (child.stdin && typeof child.stdin.end === "function") child.stdin.end();
    } catch {}

    try {
      if (typeof child.kill === "function") child.kill("SIGTERM");
    } catch {}

    return Promise.resolve();
  }

  #makeError(message, code = "APP_SERVER_ERROR") {
    const err = new Error(message);
    err.code = code;
    return err;
  }

  #stderrSummary() {
    return this.stderrLines.length ? this.stderrLines.join(" | ") : "";
  }

  async #startInternal() {
    let child;
    try {
      child = this.spawnImpl(this.command, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: this.cwd,
        env: this.env ? { ...process.env, ...this.env } : process.env,
      });
    } catch (err) {
      throw this.#makeError(`failed to spawn \`${this.command}\`: ${err.message}`, "APP_SERVER_UNAVAILABLE");
    }

    if (!child || !child.stdin || !child.stdout || !child.stderr) {
      throw this.#makeError("Codex app-server transport pipes are unavailable", "APP_SERVER_UNAVAILABLE");
    }

    this.child = child;
    this.stdoutBuffer = "";
    if (typeof child.stdout.setEncoding === "function") child.stdout.setEncoding("utf8");
    if (typeof child.stderr.setEncoding === "function") child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => this.#handleStdout(chunk));
    child.stderr.on("data", (chunk) => this.#handleStderr(chunk));
    child.on("error", (err) => {
      this.#handleFatal(
        this.#makeError(`Codex app-server failed: ${err.message}`, "APP_SERVER_UNAVAILABLE")
      );
    });
    child.on("exit", (code, signal) => {
      if (this.closed) return;
      const bits = [
        "Codex app-server exited",
        code != null ? `code=${code}` : "",
        signal ? `signal=${signal}` : "",
      ].filter(Boolean);
      const stderr = this.#stderrSummary();
      const message = stderr ? `${bits.join(" ")}: ${stderr}` : bits.join(" ");
      this.#handleFatal(this.#makeError(message, "APP_SERVER_EXITED"));
    });

    const init = await withTimeout(
      this.#sendRequest("initialize", {
        clientInfo: this.clientInfo,
        capabilities: this.capabilities,
      }),
      this.startTimeoutMs,
      "timed out waiting for Codex app-server initialize response"
    );
    this.#writeMessage({ method: "initialized", params: {} });
    return init;
  }

  #sendRequest(method, params) {
    if (!this.child || !this.child.stdin) {
      return Promise.reject(this.#makeError("Codex app-server is not running", "APP_SERVER_UNAVAILABLE"));
    }

    const id = String(this.nextRequestId++);
    return new Promise((resolve, reject) => {
      const pending = { method, resolve: null, reject: null, timer: null };
      const settle = (settleFn) => (value) => {
        if (pending.timer) {
          clearTimeout(pending.timer);
          pending.timer = null;
        }
        settleFn(value);
      };
      pending.resolve = settle(resolve);
      pending.reject = settle(reject);
      if (this.requestTimeoutMs > 0) {
        pending.timer = setTimeout(() => {
          pending.timer = null;
          this.pendingRequests.delete(id);
          pending.reject(this.#makeError(
            `timed out waiting for Codex app-server ${method} response`,
            "APP_SERVER_TIMEOUT"
          ));
        }, this.requestTimeoutMs);
        if (typeof pending.timer.unref === "function") pending.timer.unref();
      }
      this.pendingRequests.set(id, pending);
      try {
        this.#writeMessage({
          id,
          method,
          params: params && typeof params === "object" ? params : {},
        });
      } catch (err) {
        this.pendingRequests.delete(id);
        pending.reject(err);
      }
    });
  }

  #writeMessage(message) {
    if (!this.child || !this.child.stdin || typeof this.child.stdin.write !== "function") {
      throw this.#makeError("Codex app-server stdin is unavailable", "APP_SERVER_UNAVAILABLE");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleStdout(chunk) {
    this.stdoutBuffer += String(chunk);

    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const raw = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (!raw) continue;

      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        this.#handleFatal(
          this.#makeError(`received invalid JSON from Codex app-server: ${raw.slice(0, 200)}`, "APP_SERVER_PROTOCOL_ERROR")
        );
        return;
      }

      if (message && typeof message === "object" && typeof message.method === "string") {
        if (Object.prototype.hasOwnProperty.call(message, "id")) {
          this.#replyUnsupportedServerRequest(message.id, message.method);
          continue;
        }
        this.notifications.push(message);
        if (this.notifications.length > 50) this.notifications.splice(0, this.notifications.length - 50);
        continue;
      }

      if (!message || typeof message !== "object" || !Object.prototype.hasOwnProperty.call(message, "id")) {
        continue;
      }

      const id = String(message.id);
      const pending = this.pendingRequests.get(id);
      if (!pending) continue;
      this.pendingRequests.delete(id);

      if (message.error && typeof message.error === "object") {
        const rpcCode = Number.isFinite(message.error.code) ? Number(message.error.code) : null;
        const err = this.#makeError(
          `${pending.method} failed: ${typeof message.error.message === "string" ? message.error.message : "unknown error"}`,
          "APP_SERVER_REQUEST_FAILED"
        );
        err.rpcCode = rpcCode;
        err.data = message.error.data;
        pending.reject(err);
        continue;
      }

      pending.resolve(message.result);
    }
  }

  #handleStderr(chunk) {
    const lines = String(chunk).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      this.stderrLines.push(line);
      if (this.stderrLines.length > MAX_STDERR_LINES) {
        this.stderrLines.splice(0, this.stderrLines.length - MAX_STDERR_LINES);
      }
    }
  }

  #replyUnsupportedServerRequest(id, method) {
    try {
      this.#writeMessage({
        id,
        error: {
          code: -32601,
          message: `unsupported server request \`${method}\``,
        },
      });
    } catch {}
  }

  #rejectAllPending(err) {
    for (const pending of this.pendingRequests.values()) pending.reject(err);
    this.pendingRequests.clear();
  }

  #handleFatal(err) {
    if (this.closed) return;
    this.#rejectAllPending(err);
    this.startPromise = null;
    this.child = null;
    this.stdoutBuffer = "";
  }
}

function createAppServerTransport(options = {}) {
  return new CodexAppServerTransport(options);
}

module.exports = {
  DEFAULT_APP_SERVER_COMMAND,
  DEFAULT_APP_SERVER_ARGS,
  DEFAULT_START_TIMEOUT_MS,
  CodexAppServerTransport,
  createAppServerTransport,
};
