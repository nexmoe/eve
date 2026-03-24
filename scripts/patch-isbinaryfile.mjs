import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const bunStoreDirectory = join(repositoryRoot, "node_modules", ".bun");
const packageDirectories = readdirSync(bunStoreDirectory, {
  withFileTypes: true
}).filter((entry) => {
  return entry.isDirectory() && entry.name.startsWith("isbinaryfile@");
});

if (packageDirectories.length === 0) {
  throw new Error("Failed to locate isbinaryfile in node_modules/.bun.");
}

const originalSnippet = `    next(len) {
        const n = new Array();
        for (let i = 0; i < len; i++) {
            n[i] = this.nextByte();
        }
        return n;
    }`;

const patchedSnippet = `    next(len) {
        if (!Number.isSafeInteger(len) || len < 0 || len > this.size - this.offset) {
            this.error = true;
            return [];
        }
        const n = new Array(len); // __EVE_ISBINARYFILE_PATCH__
        for (let i = 0; i < len; i++) {
            n[i] = this.nextByte();
        }
        return n;
    }`;

for (const packageDirectory of packageDirectories) {
  const libraryFilePath = join(
    bunStoreDirectory,
    packageDirectory.name,
    "node_modules",
    "isbinaryfile",
    "lib",
    "index.js"
  );
  const source = readFileSync(libraryFilePath, "utf8");
  if (source.includes("__EVE_ISBINARYFILE_PATCH__")) {
    continue;
  }
  if (!source.includes(originalSnippet)) {
    console.log(`Skipped ${libraryFilePath}`);
    continue;
  }
  writeFileSync(
    libraryFilePath,
    source.replace(originalSnippet, patchedSnippet),
    "utf8"
  );
  console.log(`Patched ${libraryFilePath}`);
}
