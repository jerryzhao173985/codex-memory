"use strict";

// Extracted from ../agents/codex.js.

module.exports = Object.freeze({
  id: "codex",
  name: "Codex CLI",
  eventSource: "log-poll",
  logEventMap: Object.freeze({
    "session_meta": "idle",
    "event_msg:task_started": "thinking",
    "event_msg:turn_started": "thinking",
    "event_msg:user_message": "thinking",
    "event_msg:agent_message": null,
    "event_msg:exec_command_end": "working",
    "event_msg:patch_apply_end": "working",
    "event_msg:dynamic_tool_call_response": "working",
    "response_item:custom_tool_call_output": "working",
    "response_item:function_call": "working",
    "response_item:custom_tool_call": "working",
    "response_item:web_search_call": "working",
    "event_msg:task_complete": "codex-turn-end",
    "event_msg:turn_complete": "codex-turn-end",
    "event_msg:context_compacted": "sweeping",
    "event_msg:turn_aborted": "idle"
  }),
  logConfig: Object.freeze({
    sessionDir: "~/.codex/sessions",
    filePattern: "rollout-*.jsonl",
    pollIntervalMs: 1500
  })
});
