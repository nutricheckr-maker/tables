// electron-builder's extraResources skips node_modules and dot-folders, both of
// which the standalone server needs, so copy it into the packed app here.

const { cpSync } = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const target = path.join(context.packager.getResourcesDir(context.appOutDir), "server");
  cpSync(path.join(__dirname, "..", ".next-desktop", "standalone"), target, { recursive: true, verbatimSymlinks: true });
};
