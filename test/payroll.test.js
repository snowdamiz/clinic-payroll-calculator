import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPayrollReport,
  generateClinicianCsv,
  generateClinicianDocument,
  generateReportCsvExports,
  inferPayPeriodFromIncomeCsv,
  parseCsv,
} from "../src/payroll.js";

const incomeCsv = `Clinician,ClinicianId,Source,Description,Date Paid,Invoice or Claim #,Invoice or Claim URL,Appointment,Details,Client,Insurance Payment Type,Insurance Check/Wire Number,Amount Paid
Clinician A,101,Insurance Payment,Payer Alpha,04/25/2026,CLAIM-1,url,04/21/2026,90837,Client One,ACH,REF-1,45.00
Clinician A,101,Client payment,Appointment,04/26/2026,INV-1,url,04/21/2026,90837,Client One,,,25.00
Clinician B,202,Insurance Payment,Payer Beta,04/27/2026,CLAIM-2,url,03/01/2026,90853,Client Two,CHK,REF-2,9.44
Clinician A,101,Client payment,Missing service date,04/28/2026,INV-2,url,,90837,Client Three,,,10.00
Clinician A,101,Client payment,Appointment,04/28/2026,INV-3,url,04/27/2026,90847,Client Four,,,30.00
Clinician A,101,Insurance Payment,Payer Alpha,04/29/2026,CLAIM-3,url,04/27/2026,90847,Client Four,ACH,REF-3,70.00`;

const appointmentCsv = `Date of Service,Client,Clinician,Billing Code,Rate per Unit,Units,Total Fee,Client Payment Status,Charge,Uninvoiced,Paid,Unpaid,Insurance Payment Status,Charge,Paid,Write-off,Unpaid
04/27/2026 12:00,Client Four,Clinician A,90847,130.0,1,130.0,PAID,30.0,0.0,30.0,0.0,PAID,100.0,70.0,20.0,10.0
04/28/2026 18:00,Client Five,Clinician B,90853,75.0,1,75.0,UNPAID,0.0,0.0,0.0,0.0,PENDING,75.0,0.0,0.0,75.0
03/24/2026 18:00,Client Six,Clinician B,90853,75.0,1,75.0,PAID,0.0,0.0,0.0,0.0,PAID,75.0,75.0,0.0,0.0`;

const paymentExportWithStripeCsv = `Payment ID,Date Paid,Account,Payment type,Name,Amount,Payment Reference ID
1,04/28/2026,Accounts Receivable,Stripe,Client Four,30.00,
2,04/29/2026,Accounts Receivable Insurance,ACH,Payer Alpha,70.00,abc`;

const cardTransactionsWithFeesCsv = `Client name,Transaction ID,Transaction Type,Source,Amount,Fee,Net,Currency,Created (UTC),Available On (UTC)
Client Four,txn_charge_1,charge,card_1,30.00,1.25,28.75,usd,04/28/2026 12:00,04/29/2026 00:00
,txn_payout_1,payout,po_1,-28.75,0.00,-28.75,usd,04/29/2026 00:01,04/29/2026 00:00`;

const insuranceAllocationCsv = `Payer,Clinician,Amount
Payer Alpha,Clinician A,115.00
Payer Beta,Clinician B,9.44`;

test("infers the 25th-through-24th pay period from income export dates", () => {
  assert.deepEqual(inferPayPeriodFromIncomeCsv(incomeCsv), {
    start: "2026-04-25",
    end: "2026-05-24",
  });
  assert.deepEqual(
    inferPayPeriodFromIncomeCsv("Clinician,Date Paid,Amount Paid\nClinician A,05/25/2026,10\n"),
    {
      start: "2026-05-25",
      end: "2026-06-24",
    },
  );
  assert.equal(inferPayPeriodFromIncomeCsv("Clinician,Date Paid,Amount Paid\nClinician A,,10\n"), null);
});

test("preserves duplicate appointment balance headers by position", () => {
  const [row] = parseCsv(appointmentCsv);

  assert.equal(row.Paid, "30.0");
  assert.equal(row.Paid__2, "70.0");
  assert.equal(row.Charge, "30.0");
  assert.equal(row.Charge__2, "100.0");
  assert.equal(row.Unpaid, "0.0");
  assert.equal(row.Unpaid__2, "10.0");
});

test("builds appointment and payment ledgers with split balances and conservative matching", () => {
  const report = buildPayrollReport({
    incomeCsv,
    appointmentCsv,
    contracts: {},
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  const splitAppointment = report.appointmentLedger.find((row) => row.client === "Client Four");
  assert.equal(splitAppointment.clientPaid, 30);
  assert.equal(splitAppointment.insurancePaid, 70);
  assert.equal(splitAppointment.insuranceWriteOff, 20);
  assert.equal(splitAppointment.insuranceUnpaid, 10);
  assert.equal(splitAppointment.hasSplitPayments, true);
  assert.equal(splitAppointment.matchedPaymentCents, 10_000);
  assert.equal(report.clinicians["Clinician A"].splitPaymentRows.length, 1);
  assert.equal(report.ledgerReview.matchedPaymentCount, 2);
  assert.ok(report.ledgerReview.unmatchedPayments.some((row) => row.client === "Client One"));
  assert.ok(report.ledgerReview.unmatchedAppointments.some((row) => row.client === "Client Five"));
});

test("counts a split-payment appointment once for session-based pay", () => {
  const report = buildPayrollReport({
    incomeCsv,
    appointmentCsv,
    contracts: {
      "Clinician A": {
        payType: "per_session",
        sessionRates: { individual: 80, couplesFamily: 95, group: 30, intake: 100, other: 0 },
      },
    },
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  assert.equal(report.clinicians["Clinician A"].sessionCounts.total, 1);
  assert.equal(report.clinicians["Clinician A"].sessionCounts.couplesFamily, 1);
  assert.equal(report.clinicians["Clinician A"].pay.total, 95);
});

test("includes client and insurance portions for collection-based pay", () => {
  const report = buildPayrollReport({
    incomeCsv,
    appointmentCsv,
    contracts: {
      "Clinician A": { payType: "percent_collections", percentage: 50 },
    },
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  assert.equal(report.clinicians["Clinician A"].cashReceived.total, 180);
  assert.equal(report.clinicians["Clinician A"].cashReceived.client, 65);
  assert.equal(report.clinicians["Clinician A"].cashReceived.insurance, 115);
  assert.equal(report.clinicians["Clinician A"].pay.total, 90);
});

test("classifies trailing, aged trailing, and missing-service-date payments", () => {
  const report = buildPayrollReport({
    incomeCsv,
    appointmentCsv,
    contracts: {},
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  assert.equal(report.trailingPayments.thresholdDays, 45);
  assert.equal(report.trailingPayments.count, 4);
  assert.equal(report.trailingPayments.amount, 89.44);
  assert.equal(report.trailingPayments.oldestLagDays, 57);
  assert.equal(report.trailingPayments.missingServiceDateCount, 1);
  const trailingWarning = report.warnings.find((warning) => warning.type === "old_service_payment");
  assert.ok(trailingWarning);
  assert.match(trailingWarning.nextAction, /trailing-payment detail/);
  assert.match(trailingWarning.nextAction, /income allocation appointment date or payment date/);
});

test("migrates obsolete clinic-income percentage contracts to needs-review with no calculated pay", () => {
  const report = buildPayrollReport({
    incomeCsv,
    appointmentCsv,
    contracts: {
      "Clinician B": { payType: "percent_clinic_income", percentage: 10 },
    },
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  assert.equal(report.clinicians["Clinician B"].contract.payType, "none");
  assert.equal(report.clinicians["Clinician B"].contract.needsReview, true);
  assert.equal(report.clinicians["Clinician B"].pay.total, 0);
  assert.equal(report.clinicians["Clinician B"].pay.explanation, "Legacy percent-of-clinic-income rule needs review");
  assert.ok(report.warnings.some((warning) => warning.type === "legacy_pay_rule"));
});

test("warns when configured pay rules have zero values for active work", () => {
  const flatReport = buildPayrollReport({
    incomeCsv,
    appointmentCsv,
    contracts: {
      "Clinician A": { payType: "flat_session", flatRate: 0 },
    },
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });
  const percentReport = buildPayrollReport({
    incomeCsv,
    appointmentCsv,
    contracts: {
      "Clinician A": { payType: "percent_collections", percentage: 0 },
    },
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  assert.ok(flatReport.warnings.some((warning) => warning.type === "zero_value_pay_rule"));
  assert.ok(percentReport.warnings.some((warning) => warning.type === "zero_value_pay_rule"));
});

test("labels contribution PnL honestly when processing fees are unavailable", () => {
  const report = buildPayrollReport({
    incomeCsv,
    appointmentCsv,
    contracts: {
      "Clinician A": { payType: "percent_collections", percentage: 50 },
    },
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  assert.equal(report.contributionPnl.label, "Pay-period contribution PnL");
  assert.equal(report.contributionPnl.fullPnlAvailable, false);
  assert.equal(report.contributionPnl.processingFeeStatus, "unavailable");
  assert.equal(report.contributionPnl.processingFees, 0);
  assert.equal(report.reconciliation.paymentExportAvailable, false);
  assert.equal(report.reconciliation.insurancePayerAllocationAvailable, false);
  assert.match(report.contributionPnl.fullPnlStatus, /Full PnL unavailable/);
  assert.equal(report.contributionPnl.contributionResult, 99.44);
});

test("uses estimated or actual card fees only when supported export data exists", () => {
  const cardOnlyReport = buildPayrollReport({
    incomeCsv,
    appointmentCsv,
    cardTransactionsCsv: cardTransactionsWithFeesCsv,
    contracts: {},
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });
  const estimatedReport = buildPayrollReport({
    incomeCsv,
    appointmentCsv,
    paymentExportCsv: paymentExportWithStripeCsv,
    contracts: {},
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });
  const actualReport = buildPayrollReport({
    incomeCsv,
    appointmentCsv,
    cardTransactionsCsv: cardTransactionsWithFeesCsv,
    paymentExportCsv: paymentExportWithStripeCsv,
    contracts: {},
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  assert.equal(cardOnlyReport.reconciliation.stripePayoutGap, -28.75);
  assert.equal(cardOnlyReport.reconciliation.stripePayoutGapAvailable, false);
  assert.equal(cardOnlyReport.reconciliation.stripeGrossPaymentsAvailable, false);
  assert.equal(estimatedReport.reconciliation.processingFeeStatus, "estimated");
  assert.equal(estimatedReport.reconciliation.stripePayoutGapAvailable, false);
  assert.equal(estimatedReport.clinicIncome.estimatedStripeFees, 1.25);
  assert.equal(actualReport.reconciliation.processingFeeStatus, "actual");
  assert.equal(actualReport.reconciliation.stripePayoutGapAvailable, true);
  assert.equal(actualReport.clinicIncome.knownStripeFees, 1.25);
  assert.equal(actualReport.clinicIncome.processingFeeAdjustment, 1.25);
});

test("reconciles insurance payer allocation separately from insurance payment report timing", () => {
  const report = buildPayrollReport({
    incomeCsv,
    appointmentCsv,
    insuranceAllocationCsv,
    contracts: {},
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  assert.equal(report.reconciliation.insurancePayerAllocationTotal, 124.44);
  assert.equal(report.reconciliation.insurancePayerAllocationDifference, 0);
  assert.equal(report.reconciliation.insurancePayerAllocationAvailable, true);
});

test("generates clinician statements and report-level CSV exports with review details", () => {
  const report = buildPayrollReport({
    incomeCsv,
    appointmentCsv,
    contracts: {
      "Clinician A": {
        payType: "per_session",
        sessionRates: { individual: 80, couplesFamily: 95, group: 30, intake: 100, other: 0 },
      },
    },
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  const clinicianCsv = generateClinicianCsv(report.clinicians["Clinician A"], report);
  const clinicianHtml = generateClinicianDocument(report.clinicians["Clinician A"], report);
  const exports = generateReportCsvExports(report);

  assert.match(clinicianCsv, /Split payment detail/);
  assert.match(clinicianCsv, /Trailing payments over 45 days or outside service period/);
  assert.match(clinicianHtml, /Split Payment Detail/);
  assert.match(clinicianHtml, /Trailing And Outlier Collections/);
  assert.match(exports.appointmentLedger, /Client paid,Client unpaid,Insurance charge/);
  assert.match(exports.paymentLedger, /Lag days,Classification,Match status/);
  assert.match(exports.outlierPayments, /missing_service_date/);
  assert.match(exports.contributionPnl, /Pay-period contribution PnL/);
});
