import { defineConfig } from '@playwright/test';

/**
 * Browser tests: the built editor page, in Chromium, with the File System
 * Access API stubbed (see `test/e2e/fake-file-system.js`) so the Scene the
 * editor saves can be read back and compared with `ez render`.
 */
export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4319',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: 'node scripts/serve.mjs dist 4319',
    url: 'http://127.0.0.1:4319/editor.html',
    reuseExistingServer: !process.env['CI'],
    stdout: 'ignore',
  },
});
