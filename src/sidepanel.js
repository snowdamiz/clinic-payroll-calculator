import {
  buildPayrollReport,
  formatMoney,
  generateClinicianCsv,
  generateClinicianDocument,
  generateReportCsvExports,
  inferPayPeriodFromIncomeCsv,
  parseCsv,
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
    badge: "Required",
    priority: "core",
    requirement: "required",
    emptyText: "Payments by clinician",
    dateField: "Date Paid",
  },
  {
    inputId: "appointmentFile",
    label: "Appointment status",
    badge: "Recommended",
    priority: "session",
    requirement: "recommended",
    emptyText: "Kept sessions and CPT codes",
    dateField: "Date of Service",
  },
  {
    inputId: "cardFile",
    label: "Card transactions",
    badge: "Optional",
    priority: "optional",
    requirement: "optional",
    emptyText: "Stripe fees and deposits",
    dateField: "Available On (UTC)",
  },
  {
    inputId: "paymentFile",
    label: "Payment export",
    badge: "Optional",
    priority: "optional",
    requirement: "optional",
    emptyText: "Reconciliation totals",
    dateField: "Date Paid",
  },
  {
    inputId: "insuranceFile",
    label: "Insurance payment report",
    badge: "Optional",
    priority: "optional",
    requirement: "optional",
    emptyText: "Insurance cross-check",
    dateField: "Date Received",
  },
  {
    inputId: "insuranceAllocationFile",
    label: "Insurance payer allocation",
    badge: "Optional",
    priority: "optional",
    requirement: "optional",
    emptyText: "Insurance allocation by payer",
    dateField: "",
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
  importReview: emptyImportReview(),
  contracts: {},
  clinicianNames: [],
  report: null,
  resultsVisible: false,
  activeSetupSection: "",
  activeReviewTab: "summary",
  warningReviews: {},
  warningFilters: {
    severity: "all",
    category: "all",
    status: "all",
  },
  rulesReviewOnly: false,
  isBusy: false,
};

let draftSaveTimer = null;
let contractSaveTimer = null;
let lastAppliedImporterDraft = "";
let lastFocusedBeforeDrawer = null;

const elements = {
  periodStart: document.querySelector("#periodStart"),
  periodEnd: document.querySelector("#periodEnd"),
  calculateButton: document.querySelector("#calculateButton"),
  resetButton: document.querySelector("#resetButton"),
  calculateStatus: document.querySelector("#calculateStatus"),
  autosaveStatus: document.querySelector("#autosaveStatus"),
  readinessBanner: document.querySelector("#readinessBanner"),
  readinessTitle: document.querySelector("#readinessTitle"),
  readinessDetail: document.querySelector("#readinessDetail"),
  nextStepDetail: document.querySelector("#nextStepDetail"),
  importProgress: document.querySelector("#importProgress"),
  rulesProgress: document.querySelector("#rulesProgress"),
  resultsProgress: document.querySelector("#resultsProgress"),
  preflightPanel: document.querySelector("#preflightPanel"),
  preflightList: document.querySelector("#preflightList"),
  runSummaryPanel: document.querySelector("#runSummaryPanel"),
  runSummaryDetail: document.querySelector("#runSummaryDetail"),
  runSummaryGrid: document.querySelector("#runSummaryGrid"),
  periodPanel: document.querySelector("#periodPanel"),
  importsPanel: document.querySelector("#importsPanel"),
  contractsPanel: document.querySelector("#contractsPanel"),
  saveRulesButton: document.querySelector("#saveRulesButton"),
  clearFilesButton: document.querySelector("#clearFilesButton"),
  rulesReviewOnly: document.querySelector("#rulesReviewOnly"),
  bulkFlatRate: document.querySelector("#bulkFlatRate"),
  applyBulkFlatRateButton: document.querySelector("#applyBulkFlatRateButton"),
  copyRuleSource: document.querySelector("#copyRuleSource"),
  copyRuleButton: document.querySelector("#copyRuleButton"),
  resetSelectedRulesButton: document.querySelector("#resetSelectedRulesButton"),
  bulkImportDropzone: document.querySelector("#bulkImportDropzone"),
  openImporterButton: document.querySelector("#openImporterButton"),
  bulkFilesInput: document.querySelector("#bulkFilesInput"),
  folderImportStatus: document.querySelector("#folderImportStatus"),
  importChecklist: document.querySelector("#importChecklist"),
  fileFallbackDetails: document.querySelector("#fileFallbackDetails"),
  contractsList: document.querySelector("#contractsList"),
  contractCount: document.querySelector("#contractCount"),
  resultsPanel: document.querySelector("#resultsPanel"),
  resultPeriod: document.querySelector("#resultPeriod"),
  incomeCards: document.querySelector("#incomeCards"),
  reconciliationCards: document.querySelector("#reconciliationCards"),
  warningsList: document.querySelector("#warningsList"),
  warningOverview: document.querySelector("#warningOverview"),
  warningDrawer: document.querySelector("#warningDrawer"),
  warningDrawerPanel: document.querySelector(".warning-drawer"),
  warningDrawerClose: document.querySelector("#warningDrawerClose"),
  warningDrawerSummary: document.querySelector("#warningDrawerSummary"),
  warningSearchInput: document.querySelector("#warningSearchInput"),
  warningSeverityFilter: document.querySelector("#warningSeverityFilter"),
  warningCategoryFilter: document.querySelector("#warningCategoryFilter"),
  warningStatusFilter: document.querySelector("#warningStatusFilter"),
  warningDrawerList: document.querySelector("#warningDrawerList"),
  clinicianResults: document.querySelector("#clinicianResults"),
  summaryReview: document.querySelector("#summaryReview"),
  exportCenter: document.querySelector("#exportCenter"),
  reviewTabs: document.querySelector(".review-tabs"),
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
  elements.warningsList.addEventListener("click", handleWarningsClick);
  elements.warningDrawerClose.addEventListener("click", closeWarningDrawer);
  elements.warningDrawer.addEventListener("click", handleWarningDrawerBackdropClick);
  elements.warningDrawer.addEventListener("keydown", handleWarningDrawerKeydown);
  elements.warningSearchInput.addEventListener("input", renderWarningDrawer);
  elements.warningSeverityFilter.addEventListener("change", handleWarningFilterChange);
  elements.warningCategoryFilter.addEventListener("change", handleWarningFilterChange);
  elements.warningStatusFilter.addEventListener("change", handleWarningFilterChange);
  elements.warningDrawerList.addEventListener("click", handleWarningReviewClick);
  elements.exportCenter.addEventListener("click", handleExportAction);
  elements.contractsList.addEventListener("change", handleContractEdit);
  elements.contractsList.addEventListener("input", handleContractEdit);
  elements.importChecklist.addEventListener("change", handleImportAssignmentChange);
  elements.rulesReviewOnly.addEventListener("change", handleRulesReviewFilterChange);
  elements.applyBulkFlatRateButton.addEventListener("click", applyBulkFlatRateToSelected);
  elements.copyRuleButton.addEventListener("click", copyRuleToSelected);
  elements.resetSelectedRulesButton.addEventListener("click", resetSelectedRules);
  elements.reviewTabs.addEventListener("click", handleReviewTabClick);
  elements.reviewTabs.addEventListener("keydown", handleReviewTabKeydown);
  elements.periodStart.addEventListener("change", handlePeriodChange);
  elements.periodEnd.addEventListener("change", handlePeriodChange);
  bindHelpPopovers();
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

function bindHelpPopovers() {
  for (const button of document.querySelectorAll("[data-help-button]")) {
    button.addEventListener("pointerdown", () => {
      button.dataset.pointerFocus = "true";
    });
    button.addEventListener("click", () => toggleHelpPopover(button));
    button.addEventListener("focus", () => {
      if (button.dataset.pointerFocus) {
        delete button.dataset.pointerFocus;
        return;
      }
      openHelpPopover(button);
    });
  }
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-help-button], .help-popover")) return;
    closeHelpPopovers();
  });
}

function toggleHelpPopover(button) {
  const popover = document.querySelector(`#${button.getAttribute("aria-controls")}`);
  if (!popover) return;
  if (popover.hidden) {
    openHelpPopover(button);
  } else {
    closeHelpPopovers();
    button.focus();
  }
}

function openHelpPopover(button) {
  closeHelpPopovers({ except: button });
  const popover = document.querySelector(`#${button.getAttribute("aria-controls")}`);
  if (!popover) return;
  popover.hidden = false;
  button.setAttribute("aria-expanded", "true");
}

function closeHelpPopovers({ except = null } = {}) {
  for (const button of document.querySelectorAll("[data-help-button]")) {
    if (button === except) continue;
    const popover = document.querySelector(`#${button.getAttribute("aria-controls")}`);
    if (!popover) continue;
    popover.hidden = true;
    button.setAttribute("aria-expanded", "false");
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
    const unsupportedFiles = [...(files || [])].filter((file) => !isSupportedImportFile(file));
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
    state.importReview = buildImportReview({
      fileRecords: [...Object.values(result.assignments), ...result.unmatched],
      result,
      importPlan,
      readErrors,
      unsupportedFiles,
      source: "bulk",
    });
    clearFileInputLabels();

    const periodWasInferred = maybeApplyInferredPayPeriod(result.assignments);
    state.importReview.periodSuggestion = periodWasInferred
      ? `Set pay period to ${elements.periodStart.value} through ${elements.periodEnd.value} from the income export.`
      : "";
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
    delete state.importReview.assignments[input.id];
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
    upsertImportReviewFile(fileRecord);
    state.importReview.assignments[input.id] = {
      fileId: importReviewFileId(fileRecord),
      matchReason: "Manually assigned from the file picker.",
      source: "manual",
    };
    state.importReview.skipped = emptyImportReview().skipped;
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
    invalidateResults();
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
    const preflight = buildPreflightReview({ forceReport: true });
    if (preflight.blockers.length > 0) {
      renderPreflightPanel(preflight, { forceVisible: true });
      setActionStatus("Resolve preflight blockers before calculating.", "error");
      elements.preflightPanel.focus();
      return;
    }

    const report = rebuildFromState({ showResults: true });
    state.warningReviews = pruneWarningReviews(state.warningReviews, payrollWarnings(report));
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
  invalidateResults();
  renderGuidance();
  await Promise.all([persistContracts(), persistDraft()]);
  elements.contractCount.textContent = "Pay rules saved.";
  setActionStatus("Pay rules saved.", "success");
}

async function clearFiles() {
  state.files = {};
  state.importReview = emptyImportReview();
  state.clinicianNames = [];
  state.warningReviews = {};
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
  if (!window.confirm("Reset this local draft? This clears pay-period dates, imported files, warning review marks, and calculated results. Saved clinician pay rules stay stored locally, and original export files on your computer are not changed.")) {
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
  state.importReview = emptyImportReview();
  state.contracts = await storageGet(CONTRACTS_STORAGE_KEY, {});
  state.clinicianNames = [];
  state.report = null;
  state.resultsVisible = false;
  state.warningReviews = {};
  state.activeSetupSection = "";
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

function invalidateResults() {
  if (!state.resultsVisible) return;
  state.resultsVisible = false;
  state.activeSetupSection = state.activeSetupSection || "rules";
  elements.resultsPanel.classList.add("hidden");
  closeWarningDrawer({ restoreFocus: false, resetSearch: true });
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

  const sortedNames = sortCliniciansForRules([...new Set(names)]);
  elements.contractCount.textContent = sortedNames.length
    ? `${sortedNames.length} clinician${sortedNames.length === 1 ? "" : "s"} loaded.`
    : "Import files to load clinicians.";
  renderCopyRuleSource(sortedNames);

  if (sortedNames.length === 0) {
    elements.contractsList.className = "contracts-list empty-state";
    elements.contractsList.textContent =
      "Load the income allocation and appointment status exports, then choose one pay rule for each clinician.";
    return;
  }

  elements.contractsList.className = "contracts-list";
  let lastGroup = "";
  for (const name of sortedNames) {
    const contract = normalizeContract(state.contracts[name]);
    const clinician = state.report?.clinicians[name];
    const validation = contractValidation(contract, clinician);
    if (state.rulesReviewOnly && validation.state === "complete") continue;
    if (validation.group !== lastGroup) {
      lastGroup = validation.group;
      const group = document.createElement("h3");
      group.className = "contract-group-heading";
      group.textContent = validation.group;
      elements.contractsList.append(group);
    }

    const fragment = elements.contractTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".contract-card");
    const details = fragment.querySelector(".contract-details");
    const checkbox = fragment.querySelector(".contract-select");
    const badge = fragment.querySelector(".rule-badge");
    const heading = fragment.querySelector(".contract-summary-title");
    const summaryNote = fragment.querySelector(".contract-summary-note");
    const select = fragment.querySelector(".pay-type");
    const description = fragment.querySelector(".rule-description");
    const fields = fragment.querySelector(".contract-fields");

    card.dataset.clinician = name;
    card.classList.toggle("needs-review", Boolean(contract.needsReview));
    card.dataset.validation = validation.state;
    details.open = validation.state !== "complete";
    checkbox.setAttribute("aria-label", `Select ${name} for bulk pay rule actions`);
    badge.textContent = validation.badge;
    badge.dataset.state = validation.state;
    heading.textContent = name;
    summaryNote.textContent = contractSummaryText(contract, validation);
    select.value = contract.payType;
    description.textContent = contract.needsReview
      ? "Legacy percent-of-clinic-income rules are no longer supported. Choose a new agreement before final payroll."
      : validation.message || payRuleDescription(contract.payType);
    fields.innerHTML = `${sessionMixHtml(clinician, validation)}${contractFieldsHtml(contract, clinician)}`;
    elements.contractsList.append(fragment);
  }

  if (!elements.contractsList.children.length) {
    elements.contractsList.className = "contracts-list empty-state";
    elements.contractsList.textContent = "All visible clinician pay rules are complete.";
  }
}

function contractSummaryText(contract, validation) {
  if (validation.state !== "complete") return validation.message || "Open to finish this pay rule.";
  if (contract.payType === "flat_session") return `${formatMoney(contract.flatRate)} per kept session`;
  if (contract.payType === "per_session") return "Different rates by session type";
  if (contract.payType === "percent_collections") return `${Number(contract.percentage || 0)}% of clinician collections`;
  return "Pay rule configured";
}

function sortCliniciansForRules(names) {
  return names.sort((a, b) => {
    const aValidation = contractValidation(normalizeContract(state.contracts[a]), state.report?.clinicians[a]);
    const bValidation = contractValidation(normalizeContract(state.contracts[b]), state.report?.clinicians[b]);
    if (aValidation.rank !== bValidation.rank) return aValidation.rank - bValidation.rank;
    return a.localeCompare(b);
  });
}

function renderCopyRuleSource(names) {
  elements.copyRuleSource.innerHTML = [
    `<option value="">Choose clinician</option>`,
    ...names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`),
  ].join("");
}

function sessionMixHtml(clinician, validation) {
  const counts = clinician?.sessionCounts || defaultSessionCounts();
  const chips = sessionTypeLabels
    .map(([key, label]) => `
      <div class="session-chip">
        <strong>${Number(counts[key] || 0)}</strong>
        <span>${escapeHtml(label)}</span>
      </div>`)
    .join("");
  const open = validation.state !== "complete" ? " open" : "";

  return `
    <details class="session-mix" aria-label="Session counts from CPT codes"${open}>
      <summary class="session-mix-heading">
        <span>Sessions from CPT codes</span>
        <small>Appointment status report counts.</small>
      </summary>
      <div class="session-mix-grid">${chips}</div>
    </details>`;
}

function contractFieldsHtml(contract, clinician) {
  const example = contractExampleHtml(contract, clinician);
  if (contract.payType === "flat_session") {
    return [
      `<p class="field-group-title">Dollar rate</p>`,
      numberFieldHtml("flatRate", "Session rate", contract.flatRate, "wide"),
      example,
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
      example,
    ].join("");
  }

  if (contract.payType === "percent_collections") {
    const percentageField = numberFieldHtml("percentage", "Percent", contract.percentage, "wide", "0.01");
    return [
      `<p class="field-group-title">Percentage agreement</p>`,
      percentageField,
      example,
    ].join("");
  }

  return `<p class="muted">Select a pay method.</p>`;
}

function contractExampleHtml(contract, clinician) {
  const counts = clinician?.sessionCounts || defaultSessionCounts();
  if (contract.payType === "flat_session") {
    const total = counts.total * Number(contract.flatRate || 0);
    return `<p class="rule-example">${counts.total} sessions x ${formatMoney(contract.flatRate || 0)} = ${formatMoney(total)}</p>`;
  }

  if (contract.payType === "per_session") {
    const total = sessionTypeLabels
      .filter(([key]) => key !== "total")
      .reduce((sum, [key]) => sum + counts[key] * Number(contract.sessionRates[key] || 0), 0);
    return `<p class="rule-example">Current session mix calculates to ${formatMoney(total)}.</p>`;
  }

  if (contract.payType === "percent_collections") {
    const cash = clinician?.cashReceived?.total || 0;
    const total = cash * (Number(contract.percentage || 0) / 100);
    return `<p class="rule-example">${formatMoney(cash)} collections x ${Number(contract.percentage || 0)}% = ${formatMoney(total)}</p>`;
  }

  return "";
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

function contractValidation(contract, clinician) {
  const normalized = normalizeContract(contract);
  const counts = clinician?.sessionCounts || defaultSessionCounts();
  const hasSessions = counts.total > 0;

  if (normalized.needsReview) {
    return {
      state: "blocker",
      badge: "Legacy rule",
      message: "Legacy rule. Choose a supported agreement before exporting payroll.",
      group: "Needs pay rule",
      rank: 0,
    };
  }

  if (normalized.payType === "none") {
    return {
      state: "blocker",
      badge: "Not configured",
      message: "No pay rule is configured for this clinician.",
      group: "Needs pay rule",
      rank: 0,
    };
  }

  if (normalized.payType === "flat_session" && Number(normalized.flatRate || 0) <= 0) {
    return {
      state: "blocker",
      badge: "Missing rate",
      message: "Flat session rule is selected, but the session rate is zero.",
      group: "Rates need review",
      rank: 1,
    };
  }

  if (normalized.payType === "percent_collections" && Number(normalized.percentage || 0) <= 0) {
    return {
      state: "blocker",
      badge: "Missing percent",
      message: "Collection percentage is zero, so this rule would calculate no pay.",
      group: "Rates need review",
      rank: 1,
    };
  }

  if (normalized.payType === "per_session") {
    const activeSessionTypes = sessionTypeLabels
      .map(([key]) => key)
      .filter((key) => key !== "total" && counts[key] > 0);
    const allRatesZero = Object.values(normalized.sessionRates).every((rate) => Number(rate || 0) <= 0);
    const missingActiveRate = activeSessionTypes.some((key) => Number(normalized.sessionRates[key] || 0) <= 0);

    if (allRatesZero || (hasSessions && missingActiveRate)) {
      return {
        state: "blocker",
        badge: allRatesZero ? "All rates zero" : "Missing rate",
        message: allRatesZero
          ? "Different-rates rule is selected, but every session rate is zero."
          : "At least one session type found in this pay period has a zero rate.",
        group: "Rates need review",
        rank: 1,
      };
    }
  }

  return {
    state: "complete",
    badge: "Complete",
    message: "",
    group: "Complete",
    rank: 2,
  };
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
    invalidateResults();
    if (event.type === "change") renderContracts(state.clinicianNames);
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
    invalidateResults();
    if (event.type === "change") renderContracts(state.clinicianNames);
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

function handleRulesReviewFilterChange(event) {
  state.rulesReviewOnly = Boolean(event.target.checked);
  renderContracts(state.clinicianNames);
}

function selectedClinicianNames() {
  return [...elements.contractsList.querySelectorAll(".contract-select:checked")]
    .map((input) => input.closest(".contract-card")?.dataset.clinician)
    .filter(Boolean);
}

function applyBulkFlatRateToSelected() {
  const selectedNames = selectedClinicianNames();
  const flatRate = Number(elements.bulkFlatRate.value || 0);
  if (selectedNames.length === 0) {
    setActionStatus("Select at least one clinician before applying a bulk rate.", "error");
    return;
  }
  if (flatRate <= 0) {
    setActionStatus("Enter a flat session rate greater than zero.", "error");
    elements.bulkFlatRate.focus();
    return;
  }

  collectContractsFromDom();
  for (const name of selectedNames) {
    state.contracts[name] = {
      ...normalizeContract(state.contracts[name]),
      payType: "flat_session",
      flatRate,
      needsReview: false,
      legacyPayType: "",
    };
  }
  invalidateResults();
  renderContracts(state.clinicianNames);
  renderGuidance();
  scheduleContractSave();
  scheduleDraftSave();
  setActionStatus(`Applied ${formatMoney(flatRate)} flat rate to ${selectedNames.length} clinician${selectedNames.length === 1 ? "" : "s"}.`, "success");
}

function copyRuleToSelected() {
  const selectedNames = selectedClinicianNames();
  const sourceName = elements.copyRuleSource.value;
  if (selectedNames.length === 0) {
    setActionStatus("Select at least one clinician before copying a rule.", "error");
    return;
  }
  if (!sourceName || !state.contracts[sourceName]) {
    setActionStatus("Choose a clinician to copy from.", "error");
    elements.copyRuleSource.focus();
    return;
  }

  collectContractsFromDom();
  const sourceContract = normalizeContract(state.contracts[sourceName]);
  for (const name of selectedNames) {
    if (name === sourceName) continue;
    state.contracts[name] = normalizeContract(JSON.parse(JSON.stringify(sourceContract)));
  }
  invalidateResults();
  renderContracts(state.clinicianNames);
  renderGuidance();
  scheduleContractSave();
  scheduleDraftSave();
  setActionStatus(`Copied ${sourceName}'s rule to selected clinicians.`, "success");
}

function resetSelectedRules() {
  const selectedNames = selectedClinicianNames();
  if (selectedNames.length === 0) {
    setActionStatus("Select at least one clinician before resetting rules.", "error");
    return;
  }

  collectContractsFromDom();
  for (const name of selectedNames) {
    state.contracts[name] = defaultContract();
  }
  invalidateResults();
  renderContracts(state.clinicianNames);
  renderGuidance();
  scheduleContractSave();
  scheduleDraftSave();
  setActionStatus(`Reset ${selectedNames.length} selected pay rule${selectedNames.length === 1 ? "" : "s"}.`, "success");
}

async function handlePeriodChange() {
  await refreshCliniciansFromImports();
}

function renderResults(report) {
  elements.resultsPanel.classList.remove("hidden");
  elements.resultPeriod.textContent = `${report.period.start} to ${report.period.end}`;

  elements.incomeCards.innerHTML = [
    metricHtml("Gross income", formatMoney(report.contributionPnl.revenue), "SimplePractice income allocation"),
    metricHtml("Clinician compensation", formatMoney(report.contributionPnl.clinicianCompensation), "Calculated payroll from active clinician pay rules"),
    metricHtml("Contribution result", formatMoney(report.contributionPnl.contributionResult), report.contributionPnl.fullPnlStatus),
    metricHtml("Unresolved warnings", unreviewedWarnings(payrollWarnings(report)).length, "Warnings not marked reviewed for this run"),
  ].join("");

  elements.reconciliationCards.innerHTML = [
    metricHtml("Trailing payments", formatMoney(report.trailingPayments.amount), `${report.trailingPayments.count} payment${report.trailingPayments.count === 1 ? "" : "s"} outside the current service period or missing service dates`),
    metricHtml("Unpaid balances", formatMoney(report.ledgerReview.unpaidAppointmentBalance), "Appointment rows with unpaid balances and no matched payment in this pay period"),
    metricHtml("Income allocation", formatMoney(report.reconciliation.incomeAllocationTotal), "Pay-period report total"),
    optionalMetricHtml("Payment export", report.reconciliation.paymentExportTotal, report.reconciliation.paymentExportAvailable, differenceText(report.reconciliation.paymentExportDifference), paymentExportUnavailableNote()),
    optionalMetricHtml("Insurance allocation", report.reconciliation.insurancePayerAllocationTotal, report.reconciliation.insurancePayerAllocationAvailable, differenceText(report.reconciliation.insurancePayerAllocationDifference), insuranceAllocationUnavailableNote()),
    optionalMetricHtml("Insurance report", report.reconciliation.insurancePaymentReportTotal, report.reconciliation.insurancePaymentReportAvailable, differenceText(report.reconciliation.insuranceReportDifference), insuranceReportUnavailableNote()),
    optionalMetricHtml("Stripe gross payments", report.reconciliation.stripeGrossPayments, report.reconciliation.stripeGrossPaymentsAvailable, "From SimplePractice payment export", stripeGrossUnavailableNote(report)),
    optionalMetricHtml("Stripe deposits", report.reconciliation.stripeDeposits, report.reconciliation.cardTransactionsAvailable, "Bank payout total by available date", cardTransactionsUnavailableNote()),
    optionalMetricHtml("Stripe payout gap", report.reconciliation.stripePayoutGap, report.reconciliation.stripePayoutGapAvailable, stripeGapNote(report), stripeGapUnavailableNote(report)),
  ].join("");

  const warnings = payrollWarnings(report);
  renderWarningSummary(warnings);
  renderWarningOverview(warnings);
  renderSummaryReview(report, warnings);
  renderExportCenter(report, warnings);
  renderWarningDrawer();

  elements.clinicianResults.innerHTML = Object.values(report.clinicians)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((clinician) => clinicianCardHtml(clinician))
    .join("");

  for (const button of elements.clinicianResults.querySelectorAll("[data-statement]")) {
    button.addEventListener("click", () => {
      const clinician = report.clinicians[button.dataset.statement];
      openStatements([clinician], report);
    });
  }
  renderReviewTab();
}

function renderSummaryReview(report, warnings) {
  const counts = warningCounts(warnings);
  elements.summaryReview.innerHTML = `
    <div class="summary-strip">
      <button class="summary-chip" type="button" data-review-tab-target="warnings">
        <span>Blockers</span>
        <strong>${counts.blocker}</strong>
      </button>
      <button class="summary-chip" type="button" data-review-tab-target="warnings">
        <span>Review</span>
        <strong>${counts.review}</strong>
      </button>
      <button class="summary-chip" type="button" data-review-tab-target="clinicians">
        <span>Clinicians</span>
        <strong>${Object.keys(report.clinicians).length}</strong>
      </button>
      <button class="summary-chip" type="button" data-review-tab-target="reconciliation">
        <span>Reconciliation gap</span>
        <strong>${formatMoney(largestReconciliationGap(report))}</strong>
      </button>
    </div>
    <p class="local-note">All imported payroll data and reviewed-warning marks are stored locally in this extension draft.</p>`;

  for (const button of elements.summaryReview.querySelectorAll("[data-review-tab-target]")) {
    button.addEventListener("click", () => {
      state.activeReviewTab = button.dataset.reviewTabTarget;
      renderReviewTab();
    });
  }
}

function renderExportCenter(report, warnings) {
  const clinicians = Object.values(report.clinicians);
  const statementClinicians = clinicians.filter(sessionDetailExportClinician);
  const unresolvedBlockers = warnings.filter((warning) => warning.severity === "blocker" && !isWarningReviewed(warning));
  elements.exportCenter.innerHTML = `
    <article class="export-card" data-state="${unresolvedBlockers.length ? "blocked" : "ready"}">
      <h3>${unresolvedBlockers.length ? "Review blockers before final exports" : "Exports are ready"}</h3>
      <p>${unresolvedBlockers.length
        ? `${unresolvedBlockers.length} blocker warning${unresolvedBlockers.length === 1 ? "" : "s"} remain unreviewed. Export actions will ask for confirmation.`
        : "No unreviewed blocker warnings remain for this run."}</p>
    </article>
    <div class="export-grid">
      ${exportActionHtml("summary-csv", "Download CSV", `${clinicians.length} summary row${clinicians.length === 1 ? "" : "s"}`, "Downloads one payroll summary CSV for accounting review.")}
      ${exportActionHtml("pdf", "Export PDF", "Full payroll report", "Opens the browser print flow for a PDF-ready report with totals, reconciliation, warnings, and clinician rows.")}
      ${exportActionHtml("statement-pdf", "Export Statements PDF", `${clinicians.length} clinician statement${clinicians.length === 1 ? "" : "s"}`, "Opens all individual clinician statements in one browser print packet.")}
      ${exportActionHtml("clinician-zip", "Download Clinician ZIP", `${statementClinicians.length} clinician file${statementClinicians.length === 1 ? "" : "s"}`, "Downloads clinician-level CSV statements for clinicians with sessions or payments.")}
      ${exportActionHtml("ledger-zip", "Download Ledger ZIP", "5 ledger files", "Downloads appointment, payment, split-payment, outlier, and contribution PnL CSVs.")}
      ${exportActionHtml("full-report", "Open Full Report", "Spreadsheet-style review", "Opens the full report in a new tab without starting the print dialog.")}
    </div>`;
}

function exportActionHtml(action, label, count, detail) {
  return `
    <button class="export-detail export-action-card" type="button" data-export-action="${escapeHtml(action)}">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(count)}</span>
      <small>${escapeHtml(detail)}</small>
    </button>`;
}

function handleExportAction(event) {
  const button = event.target.closest("[data-export-action]");
  if (!button) return;

  const actions = {
    "summary-csv": downloadSummaryCsv,
    "pdf": exportResultsPdf,
    "statement-pdf": exportStatementPacketPdf,
    "clinician-zip": downloadClinicianCsvs,
    "ledger-zip": downloadLedgerCsvs,
    "full-report": openFullReport,
  };
  actions[button.dataset.exportAction]?.();
}

function handleReviewTabClick(event) {
  const button = event.target.closest("[data-review-tab]");
  if (!button) return;
  state.activeReviewTab = button.dataset.reviewTab;
  renderReviewTab();
}

function handleReviewTabKeydown(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...elements.reviewTabs.querySelectorAll("[data-review-tab]")];
  const currentIndex = tabs.findIndex((tab) => tab.dataset.reviewTab === state.activeReviewTab);
  let nextIndex = currentIndex;
  if (event.key === "ArrowLeft") nextIndex = Math.max(0, currentIndex - 1);
  if (event.key === "ArrowRight") nextIndex = Math.min(tabs.length - 1, currentIndex + 1);
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = tabs.length - 1;
  event.preventDefault();
  state.activeReviewTab = tabs[nextIndex].dataset.reviewTab;
  renderReviewTab();
  tabs[nextIndex].focus();
}

function renderReviewTab() {
  const tabs = [...elements.reviewTabs.querySelectorAll("[data-review-tab]")];
  for (const tab of tabs) {
    const active = tab.dataset.reviewTab === state.activeReviewTab;
    tab.setAttribute("aria-selected", active ? "true" : "false");
    tab.tabIndex = active ? 0 : -1;
  }

  const panels = {
    summary: document.querySelector("#summaryPanel"),
    warnings: document.querySelector("#warningsPanel"),
    clinicians: document.querySelector("#cliniciansPanel"),
    reconciliation: document.querySelector("#reconciliationPanel"),
    exports: document.querySelector("#exportsPanel"),
  };
  for (const [name, panel] of Object.entries(panels)) {
    panel.classList.toggle("hidden", name !== state.activeReviewTab);
  }
}

function renderWarningSummary(warnings = []) {
  const count = warnings.length;
  if (!count) {
    elements.warningsList.innerHTML = `<div class="success-state">No warning-level issues found for this run.</div>`;
    closeWarningDrawer({ restoreFocus: false, resetSearch: true });
    return;
  }

  const counts = warningCounts(warnings);
  const unresolvedCount = unreviewedWarnings(warnings).length;
  elements.warningsList.innerHTML = `
    <button class="warning-summary warning-summary-button" type="button" data-open-warnings aria-label="Open ${count} payroll warning${count === 1 ? "" : "s"}">
      <span>
        <strong>${unresolvedCount} unresolved of ${count}</strong>
        <small>${counts.blocker} blocker, ${counts.review} review, ${counts.info} info</small>
      </span>
      <em>Review</em>
    </button>`;
}

function handleWarningsClick(event) {
  if (!event.target.closest("[data-open-warnings]")) return;
  openWarningDrawer();
}

function openWarningDrawer() {
  if (!payrollWarnings(state.report).length) return;

  lastFocusedBeforeDrawer = document.activeElement;
  elements.warningDrawer.classList.remove("hidden");
  elements.warningDrawer.setAttribute("aria-hidden", "false");
  elements.warningSearchInput.value = "";
  renderWarningFilterOptions();
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
    if (lastFocusedBeforeDrawer?.isConnected) {
      lastFocusedBeforeDrawer.focus();
    } else {
      elements.warningsList.querySelector("[data-open-warnings]")?.focus();
    }
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
  if (event.key === "Escape") {
    closeHelpPopovers();
  }
}

function renderWarningDrawer() {
  const warnings = payrollWarnings(state.report);
  const query = elements.warningSearchInput.value.trim().toLowerCase();
  const filteredWarnings = warnings.filter((warning) => {
    const matchesQuery = query ? warningSearchText(warning).includes(query) : true;
    const matchesSeverity = state.warningFilters.severity === "all" || warning.severity === state.warningFilters.severity;
    const matchesCategory = state.warningFilters.category === "all" || warning.category === state.warningFilters.category;
    const reviewed = isWarningReviewed(warning);
    const matchesStatus = state.warningFilters.status === "all"
      || (state.warningFilters.status === "reviewed" && reviewed)
      || (state.warningFilters.status === "unreviewed" && !reviewed);
    return matchesQuery && matchesSeverity && matchesCategory && matchesStatus;
  });

  elements.warningDrawerSummary.textContent = query
    ? `${filteredWarnings.length} of ${warnings.length} warning${warnings.length === 1 ? "" : "s"} match`
    : `${warnings.length} warning${warnings.length === 1 ? "" : "s"} in this pay run`;
  elements.warningDrawerList.innerHTML = filteredWarnings.length
    ? filteredWarnings.map(warningDrawerItemHtml).join("")
    : `<div class="drawer-empty">No warnings match that search.</div>`;
}

function warningDrawerItemHtml(warning) {
  const reviewed = isWarningReviewed(warning);
  return `
    <article class="warning-drawer-item" data-severity="${escapeHtml(warning.severity)}">
      <div class="warning-item-heading">
        <span>${escapeHtml(warning.severityLabel)} | ${escapeHtml(warning.categoryLabel)}</span>
        <button class="mini-button" type="button" data-review-warning="${escapeHtml(warning.id)}" aria-pressed="${reviewed ? "true" : "false"}">
          ${reviewed ? "Reviewed" : "Mark reviewed"}
        </button>
      </div>
      <p>${escapeHtml(warning.message)}</p>
      ${warning.clinician ? `<small>${escapeHtml(warning.clinician)}</small>` : ""}
      <small>Next action: ${escapeHtml(warning.nextAction)}</small>
    </article>`;
}

function handleWarningFilterChange(event) {
  if (event.target === elements.warningSeverityFilter) {
    state.warningFilters.severity = event.target.value;
  }
  if (event.target === elements.warningCategoryFilter) {
    state.warningFilters.category = event.target.value;
  }
  if (event.target === elements.warningStatusFilter) {
    state.warningFilters.status = event.target.value;
  }
  renderWarningDrawer();
}

function handleWarningReviewClick(event) {
  const button = event.target.closest("[data-review-warning]");
  if (!button) return;

  const warningId = button.dataset.reviewWarning;
  state.warningReviews[warningId] = !state.warningReviews[warningId];
  renderWarningSummary(payrollWarnings(state.report));
  renderWarningOverview(payrollWarnings(state.report));
  renderExportCenter(state.report, payrollWarnings(state.report));
  renderWarningDrawer();
  scheduleDraftSave();
}

function handleWarningDrawerKeydown(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeWarningDrawer();
    return;
  }
  if (event.key !== "Tab") return;

  const focusable = focusableElements(elements.warningDrawerPanel);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function focusableElements(root) {
  return [...root.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")]
    .filter((element) => !element.disabled && !element.hidden && element.offsetParent !== null);
}

function renderWarningFilterOptions() {
  const warnings = payrollWarnings(state.report);
  const categories = [...new Map(warnings.map((warning) => [warning.category, warning.categoryLabel])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const current = state.warningFilters.category;
  elements.warningCategoryFilter.innerHTML = [
    `<option value="all">All categories</option>`,
    ...categories.map(([value, label]) => `<option value="${escapeHtml(value)}"${value === current ? " selected" : ""}>${escapeHtml(label)}</option>`),
  ].join("");
  elements.warningSeverityFilter.value = state.warningFilters.severity;
  elements.warningStatusFilter.value = state.warningFilters.status;
}

function warningSearchText(warning) {
  return [
    warning.severityLabel,
    warning.categoryLabel,
    formatWarningType(warning.type),
    warning.clinician,
    warning.message,
    warning.nextAction,
  ].filter(Boolean).join(" ").toLowerCase();
}

function formatWarningType(type) {
  return String(type || "warning").replaceAll("_", " ");
}

function payrollWarnings(report) {
  if (!report) return [];
  return [
    ...(report.warnings || []),
    ...reconciliationWarnings(report),
  ].map((warning, index) => decorateWarning(warning, index));
}

function reconciliationWarnings(report) {
  const warnings = [];
  const reconciliationChecks = [
    {
      type: "payment_export_gap",
      available: report.reconciliation.paymentExportAvailable,
      value: report.reconciliation.paymentExportDifference,
      message: `Payment export differs from income allocation by ${formatMoney(Math.abs(report.reconciliation.paymentExportDifference || 0))}.`,
      nextAction: "Compare the payment export date filter against the income allocation pay-period report.",
    },
    {
      type: "insurance_allocation_gap",
      available: report.reconciliation.insurancePayerAllocationAvailable,
      value: report.reconciliation.insurancePayerAllocationDifference,
      message: `Insurance payer allocation differs from insurance income by ${formatMoney(Math.abs(report.reconciliation.insurancePayerAllocationDifference || 0))}.`,
      nextAction: "Confirm the insurance payer allocation export covers the same pay period.",
    },
    {
      type: "insurance_report_gap",
      available: report.reconciliation.insurancePaymentReportAvailable,
      value: report.reconciliation.insuranceReportDifference,
      message: `Insurance payment report differs from insurance income by ${formatMoney(Math.abs(report.reconciliation.insuranceReportDifference || 0))}.`,
      nextAction: "Check whether insurance payments were filtered by received date or posted date.",
    },
  ];

  for (const check of reconciliationChecks) {
    if (!check.available || Math.abs(Number(check.value || 0)) < 0.01) continue;
    warnings.push({
      type: check.type,
      category: "reconciliation",
      severity: "review",
      message: check.message,
      nextAction: check.nextAction,
      amount: Math.abs(Number(check.value || 0)),
    });
  }

  return warnings;
}

function decorateWarning(warning, index) {
  const meta = warningMeta(warning);
  return {
    ...warning,
    id: warning.id || warningId(warning, index),
    severity: warning.severity || meta.severity,
    severityLabel: severityLabel(warning.severity || meta.severity),
    category: warning.category || meta.category,
    categoryLabel: categoryLabel(warning.category || meta.category),
    nextAction: warning.nextAction || meta.nextAction,
  };
}

function warningMeta(warning) {
  const type = warning.type || "warning";
  const metadata = {
    legacy_pay_rule: {
      severity: "blocker",
      category: "pay_rules",
      nextAction: "Choose a supported pay agreement for this clinician.",
    },
    missing_contract: {
      severity: "blocker",
      category: "pay_rules",
      nextAction: "Configure and save a pay rule for this clinician.",
    },
    zero_value_pay_rule: {
      severity: "blocker",
      category: "pay_rules",
      nextAction: "Enter a non-zero rate or percentage for this clinician.",
    },
    sessions_without_cash: {
      severity: "review",
      category: "clinician_review",
      nextAction: "Check whether payments will arrive later or whether an export is missing.",
    },
    cash_without_sessions: {
      severity: "review",
      category: "clinician_review",
      nextAction: "Check the appointment status export and trailing payment evidence.",
    },
    old_service_payment: {
      severity: "review",
      category: "trailing_payments",
      nextAction: "Confirm whether the delayed payment belongs in this pay period statement.",
    },
    payment_export_gap: {
      severity: "review",
      category: "reconciliation",
      nextAction: "Compare payment export totals against income allocation.",
    },
    insurance_allocation_gap: {
      severity: "review",
      category: "reconciliation",
      nextAction: "Compare payer allocation totals against insurance income.",
    },
    insurance_report_gap: {
      severity: "review",
      category: "reconciliation",
      nextAction: "Compare insurance report totals against insurance income.",
    },
  };
  return metadata[type] || {
    severity: "info",
    category: "general",
    nextAction: "Review this item before final export.",
  };
}

function warningId(warning, index = 0) {
  return `warning-${hashText([
    warning.type,
    warning.clinician,
    warning.message,
    warning.amount,
    index,
  ].filter(Boolean).join("|"))}`;
}

function severityLabel(severity) {
  const labels = {
    blocker: "Blocker",
    review: "Review",
    info: "Info",
  };
  return labels[severity] || "Info";
}

function categoryLabel(category) {
  const labels = {
    pay_rules: "Pay rules",
    clinician_review: "Clinician review",
    trailing_payments: "Trailing payments",
    reconciliation: "Reconciliation",
    general: "General",
  };
  return labels[category] || formatWarningType(category);
}

function warningCounts(warnings) {
  return warnings.reduce((counts, warning) => {
    counts[warning.severity] = (counts[warning.severity] || 0) + 1;
    return counts;
  }, { blocker: 0, review: 0, info: 0 });
}

function unreviewedWarnings(warnings) {
  return warnings.filter((warning) => !isWarningReviewed(warning));
}

function isWarningReviewed(warning) {
  return Boolean(state.warningReviews[warning.id]);
}

function pruneWarningReviews(reviews, warnings) {
  const validIds = new Set(warnings.map((warning) => warning.id));
  return Object.fromEntries(Object.entries(reviews || {}).filter(([id]) => validIds.has(id)));
}

function renderWarningOverview(warnings = []) {
  if (!elements.warningOverview) return;
  if (!warnings.length) {
    elements.warningOverview.innerHTML = `<div class="success-state">No warning-level issues found for this run.</div>`;
    return;
  }

  const counts = warningCounts(warnings);
  elements.warningOverview.innerHTML = `
    <div class="summary-strip">
      <button class="summary-chip" type="button" data-open-warnings data-filter-severity="blocker">
        <span>Blocker</span>
        <strong>${counts.blocker}</strong>
      </button>
      <button class="summary-chip" type="button" data-open-warnings data-filter-severity="review">
        <span>Review</span>
        <strong>${counts.review}</strong>
      </button>
      <button class="summary-chip" type="button" data-open-warnings data-filter-status="unreviewed">
        <span>Unreviewed</span>
        <strong>${unreviewedWarnings(warnings).length}</strong>
      </button>
    </div>`;

  for (const button of elements.warningOverview.querySelectorAll("[data-open-warnings]")) {
    button.addEventListener("click", () => {
      state.warningFilters.severity = button.dataset.filterSeverity || "all";
      state.warningFilters.status = button.dataset.filterStatus || "all";
      openWarningDrawer();
    });
  }
}

function largestReconciliationGap(report) {
  if (!report) return 0;
  return Math.max(
    Math.abs(Number(report.reconciliation.paymentExportDifference || 0)),
    Math.abs(Number(report.reconciliation.insurancePayerAllocationDifference || 0)),
    Math.abs(Number(report.reconciliation.insuranceReportDifference || 0)),
  );
}

function metricHtml(label, value, note) {
  return `<div class="metric" title="${escapeHtml(note)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div>`;
}

function reportMetricHtml(metric) {
  return metricHtml(metric.label, metric.value, metric.note);
}

function payrollTotalReportMetrics(report, warnings) {
  const unresolvedWarnings = unreviewedWarnings(warnings);
  return [
    { label: "Gross income", value: formatMoney(report.contributionPnl.revenue), note: "SimplePractice income allocation" },
    { label: "Clinician compensation", value: formatMoney(report.contributionPnl.clinicianCompensation), note: "Calculated payroll from active clinician pay rules" },
    { label: "Processing fees", value: formatMoney(report.contributionPnl.processingFees), note: stripeFeeNote(report) },
    { label: "Contribution result", value: formatMoney(report.contributionPnl.contributionResult), note: report.contributionPnl.fullPnlStatus },
    { label: "Unresolved warnings", value: unresolvedWarnings.length, note: "Warnings not marked reviewed for this run" },
    {
      label: "Trailing payments",
      value: formatMoney(report.trailingPayments.amount),
      note: `${report.trailingPayments.count} payment${report.trailingPayments.count === 1 ? "" : "s"} outside the current service period or missing service dates`,
    },
    {
      label: "Unpaid balances",
      value: formatMoney(report.ledgerReview.unpaidAppointmentBalance),
      note: "Appointment rows with unpaid balances and no matched payment in this pay period",
    },
  ];
}

function reconciliationReportMetrics(report) {
  return [
    { label: "Income allocation", value: formatMoney(report.reconciliation.incomeAllocationTotal), note: "Pay-period report total" },
    optionalReportMetric("Payment export", report.reconciliation.paymentExportTotal, report.reconciliation.paymentExportAvailable, differenceText(report.reconciliation.paymentExportDifference), paymentExportUnavailableNote()),
    optionalReportMetric("Insurance allocation", report.reconciliation.insurancePayerAllocationTotal, report.reconciliation.insurancePayerAllocationAvailable, differenceText(report.reconciliation.insurancePayerAllocationDifference), insuranceAllocationUnavailableNote()),
    optionalReportMetric("Insurance report", report.reconciliation.insurancePaymentReportTotal, report.reconciliation.insurancePaymentReportAvailable, differenceText(report.reconciliation.insuranceReportDifference), insuranceReportUnavailableNote()),
    optionalReportMetric("Stripe gross payments", report.reconciliation.stripeGrossPayments, report.reconciliation.stripeGrossPaymentsAvailable, "From SimplePractice payment export", stripeGrossUnavailableNote(report)),
    optionalReportMetric("Stripe deposits", report.reconciliation.stripeDeposits, report.reconciliation.cardTransactionsAvailable, "Bank payout total by available date", cardTransactionsUnavailableNote()),
    optionalReportMetric("Stripe payout gap", report.reconciliation.stripePayoutGap, report.reconciliation.stripePayoutGapAvailable, stripeGapNote(report), stripeGapUnavailableNote(report)),
  ];
}

function optionalReportMetric(label, value, available, note, unavailableNote) {
  return {
    label,
    value: available ? formatMoney(value) : "Unavailable",
    note: available ? note : unavailableNote,
  };
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
  return "Unavailable: import Card Transactions with Fee rows, or import Payment Export rows where Payment type is Stripe so fees can be estimated.";
}

function paymentExportUnavailableNote() {
  return "Unavailable: import the SimplePractice Payment Export for the same paid-date range to compare total collections and unlock Stripe gross payments.";
}

function insuranceAllocationUnavailableNote() {
  return "Unavailable: import the Insurance Payer Allocation export for this pay period with Clinician, Payer, and Amount columns.";
}

function insuranceReportUnavailableNote() {
  return "Unavailable: import the Insurance Payment Report filtered by received date for this pay period.";
}

function cardTransactionsUnavailableNote() {
  return "Unavailable: import the Card Transactions report with Amount, Fee, Net, and Available On columns.";
}

function stripeGrossUnavailableNote(report) {
  return report.reconciliation.paymentExportAvailable
    ? "Unavailable: Payment Export is loaded, but no rows with Payment type = Stripe were found. Confirm card/client payments are included."
    : "Unavailable: import the SimplePractice Payment Export. Rows with Payment type = Stripe unlock gross card payments.";
}

function stripeGapNote(report) {
  return report.reconciliation.stripeFeesAreKnown
    ? "Should roughly match known fees"
    : "May be fees plus payout timing";
}

function stripeGapUnavailableNote(report) {
  if (!report.reconciliation.cardTransactionsAvailable && !report.reconciliation.paymentExportAvailable) {
    return "Unavailable: import Card Transactions plus Payment Export rows where Payment type is Stripe.";
  }
  if (!report.reconciliation.cardTransactionsAvailable) return "Unavailable: import Card Transactions to compare bank payout deposits.";
  if (!report.reconciliation.paymentExportAvailable) return "Unavailable: import Payment Export with Payment type = Stripe rows.";
  return "Unavailable: Payment Export is loaded, but Stripe gross payment rows were not found.";
}

function clinicianCardHtml(clinician) {
  const payHelp = `Calculated payroll amount owed to ${clinician.name}. ${clinician.pay.explanation}.`;
  const cashHelp = `Money received and attributed to ${clinician.name} during this pay period. This is source cash before the clinician pay rule is applied.`;
  const reviewCount = clinician.trailingPayments.length
    + clinician.splitPaymentRows.length
    + clinician.unmatchedPayments.length
    + clinician.unmatchedAppointments.length;
  return `
    <article class="clinician-card">
      <div class="clinician-card-main">
        <div>
          <h3>${escapeHtml(clinician.name)}</h3>
          <p>${escapeHtml(clinician.pay.explanation)}</p>
        </div>
        <button class="mini-button" type="button" data-statement="${escapeHtml(clinician.name)}">Statement</button>
      </div>
      <div class="clinician-card-metrics">
        <div title="${escapeHtml(payHelp)}"><span>Pay</span><strong>${formatMoney(clinician.pay.total)}</strong></div>
        <div title="${escapeHtml(cashHelp)}"><span>Cash</span><strong>${formatMoney(clinician.cashReceived.total)}</strong></div>
        <div><span>Sessions</span><strong>${clinician.sessionCounts.total}</strong></div>
        <div><span>Review</span><strong>${reviewCount}</strong></div>
      </div>
      <details class="clinician-detail">
        <summary>Review details</summary>
        <div class="review-chip-grid">
          ${clinicianReviewHtml(clinician)}
        </div>
        ${sessionCountSummaryHtml(clinician)}
      </details>
    </article>`;
}

function clinicianReviewHtml(clinician) {
  return `
    <span>Trailing ${clinician.trailingPayments.length}</span>
    <span>Split ${clinician.splitPaymentRows.length}</span>
    <span>Unmatched pay ${clinician.unmatchedPayments.length}</span>
    <span>Open appts ${clinician.unmatchedAppointments.length}</span>`;
}

function sessionCountSummaryHtml(clinician) {
  const counts = clinician.sessionCounts;
  return `
    <p class="session-summary">
      Individual ${counts.individual}, couples/family ${counts.couplesFamily}, group ${counts.group}, intake ${counts.intake}, other ${counts.other}.
    </p>`;
}

function exportStatementPacketPdf() {
  if (!state.report) return;
  const clinicians = Object.values(state.report.clinicians);
  if (!confirmExport("Export Statements PDF", clinicians.length)) return;
  openStatements(clinicians, state.report);
  setActionStatus("PDF-ready clinician statement packet opened. Choose Save as PDF in the print dialog.", "success");
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
          :root {
            --ink: #1f2528;
            --muted: #687276;
            --line: #d8dedc;
            --paper: #fbfaf6;
            --panel: #ffffff;
            --field: #f4f7f6;
            --green: #1f7a5a;
            --green-dark: #155f46;
            --blue: #305f87;
            --blue-soft: #eaf2f8;
            --amber: #a76522;
            --shadow: 0 14px 34px rgba(45, 58, 56, 0.12);
          }
          * { box-sizing: border-box; }
          html { background: var(--paper); }
          body {
            margin: 0;
            color: var(--ink);
            background:
              linear-gradient(180deg, rgba(31, 122, 90, 0.12), transparent 260px),
              var(--paper);
            font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 13px;
            letter-spacing: 0;
            -webkit-font-smoothing: antialiased;
          }
          .print-bar {
            position: sticky;
            top: 0;
            z-index: 5;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 18px;
            color: #fff;
            background: var(--green-dark);
            border-bottom: 3px solid var(--amber);
            font-size: 12px;
            font-weight: 820;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            box-shadow: 0 8px 20px rgba(21, 95, 70, 0.2);
          }
          .clinician-document {
            break-after: page;
            width: min(940px, calc(100vw - 24px));
            max-width: 100%;
            margin: 24px auto;
            padding: 0 28px 28px;
            overflow-x: hidden;
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 8px;
            box-shadow: var(--shadow);
          }
          .clinician-document > header {
            margin: 0 -28px 22px;
            padding: 26px 28px 24px;
            color: #fff;
            background: linear-gradient(135deg, var(--green-dark), var(--green) 58%, var(--blue));
            border-bottom: 4px solid var(--amber);
          }
          .clinician-document > header p { color: rgba(255, 255, 255, 0.82); }
          .eyebrow { margin: 0 0 8px; color: #eaf4ef; font-size: 10px; font-weight: 850; letter-spacing: 0.08em; text-transform: uppercase; }
          h1 { margin: 0; font-size: 30px; line-height: 1.05; }
          h2 {
            display: flex;
            align-items: center;
            gap: 9px;
            margin: 26px 0 10px;
            color: var(--green-dark);
            font-size: 15px;
            line-height: 1.2;
          }
          h2::before { content: ""; width: 4px; height: 18px; background: var(--amber); }
          p { margin: 4px 0; line-height: 1.45; }
          section { min-width: 0; max-width: 100%; overflow-x: auto; }
          .summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 18px 0 20px; }
          .summary-grid div { min-height: 74px; border: 1px solid var(--line); border-left: 4px solid var(--green); border-radius: 8px; padding: 11px 12px; background: var(--paper); }
          .summary-grid div:nth-child(3n) { border-left-color: var(--blue); }
          .summary-grid div:nth-child(5n) { border-left-color: var(--amber); }
          .summary-grid span { display: block; color: var(--muted); font-size: 10px; font-weight: 850; text-transform: uppercase; }
          .summary-grid strong { display: block; margin-top: 8px; font-size: 19px; line-height: 1.18; overflow-wrap: anywhere; }
          table { width: 100%; min-width: 640px; border: 1px solid var(--line); border-collapse: separate; border-spacing: 0; background: #fff; }
          th, td { padding: 8px 9px; border-bottom: 1px solid #e8ecea; text-align: left; vertical-align: top; line-height: 1.32; }
          th { color: #fff; background: var(--green-dark); font-size: 10px; font-weight: 850; text-transform: uppercase; }
          tbody tr:nth-child(even) td { background: var(--field); }
          tbody tr:last-child td { border-bottom: 0; }
          .number { text-align: right; white-space: nowrap; }
          .payment-tabs { display: grid; gap: 10px; max-width: 100%; min-width: 0; }
          .payment-tab-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: 8px; max-width: 100%; min-width: 0; }
          .payment-tab {
            display: inline-flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            width: 100%;
            min-width: 0;
            border: 1px solid #c7dbd4;
            border-radius: 8px;
            background: var(--field);
            color: var(--green-dark);
            padding: 7px 11px;
            font: inherit;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
            overflow-wrap: anywhere;
            white-space: normal;
          }
          .payment-tab[aria-selected="true"] { background: var(--green); border-color: var(--green); color: #fff; }
          .payment-tab span {
            flex: 0 0 auto;
            min-width: 22px;
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.72);
            color: var(--green-dark);
            padding: 2px 7px;
            font-size: 12px;
            text-align: center;
          }
          .payment-tab[aria-selected="true"] span { background: rgba(255, 255, 255, 0.9); }
          .payment-panel { max-width: 100%; overflow-x: auto; }
          .payment-panel[hidden] { display: none; }
          @media (max-width: 700px) {
            .clinician-document { width: calc(100vw - 16px); margin: 8px auto; padding: 0 18px 20px; }
            .clinician-document > header { margin: 0 -18px 18px; padding: 22px 18px; }
            h1 { font-size: 24px; }
            .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          }
          @page { margin: 0.45in; }
          @media print {
            body { background: #fff; }
            .print-bar { display: none; }
            .clinician-document { width: auto; margin: 0; padding: 0 0 22px; border: 0; border-radius: 0; max-width: none; box-shadow: none; overflow: visible; }
            .clinician-document > header { margin: 0 0 18px; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            .payment-tab-list { display: none; }
            .payment-panel { overflow: visible; }
            .summary-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
            .summary-grid div, th { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            table { min-width: 0; font-size: 10px; }
            th, td { padding: 6px; }
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

function openFullReport() {
  if (!state.report) return;
  openFullReportWindow({ autoPrint: false });
}

function exportResultsPdf() {
  if (!state.report) return;
  if (!confirmExport("Export PDF", 1)) return;
  openFullReportWindow({ autoPrint: true });
  setActionStatus("PDF-ready report opened. Choose Save as PDF in the print dialog.", "success");
}

function openFullReportWindow({ autoPrint = false } = {}) {
  const html = fullReportPage(state.report, payrollWarnings(state.report));
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (autoPrint) {
      setActionStatus("PDF report opened in a new tab. Use the browser print menu to save it as PDF.", "success");
    }
    return;
  }

  reportWindow.document.open();
  reportWindow.document.write(html);
  reportWindow.document.close();
  reportWindow.focus();
  if (autoPrint) {
    setTimeout(() => reportWindow.print(), 300);
  }
}

function fullReportPage(report, warnings) {
  const mainMetrics = payrollTotalReportMetrics(report, warnings).map(reportMetricHtml).join("");
  const reconciliationMetrics = reconciliationReportMetrics(report).map(reportMetricHtml).join("");
  const clinicianRows = Object.values(report.clinicians)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((clinician) => `
      <tr>
        <td>${escapeHtml(clinician.name)}</td>
        <td class="number">${formatMoney(clinician.pay.total)}</td>
        <td class="number">${formatMoney(clinician.cashReceived.total)}</td>
        <td class="number">${clinician.sessionCounts.total}</td>
        <td>${escapeHtml(clinician.pay.explanation)}</td>
      </tr>`)
    .join("");
  const warningRows = warnings
    .map((warning) => `
      <tr>
        <td>${escapeHtml(warning.severityLabel)}</td>
        <td>${escapeHtml(warning.categoryLabel)}</td>
        <td>${escapeHtml(warning.clinician || "")}</td>
        <td>${escapeHtml(warning.message)}</td>
        <td>${escapeHtml(warning.nextAction)}</td>
      </tr>`)
    .join("");

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Payroll Full Report ${escapeHtml(report.period.start)} to ${escapeHtml(report.period.end)}</title>
        <style>
          :root {
            --ink: #1f2528;
            --muted: #687276;
            --line: #d8dedc;
            --paper: #fbfaf6;
            --panel: #ffffff;
            --field: #f4f7f6;
            --green: #1f7a5a;
            --green-dark: #155f46;
            --blue: #305f87;
            --amber: #a76522;
            --shadow: 0 14px 34px rgba(45, 58, 56, 0.12);
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            color: var(--ink);
            background:
              linear-gradient(180deg, rgba(31, 122, 90, 0.12), transparent 280px),
              var(--paper);
            font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            font-size: 13px;
            letter-spacing: 0;
            -webkit-font-smoothing: antialiased;
          }
          main { width: min(1160px, calc(100vw - 32px)); margin: 0 auto; padding: 24px 0 44px; }
          header {
            margin-bottom: 24px;
            padding: 28px 30px;
            color: #fff;
            background: linear-gradient(135deg, var(--green-dark), var(--green) 58%, var(--blue));
            border-bottom: 4px solid var(--amber);
            border-radius: 8px;
            box-shadow: var(--shadow);
          }
          .eyebrow { margin: 0 0 8px; color: #eaf4ef; font-size: 10px; font-weight: 850; letter-spacing: 0.08em; text-transform: uppercase; }
          h1 { margin: 0; font-size: 32px; line-height: 1.05; }
          h2 {
            display: flex;
            align-items: center;
            gap: 9px;
            margin: 30px 0 12px;
            color: var(--green-dark);
            font-size: 16px;
            line-height: 1.2;
          }
          h2::before { content: ""; width: 4px; height: 19px; background: var(--amber); }
          .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; }
          .metric { min-height: 86px; border: 1px solid var(--line); border-left: 4px solid var(--green); background: #fff; border-radius: 8px; padding: 12px 13px; box-shadow: 0 4px 12px rgba(45, 58, 56, 0.06); }
          .metric:nth-child(3n) { border-left-color: var(--blue); }
          .metric:nth-child(5n) { border-left-color: var(--amber); }
          .metric span { display: block; color: var(--muted); font-size: 10px; font-weight: 850; text-transform: uppercase; }
          .metric strong { display: block; margin-top: 8px; font-size: 22px; line-height: 1.15; overflow-wrap: anywhere; }
          .metric small { display: block; margin-top: 6px; color: var(--muted); font-size: 11px; line-height: 1.35; }
          .report-note { margin: 10px 0 0; color: rgba(255, 255, 255, 0.82); font-size: 12px; line-height: 1.45; }
          .table-wrap { overflow-x: auto; border: 1px solid var(--line); background: #fff; border-radius: 8px; box-shadow: 0 4px 12px rgba(45, 58, 56, 0.06); }
          table { width: 100%; min-width: 760px; border-collapse: separate; border-spacing: 0; }
          th, td { padding: 9px 10px; border-bottom: 1px solid #edf0ef; text-align: left; vertical-align: top; line-height: 1.32; }
          th { color: #fff; background: var(--green-dark); font-size: 10px; font-weight: 850; text-transform: uppercase; }
          tbody tr:nth-child(even) td { background: var(--field); }
          tbody tr:last-child td { border-bottom: 0; }
          .number { text-align: right; white-space: nowrap; }
          @page { margin: 0.45in; }
          @media print {
            body { background: #fff; }
            main { width: auto; padding: 0; }
            header { border-radius: 0; box-shadow: none; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            h2 { break-after: avoid; }
            .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .metric { break-inside: avoid; box-shadow: none; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            .table-wrap { overflow: visible; }
            table { min-width: 0; font-size: 11px; }
            th { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
            th, td { padding: 6px; }
          }
        </style>
      </head>
      <body>
        <main>
          <header>
            <p class="eyebrow">Clinic payroll full report</p>
            <h1>${escapeHtml(report.period.start)} to ${escapeHtml(report.period.end)}</h1>
            <p class="report-note">Generated locally from the current extension draft. Use the browser print dialog to save this report as a PDF.</p>
          </header>
          <section>
            <h2>Payroll Totals</h2>
            <div class="metric-grid">${mainMetrics}</div>
          </section>
          <section>
            <h2>Reconciliation</h2>
            <div class="metric-grid">${reconciliationMetrics}</div>
          </section>
          <section>
            <h2>Warnings</h2>
            <div class="table-wrap"><table>
              <thead><tr><th>Severity</th><th>Category</th><th>Clinician</th><th>Warning</th><th>Next action</th></tr></thead>
              <tbody>${warningRows || `<tr><td colspan="5">No warning-level issues found for this run.</td></tr>`}</tbody>
            </table></div>
          </section>
          <section>
            <h2>Clinicians</h2>
            <div class="table-wrap"><table>
              <thead><tr><th>Clinician</th><th>Pay</th><th>Cash</th><th>Sessions</th><th>Method</th></tr></thead>
              <tbody>${clinicianRows}</tbody>
            </table></div>
          </section>
        </main>
      </body>
    </html>`;
}

function downloadSummaryCsv() {
  if (!state.report) return;
  if (!confirmExport("Download CSV", Object.keys(state.report.clinicians).length)) return;

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
  const fileName = `clinic-payroll-${state.report.period.start}-to-${state.report.period.end}.csv`;
  downloadTextFile(fileName, csv);
  setActionStatus(`Downloaded ${fileName}.`, "success");
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
  if (!confirmExport("Download Clinician ZIP", clinicians.length)) return;

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

  const fileName = `clinician-pay-statements-${state.report.period.start}-to-${state.report.period.end}.zip`;
  downloadZipFile(fileName, files);
  setActionStatus(`Downloaded ${fileName} with ${files.length} clinician file${files.length === 1 ? "" : "s"}.`, "success");
}

function downloadLedgerCsvs() {
  if (!state.report) return;
  if (!confirmExport("Download Ledger ZIP", 5)) return;

  const exports = generateReportCsvExports(state.report);
  const filePrefix = `clinic-payroll-${state.report.period.start}-to-${state.report.period.end}`;
  const files = [
    ["appointment-ledger", exports.appointmentLedger],
    ["payment-ledger", exports.paymentLedger],
    ["split-payment-detail", exports.splitPaymentDetail],
    ["outlier-payments", exports.outlierPayments],
    ["contribution-pnl", exports.contributionPnl],
  ];

  const fileName = `${filePrefix}-ledgers.zip`;
  const zipFiles = files.map(([name, csv]) => ({
      name: `${filePrefix}-${name}.csv`,
      text: csv,
    }));
  downloadZipFile(fileName, zipFiles);
  setActionStatus(`Downloaded ${fileName} with ${zipFiles.length} ledger file${zipFiles.length === 1 ? "" : "s"}.`, "success");
}

function confirmExport(actionLabel, itemCount) {
  const warnings = payrollWarnings(state.report);
  const unresolvedBlockers = warnings.filter((warning) => warning.severity === "blocker" && !isWarningReviewed(warning));
  if (unresolvedBlockers.length === 0) return true;

  const topBlockers = unresolvedBlockers
    .slice(0, 3)
    .map((warning) => `- ${warning.message}`)
    .join("\n");
  return window.confirm(
    `${actionLabel} will create ${itemCount} item${itemCount === 1 ? "" : "s"}, but ${unresolvedBlockers.length} blocker warning${unresolvedBlockers.length === 1 ? "" : "s"} remain unreviewed.\n\n${topBlockers}\n\nContinue anyway?`,
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
    const dataBytes = zipFileDataBytes(file, encoder);
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

function zipFileDataBytes(file, encoder) {
  if (file.bytes instanceof Uint8Array) return file.bytes;
  if (file.bytes instanceof ArrayBuffer) return new Uint8Array(file.bytes);
  if (ArrayBuffer.isView(file.bytes)) {
    return new Uint8Array(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength);
  }
  return encoder.encode(file.text || "");
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
  elements.nextStepDetail.textContent = summary.nextStep;
  elements.importProgress.textContent = `${summary.importCount}/${importRoles.length}`;
  elements.rulesProgress.textContent = summary.clinicianCount
    ? `${summary.readyRules}/${summary.clinicianCount}`
    : "0";
  elements.resultsProgress.textContent = summary.resultsCalculated ? "Done" : "None";
  document.body.dataset.mode = summary.resultsCalculated ? "review" : "setup";
  renderPreflightPanel(summary.preflight);
  renderRunSummary(summary);
  updateSetupSections(summary);
  renderImportChecklist();
  renderImportControls();
  updateCalculateButton(summary.preflight);
}

function guidanceSummary() {
  const importCount = importFileCount();
  const clinicianCount = state.clinicianNames.length;
  const readyRules = state.clinicianNames
    .filter((name) => {
      const contract = normalizeContract(state.contracts[name]);
      return contractValidation(contract, state.report?.clinicians[name]).state === "complete";
    })
    .length;
  const missingRules = Math.max(clinicianCount - readyRules, 0);
  const resultsCalculated = Boolean(state.resultsVisible && state.report && hasImportFiles());
  const preflight = buildPreflightReview();
  let stateName = "empty";
  let title = "Import SimplePractice exports";
  let detail = `${importCount} imports loaded. No clinicians loaded yet.`;
  let nextStep = "Next: choose the income allocation export.";

  if (importCount > 0) {
    stateName = "ready";
    title = "Imports loaded";
    detail = `${importCount} import${importCount === 1 ? "" : "s"} loaded. ${clinicianCount} clinician${clinicianCount === 1 ? "" : "s"} found.`;
    nextStep = "Next: review matched imports and confirm the pay period.";
  }

  if (clinicianCount > 0 && missingRules > 0) {
    stateName = "needs-rules";
    title = `${missingRules} pay rule${missingRules === 1 ? "" : "s"} need review`;
    detail = `${readyRules} of ${clinicianCount} clinician pay rules are set.`;
    nextStep = "Next: finish the pay rules marked Not configured, Missing rate, or Legacy rule.";
  }

  if (clinicianCount > 0 && missingRules === 0) {
    stateName = "ready";
    title = "Ready to calculate";
    detail = `${clinicianCount} clinician${clinicianCount === 1 ? "" : "s"} loaded and pay rules are set.`;
    nextStep = "Next: calculate payroll, then review warnings and reconciliation.";
  }

  if (preflight.blockers.length > 0) {
    stateName = preflight.blockers.some((issue) => issue.category === "rules") ? "needs-rules" : "empty";
    nextStep = `Next: ${preflight.blockers[0].action}`;
  }

  if (resultsCalculated) {
    stateName = "calculated";
    title = "Payroll results calculated";
    detail = `${clinicianCount} clinician${clinicianCount === 1 ? "" : "s"} included for ${elements.periodStart.value} to ${elements.periodEnd.value}.`;
    nextStep = "Next: review unresolved warnings, then print or download exports.";
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
    nextStep,
    preflight,
  };
}

function buildPreflightReview({ forceReport = false } = {}) {
  const blockers = [];
  const reviews = [];
  const infos = [];
  const periodStart = parseLooseDate(elements.periodStart.value);
  const periodEnd = parseLooseDate(elements.periodEnd.value);

  if (!periodStart || !periodEnd) {
    blockers.push(preflightIssue("dates", "Pay period dates are required.", "enter both pay-period dates"));
  } else if (periodEnd < periodStart) {
    blockers.push(preflightIssue("dates", "Pay period end must be after the start date.", "correct the pay-period dates"));
  }

  if (!state.files.incomeFile?.text) {
    blockers.push(preflightIssue("imports", "Income allocation export is required.", "import the income allocation export"));
  }

  if (!state.files.appointmentFile?.text) {
    reviews.push(preflightIssue("imports", "Appointment status export is recommended for session counts and session-based pay.", "import appointment status if any clinician is session-based"));
  }

  const report = forceReport || hasImportFiles() ? safeBuildReport() : state.report;
  const clinicians = report?.clinicians || {};
  if (state.files.incomeFile?.text && Object.keys(clinicians).length === 0) {
    blockers.push(preflightIssue("imports", "No clinicians were found for this pay period.", "check the dates or the selected income allocation export"));
  }

  for (const [name, clinician] of Object.entries(clinicians)) {
    const validation = contractValidation(normalizeContract(state.contracts[name]), clinician);
    if (validation.state !== "complete") {
      blockers.push(preflightIssue("rules", `${name}: ${validation.badge}. ${validation.message}`, "finish incomplete clinician pay rules"));
    }
  }

  for (const role of importRoles.filter((item) => item.requirement === "optional" && !state.files[item.inputId]?.text)) {
    infos.push(preflightIssue("imports", `${role.label} not imported.`, "continue without optional reconciliation or add the export"));
  }

  return { blockers, reviews, infos };
}

function preflightIssue(category, message, action) {
  return { category, message, action };
}

function safeBuildReport() {
  try {
    return buildReport();
  } catch {
    return null;
  }
}

function renderPreflightPanel(preflight, { forceVisible = false } = {}) {
  const visibleIssues = [...preflight.blockers, ...preflight.reviews];
  if (!forceVisible && visibleIssues.length === 0) {
    elements.preflightPanel.classList.add("hidden");
    elements.preflightList.innerHTML = "";
    return;
  }

  elements.preflightPanel.classList.remove("hidden");
  elements.preflightList.innerHTML = visibleIssues.length
    ? visibleIssues.map((issue) => `
      <div class="preflight-item" data-category="${escapeHtml(issue.category)}">
        <strong>${escapeHtml(issue.message)}</strong>
        <span>Next action: ${escapeHtml(issue.action)}.</span>
      </div>`).join("")
    : `<div class="success-state">Preflight checks are clear.</div>`;
}

function renderRunSummary(summary) {
  if (!summary.resultsCalculated) {
    elements.runSummaryPanel.classList.add("hidden");
    elements.runSummaryGrid.innerHTML = "";
    return;
  }

  const warnings = payrollWarnings(state.report);
  elements.runSummaryPanel.classList.remove("hidden");
  elements.runSummaryDetail.textContent = "Setup is collapsed while you review calculated payroll. Use Edit to reopen a setup section.";
  elements.runSummaryGrid.innerHTML = [
    runSummaryItemHtml("Pay period", `${elements.periodStart.value} to ${elements.periodEnd.value}`, "period"),
    runSummaryItemHtml("Imports", `${summary.importCount} loaded`, "imports"),
    runSummaryItemHtml("Pay rules", `${summary.readyRules}/${summary.clinicianCount} complete`, "rules"),
    runSummaryItemHtml("Warnings", `${unreviewedWarnings(warnings).length} unresolved`, "warnings"),
  ].join("");

  for (const button of elements.runSummaryGrid.querySelectorAll("[data-edit-section]")) {
    button.addEventListener("click", () => {
      const section = button.dataset.editSection;
      if (section === "warnings") {
        openWarningDrawer();
        return;
      }
      state.activeSetupSection = state.activeSetupSection === section ? "" : section;
      renderGuidance();
      setupPanelForSection(section)?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }
}

function runSummaryItemHtml(label, value, section) {
  return `
    <div class="run-summary-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <button class="mini-button" type="button" data-edit-section="${escapeHtml(section)}">${section === "warnings" ? "Review" : "Edit"}</button>
    </div>`;
}

function updateSetupSections(summary) {
  const sections = {
    period: elements.periodPanel,
    imports: elements.importsPanel,
    rules: elements.contractsPanel,
  };
  for (const [section, panel] of Object.entries(sections)) {
    const shouldHide = summary.resultsCalculated && state.activeSetupSection !== section;
    panel.classList.toggle("hidden", shouldHide);
  }
}

function setupPanelForSection(section) {
  return {
    period: elements.periodPanel,
    imports: elements.importsPanel,
    rules: elements.contractsPanel,
  }[section] || null;
}

function renderImportChecklist() {
  elements.importChecklist.innerHTML = `
    <div class="import-review-list">
      ${importRoles.map(importReviewRowHtml).join("")}
    </div>
    ${importSkipSummaryHtml()}`;
}

function importReviewRowHtml(role) {
  const file = state.files[role.inputId];
  const isLoaded = Boolean(file?.name || file?.text);
  const assignment = state.importReview.assignments[role.inputId];
  const preview = importPreviewForRole(role.inputId, file);
  const options = importReviewFileOptions(assignment?.fileId);
  const stateLabel = isLoaded ? "Loaded" : role.badge;
  const matchReason = assignment?.matchReason || missingImportReason(role);
  const fileName = isLoaded ? file.name : role.emptyText;
  const fileNote = importReviewRowNote(role, isLoaded);

  return `
    <div class="import-review-row" data-state="${isLoaded ? "loaded" : "missing"}" data-priority="${escapeHtml(role.priority)}">
      <div class="import-role-cell">
        <span class="import-status-dot" aria-hidden="true"></span>
        <span>
          <strong>${escapeHtml(role.label)}</strong>
          <small>${escapeHtml(role.badge)}</small>
        </span>
      </div>
      <div class="import-file-cell">
        <span class="import-file-name">${escapeHtml(fileName)}</span>
        <small>${escapeHtml(fileNote)}</small>
        ${isLoaded ? importEvidenceHtml(matchReason, preview) : ""}
      </div>
      <div class="import-action-cell">
        ${options ? `
          <label class="import-reassign">
            <span>Assign</span>
            <select data-import-role="${escapeHtml(role.inputId)}">
              <option value="">Not selected</option>
              ${options}
            </select>
          </label>` : isLoaded ? `<span class="import-state-pill">${escapeHtml(stateLabel)}</span>` : ""}
      </div>
    </div>`;
}

function importReviewRowNote(role, isLoaded) {
  if (!isLoaded) return missingImportReason(role);
  if (role.requirement === "required") return "Ready for payroll totals.";
  if (role.requirement === "recommended") return "Ready for session counts and session-based rules.";
  return "Available for reconciliation and report detail.";
}

function importEvidenceHtml(matchReason, preview) {
  if (!matchReason && !preview) return "";
  return `
    <details class="import-evidence">
      <summary>Evidence</summary>
      <div class="import-evidence-body">
        ${matchReason ? `<p>${escapeHtml(matchReason)}</p>` : ""}
        ${preview ? importPreviewHtml(preview) : ""}
      </div>
    </details>`;
}

function importPreviewHtml(preview) {
  return `
    <dl class="import-preview">
      <div><dt>Rows</dt><dd>${preview.rowCount}</dd></div>
      <div><dt>Date range</dt><dd>${escapeHtml(preview.dateRange || "Not detected")}</dd></div>
      <div><dt>Headers</dt><dd>${escapeHtml(preview.headers.slice(0, 4).join(", ") || "Not detected")}</dd></div>
    </dl>`;
}

function importSkipSummaryHtml() {
  const skipped = state.importReview.skipped || emptyImportReview().skipped;
  const rows = [
    skipped.duplicates.length ? ["Duplicates", skipped.duplicates.map((item) => item.fileName).join(", ")] : null,
    skipped.unrecognized.length ? ["Unrecognized", skipped.unrecognized.map((item) => item.fileName).join(", ")] : null,
    skipped.lowerPriority.length ? ["Lower-priority candidates", skipped.lowerPriority.map((item) => item.fileName).join(", ")] : null,
    skipped.oversized.length ? ["Oversized", skipped.oversized.map((item) => item.fileName).join(", ")] : null,
    skipped.unsupported.length ? ["Unsupported format", skipped.unsupported.map((item) => item.fileName).join(", ")] : null,
    skipped.readErrors.length ? ["Read errors", skipped.readErrors.map((item) => item.fileName).join(", ")] : null,
    state.importReview.periodSuggestion ? ["Pay period suggestion", state.importReview.periodSuggestion] : null,
  ].filter(Boolean);

  if (!rows.length) return "";
  return `
    <details class="import-skip-summary">
      <summary>Skipped files and import notes <span>${rows.length}</span></summary>
      <div class="import-skip-body">
        ${rows.map(([label, detail]) => `<p><span>${escapeHtml(label)}:</span> ${escapeHtml(detail)}</p>`).join("")}
      </div>
    </details>`;
}

function renderImportControls() {
  for (const role of importRoles) {
    updateFileControl(role.inputId);
  }
  if (elements.fileFallbackDetails) {
    elements.fileFallbackDetails.open = importFileCount() === 0 && state.importReview.files.length === 0;
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

async function handleImportAssignmentChange(event) {
  const inputId = event.target.dataset.importRole;
  if (!inputId) return;

  const selectedFile = state.importReview.files.find((file) => file.id === event.target.value);
  if (!selectedFile) {
    delete state.files[inputId];
    delete state.importReview.assignments[inputId];
  } else {
    state.files[inputId] = {
      name: selectedFile.name,
      text: selectedFile.text,
    };
    state.importReview.assignments[inputId] = {
      fileId: selectedFile.id,
      matchReason: "Manually reassigned from the import review panel.",
      source: "manual",
    };
  }

  clearFileInputLabels();
  renderManualFileLabels(state.files);
  await refreshCliniciansFromImports();
  await persistDraft();
  setActionStatus("Import assignment updated.", "success");
}

function emptyImportReview() {
  return {
    files: [],
    assignments: {},
    skipped: {
      duplicates: [],
      unrecognized: [],
      lowerPriority: [],
      oversized: [],
      unsupported: [],
      readErrors: [],
    },
    periodSuggestion: "",
  };
}

function buildImportReview({ fileRecords = [], result = {}, importPlan = {}, readErrors = [], unsupportedFiles = [], source = "bulk" } = {}) {
  const review = emptyImportReview();
  const uniqueRecords = dedupeImportRecords(fileRecords);
  review.files = uniqueRecords.map((file, index) => importReviewFileRecord(file, index));

  for (const [inputId, file] of Object.entries(result.assignments || {})) {
    const role = importRoles.find((item) => item.inputId === inputId);
    const fileId = importReviewFileId(file);
    review.assignments[inputId] = {
      fileId,
      matchReason: `${source === "bulk" ? "Matched" : "Assigned"} as ${role?.label || "an import"} using file name and header evidence.`,
      source,
    };
  }

  const duplicateFingerprints = new Set((result.duplicates || []).map((duplicate) => importReviewFileId(duplicate.file)));
  review.skipped.duplicates = (result.duplicates || []).map((duplicate) => ({
    fileName: duplicate.file.name,
    reason: `Duplicate of ${duplicate.duplicateOf?.name || "another selected export"}.`,
  }));
  review.skipped.unrecognized = (result.unmatched || [])
    .filter((file) => !duplicateFingerprints.has(importReviewFileId(file)))
    .map((file) => ({
      fileName: file.name,
      reason: "Headers and file name did not match a supported SimplePractice export.",
    }));
  review.skipped.lowerPriority = (importPlan.skipped || []).map((file) => ({
    fileName: file.name,
    reason: "Skipped after higher-priority candidates were selected for scanning.",
  }));
  review.skipped.oversized = (importPlan.oversized || []).map((file) => ({
    fileName: file.name,
    reason: "File exceeded the safe per-file scan limit.",
  }));
  review.skipped.unsupported = (unsupportedFiles || []).map((file) => ({
    fileName: file.name,
    reason: "Only CSV, XLSX, and XLS exports are supported.",
  }));
  review.skipped.readErrors = (readErrors || []).map(({ file, error }) => ({
    fileName: file?.name || "Unreadable file",
    reason: errorMessage(error),
  }));

  return review;
}

function dedupeImportRecords(files) {
  const byId = new Map();
  for (const file of files || []) {
    if (!file?.name && !file?.text) continue;
    byId.set(importReviewFileId(file), file);
  }
  return [...byId.values()];
}

function upsertImportReviewFile(fileRecord) {
  const file = importReviewFileRecord(fileRecord, state.importReview.files.length);
  const existingIndex = state.importReview.files.findIndex((candidate) => candidate.id === file.id);
  if (existingIndex >= 0) {
    state.importReview.files[existingIndex] = file;
    return;
  }
  state.importReview.files.push(file);
}

function importReviewFileRecord(file, index = 0) {
  return {
    id: importReviewFileId(file, index),
    name: String(file.name || "Imported file"),
    text: String(file.text || ""),
  };
}

function importReviewFileId(file) {
  return `file-${hashText(`${file?.name || ""}\n${String(file?.text || "").slice(0, 500)}`)}`;
}

function importReviewFileOptions(selectedId = "") {
  if (!state.importReview.files.length) return "";
  return state.importReview.files
    .map((file) => `<option value="${escapeHtml(file.id)}"${file.id === selectedId ? " selected" : ""}>${escapeHtml(file.name)}</option>`)
    .join("");
}

function importPreviewForRole(inputId, file) {
  if (!file?.text) return null;
  const role = importRoles.find((item) => item.inputId === inputId);
  const rows = parseCsv(file.text);
  const headers = rows[0] ? Object.keys(rows[0]).map((header) => header.replace(/__\d+$/, "")) : firstCsvHeaders(file.text);
  const dateRange = role?.dateField ? dateRangeForRows(rows, role.dateField) : "";
  return {
    rowCount: rows.length,
    headers,
    dateRange,
  };
}

function missingImportReason(role) {
  if (role.requirement === "required") return "Required before payroll can be calculated.";
  if (role.requirement === "recommended") return "Recommended for session counts and session-based pay rules.";
  return "Optional reconciliation evidence. Payroll can run without it.";
}

function dateRangeForRows(rows, field) {
  const values = rows
    .map((row) => parseLooseDate(row[field]))
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (!values.length) return "";
  return `${dateInputValue(values[0])} to ${dateInputValue(values[values.length - 1])}`;
}

function firstCsvHeaders(text) {
  const firstLine = String(text || "").split(/\r?\n/, 1)[0] || "";
  return firstLine.split(",").map((header) => header.replace(/^"|"$/g, "").trim()).filter(Boolean);
}

function parseLooseDate(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) return new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]));
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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
  state.importReview = sanitizeImportReview(restoredDraft.importReview, state.files);
  state.contracts = normalizeContractsMap({
    ...(restoredDraft.contracts || {}),
    ...state.contracts,
  });
  state.warningReviews = restoredDraft.warningReviews || {};
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
    importReview: sanitizeImportReview(state.importReview, state.files),
    contracts: normalizeContractsMap(state.contracts),
    resultsVisible: state.resultsVisible,
    warningReviews: state.warningReviews,
    savedAt: new Date().toISOString(),
  };
}

function scheduleDraftSave() {
  window.clearTimeout(draftSaveTimer);
  setAutosaveStatus("Saving local draft...");
  draftSaveTimer = window.setTimeout(() => {
    draftSaveTimer = null;
    persistDraft().catch((error) => {
      setActionStatus(`Could not save draft: ${error.message || error}`, "error");
    });
  }, DRAFT_SAVE_DELAY_MS);
}

function scheduleContractSave() {
  window.clearTimeout(contractSaveTimer);
  setAutosaveStatus("Saving clinician rules...");
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
  setAutosaveStatus(`Rules saved locally at ${timeLabel(new Date())}.`);
}

async function persistDraft() {
  if (draftSaveTimer) {
    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
  }
  await storageSet(DRAFT_STORAGE_KEY, serializeDraft());
  setAutosaveStatus(`Draft saved locally at ${timeLabel(new Date())}.`);
}

function setAutosaveStatus(message) {
  elements.autosaveStatus.textContent = message;
}

function timeLabel(date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
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

function sanitizeImportReview(importReview, files = state.files) {
  const review = emptyImportReview();
  const storedFiles = sanitizeStoredFiles(files);
  const availableFiles = Array.isArray(importReview?.files)
    ? importReview.files
    : Object.values(storedFiles);

  review.files = dedupeImportRecords(availableFiles).map(importReviewFileRecord);
  const availableIds = new Set(review.files.map((file) => file.id));

  for (const [inputId, assignment] of Object.entries(importReview?.assignments || {})) {
    if (!fileKeys[inputId]) continue;
    const storedFile = storedFiles[inputId];
    const fileId = assignment?.fileId || (storedFile ? importReviewFileId(storedFile) : "");
    if (!fileId || !availableIds.has(fileId)) continue;
    review.assignments[inputId] = {
      fileId,
      matchReason: String(assignment.matchReason || "Restored from the saved local draft."),
      source: String(assignment.source || "restored"),
    };
  }

  for (const [inputId, storedFile] of Object.entries(storedFiles)) {
    if (review.assignments[inputId]) continue;
    const fileId = importReviewFileId(storedFile);
    if (!availableIds.has(fileId)) continue;
    review.assignments[inputId] = {
      fileId,
      matchReason: "Restored from the saved local draft.",
      source: "restored",
    };
  }

  const skipped = importReview?.skipped || {};
  for (const key of Object.keys(review.skipped)) {
    review.skipped[key] = Array.isArray(skipped[key])
      ? skipped[key].map((item) => ({
          fileName: String(item.fileName || "File"),
          reason: String(item.reason || ""),
        }))
      : [];
  }
  review.periodSuggestion = String(importReview?.periodSuggestion || "");

  return review;
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
  state.isBusy = isBusy;
  updateCalculateButton();
  elements.resetButton.disabled = isBusy;
  elements.openImporterButton.disabled = isBusy;
  elements.bulkFilesInput.disabled = isBusy;
  elements.saveRulesButton.disabled = isBusy;
  elements.clearFilesButton.disabled = isBusy;
  elements.applyBulkFlatRateButton.disabled = isBusy;
  elements.copyRuleButton.disabled = isBusy;
  elements.resetSelectedRulesButton.disabled = isBusy;
}

function updateCalculateButton(summary = buildPreflightReview()) {
  const blockers = summary.blockers || [];
  elements.calculateButton.disabled = state.isBusy || blockers.length > 0;
  elements.calculateButton.title = blockers.length
    ? `Resolve ${blockers.length} preflight blocker${blockers.length === 1 ? "" : "s"} before calculating.`
    : "Calculate payroll for this run.";
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
