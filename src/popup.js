import {
  buildPayrollReport,
  formatMoney,
  generateClinicianCsv,
  generateClinicianDocument,
} from "./payroll.js";
import { isSupportedImportFile, readImportFile } from "./importFileReader.js";
import { inferImportFiles } from "./importInference.js";

const fileKeys = {
  incomeFile: "incomeCsv",
  appointmentFile: "appointmentCsv",
  cardFile: "cardTransactionsCsv",
  paymentFile: "paymentExportCsv",
  insuranceFile: "insurancePaymentsCsv",
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
    label: "Insurance payments",
    badge: "Optional",
    priority: "optional",
    emptyText: "Insurance cross-check",
  },
];

const CONTRACTS_STORAGE_KEY = "clinicianContracts";
const DRAFT_STORAGE_KEY = "payrollWidgetDraft";
const DEFAULT_IMPORT_STATUS = "Choose Folder to infer the SimplePractice CSV or Excel exports automatically.";
const DRAFT_SAVE_DELAY_MS = 250;

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
  workflowSteps: document.querySelector("#workflowSteps"),
  saveRulesButton: document.querySelector("#saveRulesButton"),
  clearFilesButton: document.querySelector("#clearFilesButton"),
  folderInput: document.querySelector("#folderInput"),
  folderImportStatus: document.querySelector("#folderImportStatus"),
  importChecklist: document.querySelector("#importChecklist"),
  printAllButton: document.querySelector("#printAllButton"),
  downloadClinicianCsvsButton: document.querySelector("#downloadClinicianCsvsButton"),
  downloadSummaryButton: document.querySelector("#downloadSummaryButton"),
  contractsList: document.querySelector("#contractsList"),
  contractCount: document.querySelector("#contractCount"),
  resultsPanel: document.querySelector("#resultsPanel"),
  resultPeriod: document.querySelector("#resultPeriod"),
  incomeCards: document.querySelector("#incomeCards"),
  reconciliationCards: document.querySelector("#reconciliationCards"),
  warningsList: document.querySelector("#warningsList"),
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
  elements.folderInput.addEventListener("change", handleFolderChange);
  elements.printAllButton.addEventListener("click", printAllStatements);
  elements.downloadClinicianCsvsButton.addEventListener("click", downloadClinicianCsvs);
  elements.downloadSummaryButton.addEventListener("click", downloadSummaryCsv);
  elements.contractsList.addEventListener("change", handleContractEdit);
  elements.contractsList.addEventListener("input", handleContractEdit);
  elements.periodStart.addEventListener("change", refreshCliniciansFromImports);
  elements.periodEnd.addEventListener("change", refreshCliniciansFromImports);
  window.addEventListener("pagehide", () => {
    try {
      collectContractsFromDom();
    } catch {
      // Draft saves are best-effort during popup teardown.
    }
    persistDraft().catch(() => {});
  });
}

async function handleFolderChange(event) {
  const importFiles = [...(event.target.files || [])].filter(isSupportedImportFile);

  if (importFiles.length === 0) {
    elements.folderImportStatus.textContent = "No CSV or Excel files found in that folder.";
    return;
  }

  setControlsBusy(true);
  setActionStatus("Importing files...");
  try {
    const fileRecords = await Promise.all(importFiles.map(readImportFile));
    const result = inferImportFiles(fileRecords);

    state.files = {};
    clearFileInputLabels();
    for (const [inputId, file] of Object.entries(result.assignments)) {
      state.files[inputId] = {
        name: file.name,
        text: file.text,
      };
    }

    renderManualFileLabels(result.assignments);
    elements.folderImportStatus.textContent = folderStatusText(result);
    await refreshCliniciansFromImports();
    await persistDraft();
    setActionStatus(`Imported ${Object.keys(result.assignments).length} export${Object.keys(result.assignments).length === 1 ? "" : "s"}.`, "success");
  } catch (error) {
    elements.folderImportStatus.textContent = `Could not import folder: ${errorMessage(error)}`;
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
    await storageSet(CONTRACTS_STORAGE_KEY, state.contracts);
    await persistDraft();
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
  await storageSet(CONTRACTS_STORAGE_KEY, state.contracts);
  await persistDraft();
  elements.contractCount.textContent = "Pay rules saved.";
  setActionStatus("Pay rules saved.", "success");
}

async function clearFiles() {
  state.files = {};
  state.clinicianNames = [];
  elements.folderInput.value = "";
  elements.folderImportStatus.textContent = DEFAULT_IMPORT_STATUS;
  clearFileInputLabels();
  state.report = null;
  state.resultsVisible = false;
  elements.resultsPanel.classList.add("hidden");
  renderContracts([]);
  renderGuidance();
  await persistDraft();
  setActionStatus("Imports cleared.");
}

async function resetWidget() {
  if (!window.confirm("Reset dates, imported files, draft pay-rule edits, and results? Saved pay rules stay available.")) {
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
  elements.folderInput.value = "";
  elements.folderImportStatus.textContent = DEFAULT_IMPORT_STATUS;
  clearFileInputLabels();
  elements.resultsPanel.classList.add("hidden");
  renderContracts([]);
  renderGuidance();
  await storageRemove(DRAFT_STORAGE_KEY);
  setActionStatus("Widget reset.");
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

function folderStatusText(result) {
  const matchedCount = Object.keys(result.assignments).length;
  const missingLabels = result.missing.map((role) => role.label);
  const unmatchedCount = result.unmatched.length;
  const parts = [`Matched ${matchedCount} export${matchedCount === 1 ? "" : "s"}.`];
  if (missingLabels.length) parts.push(`Missing: ${missingLabels.join(", ")}.`);
  if (unmatchedCount) parts.push(`${unmatchedCount} file${unmatchedCount === 1 ? "" : "s"} not recognized.`);
  return parts.join(" ");
}

function buildReport() {
  const payload = {
    incomeCsv: "",
    appointmentCsv: "",
    cardTransactionsCsv: "",
    paymentExportCsv: "",
    insurancePaymentsCsv: "",
    contracts: state.contracts,
    periodStart: elements.periodStart.value,
    periodEnd: elements.periodEnd.value,
  };

  for (const [inputId, payloadKey] of Object.entries(fileKeys)) {
    payload[payloadKey] = state.files[inputId]?.text || "";
  }

  return buildPayrollReport(payload);
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
    heading.textContent = name;
    select.value = contract.payType;
    description.textContent = payRuleDescription(contract.payType);
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

  if (contract.payType === "percent_collections" || contract.payType === "percent_clinic_income") {
    const percentageField = numberFieldHtml("percentage", "Percent", contract.percentage, "wide", "0.01");
    if (contract.payType === "percent_clinic_income") {
      return [
        `<p class="field-group-title">Percentage agreement</p>`,
        percentageField,
        selectFieldHtml("incomeBasis", "Income basis", contract.incomeBasis, [
          ["gross", "Gross SimplePractice income"],
          ["net_after_processing_fees", "Net after card processing fees"],
        ], "wide"),
      ].join("");
    }
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
    percent_clinic_income: "Pays a percentage of total clinic income received during this pay period.",
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

function selectFieldHtml(name, label, value, options, className = "") {
  return `
    <label class="${className}">
      <span>${label}</span>
      <select data-field="${name}">
        ${options
          .map(([optionValue, optionLabel]) => {
            const selected = optionValue === value ? " selected" : "";
            return `<option value="${escapeHtml(optionValue)}"${selected}>${escapeHtml(optionLabel)}</option>`;
          })
          .join("")}
      </select>
    </label>`;
}

function handleContractEdit(event) {
  const card = event.target.closest(".contract-card");
  if (!card) return;

  const clinician = card.dataset.clinician;
  const contract = normalizeContract(state.contracts[clinician]);

  if (event.target.classList.contains("pay-type")) {
    contract.payType = event.target.value;
    state.contracts[clinician] = contract;
    renderContracts(state.clinicianNames);
    renderGuidance();
    scheduleDraftSave();
    return;
  }

  if (event.target.dataset.field) {
    const field = event.target.dataset.field;
    const value = event.target.value || "";
    if (field.startsWith("rate:")) {
      contract.sessionRates[field.replace("rate:", "")] = Number(value || 0);
    } else if (field === "incomeBasis") {
      contract.incomeBasis = value;
    } else {
      contract[field] = Number(value || 0);
    }
    state.contracts[clinician] = contract;
    renderGuidance();
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
    metricHtml("Gross income", formatMoney(report.clinicIncome.total), "SimplePractice income allocation"),
    metricHtml("Card processing fees", formatMoney(report.clinicIncome.processingFeeAdjustment), stripeFeeNote(report)),
    metricHtml("Net after processing fees", formatMoney(report.clinicIncome.netAfterProcessingFees.total), "Gross income minus card processing fees"),
    metricHtml("Insurance", formatMoney(report.clinicIncome.insurance), "Gross insurance payments"),
  ].join("");

  elements.reconciliationCards.innerHTML = [
    metricHtml("Payment export", formatMoney(report.reconciliation.paymentExportTotal), differenceText(report.reconciliation.paymentExportDifference)),
    metricHtml("Insurance report", formatMoney(report.reconciliation.insurancePaymentReportTotal), differenceText(report.reconciliation.insuranceReportDifference)),
    metricHtml("Stripe gross payments", formatMoney(report.reconciliation.stripeGrossPayments), "From SimplePractice payment export"),
    metricHtml("Stripe deposits", formatMoney(report.reconciliation.stripeDeposits), "Bank payout total by available date"),
    metricHtml("Stripe payout gap", formatMoney(report.reconciliation.stripePayoutGap), stripeGapNote(report)),
  ].join("");

  elements.warningsList.innerHTML = report.warnings
    .slice(0, 10)
    .map((warning) => `<div class="warning">${escapeHtml(warning.message)}</div>`)
    .join("");
  if (report.warnings.length > 10) {
    elements.warningsList.insertAdjacentHTML(
      "beforeend",
      `<div class="warning">${report.warnings.length - 10} more warnings hidden.</div>`,
    );
  }

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

function metricHtml(label, value, note) {
  return `<div class="metric" title="${escapeHtml(note)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div>`;
}

function differenceText(value) {
  if (!value) return "Matches income allocation";
  const direction = value > 0 ? "over" : "under";
  return `${formatMoney(Math.abs(value))} ${direction} income allocation`;
}

function stripeFeeNote(report) {
  return report.reconciliation.stripeFeesAreKnown
    ? "Actual fee column found in card transactions"
    : "Estimated from SimplePractice card rate";
}

function stripeGapNote(report) {
  return report.reconciliation.stripeFeesAreKnown
    ? "Should roughly match known fees"
    : "May be fees plus payout timing";
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
      <td title="${escapeHtml(clinician.pay.explanation)}">${escapeHtml(clinician.pay.explanation)}</td>
      <td>
        <div class="row-actions">
          <button class="mini-button" type="button" data-statement="${escapeHtml(clinician.name)}">Statement</button>
        </div>
      </td>
    </tr>`;
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
          body { margin: 0; color: #202528; font-family: Arial, sans-serif; background: #f6f7f5; }
          .print-bar { position: sticky; top: 0; padding: 12px; background: #ffffff; border-bottom: 1px solid #d8dedc; font-weight: 700; }
          .clinician-document { break-after: page; max-width: 920px; margin: 20px auto; padding: 28px; background: #fff; border: 1px solid #d8dedc; }
          .eyebrow { color: #155f46; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
          h1 { margin: 0; font-size: 28px; }
          h2 { margin: 24px 0 8px; font-size: 16px; }
          p { margin: 4px 0; }
          .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 18px 0; }
          .summary-grid div { border: 1px solid #d8dedc; border-radius: 8px; padding: 10px; }
          .summary-grid span { display: block; color: #687276; font-size: 11px; text-transform: uppercase; }
          .summary-grid strong { display: block; margin-top: 7px; font-size: 18px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 8px; border-bottom: 1px solid #e8ecea; text-align: left; vertical-align: top; }
          th { color: #687276; background: #f4f7f6; font-size: 11px; text-transform: uppercase; }
          .number { text-align: right; }
          .payment-tabs { display: grid; gap: 10px; }
          .payment-tab-list { display: flex; flex-wrap: wrap; gap: 8px; }
          .payment-tab {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            border: 1px solid #cdd9d5;
            border-radius: 999px;
            background: #f4f7f6;
            color: #155f46;
            padding: 7px 11px;
            font: inherit;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
          }
          .payment-tab[aria-selected="true"] { background: #1f7a5a; border-color: #1f7a5a; color: #fff; }
          .payment-tab span {
            min-width: 22px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.72);
            color: #155f46;
            padding: 2px 7px;
            font-size: 12px;
            text-align: center;
          }
          .payment-tab[aria-selected="true"] span { background: rgba(255, 255, 255, 0.9); }
          .payment-panel[hidden] { display: none; }
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

  clinicians.forEach((clinician, index) => {
    const fileName = [
      "clinician-pay",
      slugify(clinician.name),
      state.report.period.start,
      "to",
      state.report.period.end,
    ].join("-");

    setTimeout(() => {
      downloadTextFile(`${fileName}.csv`, generateClinicianCsv(clinician, state.report));
    }, index * 150);
  });
}

function sessionDetailExportClinician(clinician) {
  return clinician.sessionCounts.total > 0 || clinician.paymentRows.length > 0;
}

function downloadTextFile(fileName, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
  renderWorkflowSteps(summary);
  renderImportChecklist();
  renderImportControls();
}

function guidanceSummary() {
  const importCount = importFileCount();
  const clinicianCount = state.clinicianNames.length;
  const readyRules = state.clinicianNames
    .filter((name) => normalizeContract(state.contracts[name]).payType !== "none")
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

function renderWorkflowSteps(summary) {
  const steps = [
    {
      number: 1,
      title: "Imports",
      detail: summary.importCount
        ? `${summary.importCount} file${summary.importCount === 1 ? "" : "s"} loaded`
        : "No files loaded",
      state: summary.importCount ? "complete" : "active",
    },
    {
      number: 2,
      title: "Pay rules",
      detail: summary.clinicianCount
        ? summary.missingRules
          ? `${summary.missingRules} missing`
          : `${summary.clinicianCount} ready`
        : "Waiting for clinicians",
      state: !summary.importCount ? "waiting" : summary.missingRules ? "active" : "complete",
    },
    {
      number: 3,
      title: "Results",
      detail: summary.resultsCalculated ? "Calculated" : "Not run",
      state: summary.resultsCalculated ? "complete" : summary.importCount && !summary.missingRules ? "active" : "waiting",
    },
  ];

  elements.workflowSteps.innerHTML = steps.map(workflowStepHtml).join("");
}

function workflowStepHtml(step) {
  return `
    <div class="workflow-step" data-state="${escapeHtml(step.state)}">
      <span class="workflow-step-number">${step.number}</span>
      <div>
        <strong>${escapeHtml(step.title)}</strong>
        <small>${escapeHtml(step.detail)}</small>
      </div>
    </div>`;
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
  elements.warningsList.innerHTML = `<div class="warning">${escapeHtml(error.message || String(error))}</div>`;
  state.resultsVisible = true;
}

async function restoreSavedState(defaultPeriodValue) {
  const [savedContracts, draft] = await Promise.all([
    storageGet(CONTRACTS_STORAGE_KEY, {}),
    storageGet(DRAFT_STORAGE_KEY, null),
  ]);

  state.contracts = savedContracts || {};
  elements.periodStart.value = defaultPeriodValue.start;
  elements.periodEnd.value = defaultPeriodValue.end;
  elements.folderImportStatus.textContent = DEFAULT_IMPORT_STATUS;

  if (!draft || draft.version !== 1) {
    renderContracts([]);
    return;
  }

  state.files = sanitizeStoredFiles(draft.files);
  state.contracts = {
    ...state.contracts,
    ...(draft.contracts || {}),
  };
  elements.periodStart.value = draft.periodStart || defaultPeriodValue.start;
  elements.periodEnd.value = draft.periodEnd || defaultPeriodValue.end;
  elements.folderImportStatus.textContent = draft.folderImportStatus || restoredImportStatus();

  clearFileInputLabels();
  renderManualFileLabels(state.files);

  if (hasImportFiles()) {
    rebuildFromState({ showResults: Boolean(draft.resultsVisible) });
    setActionStatus(`Restored ${importFileCount()} import${importFileCount() === 1 ? "" : "s"}.`, "success");
    return;
  }

  renderContracts([]);
}

function serializeDraft() {
  return {
    version: 1,
    periodStart: elements.periodStart.value,
    periodEnd: elements.periodEnd.value,
    folderImportStatus: elements.folderImportStatus.textContent || DEFAULT_IMPORT_STATUS,
    files: sanitizeStoredFiles(state.files),
    contracts: state.contracts,
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
    ? `Restored ${count} SimplePractice export${count === 1 ? "" : "s"} from the last popup session.`
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
  return {
    ...defaultContract(),
    ...contract,
    sessionRates: {
      ...defaultContract().sessionRates,
      ...(contract.sessionRates || {}),
    },
  };
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
