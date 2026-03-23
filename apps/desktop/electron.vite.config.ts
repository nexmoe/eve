import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
  main: {
    build: {
      externalizeDeps: false
    },
    resolve: {
      alias: {
        "@eve/shared": resolve("../../packages/shared/src/index.ts")
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: false
    },
    resolve: {
      alias: {
        "@eve/shared": resolve("../../packages/shared/src/index.ts")
      }
    }
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": resolve("src/renderer/src"),
        "@eve/shared": resolve("../../packages/shared/src/index.ts")
      }
    }
  }
});
