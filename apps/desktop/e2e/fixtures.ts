import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base, type ElectronApplication, type Page } from "@playwright/test";
import { _electron as electron } from "playwright";

const currentDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(currentDir, "..");

type AppContext = {
  app: ElectronApplication;
  page: Page;
};

export const test = base.extend<{
  launchApp: () => Promise<AppContext>;
  storeDir: string;
}>({
  storeDir: async ({}, use) => {
    const directory = mkdtempSync(`${tmpdir()}/eve-desktop-e2e-`);
    try {
      await use(directory);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
  launchApp: async ({ storeDir }, use) => {
    await use(async () => {
      const app = await electron.launch({
        args: [appRoot],
        cwd: appRoot,
        env: {
          ...process.env,
          CI: "1",
          EVE_E2E_TEST: "1",
          EVE_STORE_DIR: storeDir
        }
      });
      const page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await expect(page.getByRole("button", { name: /Start recording|开始录音|Stop|停止/ })).toBeVisible();
      return { app, page };
    });
  }
});

export { expect };
