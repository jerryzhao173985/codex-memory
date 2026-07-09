"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createCatalogHistoryPolicy } = require("../catalog-history-policy");

test("catalog history policy normalizes source selection and filter-fallback notes", () => {
  const {
    buildHistoryViewSource,
  } = createCatalogHistoryPolicy({
    normalizeHistoryMode(value) {
      return value === "raw" ? "raw" : "effective";
    },
    getSessionRolloutMemoryMode() {
      return "";
    },
    getSessionRolloutEventMode() {
      return "";
    },
  });

  const source = buildHistoryViewSource("auto", "rollout", {
    filterFallback: true,
    filterScope: "resume",
  });

  assert.deepStrictEqual(source, {
    requested: "auto",
    used: "rollout",
    bridgeError: null,
    selectionReason: "auto_fallback_filter_miss",
    selectionNote: "fell back to rollout because the app-server view returned no matches for the requested resume filters.",
  });
});

test("catalog history policy builds reload safety from raw and polluted history quality", () => {
  const {
    buildHistoryQuality,
    buildResumeReloadSafety,
  } = createCatalogHistoryPolicy({
    normalizeHistoryMode(value) {
      return value === "raw" ? "raw" : "effective";
    },
    getSessionRolloutMemoryMode(sessionLike) {
      return sessionLike && sessionLike.memoryMode ? sessionLike.memoryMode : "";
    },
    getSessionRolloutEventMode(sessionLike) {
      return sessionLike && sessionLike.eventMode ? sessionLike.eventMode : "";
    },
  });

  const quality = buildHistoryQuality(
    { historyMode: "raw", memoryMode: "polluted", eventMode: "limited_or_unknown" },
    { historyMode: "raw" },
    { requested: "auto", used: "rollout" },
    "resume"
  );
  const reloadSafety = buildResumeReloadSafety(quality, null, { reloadPolicy: "strict" });

  assert.strictEqual(quality.mode, "raw_rollout_forensic");
  assert.strictEqual(quality.memoryMode, "polluted");
  assert.ok(quality.warnings.includes("session_meta recorded memory_mode=polluted for this session."));
  assert.strictEqual(reloadSafety.decision, "blocked");
  assert.strictEqual(reloadSafety.allowed, false);
  assert.ok(reloadSafety.reasons.includes("raw rollout history can reintroduce rolled-back or superseded turns into reload text."));
  assert.ok(reloadSafety.reasons.includes("session_meta recorded memory_mode=polluted for this session."));
  assert.ok(reloadSafety.suggestedFlags.includes("--history-mode effective"));
  assert.ok(reloadSafety.suggestedFlags.includes("--reload-policy allow"));
});
