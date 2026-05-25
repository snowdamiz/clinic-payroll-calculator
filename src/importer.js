import {
  buildPayrollReport,
  inferPayPeriodFromIncomeCsv,
} from "./payroll.js";
import { buildSimplePracticeImport, storedFilesFromAssignments } from "./bulkImport.js";
import { filesFromDataTransfer } from "./dropFiles.js";

const CONTRACTS_STORAGE_KEY = "clinicianContracts";
const DRAFT_STORAGE_KEY = "payrollSidePanelDraft";
const DEFAULT_IMPORT_STATUS = "Drop a folder here, open the folder importer, or choose the export files.";

const fileKeys = {
  incomeFile: "incomeCsv",
  appointmentFile: "appointmentCsv",
  cardFile: "cardTransactionsCsv",
  paymentFile: "paymentExportCsv",
  insuranceFile: "insurancePaymentsCsv",
};

const elements = {
  folderInput: document.querySelector("#importerFolderInput"),
  filesInput: document.querySelector("#importerFilesInput"),
  dropzone: document.querySelector("#importerDropzone"),
  status: document.querySelector("#importerStatus"),
  detail: document.querySelector("#importerDetail"),
  checklist: document.querySelector("#importerChecklist"),
  closeButton: document.querySelector("#closeImporterButton"),
};

bindEvents();

function bindEvents() {
  elements.folderInput.addEventListener("change", (event) => {
    importSelectedFiles([...(event.target.files || [])], "No CSV or Excel files found in that folder.");
  });
  elements.filesInput.addEventListener("change", (event) => {
    importSelectedFiles([...(event.target.files || [])], "No CSV or Excel files were selected.");
  });
  elements.dropzone.addEventListener("dragenter", handleDragEnter);
  elements.dropzone.addEventListener("dragover", handleDragOver);
  elements.dropzone.addEventListener("dragleave", handleDragLeave);
  elements.dropzone.addEventListener("drop", handleDrop);
  elements.closeButton.addEventListener("click", () => window.close());
}

function handleDragEnter(event) {
  event.preventDefault();
  elements.dropzone.dataset.dragging = "true";
}

function handleDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  elements.dropzone.dataset.dragging = "true";
}

function handleDragLeave(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return;
  delete elements.dropzone.dataset.dragging;
}

async function handleDrop(event) {
  event.preventDefault();
  delete elements.dropzone.dataset.dragging;
  await importSelectedFiles(await filesFromDataTransfer(event.dataTransfer), "No CSV or Excel files were found in that drop.");
}

async function importSelectedFiles(files, emptyMessage) {
  setBusy(true);
  setStatus("Scanning import files...");
  elements.detail.textContent = DEFAULT_IMPORT_STATUS;

  try {
    const importResult = await buildSimplePracticeImport(files, {
      onProgress: ({ index, total, file }) => {
        setStatus(`Scanning ${index + 1}/${total}: ${file.name}`);
      },
    });

    if (importResult.supportedFiles.length === 0) {
      elements.detail.textContent = emptyMessage;
      setStatus("No supported files found.", "error");
      return;
    }

    if (!importResult.importPlan?.candidates.length) {
      elements.detail.textContent =
        `No importable SimplePractice candidates found in ${importResult.supportedFiles.length} supported file${importResult.supportedFiles.length === 1 ? "" : "s"}.`;
      setStatus("No matching exports found.", "error");
      return;
    }

    const draft = await buildDraft(importResult);
    await storageSet(DRAFT_STORAGE_KEY, draft);
    renderChecklist(draft.files);
    elements.detail.textContent = draft.folderImportStatus;
    setStatus(`Imported ${Object.keys(draft.files).length} export${Object.keys(draft.files).length === 1 ? "" : "s"} into the side panel.`, "success");
  } catch (error) {
    elements.detail.textContent = `Could not import files: ${errorMessage(error)}`;
    setStatus("Import failed.", "error");
  } finally {
    setBusy(false);
  }
}

async function buildDraft(importResult) {
  const [savedContracts, currentDraft] = await Promise.all([
    storageGet(CONTRACTS_STORAGE_KEY, {}),
    storageGet(DRAFT_STORAGE_KEY, null),
  ]);
  const contracts = {
    ...(savedContracts || {}),
    ...(currentDraft?.contracts || {}),
  };
  const fallbackPeriod = defaultPayPeriod(new Date());
  const currentPeriod = {
    start: currentDraft?.periodStart || fallbackPeriod.start,
    end: currentDraft?.periodEnd || fallbackPeriod.end,
  };
  const files = storedFilesFromAssignments(importResult.result.assignments);
  const period = inferredUsefulPeriod(files, contracts, currentPeriod);
  const periodWasInferred = period.start !== currentPeriod.start || period.end !== currentPeriod.end;

  return {
    version: 1,
    periodStart: period.start,
    periodEnd: period.end,
    folderImportStatus: importStatusText(importResult, { periodWasInferred, period }),
    files,
    contracts,
    resultsVisible: false,
    importSource: "bulk-importer",
    savedAt: new Date().toISOString(),
  };
}

function inferredUsefulPeriod(files, contracts, currentPeriod) {
  const inferredPeriod = inferPayPeriodFromIncomeCsv(files.incomeFile?.text || "");
  if (!inferredPeriod) return currentPeriod;
  if (currentPeriod.start === inferredPeriod.start && currentPeriod.end === inferredPeriod.end) return currentPeriod;

  const currentReport = reportForPeriod(files, contracts, currentPeriod);
  if (Object.keys(currentReport.clinicians).length > 0) return currentPeriod;

  const inferredReport = reportForPeriod(files, contracts, inferredPeriod);
  if (Object.keys(inferredReport.clinicians).length === 0) return currentPeriod;

  return inferredPeriod;
}

function reportForPeriod(files, contracts, period) {
  const payload = {
    incomeCsv: "",
    appointmentCsv: "",
    cardTransactionsCsv: "",
    paymentExportCsv: "",
    insurancePaymentsCsv: "",
    contracts,
    periodStart: period.start,
    periodEnd: period.end,
  };

  for (const [inputId, payloadKey] of Object.entries(fileKeys)) {
    payload[payloadKey] = files[inputId]?.text || "";
  }

  return buildPayrollReport(payload);
}

function importStatusText(importResult, { periodWasInferred, period }) {
  const result = importResult.result;
  const matchedCount = Object.keys(result.assignments).length;
  const missingLabels = result.missing.map((role) => role.label);
  const unmatchedCount = result.unmatched.length;
  const parts = [`Matched ${matchedCount} export${matchedCount === 1 ? "" : "s"}.`];
  if (missingLabels.length) parts.push(`Missing: ${missingLabels.join(", ")}.`);
  if (unmatchedCount) parts.push(`${unmatchedCount} file${unmatchedCount === 1 ? "" : "s"} not recognized.`);
  if (importResult.readErrors.length) parts.push(`${importResult.readErrors.length} file${importResult.readErrors.length === 1 ? "" : "s"} could not be read.`);
  if (importResult.importPlan?.skipped?.length) parts.push(`Skipped ${importResult.importPlan.skipped.length} lower-priority file${importResult.importPlan.skipped.length === 1 ? "" : "s"} to keep the browser responsive.`);
  if (importResult.importPlan?.oversized?.length) parts.push(`Skipped ${importResult.importPlan.oversized.length} oversized file${importResult.importPlan.oversized.length === 1 ? "" : "s"}.`);
  if (periodWasInferred) parts.push(`Set pay period to ${period.start} through ${period.end} from the income export.`);
  return parts.join(" ");
}

function renderChecklist(files) {
  elements.checklist.innerHTML = Object.values(files)
    .map((file) => `
      <div class="import-check" data-state="loaded" data-priority="optional">
        <strong>${escapeHtml(file.name)}</strong>
        <span>Ready in side panel</span>
        <em>Loaded</em>
      </div>`)
    .join("");
}

function setBusy(isBusy) {
  elements.folderInput.disabled = isBusy;
  elements.filesInput.disabled = isBusy;
  elements.closeButton.disabled = isBusy;
}

function setStatus(message, tone = "") {
  elements.status.textContent = message;
  if (tone) {
    elements.status.dataset.tone = tone;
  } else {
    delete elements.status.dataset.tone;
  }
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

function errorMessage(error) {
  return error?.message || String(error);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
