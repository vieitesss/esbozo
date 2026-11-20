import { existsSync } from 'node:fs';
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { opencodeConsole } from 'e2e/oauth/opencode-console';

/**
 * Seam 2: the built editor page, in Chromium, with the File System Access API
 * stubbed (see `tests/fake-file-system.js`) so the Scene the editor saves can be
 * read back and compared with `ez render`.
 *
 * e2e starts the server itself, so a run needs no second terminal. The page is
 * served from `dist`, which `pnpm e2e` builds first.
 *
 * Agent steps run on OpenCode Go: `muse-spark-1.3-contributor` takes images and
 * tool calls. The key comes from the environment, or from a `.env` at the
 * project root that is not in git, and is never read from a committed file.
 */
const env = new URL('.env', import.meta.url);
if (process.env['OPENCODE_API_KEY'] === undefined && existsSync(env)) {
  process.loadEnvFile(env);
}

export default {
  agents: {
    default: {
      model: opencodeConsole('go/muse-spark-1.3-contributor'),
      system:
        'You are a careful QA agent for a drawing editor. Judge only what the screen shows: the ink it paints, the Grid, the theme, and the status line. Do not guess at the markup behind it.',
    },
  },
  targets: [
    {
      engine: web({ viewport: { width: 1280, height: 800 } }),
      app: {
        url: 'http://127.0.0.1:4319',
        command: {
          executable: process.execPath,
          args: ['scripts/serve.mjs', 'dist', '4319'],
          reuseExisting: true,
          log: '.e2e/logs/app.log',
        },
      },
    },
  ],
  // One page at a time: every test drives the same server and reads the folder
  // it seeded, so the stub handles never race.
  workers: 1,
} satisfies E2EConfig;
