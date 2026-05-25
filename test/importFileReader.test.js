import assert from "node:assert/strict";
import test from "node:test";

import * as XLSX from "@e965/xlsx";
import { isSupportedImportFile, readImportFile } from "../src/importFileReader.js";

test("reads CSV imports without changing the text", async () => {
  const file = textFile("income.csv", "Clinician,Amount Paid\nClinician A,175\n");

  const record = await readImportFile(file);

  assert.equal(record.name, "income.csv");
  assert.equal(record.text, "Clinician,Amount Paid\nClinician A,175\n");
});

test("converts XLSX imports to CSV-compatible text", async () => {
  const record = await readImportFile(workbookFile("income.xlsx", "xlsx"));

  assert.equal(record.name, "income.xlsx");
  assert.match(record.text, /Clinician,Date Paid,Amount Paid/);
  assert.match(record.text, /Clinician A,4\/25\/2026,175/);
});

test("converts legacy XLS imports to CSV-compatible text", async () => {
  const record = await readImportFile(workbookFile("income.xls", "xls"));

  assert.equal(record.name, "income.xls");
  assert.match(record.text, /Clinician,Date Paid,Amount Paid/);
  assert.match(record.text, /Clinician A,4\/25\/2026,175/);
});

test("recognizes only supported import extensions", () => {
  assert.equal(isSupportedImportFile({ name: "income.csv" }), true);
  assert.equal(isSupportedImportFile({ name: "income.xlsx" }), true);
  assert.equal(isSupportedImportFile({ name: "income.xls" }), true);
  assert.equal(isSupportedImportFile({ name: "notes.pdf" }), false);
});

function textFile(name, text) {
  return {
    name,
    webkitRelativePath: `exports/${name}`,
    text: async () => text,
    arrayBuffer: async () => Buffer.from(text).buffer,
  };
}

function workbookFile(name, bookType) {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Clinician", "Date Paid", "Amount Paid"],
    ["Clinician A", new Date(2026, 3, 25), 175],
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Income");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType });

  return {
    name,
    webkitRelativePath: `exports/${name}`,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}
