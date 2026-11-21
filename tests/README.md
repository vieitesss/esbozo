# Browser tests

Seven files, three scripts, each starting the built editor in Chromium through
e2e. Build first (`pnpm build`), or use the scripts, which build.

`editor.e2e.ts` serves the page statically and stubs the File System Access API;
`serve.e2e.ts` runs `ez serve` on a real temporary folder, so it saves and reads
real files; `embed.e2e.ts` loads `ez bundle`'s output in a page that holds only
the element and its attributes, beside a stub of the same save API. All six
model-free files run under `pnpm e2e`.

| Script | Files | Model calls |
| --- | --- | --- |
| `pnpm e2e` | `editor.e2e.ts`, `drawing.e2e.ts`, `snap.e2e.ts`, `serve.e2e.ts`, `embed.e2e.ts`, `cdp.e2e.ts` | none |
| `pnpm e2e:agent` | `visual.e2e.ts` | one per `agent.assert` / `agent.waitFor`, every run |
| `pnpm e2e:shots` | `screenshots.e2e.ts` | none; skipped unless `ESBOZO_SHOTS` names a folder |

## Real browser input: `tests/cdp.ts`

e2e's `browser` fixture drives the page through roles, pointer and keys, and
hands out no CDP session. Some contracts need one anyway: an input method's
preedit (`Input.imeSetComposition`, `Input.insertText`) and a slow CPU
(`Emulation.setCPUThrottlingRate`) cannot be faked by dispatching events from a
test, which is how an IME bug once passed a suite that drove the editor with
synthetic `compositionstart`/`compositionend` events.

`tests/cdp.ts` reaches the page through `surfaceOf(engine)`: `e2e.config.ts`
keeps its `web()` handle there, and e2e loads the config in each worker process,
so a test reads back the live page of the run it is in. It exports
`imeCompose(text)`, `imeCommit()`, `throttleCpu(rate)`, and `livePage()` for a
test's own page setup. `imeCommit()` confirms a preedit that is still open, and
refuses one the browser already ended (a blur ends a composition) rather than
typing the words a second time. `cdp.e2e.ts` is the proof, on a plain
`<textarea>` and not the editor: the preedit is the field's value while the
composition is open, the commit and the click-away each end it, and 4×
throttling measurably slows the page. Driving the page out of band is the
harness's documented escape hatch; reach for it for input no event can fake, not
to shortcut a role click.

## Why the agent suite is separate

e2e's model steps are judgements of the live screen, so `agent.assert` and
`agent.waitFor` call the model on every run. `pnpm e2e` is therefore model-free
and needs no key, and `pnpm e2e:agent` needs `OPENCODE_API_KEY` (or a `.env` at
the project root) and costs a call per judgement.

Drive the page the way a person does: role clicks and keys, as the theme switch
and the tool rail already are. `agent` is then only asked to judge (`assert`,
`waitFor`), never to act, so nothing is recorded and `.e2e/cache/` stays unused
and ignored.
