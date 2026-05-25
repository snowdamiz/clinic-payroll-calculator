import assert from "node:assert/strict";
import test from "node:test";

import { inferImportFiles, prioritizeImportCandidates } from "../src/importInference.js";

test("infers SimplePractice export roles from one selected folder", () => {
  const files = [
    {
      name: "appointment-status-report.csv",
      text: "Date of Service,Client,Clinician,Billing Code,Rate per Unit,Units,Total Fee,Client Payment Status,Charge,Uninvoiced,Paid,Unpaid\n",
    },
    {
      name: "Card_Transactions_Report_For_New_Pattern_Counseling_LLC_2026-05-24_175957 (1).csv",
      text: "Client name,Transaction ID,Transaction Type,Source,Amount,Fee,Net,Currency,Created (UTC),Available On (UTC)\n",
    },
    {
      name: "insurance_payment_reports_report.csv",
      text: "Date Received,Client,Payer,Amount,Clearinghouse Reference,Payer Claim,Payment Reference,Payment Status\n",
    },
    {
      name: "Pay period report - generated at 05_24_2026 18_16.csv",
      text: "Clinician,ClinicianId,Source,Description,Date Paid,Invoice or Claim #,Invoice or Claim URL,Appointment,Details,Client,Insurance Payment Type,Insurance Check/Wire Number,Amount Paid\n",
    },
    {
      name: "PaymentExport_04252026.csv",
      text: "Payment ID,Date Paid,Account,Payment type,Name,Amount,Payment Reference ID\n",
    },
  ];

  const result = inferImportFiles(files);

  assert.equal(result.assignments.incomeFile.name, "Pay period report - generated at 05_24_2026 18_16.csv");
  assert.equal(result.assignments.appointmentFile.name, "appointment-status-report.csv");
  assert.equal(result.assignments.cardFile.name, "Card_Transactions_Report_For_New_Pattern_Counseling_LLC_2026-05-24_175957 (1).csv");
  assert.equal(result.assignments.paymentFile.name, "PaymentExport_04252026.csv");
  assert.equal(result.assignments.insuranceFile.name, "insurance_payment_reports_report.csv");
  assert.deepEqual(result.unmatched, []);
});

test("reports unmatched CSVs without blocking the matched imports", () => {
  const result = inferImportFiles([
    {
      name: "random.csv",
      text: "Something,Unexpected\n1,2\n",
    },
    {
      name: "PaymentExport_04252026.csv",
      text: "Payment ID,Date Paid,Account,Payment type,Name,Amount,Payment Reference ID\n",
    },
  ]);

  assert.equal(result.assignments.paymentFile.name, "PaymentExport_04252026.csv");
  assert.deepEqual(result.unmatched.map((file) => file.name), ["random.csv"]);
});

test("prioritizes likely SimplePractice files instead of scanning a whole large folder", () => {
  const files = [
    ...Array.from({ length: 60 }, (_, index) => file(`archive-${index}.csv`, { size: 1000 + index })),
    file("appointment-status-report.csv", { size: 2000 }),
    file("PaymentExport_04252026.csv", { size: 2000 }),
    file("Pay period report - generated at 05_24_2026 18_16.csv", { size: 2000 }),
  ];

  const plan = prioritizeImportCandidates(files, {
    maxFiles: 12,
    maxNameMatchesPerRole: 2,
    maxFallbackFiles: 3,
  });

  assert.ok(plan.candidates.length < files.length);
  assert.ok(plan.skipped.length > 0);
  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.name).filter((name) => /appointment|PaymentExport|Pay period/.test(name)),
    [
      "appointment-status-report.csv",
      "PaymentExport_04252026.csv",
      "Pay period report - generated at 05_24_2026 18_16.csv",
    ],
  );
});

test("limits duplicate hinted exports and skips oversized folder candidates", () => {
  const files = [
    file("Pay period report - older.csv", { lastModified: 1, size: 1000 }),
    file("Pay period report - newest.csv", { lastModified: 3, size: 1000 }),
    file("Pay period report - middle.csv", { lastModified: 2, size: 1000 }),
    file("appointment-status-report.csv", { size: 99_000_000 }),
  ];

  const plan = prioritizeImportCandidates(files, {
    maxFiles: 10,
    maxFileBytes: 1_000_000,
    maxNameMatchesPerRole: 2,
    maxFallbackFiles: 0,
  });

  assert.deepEqual(plan.candidates.map((candidate) => candidate.name), [
    "Pay period report - newest.csv",
    "Pay period report - middle.csv",
  ]);
  assert.deepEqual(plan.oversized.map((candidate) => candidate.name), ["appointment-status-report.csv"]);
  assert.deepEqual(plan.skipped.map((candidate) => candidate.name), ["Pay period report - older.csv"]);
});

test("keeps looking for smaller hinted exports after skipping an oversized candidate", () => {
  const files = [
    file("appointment-status-report-huge.csv", { lastModified: 3, size: 99_000_000 }),
    file("appointment-status-report-current.csv", { lastModified: 2, size: 1000 }),
    file("appointment-status-report-older.csv", { lastModified: 1, size: 1000 }),
  ];

  const plan = prioritizeImportCandidates(files, {
    maxFileBytes: 1_000_000,
    maxNameMatchesPerRole: 1,
    maxFallbackFiles: 0,
  });

  assert.deepEqual(plan.candidates.map((candidate) => candidate.name), ["appointment-status-report-current.csv"]);
  assert.deepEqual(plan.oversized.map((candidate) => candidate.name), ["appointment-status-report-huge.csv"]);
});

function file(name, overrides = {}) {
  return {
    name,
    size: overrides.size ?? 1000,
    lastModified: overrides.lastModified ?? 0,
  };
}
