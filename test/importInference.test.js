import assert from "node:assert/strict";
import test from "node:test";

import { inferImportFiles } from "../src/importInference.js";

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
