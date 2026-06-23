import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:8765',
  },
  webServer: {
    command: 'python3 server.py',
    url: 'http://localhost:8765',
    reuseExistingServer: !process.env.CI,
  },
});
