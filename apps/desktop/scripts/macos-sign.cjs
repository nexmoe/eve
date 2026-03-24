"use strict";

const path = require("node:path");
const repositoryRoot = path.resolve(__dirname, "../../..");
const { sign } = require(path.join(
  repositoryRoot,
  "node_modules/.bun/node_modules/@electron/osx-sign"
));

const resourceExtensionsWithoutEntitlements = new Set([".pak"]);

const shouldStripEntitlements = (filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  return resourceExtensionsWithoutEntitlements.has(extension);
};

module.exports = async function macosSign(configuration) {
  const originalOptionsForFile = configuration.optionsForFile;

  await sign({
    ...configuration,
    optionsForFile(filePath) {
      const perFileOptions = originalOptionsForFile
        ? originalOptionsForFile(filePath)
        : null;

      if (!shouldStripEntitlements(filePath)) {
        return perFileOptions;
      }

      return {
        ...(perFileOptions ?? {}),
        additionalArguments: [],
        entitlements: [],
        hardenedRuntime: false
      };
    }
  });
};
