import { defineConfig } from "@playwright/test";

export default defineConfig({
  fullyParallel: false,
  reporter: "list",
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    trace: "on-first-retry"
  },
  workers: 1
});
