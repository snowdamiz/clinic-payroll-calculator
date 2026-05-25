import {
  buildPayrollReport,
  formatMoney,
  generateClinicianCsv,
  generateClinicianDocument,
  generateReportCsvExports,
  inferPayPeriodFromIncomeCsv,
} from "./payroll.js";
import { isSupportedImportFile, readImportFile } from "./importFileReader.js";
import { buildSimplePracticeImport, storedFilesFromAssignments } from "./bulkImport.js";
import { filesFromDataTransfer } from "./dropFiles.js";

const fileKeys = {
  incomeFile: "incomeCsv",
  appointmentFile: "appointmentCsv",
  cardFile: "cardTransactionsCsv",
  paymentFile: "paymentExportCsv",
  insuranceFile: "insurancePaymentsCsv",
  insuranceAllocationFile: "insuranceAllocationCsv",
};

const importRoles = [
  {
    inputId: "incomeFile",
    label: "Income allocation",
    badge: "Core",
    priority: "core",
    emptyText: "Payments by clinician",
  },
  {
    inputId: "appointmentFile",
    label: "Appointment status",
    badge: "Sessions",
    priority: "session",
    emptyText: "Kept sessions and CPT codes",
  },
  {
    inputId: "cardFile",
    label: "Card transactions",
    badge: "Optional",
    priority: "optional",
    emptyText: "Stripe fees and deposits",
  },
  {
    inputId: "paymentFile",
    label: "Payment export",
    badge: "Optional",
    priority: "optional",
    emptyText: "Reconciliation totals",
  },
  {
    inputId: "insuranceFile",
    label: "Insurance payment report",
    badge: "Optional",
    priority: "optional",
    emptyText: "Insurance cross-check",
  },
  {
    inputId: "insuranceAllocationFile",
    label: "Insurance payer allocation",
    badge: "Optional",
    priority: "optional",
    emptyText: "Insurance allocation by payer",
  },
];

const CONTRACTS_STORAGE_KEY = "clinicianContracts";
const DRAFT_STORAGE_KEY = "payrollSidePanelDraft";
const LEGACY_DRAFT_STORAGE_KEY = "payrollWidgetDraft";
const DEFAULT_IMPORT_STATUS = "Drop a folder here, open the folder importer, or choose the export files.";
const DRAFT_SAVE_DELAY_MS = 250;
const CONTRACT_SAVE_DELAY_MS = 250;

const sessionTypeLabels = [
  ["individual", "Individual"],
  ["couplesFamily", "Couples/Family"],
  ["group", "Group"],
  ["intake", "Intake"],
  ["other", "Other"],
  ["total", "Total"],
];

const state = {
  files: {},
  contracts: {},
  clinicianNames: [],
  report: null,
  resultsVisible: false,
};

let draftSaveTimer = null;
let contractSaveTimer = null;
let lastAppliedImporterDraft = "";

const elements = {
  periodStart: document.querySelector("#periodStart"),
  periodEnd: document.querySelector("#periodEnd"),
  calculateButton: document.querySelector("#calculateButton"),
  resetButton: document.querySelector("#resetButton"),
  calculateStatus: document.querySelector("#calculateStatus"),
  readinessBanner: document.querySelector("#readinessBanner"),
  readinessTitle: document.querySelector("#readinessTitle"),
  readinessDetail: document.querySelector("#readinessDetail"),
  importProgress: document.querySelector("#importProgress"),
  rulesProgress: document.querySelector("#rulesProgress"),
  resultsProgress: document.querySelector("#resultsProgress"),
  saveRulesButton: document.querySelector("#saveRulesButton"),
  clearFilesButton: document.querySelector("#clearFilesButton"),
  bulkImportDropzone: document.querySelector("#bulkImportDropzone"),
  openImporterButton: document.querySelector("#openImporterButton"),
  bulkFilesInput: document.querySelector("#bulkFilesInput"),
  folderImportStatus: document.querySelector("#folderImportStatus"),
  importChecklist: document.querySelector("#importChecklist"),
  printAllButton: document.querySelector("#printAllButton"),
  downloadClinicianCsvsButton: document.querySelector("#downloadClinicianCsvsButton"),
  downloadLedgersButton: document.querySelector("#downloadLedgersButton"),
  downloadSummaryButton: document.querySelector("#downloadSummaryButton"),
  contractsList: document.querySelector("#contractsList"),
  contractCount: document.querySelector("#contractCount"),
  resultsPanel: document.querySelector("#resultsPanel"),
  resultPeriod: document.querySelector("#resultPeriod"),
  incomeCards: document.querySelector("#incomeCards"),
  reconciliationCards: document.querySelector("#reconciliationCards"),
  warningsList: document.querySelector("#warningsList"),
  warningDrawer: document.querySelector("#warningDrawer"),
  warningDrawerClose: document.querySelector("#warningDrawerClose"),
  warningDrawerSummary: document.querySelector("#warningDrawerSummary"),
  warningSearchInput: document.querySelector("#warningSearchInput"),
  warningDrawerList: document.querySelector("#warningDrawerList"),
  clinicianResults: document.querySelector("#clinicianResults"),
  contractTemplate: document.querySelector("#contractTemplate"),
};

init();

async function init() {
  const period = defaultPayPeriod(new Date());
  elements.periodStart.value = period.start;
  elements.periodEnd.value = period.end;

  bindEvents();
  setControlsBusy(true);
  setActionStatus("Loading saved state...");
  try {
    await restoreSavedState(period);
  } catch (error) {
    showInlineError(error);
    setActionStatus("Saved state could not load.", "error");
  } finally {
    setControlsBusy(false);
    if (elements.calculateStatus.textContent === "Loading saved state...") {
      setActionStatus("");
    }
    renderGuidance();
  }
}

function bindEvents() {
  for (const inputId of Object.keys(fileKeys)) {
    document.querySelector(`#${inputId}`).addEventListener("change", handleFileChange);
  }

  elements.calculateButton.addEventListener("click", calculateAndRender);
  elements.resetButton.addEventListener("click", resetWidget);
  elements.saveRulesButton.addEventListener("click", saveRules);
  elements.clearFilesButton.addEventListener("click", clearFiles);
  elements.openImporterButton.addEventListener("click", openFolderImporter);
  elements.bulkFilesInput.addEventListener("change", handleBulkFilesChange);
  elements.bulkImportDropzone.addEventListener("dragenter", handleBulkDragEnter);
  elements.bulkImportDropzone.addEventListener("dragover", handleBulkDragOver);
  elements.bulkImportDropzone.addEventListener("dragleave", handleBulkDragLeave);
  elements.bulkImportDropzone.addEventListener("drop", handleBulkDrop);
  elements.printAllButton.addEventListener("click", printAllStatements);
  elements.downloadClinicianCsvsButton.addEventListener("click", downloadClinicianCsvs);
  elements.downloadLedgersButton.addEventListener("click", downloadLedgerCsvs);
  elements.downloadSummaryButton.addEventListener("click", downloadSummaryCsv);
  elements.warningsList.addEventListener("click", handleWarningsClick);
  elements.warningDrawerClose.addEventListener("click", closeWarningDrawer);
  elements.warningDrawer.addEventListener("click", handleWarningDrawerBackdropClick);
  elements.warningSearchInput.addEventListener("input", renderWarningDrawer);
  elements.contractsList.addEventListener("change", handleContractEdit);
  elements.contractsList.addEventListener("input", handleContractEdit);
  elements.periodStart.addEventListener("change", refreshCliniciansFromImports);
  elements.periodEnd.addEventListener("change", refreshCliniciansFromImports);
  window.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("pagehide", () => {
    try {
      collectContractsFromDom();
    } catch {
      // Side panel teardown saves are best-effort.
    }
    persistContracts().catch(() => {});
    persistDraft().catch(() => {});
  });
  if (globalThis.chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener(handleExternalStorageChange);
  }
}

function openFolderImporter() {
  const importerUrl = extensionAssetUrl("importer.html");
  window.open(importerUrl, "_blank", "noopener");
}

async function handleBulkFilesChange(event) {
  await importSelectedFiles([...(event.target.files || [])], {
    emptyMessage: "No CSV or Excel files were selected.",
  });
}

function handleBulkDragEnter(event) {
  event.preventDefault();
  elements.bulkImportDropzone.dataset.dragging = "true";
}

function handleBulkDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  elements.bulkImportDropzone.dataset.dragging = "true";
}

function handleBulkDragLeave(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return;
  delete elements.bulkImportDropzone.dataset.dragging;
}

async function handleBulkDrop(event) {
  event.preventDefault();
  delete elements.bulkImportDropzone.dataset.dragging;

  const files = await filesFromDataTransfer(event.dataTransfer);
  await importSelectedFiles(files, {
    emptyMessage: "No CSV or Excel files were found in that drop.",
  });
}

async function importSelectedFiles(files, { emptyMessage }) {
  setControlsBusy(true);
  setActionStatus("Scanning import files...");
  try {
    const { supportedFiles, importPlan, readErrors, result } = await buildSimplePracticeImport(files, {
      onProgress: ({ index, total, file }) => {
        setActionStatus(`Scanning ${index + 1}/${total}: ${file.name}`);
      },
    });

    if (supportedFiles.length === 0) {
      elements.folderImportStatus.textContent = emptyMessage;
      return;
    }

    if (!importPlan?.candidates.length) {
      elements.folderImportStatus.textContent =
        `No importable SimplePractice candidates found in ${supportedFiles.length} supported file${supportedFiles.length === 1 ? "" : "s"}.`;
      return;
    }

    state.files = storedFilesFromAssignments(result.assignments);
    clearFileInputLabels();

    const periodWasInferred = maybeApplyInferredPayPeriod(result.assignments);
    renderManualFileLabels(result.assignments);
    elements.folderImportStatus.textContent = folderStatusText(result, importPlan, readErrors, { periodWasInferred });
    await refreshCliniciansFromImports();
    await persistDraft();
    setActionStatus(`Imported ${Object.keys(result.assignments).length} export${Object.keys(result.assignments).length === 1 ? "" : "s"}.`, "success");
  } catch (error) {
    elements.folderImportStatus.textContent = `Could not import files: ${errorMessage(error)}`;
    setActionStatus("Import failed.", "error");
  } finally {
    setControlsBusy(false);
  }
}

async function handleFileChange(event) {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) {
    delete state.files[input.id];
    updateFileControl(input.id);
    await refreshCliniciansFromImports();
    await persistDraft();
    return;
  }

  setControlsBusy(true);
  setActionStatus(`Importing ${file.name}...`);
  try {
    const fileRecord = await readImportFile(file);
    state.files[input.id] = {
      name: fileRecord.name,
      text: fileRecord.text,
    };
    renderManualFileLabels({ [input.id]: state.files[input.id] });
    await refreshCliniciansFromImports();
    await persistDraft();
    setActionStatus(`${file.name} imported.`, "success");
  } catch (error) {
    delete state.files[input.id];
    input.value = "";
    updateFileControl(input.id);
    setActionStatus(`Could not import ${file.name}: ${errorMessage(error)}`, "error");
  } finally {
    setControlsBusy(false);
  }
}

async function refreshCliniciansFromImports() {
  try {
    rebuildFromState({ showResults: false });
    scheduleDraftSave();
  } catch (error) {
    showInlineError(error);
    renderGuidance();
  }
}

async function calculateAndRender() {
  try {
    collectContractsFromDom();
    if (!hasImportFiles()) {
      throw new Error("Import at least one SimplePractice CSV or Excel file before calculating.");
    }

    const report = rebuildFromState({ showResults: true });
    await Promise.all([persistContracts(), persistDraft()]);
    const clinicianCount = Object.keys(report.clinicians).length;
    setActionStatus(`Calculated ${clinicianCount} clinician${clinicianCount === 1 ? "" : "s"}.`, "success");
    scrollResultsIntoView();
  } catch (error) {
    showInlineError(error);
    setActionStatus("Could not calculate. See details below.", "error");
    scrollResultsIntoView();
  }
}

async function saveRules() {
  collectContractsFromDom();
  renderGuidance();
  await Promise.all([persistContracts(), persistDraft()]);
  elements.contractCount.textContent = "Pay rules saved.";
  setActionStatus("Pay rules saved.", "success");
}

async function clearFiles() {
  state.files = {};
  state.clinicianNames = [];
  elements.bulkFilesInput.value = "";
  elements.folderImportStatus.textContent = DEFAULT_IMPORT_STATUS;
  clearFileInputLabels();
  state.report = null;
  state.resultsVisible = false;
  elements.resultsPanel.classList.add("hidden");
  closeWarningDrawer({ restoreFocus: false, resetSearch: true });
  renderContracts([]);
  renderGuidance();
  await persistDraft();
  setActionStatus("Imports cleared.");
}

async function resetWidget() {
  if (!window.confirm("Reset dates, imported files, and results? Clinician pay rules stay saved.")) {
    return;
  }

  try {
    collectContractsFromDom();
    await persistContracts();
  } catch (error) {
    setActionStatus(`Could not save clinician rules before reset: ${errorMessage(error)}`, "error");
    return;
  }

  const period = defaultPayPeriod(new Date());
  state.files = {};
  state.contracts = await storageGet(CONTRACTS_STORAGE_KEY, {});
  state.clinicianNames = [];
  state.report = null;
  state.resultsVisible = false;
  elements.periodStart.value = period.start;
  elements.periodEnd.value = period.end;
  elements.bulkFilesInput.value = "";
  elements.folderImportStatus.textContent = DEFAULT_IMPORT_STATUS;
  clearFileInputLabels();
  elements.resultsPanel.classList.add("hidden");
  closeWarningDrawer({ restoreFocus: false, resetSearch: true });
  renderContracts([]);
  renderGuidance();
  await Promise.all([
    storageRemove(DRAFT_STORAGE_KEY),
    storageRemove(LEGACY_DRAFT_STORAGE_KEY),
  ]);
  setActionStatus("Side panel reset.");
}

function rebuildFromState({ showResults = false } = {}) {
  const report = buildReport();
  state.report = report;
  state.clinicianNames = Object.keys(report.clinicians);
  mergeMissingContracts(state.clinicianNames);
  renderContracts(state.clinicianNames);
  state.resultsVisible = showResults;

  if (showResults) {
    renderResults(report);
  } else {
    elements.resultsPanel.classList.add("hidden");
    closeWarningDrawer({ restoreFocus: false, resetSearch: true });
  }

  renderGuidance();
  return report;
}

function renderManualFileLabels(assignments) {
  for (const [inputId, file] of Object.entries(assignments)) {
    const input = document.querySelector(`#${inputId}`);
    const label = input?.closest(".file-control");
    if (!label) continue;
    let fileName = label.querySelector(".selected-file-name");
    if (!fileName) {
      fileName = document.createElement("small");
      fileName.className = "selected-file-name";
      label.append(fileName);
    }
    fileName.textContent = file.name;
    updateFileControl(inputId);
  }
}

function folderStatusText(result, importPlan = null, readErrors = [], scanSummary = {}) {
  const matchedCount = Object.keys(result.assignments).length;
  const missingLabels = result.missing.map((role) => role.label);
  const unmatchedCount = Math.max(0, result.unmatched.length - (result.duplicates?.length || 0));
  const parts = [`Matched ${matchedCount} export${matchedCount === 1 ? "" : "s"}.`];
  if (missingLabels.length) parts.push(`Missing: ${missingLabels.join(", ")}.`);
  if (unmatchedCount) parts.push(`${unmatchedCount} file${unmatchedCount === 1 ? "" : "s"} not recognized.`);
  if (result.duplicates?.length) parts.push(`Skipped ${result.duplicates.length} duplicate export${result.duplicates.length === 1 ? "" : "s"}.`);
  if (readErrors.length) parts.push(`${readErrors.length} file${readErrors.length === 1 ? "" : "s"} could not be read.`);
  if (importPlan?.skipped?.length) parts.push(`Skipped ${importPlan.skipped.length} lower-priority file${importPlan.skipped.length === 1 ? "" : "s"} to keep the browser responsive.`);
  if (importPlan?.oversized?.length) parts.push(`Skipped ${importPlan.oversized.length} oversized file${importPlan.oversized.length === 1 ? "" : "s"}.`);
  if (scanSummary.periodWasInferred) parts.push(`Set pay period to ${elements.periodStart.value} through ${elements.periodEnd.value} from the income export.`);
  return parts.join(" ");
}

function maybeApplyInferredPayPeriod(assignments) {
  const inferredPeriod = inferPayPeriodFromIncomeCsv(assignments.incomeFile?.text || "");
  if (!inferredPeriod) return false;
  if (elements.periodStart.value === inferredPeriod.start && elements.periodEnd.value === inferredPeriod.end) {
    return false;
  }

  const currentReport = buildPayrollReport(payrollPayloadForPeriod(elements.periodStart.value, elements.periodEnd.value));
  if (Object.keys(currentReport.clinicians).length > 0) return false;

  const inferredReport = buildPayrollReport(payrollPayloadForPeriod(inferredPeriod.start, inferredPeriod.end));
  if (Object.keys(inferredReport.clinicians).length === 0) return false;

  elements.periodStart.value = inferredPeriod.start;
  elements.periodEnd.value = inferredPeriod.end;
  return true;
}

function buildReport() {
  return buildPayrollReport(payrollPayloadForPeriod(elements.periodStart.value, elements.periodEnd.value));
}

function payrollPayloadForPeriod(periodStart, periodEnd) {
  const payload = {
    incomeCsv: "",
    appointmentCsv: "",
    cardTransactionsCsv: "",
    paymentExportCsv: "",
    insurancePaymentsCsv: "",
    contracts: state.contracts,
    periodStart,
    periodEnd,
  };

  for (const [inputId, payloadKey] of Object.entries(fileKeys)) {
    payload[payloadKey] = state.files[inputId]?.text || "";
  }

  return payload;
}

function mergeMissingContracts(names) {
  for (const name of names) {
    if (!state.contracts[name]) state.contracts[name] = defaultContract();
  }
}

function renderContracts(names) {
  elements.contractsList.innerHTML = "";

  const sortedNames = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  elements.contractCount.textContent = sortedNames.length
    ? `${sortedNames.length} clinician${sortedNames.length === 1 ? "" : "s"} loaded.`
    : "Import files to load clinicians.";

  if (sortedNames.length === 0) {
    elements.contractsList.className = "contracts-list empty-state";
    elements.contractsList.textContent =
      "Load the income allocation and appointment status exports, then choose one pay rule for each clinician.";
    return;
  }

  elements.contractsList.className = "contracts-list";
  for (const name of sortedNames) {
    const contract = normalizeContract(state.contracts[name]);
    const fragment = elements.contractTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".contract-card");
    const heading = fragment.querySelector("h3");
    const select = fragment.querySelector(".pay-type");
    const description = fragment.querySelector(".rule-description");
    const fields = fragment.querySelector(".contract-fields");
    const clinician = state.report?.clinicians[name];

    card.dataset.clinician = name;
    card.classList.toggle("needs-review", Boolean(contract.needsReview));
    heading.textContent = name;
    select.value = contract.payType;
    description.textContent = contract.needsReview
      ? "Legacy percent-of-clinic-income rules are no longer supported. Choose a new agreement before final payroll."
      : payRuleDescription(contract.payType);
    fields.innerHTML = `${sessionMixHtml(clinician)}${contractFieldsHtml(contract)}`;
    elements.contractsList.append(fragment);
  }
}

function sessionMixHtml(clinician) {
  const counts = clinician?.sessionCounts || defaultSessionCounts();
  const chips = sessionTypeLabels
    .map(([key, label]) => `
      <div class="session-chip">
        <strong>${Number(counts[key] || 0)}</strong>
        <span>${escapeHtml(label)}</span>
      </div>`)
    .join("");

  return `
    <section class="session-mix" aria-label="Session counts from CPT codes">
      <div class="session-mix-heading">
        <span>Sessions from CPT codes</span>
        <small>Appointment status report counts.</small>
      </div>
      <div class="session-mix-grid">${chips}</div>
    </section>`;
}

function contractFieldsHtml(contract) {
  if (contract.payType === "flat_session") {
    return [
      `<p class="field-group-title">Dollar rate</p>`,
      numberFieldHtml("flatRate", "Session rate", contract.flatRate, "wide"),
    ].join("");
  }

  if (contract.payType === "per_session") {
    return [
      `<p class="field-group-title">Dollar rates by session type</p>`,
      numberFieldHtml("rate:individual", "Individual", contract.sessionRates.individual),
      numberFieldHtml("rate:couplesFamily", "Couples/Family", contract.sessionRates.couplesFamily),
      numberFieldHtml("rate:group", "Group", contract.sessionRates.group),
      numberFieldHtml("rate:intake", "Intake", contract.sessionRates.intake),
      numberFieldHtml("rate:other", "Other", contract.sessionRates.other),
    ].join("");
  }

  if (contract.payType === "percent_collections") {
    const percentageField = numberFieldHtml("percentage", "Percent", contract.percentage, "wide", "0.01");
    return [
      `<p class="field-group-title">Percentage agreement</p>`,
      percentageField,
    ].join("");
  }

  return `<p class="muted">Select a pay method.</p>`;
}

function payRuleDescription(payType) {
  const descriptions = {
    none: "Choose the agreement for this clinician before running final payroll.",
    flat_session: "Pays one fixed dollar amount for each kept session in the appointment status report.",
    per_session: "Different rates by session type. Pays fixed dollar amounts based on the billing code.",
    percent_collections: "Pays a percentage of insurance and client payments received for this clinician.",
  };
  return descriptions[payType] || descriptions.none;
}

function numberFieldHtml(name, label, value, className = "", step = "1") {
  return `
    <label class="${className}">
      <span>${label}</span>
      <input data-field="${name}" type="number" min="0" step="${step}" value="${Number(value || 0)}">
    </label>`;
}

function handleContractEdit(event) {
  const card = event.target.closest(".contract-card");
  if (!card) return;

  const clinician = card.dataset.clinician;
  const contract = normalizeContract(state.contracts[clinician]);

  if (event.target.classList.contains("pay-type")) {
    contract.payType = event.target.value;
    if (contract.payType !== "none") {
      contract.needsReview = false;
      contract.legacyPayType = "";
    }
    state.contracts[clinician] = contract;
    renderContracts(state.clinicianNames);
    renderGuidance();
    scheduleContractSave();
    scheduleDraftSave();
    return;
  }

  if (event.target.dataset.field) {
    const field = event.target.dataset.field;
    const value = event.target.value || "";
    if (field.startsWith("rate:")) {
      contract.sessionRates[field.replace("rate:", "")] = Number(value || 0);
    } else {
      contract[field] = Number(value || 0);
    }
    state.contracts[clinician] = contract;
    renderGuidance();
    scheduleContractSave();
    scheduleDraftSave();
  }
}

function collectContractsFromDom() {
  for (const card of elements.contractsList.querySelectorAll(".contract-card")) {
    const clinician = card.dataset.clinician;
    const contract = normalizeContract(state.contracts[clinician]);
    contract.payType = card.querySelector(".pay-type").value;

    for (const input of card.querySelectorAll("[data-field]")) {
      const field = input.dataset.field;
      const value = input.value || "";
      if (field.startsWith("rate:")) {
        contract.sessionRates[field.replace("rate:", "")] = Number(value || 0);
      } else if (field === "incomeBasis") {
        contract.incomeBasis = value;
      } else {
        contract[field] = Number(value || 0);
      }
    }
    state.contracts[clinician] = contract;
  }
}

function renderResults(report) {
  elements.resultsPanel.classList.remove("hidden");
  elements.resultPeriod.textContent = `${report.period.start} to ${report.period.end}`;

  elements.incomeCards.innerHTML = [
    metricHtml("Gross income", formatMoney(report.contributionPnl.revenue), "SimplePractice income allocation"),
    metricHtml("Clinician compensation", formatMoney(report.contributionPnl.clinicianCompensation), "Calculated payroll from active clinician pay rules"),
    metricHtml("Processing fees", formatMoney(report.contributionPnl.processingFees), stripeFeeNote(report)),
    metricHtml("Contribution result", formatMoney(report.contributionPnl.contributionResult), report.contributionPnl.fullPnlStatus),
    metricHtml("Trailing payments", formatMoney(report.trailingPayments.amount), `${report.trailingPayments.count} payment${report.trailingPayments.count === 1 ? "" : "s"} outside the current service period or missing service dates`),
    metricHtml("Unpaid balances", formatMoney(report.ledgerReview.unpaidAppointmentBalance), "Appointment rows with unpaid balances and no matched payment in this pay period"),
  ].join("");

  elements.reconciliationCards.innerHTML = [
    metricHtml("Income allocation", formatMoney(report.reconciliation.incomeAllocationTotal), "Pay-period report total"),
    optionalMetricHtml("Payment export", report.reconciliation.paymentExportTotal, report.reconciliation.paymentExportAvailable, differenceText(report.reconciliation.paymentExportDifference), "Payment export not imported"),
    optionalMetricHtml("Insurance allocation", report.reconciliation.insurancePayerAllocationTotal, report.reconciliation.insurancePayerAllocationAvailable, differenceText(report.reconciliation.insurancePayerAllocationDifference), "Insurance payer allocation not imported"),
    optionalMetricHtml("Insurance report", report.reconciliation.insurancePaymentReportTotal, report.reconciliation.insurancePaymentReportAvailable, differenceText(report.reconciliation.insuranceReportDifference), "Insurance payment report not imported"),
    optionalMetricHtml("Stripe gross payments", report.reconciliation.stripeGrossPayments, report.reconciliation.stripeGrossPaymentsAvailable, "From SimplePractice payment export", stripeGrossUnavailableNote(report)),
    optionalMetricHtml("Stripe deposits", report.reconciliation.stripeDeposits, report.reconciliation.cardTransactionsAvailable, "Bank payout total by available date", "Card transactions not imported"),
    optionalMetricHtml("Stripe payout gap", report.reconciliation.stripePayoutGap, report.reconciliation.stripePayoutGapAvailable, stripeGapNote(report), stripeGapUnavailableNote(report)),
  ].join("");

  renderWarningSummary(report.warnings);
  renderWarningDrawer();

  elements.clinicianResults.innerHTML = Object.values(report.clinicians)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((clinician) => clinicianRowHtml(clinician))
    .join("");

  for (const button of elements.clinicianResults.querySelectorAll("[data-statement]")) {
    button.addEventListener("click", () => {
      const clinician = report.clinicians[button.dataset.statement];
      openStatements([clinician], report);
    });
  }
}

function renderWarningSummary(warnings = []) {
  const count = warnings.length;
  if (!count) {
    elements.warningsList.innerHTML = "";
    closeWarningDrawer({ restoreFocus: false, resetSearch: true });
    return;
  }

  elements.warningsList.innerHTML = `
    <button class="warning-summary warning-summary-button" type="button" data-open-warnings aria-label="Open ${count} payroll warning${count === 1 ? "" : "s"}">
      <span>
        <strong>${count} warning${count === 1 ? "" : "s"}</strong>
        <small>Payroll review</small>
      </span>
      <em>Review</em>
    </button>`;
}

function handleWarningsClick(event) {
  if (!event.target.closest("[data-open-warnings]")) return;
  openWarningDrawer();
}

function openWarningDrawer() {
  if (!state.report?.warnings?.length) return;

  elements.warningDrawer.classList.remove("hidden");
  elements.warningDrawer.setAttribute("aria-hidden", "false");
  elements.warningSearchInput.value = "";
  renderWarningDrawer();
  requestAnimationFrame(() => elements.warningSearchInput.focus());
}

function closeWarningDrawer({ restoreFocus = true, resetSearch = false } = {}) {
  elements.warningDrawer.classList.add("hidden");
  elements.warningDrawer.setAttribute("aria-hidden", "true");
  if (resetSearch) {
    elements.warningSearchInput.value = "";
  }
  if (restoreFocus) {
    elements.warningsList.querySelector("[data-open-warnings]")?.focus();
  }
}

function handleWarningDrawerBackdropClick(event) {
  if (event.target === elements.warningDrawer) {
    closeWarningDrawer();
  }
}

function handleGlobalKeydown(event) {
  if (event.key === "Escape" && !elements.warningDrawer.classList.contains("hidden")) {
    closeWarningDrawer();
  }
}

function renderWarningDrawer() {
  const warnings = state.report?.warnings || [];
  const query = elements.warningSearchInput.value.trim().toLowerCase();
  const filteredWarnings = query
    ? warnings.filter((warning) => warningSearchText(warning).includes(query))
    : warnings;

  elements.warningDrawerSummary.textContent = query
    ? `${filteredWarnings.length} of ${warnings.length} warning${warnings.length === 1 ? "" : "s"} match`
    : `${warnings.length} warning${warnings.length === 1 ? "" : "s"} in this pay run`;
  elements.warningDrawerList.innerHTML = filteredWarnings.length
    ? filteredWarnings.map(warningDrawerItemHtml).join("")
    : `<div class="drawer-empty">No warnings match that search.</div>`;
}

function warningDrawerItemHtml(warning) {
  return `
    <article class="warning-drawer-item">
      <span>${escapeHtml(formatWarningType(warning.type))}</span>
      <p>${escapeHtml(warning.message)}</p>
      ${warning.clinician ? `<small>${escapeHtml(warning.clinician)}</small>` : ""}
    </article>`;
}

function warningSearchText(warning) {
  return [
    formatWarningType(warning.type),
    warning.clinician,
    warning.message,
  ].filter(Boolean).join(" ").toLowerCase();
}

function formatWarningType(type) {
  return String(type || "warning").replaceAll("_", " ");
}

function metricHtml(label, value, note) {
  return `<div class="metric" title="${escapeHtml(note)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div>`;
}

function optionalMetricHtml(label, value, available, note, unavailableNote) {
  return metricHtml(label, available ? formatMoney(value) : "Unavailable", available ? note : unavailableNote);
}

function differenceText(value) {
  if (!value) return "Matches income allocation";
  const direction = value > 0 ? "over" : "under";
  return `${formatMoney(Math.abs(value))} ${direction} income allocation`;
}

function stripeFeeNote(report) {
  if (report.reconciliation.processingFeeStatus === "actual") {
    return "Actual fee column found in card transactions";
  }
  if (report.reconciliation.processingFeeStatus === "estimated") {
    return "Estimated from SimplePractice card payments";
  }
  return "Unavailable until card fee rows or eligible payment export are imported";
}

function stripeGrossUnavailableNote(report) {
  return report.reconciliation.paymentExportAvailable
    ? "No Stripe gross payment rows found in payment export"
    : "Payment export not imported";
}

function stripeGapNote(report) {
  return report.reconciliation.stripeFeesAreKnown
    ? "Should roughly match known fees"
    : "May be fees plus payout timing";
}

function stripeGapUnavailableNote(report) {
  if (!report.reconciliation.cardTransactionsAvailable) return "Needs card transactions";
  if (!report.reconciliation.paymentExportAvailable) return "Needs payment export with Stripe gross payment rows";
  return "Needs Stripe gross payment rows from payment export";
}

function clinicianRowHtml(clinician) {
  const payHelp = `Calculated payroll amount owed to ${clinician.name}. ${clinician.pay.explanation}.`;
  const cashHelp = `Money received and attributed to ${clinician.name} during this pay period. This is source cash before the clinician pay rule is applied.`;
  return `
    <tr>
      <td><strong>${escapeHtml(clinician.name)}</strong></td>
      <td class="number" title="${escapeHtml(payHelp)}">${formatMoney(clinician.pay.total)}</td>
      <td class="number" title="${escapeHtml(cashHelp)}">${formatMoney(clinician.cashReceived.total)}</td>
      <td class="number sessions-cell">
        <strong>${clinician.sessionCounts.total}</strong>
        ${sessionCountSummaryHtml(clinician)}
      </td>
      <td class="review-cell">
        ${clinicianReviewHtml(clinician)}
      </td>
      <td title="${escapeHtml(clinician.pay.explanation)}">${escapeHtml(clinician.pay.explanation)}</td>
      <td>
        <div class="row-actions">
          <button class="mini-button" type="button" data-statement="${escapeHtml(clinician.name)}">Statement</button>
        </div>
      </td>
    </tr>`;
}

function clinicianReviewHtml(clinician) {
  return `
    <small>Trailing ${clinician.trailingPayments.length}</small>
    <small>Split ${clinician.splitPaymentRows.length}</small>
    <small>Unmatched pay ${clinician.unmatchedPayments.length}</small>
    <small>Open appts ${clinician.unmatchedAppointments.length}</small>`;
}

function sessionCountSummaryHtml(clinician) {
  const counts = clinician.sessionCounts;
  return `
    <small>
      Ind ${counts.individual} | C/F ${counts.couplesFamily} | Group ${counts.group}
    </small>`;
}

function printAllStatements() {
  if (!state.report) return;
  openStatements(Object.values(state.report.clinicians), state.report);
}

function openStatements(clinicians, report) {
  const body = clinicians.map((clinician) => generateClinicianDocument(clinician, report)).join("");
  const html = printablePage(body, report);
  const printWindow = window.open("", "_blank");

  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
    return;
  }

  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function printablePage(body, report) {
  const printScriptSrc = extensionAssetUrl("src/print-page.js");

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Clinician Statements ${escapeHtml(report.period.start)} to ${escapeHtml(report.period.end)}</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; color: #202528; font-family: Arial, sans-serif; background: #f6f7f5; }
          .print-bar { position: sticky; top: 0; padding: 12px; background: #ffffff; border-bottom: 1px solid #d8dedc; font-weight: 700; }
          .clinician-document { break-after: page; width: min(920px, calc(100vw - 24px)); max-width: 100%; margin: 20px auto; padding: 28px; overflow-x: hidden; background: #fff; border: 1px solid #d8dedc; }
          .eyebrow { color: #155f46; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
          h1 { margin: 0; font-size: 28px; }
          h2 { margin: 24px 0 8px; font-size: 16px; }
          p { margin: 4px 0; }
          section { min-width: 0; max-width: 100%; overflow-x: auto; }
          .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 18px 0; }
          .summary-grid div { border: 1px solid #d8dedc; border-radius: 8px; padding: 10px; }
          .summary-grid span { display: block; color: #687276; font-size: 11px; text-transform: uppercase; }
          .summary-grid strong { display: block; margin-top: 7px; font-size: 18px; }
          table { width: 100%; min-width: 640px; border-collapse: collapse; }
          th, td { padding: 8px; border-bottom: 1px solid #e8ecea; text-align: left; vertical-align: top; }
          th { color: #687276; background: #f4f7f6; font-size: 11px; text-transform: uppercase; }
          .number { text-align: right; }
          .payment-tabs { display: grid; gap: 10px; max-width: 100%; min-width: 0; }
          .payment-tab-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: 8px; max-width: 100%; min-width: 0; }
          .payment-tab {
            display: inline-flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            width: 100%;
            min-width: 0;
            border: 1px solid #cdd9d5;
            border-radius: 999px;
            background: #f4f7f6;
            color: #155f46;
            padding: 7px 11px;
            font: inherit;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
            overflow-wrap: anywhere;
            white-space: normal;
          }
          .payment-tab[aria-selected="true"] { background: #1f7a5a; border-color: #1f7a5a; color: #fff; }
          .payment-tab span {
            flex: 0 0 auto;
            min-width: 22px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.72);
            color: #155f46;
            padding: 2px 7px;
            font-size: 12px;
            text-align: center;
          }
          .payment-tab[aria-selected="true"] span { background: rgba(255, 255, 255, 0.9); }
          .payment-panel { max-width: 100%; overflow-x: auto; }
          .payment-panel[hidden] { display: none; }
          @media (max-width: 700px) {
            .clinician-document { width: calc(100vw - 16px); margin: 8px auto; padding: 18px; }
            h1 { font-size: 24px; }
            .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          }
          @media print {
            body { background: #fff; }
            .print-bar { display: none; }
            .clinician-document { margin: 0; border: 0; max-width: none; }
            .payment-tab-list { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="print-bar">Clinician statements</div>
        ${body}
        <script type="module" src="${escapeHtml(printScriptSrc)}"></script>
      </body>
    </html>`;
}

function downloadSummaryCsv() {
  if (!state.report) return;

  const rows = [
    ["Clinician", "Calculated Pay", "Cash Received", "Insurance", "Client", "Kept Sessions", "Individual", "Couples/Family", "Group", "Intake", "Other", "Pay Method"],
    ...Object.values(state.report.clinicians)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((clinician) => [
        clinician.name,
        clinician.pay.total,
        clinician.cashReceived.total,
        clinician.cashReceived.insurance,
        clinician.cashReceived.client,
        clinician.sessionCounts.total,
        clinician.sessionCounts.individual,
        clinician.sessionCounts.couplesFamily,
        clinician.sessionCounts.group,
        clinician.sessionCounts.intake,
        clinician.sessionCounts.other,
        clinician.pay.explanation,
      ]),
  ];

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  downloadTextFile(`clinic-payroll-${state.report.period.start}-to-${state.report.period.end}.csv`, csv);
}

function downloadClinicianCsvs() {
  if (!state.report) return;

  const clinicians = Object.values(state.report.clinicians)
    .filter((clinician) => sessionDetailExportClinician(clinician))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (clinicians.length === 0) {
    elements.warningsList.innerHTML = `<div class="warning">No clinicians with kept sessions are ready to export.</div>`;
    return;
  }

  const files = clinicians.map((clinician) => ({
    name: [
      "clinician-pay",
      slugify(clinician.name),
      state.report.period.start,
      "to",
      state.report.period.end,
    ].join("-") + ".csv",
    text: generateClinicianCsv(clinician, state.report),
  }));

  downloadZipFile(
    `clinician-pay-statements-${state.report.period.start}-to-${state.report.period.end}.zip`,
    files,
  );
}

function downloadLedgerCsvs() {
  if (!state.report) return;

  const exports = generateReportCsvExports(state.report);
  const filePrefix = `clinic-payroll-${state.report.period.start}-to-${state.report.period.end}`;
  const files = [
    ["appointment-ledger", exports.appointmentLedger],
    ["payment-ledger", exports.paymentLedger],
    ["split-payment-detail", exports.splitPaymentDetail],
    ["outlier-payments", exports.outlierPayments],
    ["contribution-pnl", exports.contributionPnl],
  ];

  downloadZipFile(
    `${filePrefix}-ledgers.zip`,
    files.map(([name, csv]) => ({
      name: `${filePrefix}-${name}.csv`,
      text: csv,
    })),
  );
}

function sessionDetailExportClinician(clinician) {
  return clinician.sessionCounts.total > 0 || clinician.paymentRows.length > 0;
}

function downloadTextFile(fileName, text, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function downloadZipFile(fileName, files) {
  downloadBlob(fileName, createZipBlob(files));
}

function downloadBlob(fileName, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function createZipBlob(files) {
  const encoder = new TextEncoder();
  const localFileParts = [];
  const centralDirectoryParts = [];
  const records = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(safeZipPath(file.name));
    const dataBytes = encoder.encode(file.text || "");
    const crc = crc32(dataBytes);
    const timestamp = dosDateTime(new Date());
    const localHeader = zipLocalFileHeader({
      nameBytes,
      dataBytes,
      crc,
      ...timestamp,
    });

    localFileParts.push(localHeader, dataBytes);
    records.push({
      nameBytes,
      dataBytes,
      crc,
      offset,
      ...timestamp,
    });
    offset += localHeader.byteLength + dataBytes.byteLength;
  }

  let centralDirectorySize = 0;
  for (const record of records) {
    const centralHeader = zipCentralDirectoryHeader(record);
    centralDirectoryParts.push(centralHeader);
    centralDirectorySize += centralHeader.byteLength;
  }

  const end = zipEndOfCentralDirectory({
    fileCount: records.length,
    centralDirectorySize,
    centralDirectoryOffset: offset,
  });

  return new Blob([...localFileParts, ...centralDirectoryParts, end], { type: "application/zip" });
}

function zipLocalFileHeader({ nameBytes, dataBytes, crc, dosTime, dosDate }) {
  const header = new Uint8Array(30 + nameBytes.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, dosTime, true);
  view.setUint16(12, dosDate, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, dataBytes.byteLength, true);
  view.setUint32(22, dataBytes.byteLength, true);
  view.setUint16(26, nameBytes.byteLength, true);
  view.setUint16(28, 0, true);
  header.set(nameBytes, 30);
  return header;
}

function zipCentralDirectoryHeader({ nameBytes, dataBytes, crc, offset, dosTime, dosDate }) {
  const header = new Uint8Array(46 + nameBytes.byteLength);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, dosTime, true);
  view.setUint16(14, dosDate, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, dataBytes.byteLength, true);
  view.setUint32(24, dataBytes.byteLength, true);
  view.setUint16(28, nameBytes.byteLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  header.set(nameBytes, 46);
  return header;
}

function zipEndOfCentralDirectory({ fileCount, centralDirectorySize, centralDirectoryOffset }) {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);
  return header;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function safeZipPath(name) {
  return String(name || "export.csv")
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/") || "export.csv";
}

function extensionAssetUrl(assetPath) {
  return globalThis.chrome?.runtime?.getURL
    ? chrome.runtime.getURL(assetPath)
    : assetPath;
}

function slugify(value) {
  return String(value || "clinician")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll("\"", "\"\"")}"`;
  return text;
}

function renderGuidance() {
  const summary = guidanceSummary();
  elements.readinessBanner.dataset.state = summary.state;
  elements.readinessTitle.textContent = summary.title;
  elements.readinessDetail.textContent = summary.detail;
  elements.importProgress.textContent = `${summary.importCount}/${importRoles.length}`;
  elements.rulesProgress.textContent = summary.clinicianCount
    ? `${summary.readyRules}/${summary.clinicianCount}`
    : "0";
  elements.resultsProgress.textContent = summary.resultsCalculated ? "Done" : "None";
  renderImportChecklist();
  renderImportControls();
}

function guidanceSummary() {
  const importCount = importFileCount();
  const clinicianCount = state.clinicianNames.length;
  const readyRules = state.clinicianNames
    .filter((name) => {
      const contract = normalizeContract(state.contracts[name]);
      return contract.payType !== "none" && !contract.needsReview;
    })
    .length;
  const missingRules = Math.max(clinicianCount - readyRules, 0);
  const resultsCalculated = Boolean(state.resultsVisible && state.report && hasImportFiles());
  let stateName = "empty";
  let title = "Import SimplePractice exports";
  let detail = `${importCount} imports loaded. No clinicians loaded yet.`;

  if (importCount > 0) {
    stateName = "ready";
    title = "Imports loaded";
    detail = `${importCount} import${importCount === 1 ? "" : "s"} loaded. ${clinicianCount} clinician${clinicianCount === 1 ? "" : "s"} found.`;
  }

  if (clinicianCount > 0 && missingRules > 0) {
    stateName = "needs-rules";
    title = `${missingRules} pay rule${missingRules === 1 ? "" : "s"} need review`;
    detail = `${readyRules} of ${clinicianCount} clinician pay rules are set.`;
  }

  if (clinicianCount > 0 && missingRules === 0) {
    stateName = "ready";
    title = "Ready to calculate";
    detail = `${clinicianCount} clinician${clinicianCount === 1 ? "" : "s"} loaded and pay rules are set.`;
  }

  if (resultsCalculated) {
    stateName = "calculated";
    title = "Payroll results calculated";
    detail = `${clinicianCount} clinician${clinicianCount === 1 ? "" : "s"} included for ${elements.periodStart.value} to ${elements.periodEnd.value}.`;
  }

  return {
    state: stateName,
    title,
    detail,
    importCount,
    clinicianCount,
    readyRules,
    missingRules,
    resultsCalculated,
  };
}

function renderImportChecklist() {
  elements.importChecklist.innerHTML = importRoles
    .map((role) => {
      const file = state.files[role.inputId];
      const isLoaded = Boolean(file?.name || file?.text);
      return `
        <div class="import-check" data-state="${isLoaded ? "loaded" : "missing"}" data-priority="${escapeHtml(role.priority)}">
          <strong>${escapeHtml(role.label)}</strong>
          <span>${escapeHtml(isLoaded ? file.name : role.emptyText)}</span>
          <em>${escapeHtml(isLoaded ? "Loaded" : role.badge)}</em>
        </div>`;
    })
    .join("");
}

function renderImportControls() {
  for (const role of importRoles) {
    updateFileControl(role.inputId);
  }
}

function updateFileControl(inputId) {
  const control = document.querySelector(`[data-file-control="${inputId}"]`);
  if (!control) return;

  const file = state.files[inputId];
  const selectedFileName = control.querySelector(".selected-file-name");
  control.classList.toggle("is-loaded", Boolean(file?.name || file?.text));
  if (selectedFileName) selectedFileName.textContent = file?.name || "Not selected";
}

function showInlineError(error) {
  state.report = null;
  elements.resultsPanel.classList.remove("hidden");
  elements.resultPeriod.textContent = "";
  elements.incomeCards.innerHTML = "";
  elements.reconciliationCards.innerHTML = "";
  elements.clinicianResults.innerHTML = "";
  closeWarningDrawer({ restoreFocus: false, resetSearch: true });
  elements.warningsList.innerHTML = `<div class="warning">${escapeHtml(error.message || String(error))}</div>`;
  state.resultsVisible = true;
}

async function restoreSavedState(defaultPeriodValue) {
  const [savedContracts, draft, legacyDraft] = await Promise.all([
    storageGet(CONTRACTS_STORAGE_KEY, {}),
    storageGet(DRAFT_STORAGE_KEY, null),
    storageGet(LEGACY_DRAFT_STORAGE_KEY, null),
  ]);
  const restoredDraft = draft || legacyDraft;

  state.contracts = normalizeContractsMap(savedContracts || {});
  elements.periodStart.value = defaultPeriodValue.start;
  elements.periodEnd.value = defaultPeriodValue.end;
  elements.folderImportStatus.textContent = DEFAULT_IMPORT_STATUS;

  if (!restoredDraft || restoredDraft.version !== 1) {
    renderContracts([]);
    return;
  }

  if (applyDraftToPanel(restoredDraft, defaultPeriodValue)) {
    if (!draft && legacyDraft) {
      await persistDraft();
    }
    setActionStatus(`Restored ${importFileCount()} import${importFileCount() === 1 ? "" : "s"}.`, "success");
    return;
  }
}

function applyDraftToPanel(restoredDraft, defaultPeriodValue) {
  state.files = sanitizeStoredFiles(restoredDraft.files);
  state.contracts = normalizeContractsMap({
    ...(restoredDraft.contracts || {}),
    ...state.contracts,
  });
  elements.periodStart.value = restoredDraft.periodStart || defaultPeriodValue.start;
  elements.periodEnd.value = restoredDraft.periodEnd || defaultPeriodValue.end;
  elements.folderImportStatus.textContent = restoredDraft.folderImportStatus || restoredImportStatus();

  clearFileInputLabels();
  renderManualFileLabels(state.files);

  if (hasImportFiles()) {
    rebuildFromState({ showResults: Boolean(restoredDraft.resultsVisible) });
    return true;
  }

  renderContracts([]);
  renderGuidance();
  return false;
}

function handleExternalStorageChange(changes, areaName) {
  if (areaName !== "local") return;

  const draft = changes[DRAFT_STORAGE_KEY]?.newValue;
  if (!draft || draft.version !== 1 || draft.importSource !== "bulk-importer") return;
  if (draft.savedAt && draft.savedAt === lastAppliedImporterDraft) return;

  lastAppliedImporterDraft = draft.savedAt || String(Date.now());
  applyDraftToPanel(draft, defaultPayPeriod(new Date()));
  setActionStatus(`Imported ${importFileCount()} export${importFileCount() === 1 ? "" : "s"} from the folder importer.`, "success");
}

function serializeDraft() {
  return {
    version: 1,
    periodStart: elements.periodStart.value,
    periodEnd: elements.periodEnd.value,
    folderImportStatus: elements.folderImportStatus.textContent || DEFAULT_IMPORT_STATUS,
    files: sanitizeStoredFiles(state.files),
    contracts: normalizeContractsMap(state.contracts),
    resultsVisible: state.resultsVisible,
    savedAt: new Date().toISOString(),
  };
}

function scheduleDraftSave() {
  window.clearTimeout(draftSaveTimer);
  draftSaveTimer = window.setTimeout(() => {
    draftSaveTimer = null;
    persistDraft().catch((error) => {
      setActionStatus(`Could not save draft: ${error.message || error}`, "error");
    });
  }, DRAFT_SAVE_DELAY_MS);
}

function scheduleContractSave() {
  window.clearTimeout(contractSaveTimer);
  contractSaveTimer = window.setTimeout(() => {
    contractSaveTimer = null;
    persistContracts().catch((error) => {
      setActionStatus(`Could not save clinician rules: ${error.message || error}`, "error");
    });
  }, CONTRACT_SAVE_DELAY_MS);
}

async function persistContracts() {
  if (contractSaveTimer) {
    window.clearTimeout(contractSaveTimer);
    contractSaveTimer = null;
  }
  state.contracts = normalizeContractsMap(state.contracts);
  await storageSet(CONTRACTS_STORAGE_KEY, state.contracts);
}

async function persistDraft() {
  if (draftSaveTimer) {
    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }
  await storageSet(DRAFT_STORAGE_KEY, serializeDraft());
}

function sanitizeStoredFiles(files = {}) {
  return Object.fromEntries(
    Object.keys(fileKeys)
      .map((inputId) => {
        const file = files[inputId];
        if (!file?.name && !file?.text) return null;
        return [
          inputId,
          {
            name: String(file.name || "Imported file"),
            text: String(file.text || ""),
          },
        ];
      })
      .filter(Boolean),
  );
}

function hasImportFiles() {
  return Object.values(sanitizeStoredFiles(state.files)).some((file) => file.name || file.text);
}

function importFileCount() {
  return Object.keys(sanitizeStoredFiles(state.files)).length;
}

function restoredImportStatus() {
  const count = importFileCount();
  return count
    ? `Restored ${count} SimplePractice export${count === 1 ? "" : "s"} from the last side panel session.`
    : DEFAULT_IMPORT_STATUS;
}

function clearFileInputLabels() {
  for (const inputId of Object.keys(fileKeys)) {
    const input = document.querySelector(`#${inputId}`);
    input.value = "";
    updateFileControl(inputId);
  }
}

function setControlsBusy(isBusy) {
  elements.calculateButton.disabled = isBusy;
  elements.resetButton.disabled = isBusy;
  elements.openImporterButton.disabled = isBusy;
  elements.bulkFilesInput.disabled = isBusy;
}

function setActionStatus(message, tone = "") {
  elements.calculateStatus.textContent = message;
  if (tone) {
    elements.calculateStatus.dataset.tone = tone;
  } else {
    delete elements.calculateStatus.dataset.tone;
  }
}

function errorMessage(error) {
  return error?.message || String(error);
}

function scrollResultsIntoView() {
  elements.resultsPanel.scrollIntoView({ block: "start", behavior: "smooth" });
}

function defaultContract() {
  return {
    payType: "none",
    legacyPayType: "",
    needsReview: false,
    incomeBasis: "gross",
    flatRate: 0,
    percentage: 0,
    sessionRates: {
      individual: 0,
      couplesFamily: 0,
      group: 0,
      intake: 0,
      other: 0,
    },
  };
}

function defaultSessionCounts() {
  return {
    total: 0,
    individual: 0,
    couplesFamily: 0,
    group: 0,
    intake: 0,
    other: 0,
  };
}

function normalizeContract(contract = {}) {
  const payType = contract.payType === "percent_clinic_income"
    ? "none"
    : contract.payType || "none";
  const needsReview = Boolean(contract.needsReview || contract.payType === "percent_clinic_income");

  return {
    ...defaultContract(),
    ...contract,
    payType,
    legacyPayType: needsReview ? "percent_clinic_income" : "",
    needsReview,
    sessionRates: {
      ...defaultContract().sessionRates,
      ...(contract.sessionRates || {}),
    },
  };
}

function normalizeContractsMap(contracts = {}) {
  return Object.fromEntries(
    Object.entries(contracts).map(([name, contract]) => [name, normalizeContract(contract)]),
  );
}

function defaultPayPeriod(today) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();
  const startDate = day >= 25 ? new Date(year, month, 25) : new Date(year, month - 1, 25);
  const endDate = day >= 25 ? new Date(year, month + 1, 24) : new Date(year, month, 24);

  return {
    start: dateInputValue(startDate),
    end: dateInputValue(endDate),
  };
}

function dateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function storageGet(key, fallback) {
  return new Promise((resolve) => {
    if (!globalThis.chrome?.storage?.local) {
      try {
        const value = localStorage.getItem(key);
        resolve(value ? JSON.parse(value) : fallback);
      } catch {
        resolve(fallback);
      }
      return;
    }

    chrome.storage.local.get([key], (result) => {
      if (chrome.runtime?.lastError) {
        resolve(fallback);
        return;
      }
      resolve(result[key] || fallback);
    });
  });
}

function storageSet(key, value) {
  return new Promise((resolve, reject) => {
    if (!globalThis.chrome?.storage?.local) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        resolve();
      } catch (error) {
        reject(error);
      }
      return;
    }

    chrome.storage.local.set({ [key]: value }, () => {
      const error = chrome.runtime?.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function storageRemove(key) {
  return new Promise((resolve, reject) => {
    if (!globalThis.chrome?.storage?.local) {
      localStorage.removeItem(key);
      resolve();
      return;
    }

    chrome.storage.local.remove(key, () => {
      const error = chrome.runtime?.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
