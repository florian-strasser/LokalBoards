import { defineConfig } from "vitest/config";

// Integration tests run against a real (throwaway) MySQL. Provide the connection
// via TEST_MYSQL_* env vars; these are mapped onto the NUXT_MYSQL_* vars that
// app/lib/databaseSetup.ts reads. Never point this at a real/production database
// — the tests truncate tables.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.integration.test.ts"],
    // One shared database — run test files serially to avoid cross-talk.
    fileParallelism: false,
    env: {
      NUXT_MYSQL_HOST: process.env.TEST_MYSQL_HOST ?? "127.0.0.1",
      NUXT_MYSQL_PORT: process.env.TEST_MYSQL_PORT ?? "",
      NUXT_MYSQL_USER: process.env.TEST_MYSQL_USER ?? "root",
      NUXT_MYSQL_PASSWORD: process.env.TEST_MYSQL_PASSWORD ?? "",
      NUXT_MYSQL_DATABASE: process.env.TEST_MYSQL_DATABASE ?? "lokalboards_test",
      NUXT_MYSQL_SSL: process.env.TEST_MYSQL_SSL ?? "false",
    },
  },
});
