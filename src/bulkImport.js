import { isSupportedImportFile, readImportFile } from "./importFileReader.js";
import { inferImportFiles, prioritizeImportCandidates } from "./importInference.js";

export async function buildSimplePracticeImport(files, { onProgress } = {}) {
  const supportedFiles = [...(files || [])].filter(isSupportedImportFile);

  if (supportedFiles.length === 0) {
    return {
      supportedFiles,
      importPlan: null,
      fileRecords: [],
      readErrors: [],
      result: null,
    };
  }

  const importPlan = prioritizeImportCandidates(supportedFiles);
  const fileRecords = [];
  const readErrors = [];

  for (const [index, file] of importPlan.candidates.entries()) {
    await onProgress?.({
      index,
      total: importPlan.candidates.length,
      file,
    });
    await allowUiUpdate();
    try {
      fileRecords.push(await readImportFile(file));
    } catch (error) {
      readErrors.push({ file, error });
    }
  }

  return {
    supportedFiles,
    importPlan,
    fileRecords,
    readErrors,
    result: inferImportFiles(fileRecords),
  };
}

export function storedFilesFromAssignments(assignments = {}) {
  return Object.fromEntries(
    Object.entries(assignments).map(([inputId, file]) => [
      inputId,
      {
        name: file.name,
        text: file.text,
      },
    ]),
  );
}

function allowUiUpdate() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}
