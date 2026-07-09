"use strict";

const SHELL_SEGMENT_TOKENS = new Set(["&&", "||", "|", ";"]);
const WRAPPER_COMMANDS = new Set(["command", "builtin", "noglob", "time"]);
const BARE_SHELL_COMMAND_TOKENS = new Set([
  ".", ":", "[", "]",
  "alias", "awk", "basename", "bg", "break", "builtin",
  "caller", "case", "cat", "cd", "command", "comm", "compgen", "complete", "continue", "cut",
  "declare", "dirname", "dirs", "do", "done",
  "echo", "elif", "else", "env", "esac", "eval", "exec", "exit", "export",
  "false", "fg", "fi", "find", "for", "function",
  "grep", "hash", "head", "if", "in",
  "jobs",
  "kill",
  "let", "local", "ls",
  "mapfile", "mkdir", "mktemp", "more", "mv",
  "nl", "noglob",
  "perl", "popd", "printf", "pushd", "pwd",
  "read", "readarray", "realpath", "return", "rg", "rga", "rm",
  "sed", "select", "set", "shift", "sleep", "sort", "source", "stat",
  "tail", "tee", "test", "then", "time", "touch", "tr", "trap", "true", "type", "typeset",
  "ulimit", "umask", "unalias", "uniq", "unset", "until",
  "wait", "wc", "while",
  "xargs",
]);
const GENERIC_PATH_TOKEN_RE = /^[A-Za-z0-9_./~@-]+$/;
const PATH_PATTERN_TOKEN_RE = /^[A-Za-z0-9_./~@*?[\]{}!,:-]+$/;
const PATH_EXTENSION_RE = /\.[A-Za-z_][A-Za-z0-9._-]*$/;
const RIPGREP_PATH_PATTERN_OPTIONS = new Set(["-g", "--glob", "--iglob"]);
const RIPGREP_VALUE_OPTIONS = new Set([
  "-e", "--regexp",
  "-f", "--file",
  "-t", "-T",
  "--type", "--type-not",
  "--type-add",
  "-m", "--max-count",
  "-A", "-B", "-C",
  "--context",
  "--max-depth",
  "-M", "--max-filesize",
  "--sort", "--sortr",
]);
const GREP_PATH_PATTERN_OPTIONS = new Set(["--include", "--exclude", "--exclude-dir"]);
const GREP_VALUE_OPTIONS = new Set([
  "-e", "--regexp",
  "-f", "--file",
  "-m", "--max-count",
  "-A", "-B", "-C",
]);
const FIND_PATH_PATTERN_OPTIONS = new Set([
  "-name", "-iname",
  "-path", "-wholename",
  "-regex", "-iregex",
]);
const FD_PATH_PATTERN_OPTIONS = new Set(["-E", "--exclude", "-g", "--glob"]);
const FD_VALUE_OPTIONS = new Set(["-t", "--type", "-e", "--extension", "--search-path"]);
const GIT_LS_FILES_PATTERN_OPTIONS = new Set(["--exclude"]);
const GIT_LS_FILES_VALUE_OPTIONS = new Set(["--exclude-from", "--pathspec-from-file"]);
const SED_VALUE_OPTIONS = new Set(["-e", "-f"]);
const HEAD_TAIL_VALUE_OPTIONS = new Set(["-n", "--lines", "-c", "--bytes"]);
const LS_VALUE_OPTIONS = new Set([
  "-I", "--ignore",
  "-w", "--width",
  "--indicator-style",
  "--time-style",
  "--quoting-style",
]);
const STAT_VALUE_OPTIONS = new Set(["-f", "--format", "-c", "--printf"]);
const SHELL_READ_COMMANDS = new Set(["sed", "cat", "nl", "head", "tail", "less", "more", "bat", "file", "stat"]);
const SHELL_SEARCH_COMMANDS = new Set(["rg", "rga", "ripgrep-all", "ag", "ack", "pt", "grep", "egrep", "fgrep"]);
const SHELL_LIST_COMMANDS = new Set(["ls"]);
const SHELL_STRUCTURE_SKIP_COMMANDS = new Set([
  ".", ":", "[", "]",
  "alias", "bg", "break", "builtin",
  "caller", "case", "cd", "command", "compgen", "complete", "continue",
  "declare", "dirs", "do", "done",
  "elif", "else", "env", "esac", "eval", "exec", "export",
  "false", "fg", "fi", "for", "function",
  "hash", "if", "in",
  "jobs",
  "kill",
  "let", "local",
  "mapfile",
  "popd", "pushd", "pwd",
  "read", "readarray", "return",
  "select", "set", "shift", "source",
  "test", "then", "trap", "true", "type", "typeset",
  "ulimit", "umask", "unalias", "unset", "until",
  "wait", "while",
]);
const HEREDOC_START_RE = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g;
const COMMAND_SUBSTITUTION_RE = /\$\(([^()\n]+)\)/g;

function pushUniqueString(list, value, limit = 20) {
  if (!Array.isArray(list)) return;
  if (typeof value !== "string") return;
  const text = value.trim();
  if (!text || list.includes(text) || list.length >= limit) return;
  list.push(text);
}

function looksLikeGlobPath(value) {
  return typeof value === "string" && /[*?[\]{}]/.test(value);
}

function isEnvAssignment(token) {
  return typeof token === "string" && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}

function looksLikePathPatternToken(token, mode = "explicit") {
  if (typeof token !== "string") return false;
  const text = token.trim();
  if (!text || text === "." || text === ".." || text === "--") return false;
  if (text.startsWith("-") || text.startsWith("<<")) return false;
  if (!looksLikeGlobPath(text)) return false;
  if (isEnvAssignment(text)) return false;
  if (/^\d+$/.test(text)) return false;

  if (mode === "loose") {
    return PATH_PATTERN_TOKEN_RE.test(text);
  }

  if (text.startsWith("/") || text.startsWith("./") || text.startsWith("../") || text.startsWith("~/")) return true;
  if (text.includes("/")) return true;
  return PATH_EXTENSION_RE.test(text) || /[*?]/.test(text);
}

function looksLikePathFilterToken(token) {
  if (typeof token !== "string") return false;
  const text = token.trim();
  if (!text || text === "." || text === ".." || text === "--") return false;
  if (text.startsWith("-") || text.startsWith("<<")) return false;
  if (isEnvAssignment(text)) return false;
  if (/^\d+$/.test(text)) return false;
  return PATH_PATTERN_TOKEN_RE.test(text);
}

function pushUniquePathFilter(list, value, limit = 20) {
  if (!Array.isArray(list)) return;
  if (typeof value !== "string") return;
  const text = value.trim();
  if (!looksLikePathFilterToken(text)) return;
  pushUniqueString(list, text, limit);
}

function extractAssignedOptionValue(arg, options) {
  if (typeof arg !== "string" || !arg || !options || typeof options[Symbol.iterator] !== "function") return null;
  for (const optionName of options) {
    if (typeof optionName !== "string" || !optionName) continue;
    if (arg.startsWith(`${optionName}=`)) {
      return arg.slice(optionName.length + 1);
    }
  }
  return null;
}

function looksLikePathToken(token, mode = "explicit") {
  if (typeof token !== "string") return false;
  const text = token.trim();
  if (!text || text === "." || text === ".." || text === "--") return false;
  if (text.startsWith("-") || text.startsWith("<<")) return false;
  if (/[|*?[\]{}()]/.test(text)) return false;
  if (isEnvAssignment(text)) return false;
  if (/^\d+$/.test(text)) return false;

  if (mode === "loose") {
    if (
      !text.startsWith("/") &&
      !text.startsWith("./") &&
      !text.startsWith("../") &&
      !text.startsWith("~/") &&
      !text.includes("/") &&
      !text.includes("\\") &&
      !PATH_EXTENSION_RE.test(text) &&
      BARE_SHELL_COMMAND_TOKENS.has(text.toLowerCase())
    ) {
      return false;
    }
    return GENERIC_PATH_TOKEN_RE.test(text);
  }

  if (text.startsWith("/") || text.startsWith("./") || text.startsWith("../") || text.startsWith("~/")) return true;
  if (text.includes("/")) return true;
  return PATH_EXTENSION_RE.test(text);
}

function looksLikeFdPathOperand(token) {
  if (!looksLikePathToken(token, "loose")) return false;
  const text = token.trim();
  return (
    text.startsWith("/") ||
    text.startsWith("./") ||
    text.startsWith("../") ||
    text.startsWith("~/") ||
    /[\\/]/.test(text)
  );
}

function countMatches(value, pattern) {
  if (typeof value !== "string" || !value || !(pattern instanceof RegExp)) return 0;
  let count = 0;
  let match = null;
  pattern.lastIndex = 0;
  while ((match = pattern.exec(value))) count += 1;
  pattern.lastIndex = 0;
  return count;
}

function tokenizeShellCommand(commandText, options = {}) {
  if (typeof commandText !== "string" || !commandText.trim()) return [];
  const preserveNewlines = Boolean(options && options.preserveNewlines);

  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;

  const pushCurrent = () => {
    if (!current) return;
    tokens.push(current);
    current = "";
  };

  for (let index = 0; index < commandText.length; index += 1) {
    const char = commandText[index];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }

    if (quote === "\"") {
      if (char === "\"") {
        quote = null;
        continue;
      }
      if (char === "\\") {
        const next = commandText[index + 1];
        if (typeof next === "string") {
          current += next;
          index += 1;
          continue;
        }
      }
      current += char;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }

    if (char === "\n" && preserveNewlines) {
      pushCurrent();
      tokens.push(";");
      continue;
    }

    if (char === "\r" && preserveNewlines) {
      pushCurrent();
      continue;
    }

    if (/\s/.test(char)) {
      pushCurrent();
      continue;
    }

    if ((char === "&" || char === "|") && commandText[index + 1] === char) {
      pushCurrent();
      tokens.push(char + char);
      index += 1;
      continue;
    }

    if (char === "|" || char === ";") {
      pushCurrent();
      tokens.push(char);
      continue;
    }

    current += char;
  }

  pushCurrent();
  return tokens;
}

function splitShellSegments(tokens) {
  const segments = [];
  let current = [];
  for (const token of Array.isArray(tokens) ? tokens : []) {
    if (SHELL_SEGMENT_TOKENS.has(token)) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  if (current.length) segments.push(current);
  return segments;
}

function normalizeCommandName(token) {
  if (typeof token !== "string" || !token) return "";
  const parts = token.split("/");
  return (parts[parts.length - 1] || "")
    .replace(/^[({]+/, "")
    .replace(/[)}]+$/, "")
    .toLowerCase();
}

function skipEnvAssignmentCommandSubstitution(segmentTokens, startIndex) {
  const values = Array.isArray(segmentTokens) ? segmentTokens : [];
  if (!values.length || startIndex >= values.length) return startIndex + 1;

  let index = startIndex;
  let depth = 0;
  while (index < values.length) {
    const token = values[index];
    depth += countMatches(token, /\$\(/g);
    depth -= countMatches(token, /\)/g);
    index += 1;
    if (depth <= 0) break;
  }
  return index;
}

function resolveCommandSegment(segmentTokens) {
  if (!Array.isArray(segmentTokens) || !segmentTokens.length) return null;

  let index = 0;
  while (index < segmentTokens.length) {
    const token = segmentTokens[index];
    if (!token) {
      index += 1;
      continue;
    }

    if (isEnvAssignment(token)) {
      if (/\$\(/.test(token)) {
        index = skipEnvAssignmentCommandSubstitution(segmentTokens, index);
      } else {
        index += 1;
      }
      continue;
    }

    const normalized = normalizeCommandName(token);
    if (normalized === "env") {
      index += 1;
      while (index < segmentTokens.length) {
        const current = segmentTokens[index];
        if (isEnvAssignment(current)) {
          index += 1;
          continue;
        }
        if (current === "-u" || current === "--unset") {
          index += 2;
          continue;
        }
        if (typeof current === "string" && current.startsWith("-")) {
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }

    if (WRAPPER_COMMANDS.has(normalized)) {
      index += 1;
      continue;
    }

    if (typeof token === "string" && token.startsWith("-")) {
      index += 1;
      continue;
    }

    return {
      commandName: normalized,
      index,
    };
  }

  return null;
}

function inferSimplePathHints(args, type, optionsWithValue = new Set(), options = {}) {
  const paths = [];
  const patterns = [];
  const types = [];
  const queries = [];
  let afterDashDash = false;
  let expectValue = false;
  let consumedScript = false;

  for (const arg of Array.isArray(args) ? args : []) {
    if (afterDashDash) {
      if (looksLikePathToken(arg, options.loosePaths ? "loose" : "explicit")) pushUniqueString(paths, arg);
      else if (looksLikePathPatternToken(arg, options.loosePaths ? "loose" : "explicit")) pushUniqueString(patterns, arg);
      continue;
    }

    if (expectValue) {
      expectValue = false;
      continue;
    }

    if (arg === "--") {
      afterDashDash = true;
      continue;
    }

    if (optionsWithValue.has(arg)) {
      expectValue = true;
      continue;
    }

    if (typeof arg === "string" && arg.startsWith("-")) continue;

    if (options.skipFirstNonPath && !consumedScript && !looksLikePathToken(arg, options.loosePaths ? "loose" : "explicit")) {
      consumedScript = true;
      continue;
    }
    consumedScript = true;

    if (looksLikePathToken(arg, options.loosePaths ? "loose" : "explicit")) {
      pushUniqueString(paths, arg);
    } else if (looksLikePathPatternToken(arg, options.loosePaths ? "loose" : "explicit")) {
      pushUniqueString(patterns, arg);
    }
  }

  if (paths.length && type) pushUniqueString(types, type);
  if (patterns.length && type) pushUniqueString(types, type);
  return { types, paths, patterns, queries };
}

function inferRipgrepLikeHints(args, commandName) {
  const types = [];
  const paths = [];
  const patterns = [];
  const queries = [];
  const grepFamily = commandName === "grep" || commandName === "egrep" || commandName === "fgrep";
  const valueOptions = grepFamily ? GREP_VALUE_OPTIONS : RIPGREP_VALUE_OPTIONS;
  const patternOptions = grepFamily ? GREP_PATH_PATTERN_OPTIONS : RIPGREP_PATH_PATTERN_OPTIONS;
  let afterDashDash = false;
  let expectValue = null;
  let fileListMode = false;
  let capturedQuery = false;

  for (const arg of Array.isArray(args) ? args : []) {
    if (afterDashDash) {
      if (looksLikePathToken(arg, "loose")) pushUniqueString(paths, arg);
      else if (looksLikePathPatternToken(arg, "loose")) pushUniquePathFilter(patterns, arg);
      continue;
    }

    if (expectValue) {
      if (expectValue === "query" && arg) {
        pushUniqueString(queries, arg);
        capturedQuery = true;
      } else if (expectValue === "pattern") {
        pushUniquePathFilter(patterns, arg);
      }
      expectValue = null;
      continue;
    }

    if (arg === "--") {
      afterDashDash = true;
      continue;
    }

    const assignedQuery = extractAssignedOptionValue(arg, ["--regexp"]);
    if (assignedQuery) {
      pushUniqueString(queries, assignedQuery);
      capturedQuery = true;
      continue;
    }

    const assignedPattern = extractAssignedOptionValue(arg, patternOptions);
    if (assignedPattern) {
      pushUniquePathFilter(patterns, assignedPattern);
      continue;
    }

    const assignedValue = extractAssignedOptionValue(arg, valueOptions);
    if (assignedValue != null) continue;

    if (arg === "--files") {
      fileListMode = true;
      continue;
    }

    if (arg === "-e" || arg === "--regexp") {
      expectValue = "query";
      continue;
    }

    if (patternOptions.has(arg)) {
      expectValue = "pattern";
      continue;
    }

    if (valueOptions.has(arg)) {
      expectValue = "skip";
      continue;
    }

    if (typeof arg === "string" && arg.startsWith("-")) continue;

    if (!fileListMode && !capturedQuery) {
      pushUniqueString(queries, arg);
      capturedQuery = true;
      continue;
    }

    if (looksLikePathToken(arg, "loose")) pushUniqueString(paths, arg);
    else if (looksLikePathPatternToken(arg, "loose")) pushUniquePathFilter(patterns, arg);
  }

  if (capturedQuery) pushUniqueString(types, "search");
  else if (fileListMode) pushUniqueString(types, "list_files");

  return { types, paths, patterns, queries };
}

function inferFindHints(args) {
  const paths = [];
  const patterns = [];
  const types = [];
  const queries = [];
  let rootPhase = true;
  let expectPattern = false;

  for (const arg of Array.isArray(args) ? args : []) {
    if (expectPattern) {
      pushUniquePathFilter(patterns, arg);
      pushUniqueString(queries, arg);
      expectPattern = false;
      rootPhase = false;
      continue;
    }

    if (arg === "--") {
      rootPhase = false;
      continue;
    }

    const assignedPattern = extractAssignedOptionValue(arg, FIND_PATH_PATTERN_OPTIONS);
    if (assignedPattern) {
      pushUniquePathFilter(patterns, assignedPattern);
      pushUniqueString(queries, assignedPattern);
      rootPhase = false;
      continue;
    }

    if (FIND_PATH_PATTERN_OPTIONS.has(arg)) {
      expectPattern = true;
      continue;
    }

    if (
      arg === "!" ||
      arg === "(" ||
      arg === ")" ||
      arg === "-o" ||
      arg === "-or" ||
      arg === "-a" ||
      arg === "-and" ||
      arg === "-not"
    ) {
      rootPhase = false;
      continue;
    }

    if (typeof arg === "string" && arg.startsWith("-")) {
      rootPhase = false;
      continue;
    }

    if (!rootPhase) continue;

    if (looksLikePathToken(arg, "loose")) pushUniqueString(paths, arg);
    else if (looksLikePathPatternToken(arg, "loose")) pushUniqueString(patterns, arg);
  }

  pushUniqueString(types, patterns.length ? "search" : "list_files");
  return { types, paths, patterns, queries };
}

function inferFdHints(args) {
  const types = [];
  const paths = [];
  const patterns = [];
  const queries = [];
  let afterDashDash = false;
  let expectValue = null;
  const nonFlags = [];

  for (const arg of Array.isArray(args) ? args : []) {
    if (afterDashDash) {
      nonFlags.push(arg);
      continue;
    }

    if (expectValue) {
      if (expectValue === "pattern") {
        pushUniquePathFilter(patterns, arg);
      }
      expectValue = null;
      continue;
    }

    if (arg === "--") {
      afterDashDash = true;
      continue;
    }

    const assignedPattern = extractAssignedOptionValue(arg, FD_PATH_PATTERN_OPTIONS);
    if (assignedPattern) {
      pushUniquePathFilter(patterns, assignedPattern);
      continue;
    }

    const assignedValue = extractAssignedOptionValue(arg, FD_VALUE_OPTIONS);
    if (assignedValue != null) continue;

    if (FD_PATH_PATTERN_OPTIONS.has(arg)) {
      expectValue = "pattern";
      continue;
    }

    if (FD_VALUE_OPTIONS.has(arg)) {
      expectValue = "skip";
      continue;
    }

    if (typeof arg === "string" && arg.startsWith("-")) continue;
    nonFlags.push(arg);
  }

  if (nonFlags.length <= 1) {
    const single = nonFlags[0] || "";
    if (single) {
      if (looksLikeFdPathOperand(single)) {
        pushUniqueString(paths, single);
        pushUniqueString(types, "list_files");
      } else {
        pushUniqueString(queries, single);
        pushUniqueString(types, "search");
      }
    } else {
      pushUniqueString(types, "list_files");
    }
  } else {
    pushUniqueString(queries, nonFlags[0]);
    if (looksLikePathToken(nonFlags[1], "loose")) pushUniqueString(paths, nonFlags[1]);
    else if (looksLikePathPatternToken(nonFlags[1], "loose")) pushUniquePathFilter(patterns, nonFlags[1]);
    pushUniqueString(types, "search");
  }

  return { types, paths, patterns, queries };
}

function inferGitHints(args) {
  const types = [];
  const paths = [];
  const patterns = [];
  const queries = [];
  if (!Array.isArray(args) || !args.length) return { types, paths, patterns, queries };

  let subcommandIndex = 0;
  while (subcommandIndex < args.length && typeof args[subcommandIndex] === "string" && args[subcommandIndex].startsWith("-")) {
    subcommandIndex += 1;
  }
  if (subcommandIndex >= args.length) return { types, paths, patterns, queries };

  const subcommand = String(args[subcommandIndex]).toLowerCase();
  const rest = args.slice(subcommandIndex + 1);
  let afterDashDash = false;
  let expectValue = null;
  let capturedQuery = false;

  for (const arg of rest) {
    if (afterDashDash) {
      if (looksLikePathToken(arg, "loose")) pushUniqueString(paths, arg);
      else if (looksLikePathPatternToken(arg, "loose")) pushUniqueString(patterns, arg);
      continue;
    }

    if (expectValue) {
      if (expectValue === "query" && arg) {
        pushUniqueString(queries, arg);
        capturedQuery = true;
      } else if (expectValue === "pattern") {
        pushUniquePathFilter(patterns, arg);
      }
      expectValue = null;
      continue;
    }

    if (arg === "--") {
      afterDashDash = true;
      continue;
    }

    if (subcommand === "grep") {
      const assignedQuery = extractAssignedOptionValue(arg, ["--regexp"]);
      if (assignedQuery) {
        pushUniqueString(queries, assignedQuery);
        capturedQuery = true;
        continue;
      }

      const assignedPattern = extractAssignedOptionValue(arg, GREP_PATH_PATTERN_OPTIONS);
      if (assignedPattern) {
        pushUniquePathFilter(patterns, assignedPattern);
        continue;
      }
    }

    if (subcommand === "ls-files") {
      const assignedPattern = extractAssignedOptionValue(arg, GIT_LS_FILES_PATTERN_OPTIONS);
      if (assignedPattern) {
        pushUniquePathFilter(patterns, assignedPattern);
        continue;
      }

      const assignedValue = extractAssignedOptionValue(arg, GIT_LS_FILES_VALUE_OPTIONS);
      if (assignedValue != null) continue;
    }

    if (subcommand === "grep" && (arg === "-e" || arg === "--regexp")) {
      expectValue = "query";
      continue;
    }

    if (subcommand === "grep" && GREP_PATH_PATTERN_OPTIONS.has(arg)) {
      expectValue = "pattern";
      continue;
    }

    if (subcommand === "grep" && GREP_VALUE_OPTIONS.has(arg)) {
      expectValue = "skip";
      continue;
    }

    if (subcommand === "ls-files" && GIT_LS_FILES_PATTERN_OPTIONS.has(arg)) {
      expectValue = "pattern";
      continue;
    }

    if (subcommand === "ls-files" && GIT_LS_FILES_VALUE_OPTIONS.has(arg)) {
      expectValue = "skip";
      continue;
    }

    if (typeof arg === "string" && arg.startsWith("-")) continue;

    if (subcommand === "grep" && !capturedQuery) {
      pushUniqueString(queries, arg);
      capturedQuery = true;
      continue;
    }

    if (subcommand === "ls-files") {
      if (looksLikePathToken(arg, "loose")) pushUniqueString(paths, arg);
      else if (looksLikePathPatternToken(arg, "loose")) pushUniquePathFilter(patterns, arg);
      continue;
    }

    if (subcommand === "diff") {
      if (looksLikePathToken(arg, afterDashDash ? "loose" : "explicit")) pushUniqueString(paths, arg);
      else if (looksLikePathPatternToken(arg, afterDashDash ? "loose" : "explicit")) pushUniquePathFilter(patterns, arg);
      continue;
    }

    if (
      (subcommand === "show" || subcommand === "restore" || subcommand === "checkout" || subcommand === "add" || subcommand === "rm" || subcommand === "mv") &&
      (looksLikePathToken(arg, afterDashDash ? "loose" : "explicit") || looksLikePathPatternToken(arg, afterDashDash ? "loose" : "explicit"))
    ) {
      if (looksLikePathToken(arg, afterDashDash ? "loose" : "explicit")) pushUniqueString(paths, arg);
      else pushUniquePathFilter(patterns, arg);
    }
  }

  if (subcommand === "grep" && capturedQuery) pushUniqueString(types, "search");
  if (subcommand === "ls-files") pushUniqueString(types, "list_files");
  if ((subcommand === "diff" || subcommand === "show") && (paths.length || patterns.length)) pushUniqueString(types, "read");
  if ((subcommand === "restore" || subcommand === "checkout" || subcommand === "add" || subcommand === "rm" || subcommand === "mv") && (paths.length || patterns.length)) {
    pushUniqueString(types, "read");
  }

  return { types, paths, patterns, queries };
}

function inferShellCommandTypeHint(commandName, args = []) {
  const normalized = typeof commandName === "string" ? commandName.toLowerCase() : "";
  if (!normalized) return null;
  if (SHELL_READ_COMMANDS.has(normalized)) return "read";
  if (SHELL_SEARCH_COMMANDS.has(normalized)) return "search";
  if (SHELL_LIST_COMMANDS.has(normalized)) return "list_files";

  if (normalized === "find") {
    const values = Array.isArray(args) ? args : [];
    for (const arg of values) {
      if (typeof arg !== "string" || !arg) continue;
      if (FIND_PATH_PATTERN_OPTIONS.has(arg)) return "search";
      if (extractAssignedOptionValue(arg, FIND_PATH_PATTERN_OPTIONS)) return "search";
    }
    return "list_files";
  }

  if (normalized === "fd") {
    const hints = inferFdHints(Array.isArray(args) ? args : []);
    return Array.isArray(hints.types) && hints.types.length ? hints.types[0] : null;
  }

  if (normalized === "git") {
    const values = Array.isArray(args) ? args : [];
    let subcommandIndex = 0;
    while (
      subcommandIndex < values.length &&
      typeof values[subcommandIndex] === "string" &&
      values[subcommandIndex].startsWith("-")
    ) {
      subcommandIndex += 1;
    }
    const subcommand = subcommandIndex < values.length ? String(values[subcommandIndex]).toLowerCase() : "";
    if (subcommand === "grep") return "search";
    if (subcommand === "ls-files") return "list_files";
    if (subcommand === "diff" || subcommand === "show") return "read";
  }

  return null;
}

function collectShellStructureSources(commandText) {
  if (typeof commandText !== "string" || !commandText.trim()) return [];

  const sources = [];
  const heredocDelimiters = [];
  const lines = [];
  const normalized = commandText.replace(/\r\n/g, "\n");
  let current = "";
  let quote = null;
  let escaped = false;

  const pushCurrentLine = () => {
    lines.push(current);
    current = "";
  };

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (quote === "'") {
      current += char;
      if (char === "'") quote = null;
      continue;
    }

    if (quote === "\"") {
      current += char;
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") quote = null;
      continue;
    }

    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }

    if (char === "'" || char === "\"") {
      current += char;
      quote = char;
      continue;
    }

    if (char === "\n") {
      pushCurrentLine();
      continue;
    }

    current += char;
  }
  pushCurrentLine();

  for (const rawLine of lines) {
    const line = typeof rawLine === "string" ? rawLine : "";
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (heredocDelimiters.length) {
      if (trimmed === heredocDelimiters[0]) heredocDelimiters.shift();
      continue;
    }

    sources.push(line);

    let match = null;
    HEREDOC_START_RE.lastIndex = 0;
    while ((match = HEREDOC_START_RE.exec(line))) {
      if (match[2]) heredocDelimiters.push(match[2]);
    }

    COMMAND_SUBSTITUTION_RE.lastIndex = 0;
    while ((match = COMMAND_SUBSTITUTION_RE.exec(line))) {
      const inner = typeof match[1] === "string" ? match[1].trim() : "";
      if (inner) sources.push(inner);
    }
  }

  return sources;
}

function isUsefulShellStructureCommand(commandName) {
  if (typeof commandName !== "string" || !commandName) return false;
  if (SHELL_STRUCTURE_SKIP_COMMANDS.has(commandName)) return false;
  return /^[A-Za-z0-9_.:+-]+$/.test(commandName);
}

function inferShellCommandStructure(commandText) {
  const shellCommands = [];
  const commandTypeHints = [];
  const sources = collectShellStructureSources(commandText);

  for (const source of sources) {
    const tokens = tokenizeShellCommand(source);
    const segments = splitShellSegments(tokens);

    for (const segment of segments) {
      const resolved = resolveCommandSegment(segment);
      if (!resolved || !isUsefulShellStructureCommand(resolved.commandName)) continue;
      pushUniqueString(shellCommands, resolved.commandName, 20);
      const hint = inferShellCommandTypeHint(
        resolved.commandName,
        segment.slice(resolved.index + 1)
      );
      pushUniqueString(commandTypeHints, hint, 10);
    }
  }

  return { shellCommands, commandTypeHints };
}

function inferCommandHints(commandText) {
  const tokens = tokenizeShellCommand(commandText);
  const segments = splitShellSegments(tokens);
  const types = [];
  const paths = [];
  const patterns = [];
  const queries = [];

  for (const segment of segments) {
    const resolved = resolveCommandSegment(segment);
    if (!resolved) continue;
    const args = segment.slice(resolved.index + 1);
    let hints = { types: [], paths: [], patterns: [], queries: [] };

    switch (resolved.commandName) {
      case "rg":
      case "rga":
      case "ripgrep-all":
      case "ag":
      case "ack":
      case "pt":
      case "grep":
      case "egrep":
      case "fgrep":
        hints = inferRipgrepLikeHints(args, resolved.commandName);
        break;
      case "fd":
        hints = inferFdHints(args);
        break;
      case "sed":
        hints = inferSimplePathHints(args, "read", SED_VALUE_OPTIONS, {
          skipFirstNonPath: true,
          loosePaths: true,
        });
        break;
      case "cat":
      case "nl":
      case "head":
      case "tail":
      case "less":
      case "more":
      case "bat":
        hints = inferSimplePathHints(args, "read", HEAD_TAIL_VALUE_OPTIONS, { loosePaths: true });
        break;
      case "file":
        hints = inferSimplePathHints(args, "read", new Set(), { loosePaths: true });
        break;
      case "stat":
        hints = inferSimplePathHints(args, "read", STAT_VALUE_OPTIONS, { loosePaths: true });
        break;
      case "ls":
        hints = inferSimplePathHints(args, "list_files", LS_VALUE_OPTIONS, { loosePaths: true });
        break;
      case "find":
        hints = inferFindHints(args);
        break;
      case "git":
        hints = inferGitHints(args);
        break;
      default:
        break;
    }

    for (const type of hints.types) pushUniqueString(types, type);
    for (const candidate of hints.paths) pushUniqueString(paths, candidate);
    for (const candidate of hints.patterns) pushUniqueString(patterns, candidate);
    for (const query of hints.queries) pushUniqueString(queries, query);
  }

  return { types, paths, patterns, queries };
}

module.exports = {
  inferCommandHints,
  inferShellCommandStructure,
  looksLikeGlobPath,
};
