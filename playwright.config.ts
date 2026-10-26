import { defineConfig } from "@playwright/test";

// 3000 by default, matching a normal local run. Overridable so the suite can be
// run beside a development server that already holds that port.
const PORT = Number(process.env.PLAYWRIGHT_PORT || 3000);
const baseURL = `http://127.0.0.1:${PORT}`;

const dbEnv = {
  NUXT_MYSQL_HOST: process.env.TEST_MYSQL_HOST ?? "127.0.0.1",
  NUXT_MYSQL_PORT: process.env.TEST_MYSQL_PORT ?? "",
  NUXT_MYSQL_USER: process.env.TEST_MYSQL_USER ?? "root",
  NUXT_MYSQL_PASSWORD: process.env.TEST_MYSQL_PASSWORD ?? "",
  NUXT_MYSQL_DATABASE: process.env.TEST_MYSQL_DATABASE ?? "lokalboards_test",
  NUXT_MYSQL_SSL: "false",
};

// Browser end-to-end tests against the built production server. Requires the app
// to be built first (`npm run build`) and a throwaway MySQL (TEST_MYSQL_*).
export default defineConfig({
  testDir: "./test/playwright",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  globalSetup: "./test/playwright/global-setup.ts",
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    command: "node .output/server/index.mjs",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...dbEnv,
      NUXT_LANGUAGE: "en",
      NUXT_PUBLIC_SIGNUP: "true",
      NUXT_LOG_LEVEL: "error",
      PORT: String(PORT),
      NITRO_PORT: String(PORT),
    },
  },
});
