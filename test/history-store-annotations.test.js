const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createHistoryAnnotationStore,
  applyAnnotationPatch,
} = require("../history-store-annotations");

const tempRoots = new Set();

afterEach(() => {
  for (const rootDir of tempRoots) {
    fs.rmSync(rootDir, { recursive: true, force: true });
    tempRoots.delete(rootDir);
  }
});

function makeTempAnnotationPath() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-history-annotations-"));
  tempRoots.add(rootDir);
  return path.join(rootDir, "index", "annotations.json");
}

describe("history store annotations", () => {
  it("normalizes annotation patches and supports clearing note and tags", () => {
    const patched = applyAnnotationPatch({
      bookmarked: false,
      tags: ["Backend", "backend"],
      note: "keep",
      updatedAt: "2026-04-10T00:00:00.000Z",
    }, {
      bookmarked: true,
      addTags: ["Important", "backend"],
      removeTags: ["backend"],
      note: " resume from here ",
    });

    assert.ok(patched);
    assert.strictEqual(patched.bookmarked, true);
    assert.deepStrictEqual(patched.tags, ["backend", "important"]);
    assert.strictEqual(patched.note, "resume from here");

    const cleared = applyAnnotationPatch(patched, {
      clearTags: true,
      clearNote: true,
      bookmarked: false,
    });
    assert.strictEqual(cleared, null);
  });

  it("persists session and turn annotations and reapplies them to the cached catalog", () => {
    const annotationPath = makeTempAnnotationPath();
    const catalog = {
      sessions: [
        {
          sessionId: "codex:test-session",
          sessionKey: "test-session",
          cwd: "/repo/a",
          turns: [
            { turnId: "turn-1" },
          ],
        },
      ],
    };

    const annotationStore = createHistoryAnnotationStore({
      annotationPath,
      loadCatalog() {
        return catalog;
      },
      getCachedCatalog() {
        return catalog;
      },
    });

    const sessionResult = annotationStore.setSessionAnnotation("codex:test-session", {
      bookmarked: true,
      addTags: ["Important", "backend"],
      note: "resume from here",
    });
    assert.ok(sessionResult);
    assert.strictEqual(sessionResult.sessionId, "codex:test-session");
    assert.deepStrictEqual(sessionResult.annotation.tags, ["backend", "important"]);
    assert.strictEqual(catalog.sessions[0].annotation.bookmarked, true);

    const turnResult = annotationStore.setTurnAnnotation("codex:test-session", "turn-1", {
      addTags: ["fix"],
    });
    assert.ok(turnResult);
    assert.strictEqual(turnResult.turnId, "turn-1");
    assert.deepStrictEqual(turnResult.annotation.tags, ["fix"]);
    assert.deepStrictEqual(catalog.sessions[0].turns[0].annotation.tags, ["fix"]);

    const saved = JSON.parse(fs.readFileSync(annotationPath, "utf8"));
    assert.deepStrictEqual(saved.sessions["codex:test-session"].tags, ["backend", "important"]);
    assert.deepStrictEqual(saved.turns["codex:test-session::turn-1"].tags, ["fix"]);

    const refreshedCatalog = {
      sessions: [
        {
          sessionId: "codex:test-session",
          sessionKey: "test-session",
          cwd: "/repo/a",
          turns: [
            { turnId: "turn-1" },
          ],
        },
      ],
    };
    annotationStore.applyCatalogAnnotations(refreshedCatalog, true);
    assert.strictEqual(refreshedCatalog.sessions[0].annotation.bookmarked, true);
    assert.deepStrictEqual(refreshedCatalog.sessions[0].turns[0].annotation.tags, ["fix"]);
  });
});
