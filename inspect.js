"use strict";

const fs = require("fs");
const path = require("path");
const { normalizeRecordObject, summarizeRecord } = require("./parser");
const codexConfig = require("./config");

function parseArgs(argv) {
  const args = { json: false, pretty: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--pretty") args.pretty = true;
    else if (!args.file) args.file = arg;
  }
  return args;
}

function printHelp() {
  console.log(`Inspect a Codex rollout JSONL file

Usage:
  node inspect.js <rollout.jsonl> [--json] [--pretty]

Options:
  --json    Print full normalized records as JSON
  --pretty  Print pretty-printed JSON
  --help    Show this message
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const filePath = path.resolve(args.file);
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const record = normalizeRecordObject(obj, { logEventMap: codexConfig.logEventMap });
    if (args.json) {
      console.log(JSON.stringify(record, null, args.pretty ? 2 : 0));
    } else {
      console.log(JSON.stringify(summarizeRecord(record)));
    }
  }
}

if (require.main === module) main();
