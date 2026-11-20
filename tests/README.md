# Browser tests

Three files, three scripts, two of which start the built editor in Chromium
through e2e. Build first (`pnpm build`), or use the scripts, which build.

| Script | File | Model calls |
| --- | --- | --- |
| `pnpm e2e` | `editor.e2e.ts` | none |
| `pnpm e2e:agent` | `visual.e2e.ts` | one per `agent.assert` / `agent.waitFor`, every run |
| `pnpm e2e:shots` | `screenshots.e2e.ts` | none; skipped unless `ESBOZO_SHOTS` names a folder |

## Why the agent suite is separate

e2e's replay cache only covers `agent.act`: a recorded action replays without
touching the model. `agent.assert` and `agent.waitFor` are judgements of the
live screen, so they call the model on every run. `pnpm e2e` is therefore
model-free and needs no key, and `pnpm e2e:agent` needs `OPENCODE_API_KEY` (or a
`.env` at the project root) and costs a call per judgement.

The one `agent.act` step, "turn the Grid off", is recorded in `.e2e/cache/`,
which is committed. Record a new one with the key set before committing it, or
the suite would replay nothing on a key-less machine.
