import * as XLSX from "../node_modules/@e965/xlsx/xlsx.mjs";

const CSV_EXTENSIONS = new Set([".csv"]);
const WORKBOOK_EXTENSIONS = new Set([".xlsx", ".xls"]);
const SUPPORTED_EXTENSIONS = new Set([...CSV_EXTENSIONS, ...WORKBOOK_EXTENSIONS]);

export const SUPPORTED_IMPORT_ACCEPT = [
  ".csv",
  ".xlsx",
  ".xls",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
].join(",");

export function isSupportedImportFile(file) {
  return SUPPORTED_EXTENSIONS.has(fileExtension(file?.name));
}

export async function readImportFile(file) {
  const name = file?.name || "Imported file";
  const path = file?.webkitRelativePath || name;

  if (!isSupportedImportFile(file)) {
    throw new Error(`${name} is not a supported CSV or Excel file.`);
  }

  return {
    name,
    path,
    text: await fileToCsvText(file),
  };
}

async function fileToCsvText(file) {
  const extension = fileExtension(file.name);
  if (CSV_EXTENSIONS.has(extension)) return file.text();
  if (WORKBOOK_EXTENSIONS.has(extension)) return workbookToCsv(await file.arrayBuffer(), file.name);
  return "";
}

function workbookToCsv(buffer, fileName) {
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: false,
    cellNF: true,
    dateNF: "m/d/yyyy",
  });
  const worksheet = firstPopulatedWorksheet(workbook);

  if (!worksheet) {
    throw new Error(`${fileName} does not contain a readable worksheet.`);
  }

  return worksheetRows(worksheet)
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

function firstPopulatedWorksheet(workbook) {
  for (const sheetName of workbook.SheetNames || []) {
    const worksheet = workbook.Sheets[sheetName];
    if (worksheetRows(worksheet).length > 0) return worksheet;
  }
  return null;
}

function worksheetRows(worksheet) {
  if (!worksheet?.["!ref"]) return [];

  const range = XLSX.utils.decode_range(worksheet["!ref"]);
  const rows = [];

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row = [];

    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      row.push(formatCellValue(worksheet[address]));
    }

    if (row.some((value) => String(value).trim())) rows.push(trimTrailingEmptyCells(row));
  }

  return rows;
}

function formatCellValue(cell) {
  if (!cell) return "";

  if (cell.t === "d" && cell.v instanceof Date) return formatDateParts(datePartsFromDate(cell.v));
  if (cell.t === "n" && isDateCell(cell)) {
    return formatDateParts(XLSX.SSF.parse_date_code(cell.v));
  }

  return cell.w ?? cell.v ?? "";
}

function isDateCell(cell) {
  return Boolean(cell.z && XLSX.SSF.is_date(cell.z) && XLSX.SSF.parse_date_code(cell.v));
}

function datePartsFromDate(date) {
  return {
    y: date.getUTCFullYear(),
    m: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
    H: date.getUTCHours(),
    M: date.getUTCMinutes(),
    S: date.getUTCSeconds(),
  };
}

function formatDateParts(parts) {
  if (!parts) return "";

  const date = `${parts.m}/${parts.d}/${parts.y}`;
  const hasTime = parts.H || parts.M || parts.S;
  if (!hasTime) return date;

  const minutes = String(parts.M || 0).padStart(2, "0");
  const seconds = parts.S ? `:${String(Math.floor(parts.S)).padStart(2, "0")}` : "";
  return `${date} ${parts.H || 0}:${minutes}${seconds}`;
}

function trimTrailingEmptyCells(row) {
  const trimmed = [...row];
  while (trimmed.length > 0 && !String(trimmed[trimmed.length - 1]).trim()) {
    trimmed.pop();
  }
  return trimmed;
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll("\"", "\"\"")}"`;
  return text;
}

function fileExtension(name = "") {
  const match = String(name).toLowerCase().match(/\.[^.]+$/);
  return match?.[0] || "";
}
