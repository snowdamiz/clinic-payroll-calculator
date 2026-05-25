import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPayrollReport,
  generateClinicianCsv,
  generateClinicianDocument,
  inferPayPeriodFromIncomeCsv,
} from "../src/payroll.js";

const incomeCsv = `Clinician,ClinicianId,Source,Description,Date Paid,Invoice or Claim #,Invoice or Claim URL,Appointment,Details,Client,Insurance Payment Type,Insurance Check/Wire Number,Amount Paid
Scott LaForce,1715392,Insurance Payment,CIGNA Health Plan,04/25/2026,Claim #270925712,url,04/21/2026,90837,Ryan Henin,ACH,260423090057625,45.00
Scott LaForce,1715392,Client payment,Appointment,04/26/2026,INV #20941,url,04/21/2026,90837,Ryan Henin,,,25.00
Ben Poling,1646815,Insurance Payment,United HealthCare,04/27/2026,,,04/13/2026,90853,Matt Mohr,CHK,1245339622,9.44`;

test("infers the 25th-through-24th pay period from income export dates", () => {
  assert.deepEqual(inferPayPeriodFromIncomeCsv(incomeCsv), {
    start: "2026-04-25",
    end: "2026-05-24",
  });
  assert.deepEqual(
    inferPayPeriodFromIncomeCsv("Clinician,Date Paid,Amount Paid\nScott,05/25/2026,10\n"),
    {
      start: "2026-05-25",
      end: "2026-06-24",
    },
  );
  assert.equal(inferPayPeriodFromIncomeCsv("Clinician,Date Paid,Amount Paid\nScott,,10\n"), null);
});

test("totals cash-basis clinic income by source and clinician from the pay-period report", () => {
  const report = buildPayrollReport({
    incomeCsv,
    appointmentCsv: "",
    contracts: {},
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  assert.equal(report.clinicIncome.total, 79.44);
  assert.equal(report.clinicIncome.insurance, 54.44);
  assert.equal(report.clinicIncome.client, 25);
  assert.equal(report.clinicians["Scott LaForce"].cashReceived.total, 70);
  assert.equal(report.clinicians["Ben Poling"].cashReceived.insurance, 9.44);
});

const appointmentCsv = `Date of Service,Client,Clinician,Billing Code,Rate per Unit,Units,Total Fee,Client Payment Status,Charge,Uninvoiced,Paid,Unpaid
04/27/2026 12:00,Colin Jones,Scott LaForce,90837,195.0,1,195.0,PAID,20.0,0.0,20.0,0.0
04/27/2026 13:00,Family Client,Scott LaForce,90847,195.0,1,195.0,NO CHARGE,0.0,0.0,0.0,0.0
04/28/2026 18:00,Group Member,Ben Poling,90853,75.0,1,75.0,UNPAID,0.0,0.0,0.0,0.0
03/24/2026 18:00,Old Session,Ben Poling,90853,75.0,1,75.0,PAID,0.0,0.0,0.0,0.0`;

test("pays per-session clinicians from kept appointments using different rates by session type", () => {
  const report = buildPayrollReport({
    incomeCsv: "",
    appointmentCsv,
    contracts: {
      "Scott LaForce": {
        payType: "per_session",
        sessionRates: { individual: 80, couplesFamily: 95, group: 30, intake: 100, other: 0 },
      },
      "Ben Poling": {
        payType: "per_session",
        sessionRates: { individual: 75, couplesFamily: 90, group: 35, intake: 90, other: 0 },
      },
    },
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  assert.equal(report.clinicians["Scott LaForce"].sessionCounts.total, 2);
  assert.equal(report.clinicians["Scott LaForce"].sessionCounts.individual, 1);
  assert.equal(report.clinicians["Scott LaForce"].sessionCounts.couplesFamily, 1);
  assert.equal(report.clinicians["Scott LaForce"].pay.total, 175);
  assert.equal(report.clinicians["Ben Poling"].sessionCounts.group, 1);
  assert.equal(report.clinicians["Ben Poling"].pay.total, 35);
});

test("supports percentage contracts based on clinic income or clinician collections", () => {
  const report = buildPayrollReport({
    incomeCsv,
    appointmentCsv: "",
    contracts: {
      "Scott LaForce": { payType: "percent_collections", percentage: 60 },
      "Ben Poling": { payType: "percent_clinic_income", percentage: 10 },
    },
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  assert.equal(report.clinicians["Scott LaForce"].pay.total, 42);
  assert.equal(report.clinicians["Scott LaForce"].pay.explanation, "60% of cash received for this clinician");
  assert.equal(report.clinicians["Ben Poling"].pay.total, 7.94);
  assert.equal(
    report.clinicians["Ben Poling"].pay.explanation,
    "10% of total clinic income received in this pay period",
  );
});

const cardTransactionsWithFeesCsv = `Client name,Transaction ID,Transaction Type,Source,Amount,Fee,Net,Currency,Created (UTC),Available On (UTC)
Ryan Henin,txn_charge_1,charge,card_1,25.00,1.03,23.97,usd,04/26/2026 12:00,04/28/2026 00:00
,txn_payout_1,payout,po_1,-23.97,0.00,-23.97,usd,04/28/2026 00:01,04/28/2026 00:00`;

const paymentExportWithStripeCsv = `Payment ID,Date Paid,Account,Payment type,Name,Amount,Payment Reference ID
1,04/26/2026,Accounts Receivable,Stripe,Ryan Henin,25.00,
2,04/27/2026,Accounts Receivable Insurance,ACH,United HealthCare,54.44,abc`;

test("separates gross SimplePractice income from net income after known Stripe fees", () => {
  const report = buildPayrollReport({
    incomeCsv,
    appointmentCsv: "",
    cardTransactionsCsv: cardTransactionsWithFeesCsv,
    paymentExportCsv: paymentExportWithStripeCsv,
    contracts: {
      "Ben Poling": {
        payType: "percent_clinic_income",
        percentage: 10,
        incomeBasis: "net_after_known_fees",
      },
    },
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  assert.equal(report.clinicIncome.total, 79.44);
  assert.equal(report.clinicIncome.knownStripeFees, 1.03);
  assert.equal(report.clinicIncome.netAfterKnownFees.total, 78.41);
  assert.equal(report.clinicIncome.netAfterKnownFees.client, 23.97);
  assert.equal(report.reconciliation.stripeGrossPayments, 25);
  assert.equal(report.reconciliation.stripeDeposits, 23.97);
  assert.equal(report.reconciliation.stripePayoutGap, 1.03);
  assert.equal(report.reconciliation.stripeFeesAreKnown, true);
  assert.equal(report.clinicians["Ben Poling"].pay.total, 7.84);
  assert.equal(
    report.clinicians["Ben Poling"].pay.explanation,
    "10% of net clinic income after card processing fees",
  );
});

test("estimates SimplePractice Stripe fees from payment export when fee rows are unavailable", () => {
  const report = buildPayrollReport({
    incomeCsv,
    appointmentCsv: "",
    paymentExportCsv: paymentExportWithStripeCsv,
    contracts: {
      "Ben Poling": {
        payType: "percent_clinic_income",
        percentage: 10,
        incomeBasis: "net_after_processing_fees",
      },
    },
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  assert.equal(report.clinicIncome.estimatedStripeFees, 1.09);
  assert.equal(report.clinicIncome.processingFeeAdjustment, 1.09);
  assert.equal(report.clinicIncome.netAfterProcessingFees.total, 78.35);
  assert.equal(report.clinicians["Ben Poling"].pay.total, 7.84);
  assert.equal(
    report.clinicians["Ben Poling"].pay.explanation,
    "10% of net clinic income after card processing fees",
  );
});

test("generates clinician CSV with paid session detail for session-based clinicians", () => {
  const report = buildPayrollReport({
    incomeCsv,
    appointmentCsv,
    contracts: {
      "Scott LaForce": {
        payType: "per_session",
        sessionRates: { individual: 80, couplesFamily: 95, group: 30, intake: 100, other: 0 },
      },
    },
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  const csv = generateClinicianCsv(report.clinicians["Scott LaForce"], report);

  assert.match(csv, /Clinician,Scott LaForce/);
  assert.match(csv, /Calculated pay,175/);
  assert.match(csv, /Paid sessions/);
  assert.match(csv, /04\/27\/2026 12:00,Colin Jones,Individual,90837,80/);
  assert.match(csv, /04\/27\/2026 13:00,Family Client,Couples\/Family,90847,95/);
});

test("generates clinician CSV with CPT-derived session counts by type", () => {
  const report = buildPayrollReport({
    incomeCsv,
    appointmentCsv,
    contracts: {
      "Scott LaForce": {
        payType: "per_session",
        sessionRates: { individual: 80, couplesFamily: 95, group: 30, intake: 100, other: 0 },
      },
    },
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  const csv = generateClinicianCsv(report.clinicians["Scott LaForce"], report);

  assert.match(csv, /Session counts by type/);
  assert.match(csv, /Individual,1/);
  assert.match(csv, /Couples\/Family,1/);
  assert.match(csv, /Group,0/);
  assert.match(csv, /Total,2/);
});

test("generates session-detail CSV for total-income percentage clinicians with pay pending", () => {
  const report = buildPayrollReport({
    incomeCsv,
    appointmentCsv,
    contracts: {
      "Scott LaForce": {
        payType: "percent_clinic_income",
        percentage: 10,
      },
    },
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  const csv = generateClinicianCsv(report.clinicians["Scott LaForce"], report);

  assert.match(csv, /Clinician,Scott LaForce/);
  assert.match(csv, /Calculated pay,Pending/);
  assert.match(csv, /Pay basis,Pending - total clinic income percentage requires overhead adjustments/);
  assert.match(csv, /04\/27\/2026 12:00,Colin Jones,Individual,90837,/);
  assert.match(csv, /04\/27\/2026 13:00,Family Client,Couples\/Family,90847,/);
});

test("generates a printable clinician statement with pay basis and detail rows", () => {
  const report = buildPayrollReport({
    incomeCsv,
    appointmentCsv,
    contracts: {
      "Scott LaForce": {
        payType: "per_session",
        sessionRates: { individual: 80, couplesFamily: 95, group: 30, intake: 100, other: 0 },
      },
    },
    periodStart: "2026-04-25",
    periodEnd: "2026-05-24",
  });

  const html = generateClinicianDocument(report.clinicians["Scott LaForce"], report);

  assert.match(html, /Scott LaForce/);
  assert.match(html, /Calculated pay/);
  assert.match(html, /\$175\.00/);
  assert.match(html, /Session-type rates applied to kept appointments/);
  assert.match(html, /Ryan Henin/);
  assert.match(html, /Family Client/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /Insurance payments/);
  assert.match(html, /Client payments/);
  assert.match(html, /data-payment-panel="insurance"/);
  assert.match(html, /data-payment-panel="client"/);
  assert.match(html, /No other payments received in this pay period|Client payment/);
});
