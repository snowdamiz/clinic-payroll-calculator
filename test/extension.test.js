import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships as a Manifest V3 Chrome side panel extension", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const sidePanelHtml = await readFile(new URL("../sidepanel.html", import.meta.url), "utf8");
  const backgroundJs = await readFile(new URL("../src/background.js", import.meta.url), "utf8");

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.side_panel.default_path, "sidepanel.html");
  assert.equal(manifest.background.service_worker, "src/background.js");
  assert.deepEqual(Object.keys(manifest.icons), ["16", "32", "48", "128"]);
  assert.deepEqual(Object.keys(manifest.action.default_icon), ["16", "32", "48", "128"]);
  assert.deepEqual(manifest.permissions, ["storage", "unlimitedStorage", "sidePanel"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.match(sidePanelHtml, /src\/sidepanel.js/);
  assert.match(sidePanelHtml, /src\/sidepanel.css/);
  assert.match(backgroundJs, /setPanelBehavior/);
  assert.match(backgroundJs, /openPanelOnActionClick:\s*true/);
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
  assert.match(storeNotes, /side panel/);
  assert.match(privacyPolicy, /does not transmit data to any external server/);
  assert.match(privacyPolicy, /sidePanel/);
});

test("explains clinician pay rules in the side panel", async () => {
  const sidePanelHtml = await readFile(new URL("../sidepanel.html", import.meta.url), "utf8");
  const sidePanelJs = await readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8");

  assert.match(sidePanelHtml, /Clinician pay rules decide how each clinician/);
  assert.match(sidePanelHtml, /Flat rate per kept session/);
  assert.doesNotMatch(sidePanelHtml, /Percent of total clinic income/);
  assert.doesNotMatch(sidePanelHtml, /percent_clinic_income/);
  assert.match(sidePanelJs, /Different rates by session type/);
  assert.match(sidePanelJs, /Legacy percent-of-clinic-income rules are no longer supported/);
});

test("keeps the rule tooltip inside the visible side panel", async () => {
  const css = await readFile(new URL("../src/sidepanel.css", import.meta.url), "utf8");

  assert.match(css, /--radius-panel:\s*8px/);
  assert.match(css, /--radius-control:\s*8px/);
  assert.match(css, /\.help-popover\s*{[^}]*bottom:\s*calc\(100% \+ 10px\)/s);
  assert.match(css, /\.help-popover\s*{[^}]*max-height:\s*min\(360px, calc\(100vh - 80px\)\)/s);
  assert.match(css, /\.help-popover\s*{[^}]*overflow:\s*auto/s);
});

test("does not fake rounding for the browser-owned side panel shell", async () => {
  const css = await readFile(new URL("../src/sidepanel.css", import.meta.url), "utf8");

  assert.doesNotMatch(css, /--radius-shell/);
  assert.doesNotMatch(css, /\.shell\s*{[^}]*border-radius/s);
  assert.match(css, /body\s*{[^}]*background:[^}]*var\(--paper\)/s);
});

test("keeps file select boxes square", async () => {
  const css = await readFile(new URL("../src/sidepanel.css", import.meta.url), "utf8");

  assert.match(css, /\.file-control\s*{[^}]*border-radius:\s*0/s);
  assert.match(css, /::file-selector-button\s*{[^}]*border-radius:\s*0/s);
});

test("labels contribution PnL, trailing review, and ledger exports in the side panel", async () => {
  const sidePanelJs = await readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8");
  const sidePanelHtml = await readFile(new URL("../sidepanel.html", import.meta.url), "utf8");

  assert.match(sidePanelJs, /Gross income/);
  assert.match(sidePanelJs, /Clinician compensation/);
  assert.match(sidePanelJs, /Contribution result/);
  assert.match(sidePanelJs, /Trailing payments/);
  assert.match(sidePanelJs, /Unpaid balances/);
  assert.match(sidePanelJs, /optionalMetricHtml/);
  assert.match(sidePanelJs, /Unavailable/);
  assert.match(sidePanelJs, /stripePayoutGapAvailable/);
  assert.match(sidePanelJs, /Needs Stripe gross payment rows from payment export/);
  assert.match(sidePanelJs, /Stripe payout gap/);
  assert.match(sidePanelJs, /generateClinicianCsv/);
  assert.match(sidePanelJs, /generateReportCsvExports/);
  assert.match(sidePanelJs, /downloadZipFile/);
  assert.match(sidePanelJs, /createZipBlob/);
  assert.match(sidePanelJs, /application\/zip/);
  assert.match(sidePanelJs, /sessionDetailExportClinician/);
  assert.match(sidePanelHtml, /Download Clinician ZIP/);
  assert.match(sidePanelHtml, /Download Ledger ZIP/);
});

test("keeps payroll warnings behind a searchable bottom drawer", async () => {
  const sidePanelHtml = await readFile(new URL("../sidepanel.html", import.meta.url), "utf8");
  const sidePanelJs = await readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/sidepanel.css", import.meta.url), "utf8");

  assert.match(sidePanelHtml, /id="warningDrawer"/);
  assert.match(sidePanelHtml, /id="warningSearchInput"/);
  assert.match(sidePanelHtml, /class="warning-drawer"/);
  assert.match(sidePanelJs, /renderWarningSummary/);
  assert.match(sidePanelJs, /renderWarningDrawer/);
  assert.match(sidePanelJs, /data-open-warnings/);
  assert.match(sidePanelJs, /warningSearchText/);
  assert.doesNotMatch(sidePanelJs, /more warnings hidden/);
  assert.match(css, /\.warning-summary/);
  assert.match(css, /\.warning-drawer/);
  assert.match(css, /\.warning-drawer-list\s*{[^}]*overflow:\s*auto/s);
});

test("adds tooltip help for payroll output columns and row values", async () => {
  const sidePanelHtml = await readFile(new URL("../sidepanel.html", import.meta.url), "utf8");
  const sidePanelJs = await readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/sidepanel.css", import.meta.url), "utf8");

  assert.match(sidePanelHtml, /Pay is the calculated payroll amount owed/);
  assert.match(sidePanelHtml, /Cash is the money received and attributed/);
  assert.match(sidePanelHtml, /Sessions are kept appointments counted from CPT codes/);
  assert.match(sidePanelHtml, /Review counts show trailing collections/);
  assert.match(sidePanelHtml, /Method explains the pay rule used/);
  assert.match(sidePanelJs, /Calculated payroll amount owed to/);
  assert.match(sidePanelJs, /source cash before the clinician pay rule is applied/);
  assert.match(css, /\.inline-help/);
  assert.match(css, /cursor:\s*help/);
});

test("statement pages include clickable payment source tabs", async () => {
  const sidePanelJs = await readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8");
  const printPageJs = await readFile(new URL("../src/print-page.js", import.meta.url), "utf8");
  const payrollJs = await readFile(new URL("../src/payroll.js", import.meta.url), "utf8");

  assert.match(payrollJs, /Insurance payments/);
  assert.match(payrollJs, /Client payments/);
  assert.match(payrollJs, /data-payment-panel/);
  assert.match(sidePanelJs, /grid-template-columns: repeat\(auto-fit, minmax\(min\(180px, 100%\), 1fr\)\)/);
  assert.match(sidePanelJs, /overflow-x: auto/);
  assert.match(printPageJs, /data-payment-tab/);
  assert.match(sidePanelJs, /src\/print-page\.js/);
  assert.match(printPageJs, /aria-selected/);
  assert.match(printPageJs, /panel\.hidden = panel\.dataset\.paymentPanel !== selected/);
});

test("supports bulk imports without the side-panel directory picker crash path", async () => {
  const sidePanelHtml = await readFile(new URL("../sidepanel.html", import.meta.url), "utf8");
  const sidePanelJs = await readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8");
  const importerHtml = await readFile(new URL("../importer.html", import.meta.url), "utf8");
  const importerJs = await readFile(new URL("../src/importer.js", import.meta.url), "utf8");

  assert.match(sidePanelHtml, /id="bulkImportDropzone"/);
  assert.match(sidePanelHtml, /id="openImporterButton"/);
  assert.match(sidePanelHtml, /id="bulkFilesInput"/);
  assert.doesNotMatch(sidePanelHtml, /id="folderInput"[^>]*webkitdirectory/);
  assert.match(sidePanelHtml, /\.xlsx,.xls/);
  assert.match(sidePanelHtml, /Drop a folder or exported files here/);
  assert.match(sidePanelJs, /filesFromDataTransfer/);
  assert.match(sidePanelJs, /buildSimplePracticeImport/);
  assert.match(sidePanelJs, /isSupportedImportFile/);
  assert.match(sidePanelJs, /handleBulkDrop/);
  assert.match(sidePanelJs, /inferPayPeriodFromIncomeCsv/);
  assert.match(sidePanelHtml, /insuranceAllocationFile/);
  assert.match(sidePanelJs, /insuranceAllocationCsv/);
  assert.match(importerHtml, /id="importerFolderInput"/);
  assert.match(importerHtml, /webkitdirectory/);
  assert.match(importerJs, /importSource:\s*"bulk-importer"/);
  assert.match(importerJs, /payrollSidePanelDraft/);
});

test("persists imported data and offers a reset beside calculate", async () => {
  const sidePanelHtml = await readFile(new URL("../sidepanel.html", import.meta.url), "utf8");
  const sidePanelJs = await readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));

  assert.match(sidePanelHtml, /id="resetButton"/);
  assert.match(sidePanelHtml, /id="calculateStatus"/);
  assert.match(sidePanelJs, /payrollSidePanelDraft/);
  assert.match(sidePanelJs, /payrollWidgetDraft/);
  assert.match(sidePanelJs, /restoreSavedState/);
  assert.match(sidePanelJs, /serializeDraft/);
  assert.match(sidePanelJs, /Import at least one SimplePractice CSV or Excel file before calculating/);
  assert.match(sidePanelJs, /scrollResultsIntoView/);
  assert.match(sidePanelJs, /storageRemove\(DRAFT_STORAGE_KEY\)/);
  assert.ok(manifest.permissions.includes("unlimitedStorage"));
});

test("auto-saves clinician pay rules and reset preserves them", async () => {
  const sidePanelJs = await readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8");
  const importerJs = await readFile(new URL("../src/importer.js", import.meta.url), "utf8");

  assert.match(sidePanelJs, /const CONTRACTS_STORAGE_KEY = "clinicianContracts"/);
  assert.match(sidePanelJs, /function scheduleContractSave\(\)/);
  assert.match(sidePanelJs, /async function persistContracts\(\)/);
  assert.match(sidePanelJs, /scheduleContractSave\(\);/);
  assert.match(sidePanelJs, /persistContracts\(\)\.catch\(\(\) => \{\}\)/);
  assert.match(sidePanelJs, /Reset dates, imported files, and results\? Clinician pay rules stay saved\./);
  assert.match(sidePanelJs, /await persistContracts\(\);/);
  assert.match(sidePanelJs, /normalizeContractsMap/);
  assert.doesNotMatch(sidePanelJs, /draft pay-rule edits/);
  assert.match(importerJs, /\.\.\.\(currentDraft\?\.contracts \|\| \{\}\),\s*\.\.\.\(savedContracts \|\| \{\}\),/s);
});

test("guides payroll setup with import status", async () => {
  const sidePanelHtml = await readFile(new URL("../sidepanel.html", import.meta.url), "utf8");
  const sidePanelJs = await readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/sidepanel.css", import.meta.url), "utf8");

  assert.match(sidePanelHtml, /id="readinessBanner"/);
  assert.match(sidePanelHtml, /0\/6/);
  assert.doesNotMatch(sidePanelHtml, /id="workflowSteps"/);
  assert.match(sidePanelHtml, /id="importChecklist"/);
  assert.match(sidePanelHtml, /Payments received by clinician/);
  assert.match(sidePanelJs, /renderGuidance/);
  assert.match(sidePanelJs, /guidanceSummary/);
  assert.doesNotMatch(sidePanelJs, /renderWorkflowSteps/);
  assert.match(sidePanelJs, /renderImportChecklist/);
  assert.match(sidePanelJs, /state\.files = \{\}/);
  assert.match(css, /\.readiness-banner/);
  assert.doesNotMatch(css, /\.workflow-step/);
  assert.match(css, /\.import-check/);
  assert.match(css, /\.results-panel \.button-row\s*{[^}]*grid-template-columns:\s*repeat\(auto-fit, minmax\(min\(180px, 100%\), 1fr\)\)/s);
  assert.match(css, /\.section-heading,\s*\.button-row\s*{[^}]*flex-wrap:\s*wrap/s);
  assert.match(css, /\.metric-grid\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(css, /@media \(min-width:\s*1380px\)/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
});

test("surfaces CPT-derived session counts beside clinician pay rules", async () => {
  const sidePanelJs = await readFile(new URL("../src/sidepanel.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/sidepanel.css", import.meta.url), "utf8");

  assert.match(sidePanelJs, /Sessions from CPT codes/);
  assert.match(sidePanelJs, /sessionMixHtml/);
  assert.match(sidePanelJs, /Couples\/Family/);
  assert.match(css, /\.session-mix/);
  assert.match(css, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});
