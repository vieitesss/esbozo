import { existsSync } from 'node:fs';
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { opencodeConsole } from 'e2e/oauth/opencode-console';
import { keepSurface } from './tests/cdp.ts';

/**
 * Seam 2: the built editor page, in Chromium, with the File System Access API
 * stubbed (see `tests/fake-file-system.js`) so the Scene the editor saves can be
 * read back and compared with `ez render`.
 *
 * e2e starts the server itself on a port it picks, so a run needs no second
 * terminal and cannot drive another worktree's build. The page is served from
 * `dist`, which `pnpm e2e` builds first.
 *
 * The server stays `scripts/serve.mjs` rather than `ez serve`: a served page
 * takes its folder from the save API, and this suite's folder is the stubbed
 * File System Access handle. `tests/serve.e2e.ts` drives `ez serve` on a real
 * folder, which is the only place that mode is wanted.
 *
 * Agent steps run on OpenCode Go: `muse-spark-1.3-contributor` takes images and
 * tool calls. The key comes from the environment, or from a `.env` at the
 * project root that is not in git, and is never read from a committed file.
 */
const env = new URL('.env', import.meta.url);
if (process.env['OPENCODE_API_KEY'] === undefined && existsSync(env)) {
  process.loadEnvFile(env);
}

/**
 * One engine handle, kept before it goes into the target: `tests/cdp.ts` reads
 * the live page back from it, for the input only CDP can dispatch (see that
 * file). The worker loads this config itself, so the handle a test reaches is
 * the handle this run drives.
 */
const engine = web({ viewport: { width: 1280, height: 800 } });
keepSurface(engine);

/**
 * One judgement of the live screen is one model call, and a slow model is the
 * model's business: 30 s (e2e's default) failed a `pnpm e2e:agent` run with
 * `STEP_TIMEOUT: model call exceeded the remaining step timeout`, on a screen
 * the run before had judged. Double that.
 */
const JUDGMENT_TIMEOUT_MS = 60_000;
/**
 * One attempt is one test, and the busiest test makes three judgements: three
 * slow calls are 180 s of model time before the run has opened the editor or
 * taken a screenshot. The attempt gets a minute more, so the last call is not
 * cut off by the budget the ones before it spent.
 */
const ATTEMPT_TIMEOUT_MS = 240_000;

/**
 * @public The `e2e` runner loads this file by name, so nothing in the project
 * imports the config it exports.
 */
export default {
  // Room for every judgement a test makes, not for a slower page.
  timeout: ATTEMPT_TIMEOUT_MS,
  agents: {
    default: {
      model: opencodeConsole('go/muse-spark-1.3-contributor'),
      judgmentTimeout: JUDGMENT_TIMEOUT_MS,
      system:
        'You are a careful QA agent for a drawing editor. Judge only what the screen shows: the ink it paints, the Grid, the theme, and the status line. Do not guess at the markup behind it.',
    },
  },
  targets: [
    {
      engine,
      app: {
        // Port 0 asks e2e for a free port and fills it into `{port}`, so parallel
        // worktrees never share a server and a stale one is never reused.
        url: 'http://127.0.0.1:0',
        // Copy and paste are part of what these tests drive.
        permissions: { 'clipboard-read': 'grant', 'clipboard-write': 'grant' },
        command: {
          executable: process.execPath,
          args: ['scripts/serve.mjs', 'dist', '{port}'],
          log: '.e2e/logs/app.log',
        },
      },
    },
  ],
  // One page at a time: every test drives the same server and reads the folder
  // it seeded, so the stub handles never race.
  workers: 1,
} satisfies E2EConfig;
