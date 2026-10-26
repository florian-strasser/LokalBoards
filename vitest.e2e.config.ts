import { defineConfig } from "vitest/config";

// End-to-end tests build and run the real Nuxt server (via @nuxt/test-utils) and
// hit it over HTTP. They need a throwaway MySQL — provide it via TEST_MYSQL_*
// (mapped onto the NUXT_MYSQL_* vars the server reads). Never point at real data.
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.e2e.test.ts"],
    // The server is built once in a beforeAll hook; give it room.
    testTimeout: 60_000,
    hookTimeout: 240_000,
    fileParallelism: false,
    env: {
      NUXT_MYSQL_HOST: process.env.TEST_MYSQL_HOST ?? "127.0.0.1",
      NUXT_MYSQL_PORT: process.env.TEST_MYSQL_PORT ?? "",
      NUXT_MYSQL_USER: process.env.TEST_MYSQL_USER ?? "root",
      NUXT_MYSQL_PASSWORD: process.env.TEST_MYSQL_PASSWORD ?? "",
      NUXT_MYSQL_DATABASE: process.env.TEST_MYSQL_DATABASE ?? "lokalboards_test",
      NUXT_MYSQL_SSL: "false",
      NUXT_PUBLIC_SIGNUP: "true",
      NUXT_LOG_LEVEL: "error",
      // Mail the tests trigger (welcome, password reset) goes nowhere rather
      // than to the placeholder host in nuxt.config.
      NUXT_EMAIL_HOST: "127.0.0.1",
      NUXT_EMAIL_PORT: "9",
    },
  },
});
