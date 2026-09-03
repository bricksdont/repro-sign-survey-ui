import { defineConfig } from '@playwright/test';

// A dedicated port, distinct from server.py's own default (8765) —
// deliberately never the port a developer would run `python3 server.py`
// on for everyday manual use. Tests spawn/reuse/tear down their own
// instance here without ever touching (or being confused by) a long-running
// process someone's using the app through in a browser at the same time.
const TEST_PORT = 8766;

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
  },
  webServer: {
    command: `python3 server.py ${TEST_PORT}`,
    url: `http://localhost:${TEST_PORT}`,
    reuseExistingServer: !process.env.CI,
    // No PB_URL override needed — server.py's /export auto-detects the
    // local PocketBase from the incoming Host header (localhost:8766
    // here), same as every other test in this suite already gets by
    // hitting http://localhost:8090 directly.
  },
});
