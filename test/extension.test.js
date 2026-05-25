import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships as a minimal Manifest V3 Chrome extension popup", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const popupHtml = await readFile(new URL("../popup.html", import.meta.url), "utf8");

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.deepEqual(Object.keys(manifest.icons), ["16", "32", "48", "128"]);
  assert.deepEqual(Object.keys(manifest.action.default_icon), ["16", "32", "48", "128"]);
  assert.deepEqual(manifest.permissions, ["storage", "unlimitedStorage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.match(popupHtml, /src\/popup.js/);
});

test("includes Chrome Web Store upload preparation scripts and docs", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const storeNotes = await readFile(new URL("../CHROME_STORE_SUBMISSION.md", import.meta.url), "utf8");
  const privacyPolicy = await readFile(new URL("../PRIVACY_POLICY.md", import.meta.url), "utf8");

  assert.equal(packageJson.scripts.store, "npm run icons && npm test && npm run validate && npm run package");
  assert.match(packageJson.scripts.validate, /validate-extension/);
  assert.match(packageJson.scripts.package, /package-extension/);
  assert.match(storeNotes, /dist\/chrome-store\/clinic-payroll-calculator-0\.1\.0\.zip/);
  assert.match(storeNotes, /Single purpose/);
  assert.match(privacyPolicy, /does not transmit data to any external server/);
});

test("explains clinician pay rules in the popup", async () => {
  const popupHtml = await readFile(new URL("../popup.html", import.meta.url), "utf8");
  const popupJs = await readFile(new URL("../src/popup.js", import.meta.url), "utf8");

  assert.match(popupHtml, /Clinician pay rules decide how each clinician/);
  assert.match(popupHtml, /Flat rate per kept session/);
  assert.match(popupHtml, /Percent of total clinic income/);
  assert.match(popupJs, /Different rates by session type/);
});

test("keeps the rule tooltip inside the visible popup", async () => {
  const css = await readFile(new URL("../src/popup.css", import.meta.url), "utf8");

  assert.match(css, /--radius-panel:\s*18px/);
  assert.match(css, /--radius-control:\s*12px/);
  assert.match(css, /\.help-popover\s*{[^}]*bottom:\s*calc\(100% \+ 10px\)/s);
  assert.match(css, /\.help-popover\s*{[^}]*max-height:\s*min\(360px, calc\(100vh - 80px\)\)/s);
  assert.match(css, /\.help-popover\s*{[^}]*overflow:\s*auto/s);
});

test("does not fake rounding for the browser-owned popup shell", async () => {
  const css = await readFile(new URL("../src/popup.css", import.meta.url), "utf8");

  assert.doesNotMatch(css, /--radius-shell/);
  assert.doesNotMatch(css, /\.shell\s*{[^}]*border-radius/s);
  assert.match(css, /body\s*{[^}]*background:[^}]*var\(--paper\)/s);
});

test("keeps file select boxes square", async () => {
  const css = await readFile(new URL("../src/popup.css", import.meta.url), "utf8");

  assert.match(css, /\.file-control\s*{[^}]*border-radius:\s*0/s);
  assert.match(css, /::file-selector-button\s*{[^}]*border-radius:\s*0/s);
});

test("labels gross income, processing fees, net income, and clinician CSV exports in the popup", async () => {
  const popupJs = await readFile(new URL("../src/popup.js", import.meta.url), "utf8");
  const popupHtml = await readFile(new URL("../popup.html", import.meta.url), "utf8");

  assert.match(popupJs, /Gross income/);
  assert.match(popupJs, /Card processing fees/);
  assert.match(popupJs, /Net after processing fees/);
  assert.match(popupJs, /Stripe payout gap/);
  assert.match(popupJs, /net_after_processing_fees/);
  assert.match(popupJs, /generateClinicianCsv/);
  assert.match(popupJs, /sessionDetailExportClinician/);
  assert.match(popupHtml, /Download Clinician CSVs/);
});

test("adds tooltip help for payroll output columns and row values", async () => {
  const popupHtml = await readFile(new URL("../popup.html", import.meta.url), "utf8");
  const popupJs = await readFile(new URL("../src/popup.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/popup.css", import.meta.url), "utf8");

  assert.match(popupHtml, /Pay is the calculated payroll amount owed/);
  assert.match(popupHtml, /Cash is the money received and attributed/);
  assert.match(popupHtml, /Sessions are kept appointments counted from CPT codes/);
  assert.match(popupHtml, /Method explains the pay rule used/);
  assert.match(popupJs, /Calculated payroll amount owed to/);
  assert.match(popupJs, /source cash before the clinician pay rule is applied/);
  assert.match(css, /\.inline-help/);
  assert.match(css, /cursor:\s*help/);
});

test("statement pages include clickable payment source tabs", async () => {
  const popupJs = await readFile(new URL("../src/popup.js", import.meta.url), "utf8");
  const printPageJs = await readFile(new URL("../src/print-page.js", import.meta.url), "utf8");
  const payrollJs = await readFile(new URL("../src/payroll.js", import.meta.url), "utf8");

  assert.match(payrollJs, /Insurance payments/);
  assert.match(payrollJs, /Client payments/);
  assert.match(payrollJs, /data-payment-panel/);
  assert.match(printPageJs, /data-payment-tab/);
  assert.match(popupJs, /src\/print-page\.js/);
  assert.match(printPageJs, /aria-selected/);
  assert.match(printPageJs, /panel\.hidden = panel\.dataset\.paymentPanel !== selected/);
});

test("supports selecting one folder and inferring import files", async () => {
  const popupHtml = await readFile(new URL("../popup.html", import.meta.url), "utf8");
  const popupJs = await readFile(new URL("../src/popup.js", import.meta.url), "utf8");

  assert.match(popupHtml, /id="folderInput"/);
  assert.match(popupHtml, /webkitdirectory/);
  assert.match(popupHtml, /\.xlsx,.xls/);
  assert.match(popupHtml, /Choose Folder/);
  assert.match(popupHtml, /CSV or Excel exports/);
  assert.match(popupJs, /inferImportFiles/);
  assert.match(popupJs, /isSupportedImportFile/);
  assert.match(popupJs, /handleFolderChange/);
});

test("persists imported data and offers a reset beside calculate", async () => {
  const popupHtml = await readFile(new URL("../popup.html", import.meta.url), "utf8");
  const popupJs = await readFile(new URL("../src/popup.js", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

  assert.match(popupHtml, /id="resetButton"/);
  assert.match(popupHtml, /id="calculateStatus"/);
  assert.match(popupJs, /payrollWidgetDraft/);
  assert.match(popupJs, /restoreSavedState/);
  assert.match(popupJs, /serializeDraft/);
  assert.match(popupJs, /Import at least one SimplePractice CSV or Excel file before calculating/);
  assert.match(popupJs, /scrollResultsIntoView/);
  assert.match(popupJs, /storageRemove\(DRAFT_STORAGE_KEY\)/);
  assert.ok(manifest.permissions.includes("unlimitedStorage"));
});

test("guides payroll setup with clear workflow and import status", async () => {
  const popupHtml = await readFile(new URL("../popup.html", import.meta.url), "utf8");
  const popupJs = await readFile(new URL("../src/popup.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/popup.css", import.meta.url), "utf8");

  assert.match(popupHtml, /id="readinessBanner"/);
  assert.match(popupHtml, /id="workflowSteps"/);
  assert.match(popupHtml, /id="importChecklist"/);
  assert.match(popupHtml, /Payments received by clinician/);
  assert.match(popupJs, /renderGuidance/);
  assert.match(popupJs, /guidanceSummary/);
  assert.match(popupJs, /renderImportChecklist/);
  assert.match(popupJs, /state\.files = \{\}/);
  assert.match(css, /\.readiness-banner/);
  assert.match(css, /\.workflow-step/);
  assert.match(css, /\.import-check/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
});

test("surfaces CPT-derived session counts beside clinician pay rules", async () => {
  const popupJs = await readFile(new URL("../src/popup.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/popup.css", import.meta.url), "utf8");

  assert.match(popupJs, /Sessions from CPT codes/);
  assert.match(popupJs, /sessionMixHtml/);
  assert.match(popupJs, /Couples\/Family/);
  assert.match(css, /\.session-mix/);
  assert.match(css, /grid-template-columns:\s*repeat\(auto-fit, minmax\(92px, 1fr\)\)/);
});
