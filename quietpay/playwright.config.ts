import { defineConfig } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  workers: 1,
  timeout: 30_000,
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { QUIETPAY_ALLOW_PUBLIC_FALLBACK: "true" },
  },
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 360, height: 740 } },
});
