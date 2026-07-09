"use strict";

const codexConfig = require("./config");
const CodexLogMonitor = require("./log-monitor");
const { CodexStateMachine } = require("./state-machine");
const { createCodexServer } = require("./server");
const { createHistoryStore } = require("./history-store");

function parseArgs(argv) {
  const args = { quiet: false, noMonitor: false, noServer: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--quiet") args.quiet = true;
    else if (arg === "--no-monitor") args.noMonitor = true;
    else if (arg === "--no-server") args.noServer = true;
    else if (arg === "--port") args.port = Number(argv[index + 1]), index += 1;
    else if (arg === "--session-dir") args.sessionDir = argv[index + 1], index += 1;
    else if (arg === "--index-dir") args.indexRoot = argv[index + 1], index += 1;
    else if (arg === "--poll-ms") args.pollIntervalMs = Number(argv[index + 1]), index += 1;
    else if (arg === "--backfill-ms") args.backfillRecentMs = Number(argv[index + 1]), index += 1;
    else if (arg === "--tail-kb") args.initialTailBytes = Number(argv[index + 1]) * 1024, index += 1;
  }
  return args;
}

function printHelp() {
  console.log(`Standalone Codex backend

Usage:
  node index.js [options]

Options:
  --port <n>         Preferred HTTP port (default range 24633-24637)
  --session-dir <p>  Override ~/.codex/sessions
  --index-dir <p>    Override ~/.codex/memories/clawd-codex-history
  --poll-ms <n>      Override monitor poll interval
  --backfill-ms <n>  Recover recent context from existing rollout files on startup
  --tail-kb <n>      Initial tail window per existing rollout file (default 512)
  --no-monitor       Start HTTP API only
  --no-server        Start local monitor only
  --quiet            Suppress JSON transition logs
  --help             Show this message
`);
}

async function startStandaloneBackend(options = {}) {
  const stateMachine = options.stateMachine || new CodexStateMachine(options.stateOptions);
  stateMachine.start();
  const sessionDir = options.sessionDir || codexConfig.logConfig.sessionDir;
  const catalogStore = options.catalogStore || createHistoryStore({
    sessionDir,
    indexRoot: options.indexRoot,
  });

  if (!options.quiet) {
    stateMachine.on("transition", (transition) => {
      console.log(JSON.stringify(transition));
    });
  }

  let server = null;
  if (!options.noServer) {
    server = createCodexServer({
      stateMachine,
      catalogStore,
      preferredPort: options.port,
      runtimeConfigPath: options.runtimeConfigPath
    });
    try {
      const started = await server.start();
      if (!options.quiet) {
        console.error(`Codex backend HTTP API listening on ${started.url}`);
      }
    } catch (err) {
      server = null;
      console.error(`Codex backend HTTP API failed to start: ${err.message}`);
    }
  }

  let monitor = null;
  if (!options.noMonitor) {
    const config = {
      ...codexConfig,
      logConfig: {
        ...codexConfig.logConfig,
        sessionDir,
        pollIntervalMs: options.pollIntervalMs || codexConfig.logConfig.pollIntervalMs
      }
    };
    monitor = new CodexLogMonitor(config, (sessionId, state, event, extra) => {
      stateMachine.handleEvent({
        sessionId,
        state,
        event,
        cwd: extra.cwd,
        sourcePid: extra.sourcePid,
        agentPid: extra.agentPid,
        timestampMs: extra.timestampMs,
        permissionDetail: extra.permissionDetail || null
      });
    }, {
      backfillRecentMs: options.backfillRecentMs,
      initialTailBytes: options.initialTailBytes,
    });
    monitor.on("record", (sessionId, record, extra) => {
      stateMachine.observeRecord(sessionId, record, extra);
    });
    monitor.start();
    stateMachine.cleanStaleSessions();
    if (!options.quiet) {
      console.error(`Watching Codex sessions in ${config.logConfig.sessionDir}`);
    }
  }

  const stop = async () => {
    if (monitor) monitor.stop();
    if (server) await server.stop();
    if (catalogStore && typeof catalogStore.close === "function") await Promise.resolve(catalogStore.close());
    stateMachine.stop();
  };

  return { stateMachine, server, monitor, catalogStore, stop };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const service = await startStandaloneBackend(args);
  const shutdown = async () => {
    await service.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs, startStandaloneBackend };
