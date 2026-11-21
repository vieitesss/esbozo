# Browser tests

Six files, three scripts, each starting the built editor in Chromium through
e2e. Build first (`pnpm build`), or use the scripts, which build.

`editor.e2e.ts` serves the page statically and stubs the File System Access API;
`serve.e2e.ts` runs `ez serve` on a real temporary folder, so it saves and reads
real files; `embed.e2e.ts` loads `ez bundle`'s output in a page that holds only
the element and its attributes, beside a stub of the same save API. All five
model-free files run under `pnpm e2e`.

| Script | Files | Model calls |
| --- | --- | --- |
| `pnpm e2e` | `editor.e2e.ts`, `drawing.e2e.ts`, `snap.e2e.ts`, `serve.e2e.ts`, `embed.e2e.ts` | none |
| `pnpm e2e:agent` | `visual.e2e.ts` | one per `agent.assert` / `agent.waitFor`, every run |
| `pnpm e2e:shots` | `screenshots.e2e.ts` | none; skipped unless `ESBOZO_SHOTS` names a folder |

## Why the agent suite is separate

e2e's model steps are judgements of the live screen, so `agent.assert` and
`agent.waitFor` call the model on every run. `pnpm e2e` is therefore model-free
and needs no key, and `pnpm e2e:agent` needs `OPENCODE_API_KEY` (or a `.env` at
the project root) and costs a call per judgement.

Drive the page the way a person does: role clicks and keys, as the theme switch
and the tool rail already are. `agent` is then only asked to judge (`assert`,
`waitFor`), never to act, so nothing is recorded and `.e2e/cache/` stays unused
and ignored.
