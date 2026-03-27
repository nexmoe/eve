"use strict";

const path = require("node:path");
const repositoryRoot = path.resolve(__dirname, "../../..");
const { signApp } = require(path.join(
  repositoryRoot,
  "node_modules/.bun/node_modules/@electron/osx-sign"
));

const ignoredResourceExtensions = new Set([".pak"]);
const shouldIgnoreResource = (filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  return ignoredResourceExtensions.has(extension);
};

module.exports = async function macosSign(configuration) {
  const originalIgnore = configuration.ignore;

  const ignore = Array.isArray(originalIgnore)
    ? [...originalIgnore]
    : originalIgnore
      ? [originalIgnore]
      : [];
  ignore.push((filePath) => shouldIgnoreResource(filePath));

  await signApp({
    ...configuration,
    ignore
  });
};
