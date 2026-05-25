import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredIconSizes = ["16", "32", "48", "128"];
const textFiles = [
  "manifest.json",
  "popup.html",
  "src/importFileReader.js",
  "src/importInference.js",
  "src/payroll.js",
  "src/popup.css",
  "src/popup.js",
  "src/print-page.js",
];

const errors = [];

const manifest = await readJson("manifest.json");
validateManifest(manifest);
await validateFiles(manifest);
await validateTextFiles();
await assertFile("node_modules/@e965/xlsx/xlsx.mjs", "Excel parser module");

if (errors.length > 0) {
  console.error("Chrome Web Store validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Chrome Web Store validation passed.");
}

function validateManifest(manifestJson) {
  if (manifestJson.manifest_version !== 3) {
    errors.push("manifest_version must be 3.");
  }

  if (!manifestJson.name || manifestJson.name.length > 75) {
    errors.push("manifest.name is required and must be 75 characters or fewer.");
  }

  if (!isChromeVersion(manifestJson.version)) {
    errors.push("manifest.version must be 1 to 4 dot-separated integers.");
  }

  if (!manifestJson.description || manifestJson.description.length > 132) {
    errors.push("manifest.description is required and must be 132 characters or fewer.");
  }

  if (!manifestJson.action?.default_popup) {
    errors.push("manifest.action.default_popup is required for this popup extension.");
  }

  for (const size of requiredIconSizes) {
    if (!manifestJson.icons?.[size]) {
      errors.push(`manifest.icons.${size} is required.`);
    }
    if (!manifestJson.action?.default_icon?.[size]) {
      errors.push(`manifest.action.default_icon.${size} is required.`);
    }
  }

  if (manifestJson.host_permissions?.length) {
    errors.push("host_permissions should stay empty unless a remote site is truly required.");
  }
}

async function validateFiles(manifestJson) {
  if (manifestJson.action?.default_popup) {
    await assertFile(manifestJson.action.default_popup, "popup HTML");
  }

  const iconEntries = [
    ...Object.entries(manifestJson.icons || {}),
    ...Object.entries(manifestJson.action?.default_icon || {}),
  ];
  for (const [size, iconPath] of iconEntries) {
    await assertFile(iconPath, `${size}px icon`);
    await assertPngSize(iconPath, Number(size), Number(size));
  }
}

async function validateTextFiles() {
  const remoteCodePattern = /<script\b(?![^>]*\bsrc=)|\b(?:eval|Function)\s*\(|\bset(?:Timeout|Interval)\s*\(\s*["'`]|https?:\/\/|<script[^>]+\bsrc=["']https?:\/\//i;

  for (const filePath of textFiles) {
    const text = await readText(filePath);
    if (remoteCodePattern.test(text)) {
      errors.push(`${filePath} contains inline script, remote URL, eval, Function, or string timer usage.`);
    }
  }

  const popupHtml = await readText("popup.html");
  if (!/<script type="module" src="src\/popup\.js"><\/script>/.test(popupHtml)) {
    errors.push("popup.html should load src/popup.js as an external module script.");
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readText(filePath));
  } catch (error) {
    errors.push(`${filePath} is not valid JSON: ${error.message}`);
    return {};
  }
}

async function readText(filePath) {
  return readFile(path.join(rootDir, filePath), "utf8");
}

async function assertFile(filePath, label) {
  if (!isSafeRelativePath(filePath)) {
    errors.push(`${label} path is not a safe relative path: ${filePath}`);
    return;
  }

  try {
    await access(path.join(rootDir, filePath));
  } catch {
    errors.push(`${label} file is missing: ${filePath}`);
  }
}

async function assertPngSize(filePath, expectedWidth, expectedHeight) {
  const buffer = await readFile(path.join(rootDir, filePath));
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    errors.push(`${filePath} is not a PNG file.`);
    return;
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== expectedWidth || height !== expectedHeight) {
    errors.push(`${filePath} is ${width}x${height}, expected ${expectedWidth}x${expectedHeight}.`);
  }
}

function isSafeRelativePath(filePath) {
  return Boolean(filePath)
    && !path.isAbsolute(filePath)
    && !filePath.split(/[\\/]/).includes("..");
}

function isChromeVersion(version) {
  if (!/^\d+(?:\.\d+){0,3}$/.test(String(version || ""))) return false;
  return String(version).split(".").every((part) => Number(part) <= 65535);
}
