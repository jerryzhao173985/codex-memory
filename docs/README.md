# Codex Harness Docs

- [codex-history-docs-map.md](./codex-history-docs-map.md): canonical docs homes, subsystem ownership, and runtime checkpoints
- [codex-history-harness.md](./codex-history-harness.md): daily operator guide for `cmem` and `history.js`
- [codex-history-system-model.md](./codex-history-system-model.md): exact vs derived mental model for the harness
- [codex-history-source-grounding.md](./codex-history-source-grounding.md): upstream `codex app-server` parity, normalized differences, and current intentional gaps
- [codex-history-maintenance.md](./codex-history-maintenance.md): maintainer map for module boundaries, invariants, tests, and next worthwhile work

## Start Here

- if you need to know which doc owns a stable feature family, start with [codex-history-docs-map.md](./codex-history-docs-map.md)
- if you need command usage, start with [codex-history-harness.md](./codex-history-harness.md)
- if you need exact-vs-derived semantics, start with [codex-history-system-model.md](./codex-history-system-model.md)
- if you need upstream bridge parity and normalizations, use [codex-history-source-grounding.md](./codex-history-source-grounding.md)
- if you need module ownership, tests, and next worthwhile work, use [codex-history-maintenance.md](./codex-history-maintenance.md)

## Executable Examples

A representative subset of the README/operator examples is exercised by [test/readme-smoke.test.js](../test/readme-smoke.test.js).

Current smoke-covered examples include:

- `npm run history -- overview`
- `npm run history -- search --query "dokcer" --query-mode fuzzy --limit 5`
- `npm run history -- search --query "feature-toggle" --json --pretty --compact`
- `npm run history -- threads --sort updated_at --model-provider openai --source-kind sub-agent-thread-spawn`
- `npm run history -- project --cwd ...`
- `npm run history -- family ...`
- `npm run history -- workstream ...`
- `npm run history -- workstream ... --json --pretty --compact`
- `npm run history -- artifacts --kind query --q "feature-toggle" --json --pretty --compact`
- `cmem query "dokcer" --fuzzy`
- `cmem threads --sort updated_at --model-provider openai --source-kind cli`
- `cmem repo ...`

These are intentionally representative smoke checks, not exhaustive docs coverage.
