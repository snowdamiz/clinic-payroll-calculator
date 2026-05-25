import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = await readJson("manifest.json");
const packageJson = await readJson("package.json");
const distDir = path.join(rootDir, "dist", "chrome-store");
const stageDir = path.join(distDir, "stage");
const zipName = `${packageJson.name}-${manifest.version}.zip`;
const zipPath = path.join(distDir, zipName);
const packageFiles = ["manifest.json", "popup.html", "src", "icons"];
const dependencyFiles = ["node_modules/@e965/xlsx/xlsx.mjs"];

await rm(stageDir, { recursive: true, force: true });
await mkdir(stageDir, { recursive: true });
await rm(zipPath, { force: true });

for (const filePath of packageFiles) {
  await cp(path.join(rootDir, filePath), path.join(stageDir, filePath), { recursive: true });
}

for (const filePath of dependencyFiles) {
  const destination = path.join(stageDir, filePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(rootDir, filePath), destination);
}

const zipResult = spawnSync("zip", ["-r", "-X", zipPath, "."], {
  cwd: stageDir,
  stdio: "inherit",
});

if (zipResult.error) throw zipResult.error;
if (zipResult.status !== 0) process.exit(zipResult.status);

const zipStats = await stat(zipPath);
console.log(`Chrome Web Store package ready: ${path.relative(rootDir, zipPath)} (${zipStats.size} bytes)`);

async function readJson(filePath) {
  return JSON.parse(await readFile(path.join(rootDir, filePath), "utf8"));
}
