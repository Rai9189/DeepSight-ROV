import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Tests share one database, one GPU and one video source.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:3000',
    // Playwright's bundled Chromium usually lacks H.264, the default PREFER_CODEC.
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'chrome', dependencies: ['setup'] },
  ],
  // No reuseExistingServer: a server already on these ports fails the run, so the
  // tests can never reach a backend that is using the real database.
  webServer: [
    {
      command: '.\\mediamtx.exe mediamtx.yml',
      port: 8554,
    },
    {
      command: 'venv\\Scripts\\python ..\\..\\e2e\\run_backend.py',
      cwd: 'src/backend',
      url: 'http://localhost:8000/api/health',
      timeout: 120_000, // YOLO model load
    },
    {
      // Tests the last `npm run build`: only production prefetches loading.tsx.
      // E2E_DEV=1 uses the dev server instead, where the Loading test fails.
      command: process.env.E2E_DEV ? 'npm run dev' : 'npm run start',
      url: 'http://localhost:3000/auth/login',
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_BACKEND_URL: 'http://localhost:8000',
        NEXT_PUBLIC_API_URL: 'http://localhost:8000',
      },
    },
  ],
});
