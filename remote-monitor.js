"use strict";

const codexConfig = require("./config");
const CodexLogMonitor = require("./log-monitor");
const { postJsonToRunningServer } = require("./runtime-config");
const os = require("os");

function parseArgs(argv) {
  const args = { once: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--once") args.once = true;
    else if (arg === "--port") args.port = Number(argv[index + 1]), index += 1;
    else if (arg === "--session-dir") args.sessionDir = argv[index + 1], index += 1;
    else if (arg === "--poll-ms") args.pollIntervalMs = Number(argv[index + 1]), index += 1;
    else if (arg === "--backfill-ms") args.backfillRecentMs = Number(argv[index + 1]), index += 1;
    else if (arg === "--tail-kb") args.initialTailBytes = Number(argv[index + 1]) * 1024, index += 1;
  }
  return args;
}

function printHelp() {
  console.log(`Standalone Codex remote monitor

Usage:
  node remote-monitor.js [options]

Options:
  --port <n>         Preferred local/tunnel port for the receiver
  --session-dir <p>  Override ~/.codex/sessions
  --poll-ms <n>      Override monitor poll interval
  --backfill-ms <n>  Recover recent context from existing rollout files on startup
  --tail-kb <n>      Initial tail window per existing rollout file (default 512)
  --once             Poll once, then exit
  --help             Show this message
`);
}

function toPositiveInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function startRemoteMonitor(options = {}) {
  const config = {
    ...codexConfig,
    logConfig: {
      ...codexConfig.logConfig,
      sessionDir: options.sessionDir || codexConfig.logConfig.sessionDir,
      pollIntervalMs: options.pollIntervalMs || codexConfig.logConfig.pollIntervalMs
    }
  };

  const host = options.host || os.hostname().split(".")[0];

  const monitor = new CodexLogMonitor(config, (sessionId, state, event, extra) => {
    const payload = {
      state: state === "codex-permission" ? "notification" : state,
      raw_state: state,
      session_id: sessionId,
      event,
      cwd: extra.cwd || "",
      agent_id: "codex",
      host,
    };
    const agentPid = toPositiveInt(extra.agentPid || extra.sourcePid);
    if (agentPid) payload.agent_pid = agentPid;
    if (Number.isFinite(extra.timestampMs)) payload.timestamp_ms = extra.timestampMs;
    if (extra.permissionDetail) payload.permission_detail = extra.permissionDetail;
    postJsonToRunningServer(payload, {
      preferredPort: options.port,
      runtimePort: options.port,
      timeoutMs: 100
    }, () => {});
  }, {
    backfillRecentMs: options.backfillRecentMs,
    initialTailBytes: options.initialTailBytes,
  });

  monitor.on("record", (sessionId, record, extra) => {
    postJsonToRunningServer({
      session_id: sessionId,
      record,
      cwd: extra.cwd || "",
      agent_id: "codex",
      host,
      agent_pid: toPositiveInt(extra.agentPid || extra.sourcePid),
    }, {
      preferredPort: options.port,
      runtimePort: options.port,
      timeoutMs: 100,
    }, () => {});
  });

  if (options.once) {
    monitor.pollOnce();
    const waitMs = (config.logConfig.pollIntervalMs || 1500) + 2200;
    const timer = setTimeout(() => {
      monitor.stop();
      process.exit(0);
    }, waitMs);
    return {
      monitor,
      stop() {
        clearTimeout(timer);
        monitor.stop();
      }
    };
  }

  monitor.start();
  return { monitor, stop: () => monitor.stop() };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const service = startRemoteMonitor(args);
  process.on("SIGINT", () => {
    service.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    service.stop();
    process.exit(0);
  });
}

if (require.main === module) main();

module.exports = { parseArgs, startRemoteMonitor };
