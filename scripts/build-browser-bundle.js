const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const sourceFiles = [
  "app/shared/config.mjs",
  "app/shared/rng.mjs",
  "app/shared/geometry.mjs",
  "app/shared/selectors.mjs",
  "app/ai/choose-move.mjs",
  "app/engine/create-engine.mjs",
  "app/render/canvas-renderer.mjs",
  "app/ui/ui-controller.mjs",
  "app/bootstrap.mjs",
];

function stripModuleSyntax(source) {
  return source
    .replace(/^import[\s\S]*?;\r?\n/gm, "")
    .replace(/^export function /gm, "function ")
    .replace(/^export const /gm, "const ")
    .replace(/^export class /gm, "class ")
    .replace(/^export \{[\s\S]*?\};?\r?\n?/gm, "");
}

function createBundle() {
  const sections = sourceFiles.map((relativePath) => {
    const absolutePath = path.join(projectRoot, relativePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    return `// ${relativePath}\n${stripModuleSyntax(source).trim()}`;
  });

  return [
    "(function bootstrapSnakeArenaBundle() {",
    "  \"use strict\";",
    "",
    sections.join("\n\n"),
    "",
    "  bootstrap();",
    "})();",
    "",
  ].join("\n");
}

const outputPath = path.join(projectRoot, "script.js");
fs.writeFileSync(outputPath, createBundle(), "utf8");
console.log(`Wrote ${outputPath}`);
