const MONEY_FIELDS = ["Amount Paid", "Paid", "Charge", "Net", "Fee", "Amount"];
const SESSION_TYPES = ["individual", "couplesFamily", "group", "intake", "other"];
const SIMPLEPRACTICE_CARD_PERCENT = 0.0315;
const SIMPLEPRACTICE_CARD_FIXED_CENTS = 30;
const TRAILING_PAYMENT_THRESHOLD_DAYS = 45;

export function buildPayrollReport({
  incomeCsv = "",
  appointmentCsv = "",
  cardTransactionsCsv = "",
  paymentExportCsv = "",
  insurancePaymentsCsv = "",
  insuranceAllocationCsv = "",
  contracts = {},
  periodStart,
  periodEnd,
} = {}) {
  const incomeRows = parseCsv(incomeCsv);
  const appointmentRows = parseCsv(appointmentCsv);
  const cardRows = parseCsv(cardTransactionsCsv);
  const paymentRows = parseCsv(paymentExportCsv);
  const insuranceRows = parseCsv(insurancePaymentsCsv);
  const insuranceAllocationRows = parseCsv(insuranceAllocationCsv);
  const period = makePeriod(periodStart, periodEnd);
  const paymentLedger = [];
  const appointmentLedger = [];
  const clinicians = {};
  const incomeCents = {
    total: 0,
    insurance: 0,
    client: 0,
    other: 0,
  };

  for (const row of incomeRows) {
    if (!isWithinPeriod(row["Date Paid"], period)) continue;

    const clinicianName = clean(row.Clinician) || "Unassigned";
    const source = classifyIncomeSource(row.Source);
    const cents = moneyToCents(row["Amount Paid"]);

    incomeCents.total += cents;
    incomeCents[source] += cents;

    const clinician = ensureClinician(clinicians, clinicianName);
    clinician.cashReceived.totalCents += cents;
    clinician.cashReceived[`${source}Cents`] += cents;
    const normalizedPayment = normalizeIncomeRow(row, source, cents, {
      index: paymentLedger.length + 1,
      period,
    });
    paymentLedger.push(normalizedPayment);
    clinician.paymentRows.push(normalizedPayment);
  }

  for (const row of appointmentRows) {
    if (!isWithinPeriod(row["Date of Service"], period)) continue;
    if (!isKeptAppointment(row)) continue;

    const clinicianName = clean(row.Clinician) || "Unassigned";
    const sessionType = classifySessionType(row["Billing Code"]);
    const clinician = ensureClinician(clinicians, clinicianName);
    clinician.sessionCounts.total += 1;
    clinician.sessionCounts[sessionType] += 1;
    const normalizedAppointment = normalizeAppointmentRow(row, sessionType, appointmentLedger.length + 1);
    appointmentLedger.push(normalizedAppointment);
    clinician.appointmentRows.push(normalizedAppointment);
  }

  const ledgerReview = reconcileLedgers(appointmentLedger, paymentLedger);
  applyLedgerReviewToClinicians(clinicians, ledgerReview);

  const reconciliation = buildReconciliation({
    cardRows,
    paymentRows,
    insuranceRows,
    insuranceAllocationRows,
    period,
    clinicIncomeCents: incomeCents,
  });
  const clinicIncome = buildClinicIncome(incomeCents, reconciliation);
  const finalizedClinicians = finalizeClinicians(clinicians, contracts, clinicIncome);
  const contributionPnl = buildContributionPnl(clinicIncome, finalizedClinicians, reconciliation);

  return {
    period: {
      start: periodStart || "",
      end: periodEnd || "",
    },
    appointmentLedger,
    paymentLedger,
    clinicIncome,
    contributionPnl,
    trailingPayments: buildTrailingSummary(paymentLedger),
    ledgerReview,
    reconciliation,
    clinicians: finalizedClinicians,
    warnings: buildWarnings(finalizedClinicians, contracts, period),
  };
}

export function generateClinicianDocument(clinician, report) {
  const contract = clinician.contract;
  const paymentTabs = clinicianPaymentTabsHtml(clinician);
  const sessionRows = clinician.appointmentRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.serviceDate)}</td>
          <td>${escapeHtml(row.client)}</td>
          <td>${escapeHtml(formatSessionType(row.sessionType))}</td>
          <td>${escapeHtml(row.billingCode)}</td>
          <td>${escapeHtml(row.paymentStatus)}</td>
        </tr>`,
    )
    .join("");
  const splitRows = clinician.appointmentRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.serviceDate)}</td>
          <td>${escapeHtml(row.client)}</td>
          <td>${escapeHtml(row.billingCode)}</td>
          <td class="number">${formatMoney(row.totalFee)}</td>
          <td class="number">${formatMoney(row.clientPaid)}</td>
          <td class="number">${formatMoney(row.clientUnpaid)}</td>
          <td class="number">${formatMoney(row.insurancePaid)}</td>
          <td class="number">${formatMoney(row.insuranceWriteOff)}</td>
          <td class="number">${formatMoney(row.insuranceUnpaid)}</td>
        </tr>`,
    )
    .join("");
  const trailingRows = clinician.trailingPayments
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.datePaid)}</td>
          <td>${escapeHtml(row.serviceDate)}</td>
          <td>${escapeHtml(row.client)}</td>
          <td>${escapeHtml(row.sourceLabel)}</td>
          <td class="number">${formatMoney(row.amount)}</td>
          <td class="number">${row.lagDays ?? ""}</td>
        </tr>`,
    )
    .join("");

  return `
    <article class="clinician-document">
      <header>
        <p class="eyebrow">Clinician pay period statement</p>
        <h1>${escapeHtml(clinician.name)}</h1>
        <p>${escapeHtml(report.period.start)} to ${escapeHtml(report.period.end)}</p>
      </header>
      <section class="summary-grid">
        <div><span>Calculated pay</span><strong>${formatMoney(clinician.pay.total)}</strong></div>
        <div><span>Pay method</span><strong>${escapeHtml(describeContract(contract))}</strong></div>
        <div><span>Cash received</span><strong>${formatMoney(clinician.cashReceived.total)}</strong></div>
        <div><span>Kept sessions</span><strong>${clinician.sessionCounts.total}</strong></div>
        <div><span>Trailing payments</span><strong>${clinician.trailingPayments.length}</strong></div>
        <div><span>Unmatched review</span><strong>${clinician.unmatchedPayments.length + clinician.unmatchedAppointments.length}</strong></div>
      </section>
      <section>
        <h2>Pay Basis</h2>
        <p>${escapeHtml(clinician.pay.explanation)}</p>
      </section>
      <section>
        <h2>Session Count</h2>
        <table>
          <thead><tr><th>Individual</th><th>Couples/Family</th><th>Group</th><th>Intake</th><th>Other</th><th>Total</th></tr></thead>
          <tbody><tr>
            <td>${clinician.sessionCounts.individual}</td>
            <td>${clinician.sessionCounts.couplesFamily}</td>
            <td>${clinician.sessionCounts.group}</td>
            <td>${clinician.sessionCounts.intake}</td>
            <td>${clinician.sessionCounts.other}</td>
            <td>${clinician.sessionCounts.total}</td>
          </tr></tbody>
        </table>
      </section>
      <section>
        <h2>Actual Payments Received This Period</h2>
        ${paymentTabs}
      </section>
      <section>
        <h2>Kept Sessions This Period</h2>
        <table>
          <thead><tr><th>Service date</th><th>Client</th><th>Session type</th><th>Billing code</th><th>Client payment status</th></tr></thead>
          <tbody>${sessionRows || `<tr><td colspan="5">No kept sessions found in the appointment report.</td></tr>`}</tbody>
        </table>
      </section>
      <section>
        <h2>Split Payment Detail</h2>
        <table>
          <thead><tr><th>Service date</th><th>Client</th><th>CPT</th><th>Total fee</th><th>Client paid</th><th>Client unpaid</th><th>Insurance paid</th><th>Insurance write-off</th><th>Insurance unpaid</th></tr></thead>
          <tbody>${splitRows || `<tr><td colspan="9">No appointment rows found.</td></tr>`}</tbody>
        </table>
      </section>
      <section>
        <h2>Trailing And Outlier Collections</h2>
        <table>
          <thead><tr><th>Date paid</th><th>Service date</th><th>Client</th><th>Source</th><th>Amount</th><th>Lag days</th></tr></thead>
          <tbody>${trailingRows || `<tr><td colspan="6">No trailing payments found for this clinician.</td></tr>`}</tbody>
        </table>
      </section>
    </article>`;
}

function clinicianPaymentTabsHtml(clinician) {
  const baseId = `payments-${slugify(clinician.name)}`;
  const tabDefinitions = [
    {
      id: "all",
      label: "All payments",
      rows: clinician.paymentRows,
      empty: "No payments received in this pay period.",
    },
    {
      id: "insurance",
      label: "Insurance payments",
      rows: clinician.paymentRows.filter((row) => row.source === "insurance"),
      empty: "No insurance payments received in this pay period.",
    },
    {
      id: "client",
      label: "Client payments",
      rows: clinician.paymentRows.filter((row) => row.source === "client"),
      empty: "No client payments received in this pay period.",
    },
  ];
  const otherRows = clinician.paymentRows.filter((row) => row.source === "other");
  if (otherRows.length > 0) {
    tabDefinitions.push({
      id: "other",
      label: "Other payments",
      rows: otherRows,
      empty: "No other payments received in this pay period.",
    });
  }

  const tabs = tabDefinitions
    .map((tab, index) => {
      const active = index === 0;
      const panelId = `${baseId}-${tab.id}`;
      return `
        <button
          class="payment-tab"
          type="button"
          role="tab"
          aria-selected="${active ? "true" : "false"}"
          aria-controls="${panelId}"
          data-payment-tab="${tab.id}"
        >
          ${escapeHtml(tab.label)}
          <span>${tab.rows.length}</span>
        </button>`;
    })
    .join("");

  const panels = tabDefinitions
    .map((tab, index) => {
      const active = index === 0;
      const panelId = `${baseId}-${tab.id}`;
      return `
        <div
          id="${panelId}"
          class="payment-panel"
          role="tabpanel"
          data-payment-panel="${tab.id}"
          ${active ? "" : "hidden"}
        >
          <table>
            <thead><tr><th>Date paid</th><th>Service date</th><th>Client</th><th>Source</th><th>Description</th><th>Amount</th></tr></thead>
            <tbody>${paymentRowsHtml(tab.rows, tab.empty)}</tbody>
          </table>
        </div>`;
    })
    .join("");

  return `
    <div class="payment-tabs" data-payment-tabs>
      <div class="payment-tab-list" role="tablist" aria-label="Payment source views">
        ${tabs}
      </div>
      ${panels}
    </div>`;
}

function paymentRowsHtml(rows, emptyMessage) {
  if (rows.length === 0) {
    return `<tr><td colspan="6">${escapeHtml(emptyMessage)}</td></tr>`;
  }
  return rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.datePaid)}</td>
          <td>${escapeHtml(row.serviceDate)}</td>
          <td>${escapeHtml(row.client)}</td>
          <td>${escapeHtml(row.sourceLabel)}</td>
          <td>${escapeHtml(row.description)}</td>
          <td class="number">${formatMoney(row.amount)}</td>
        </tr>`,
    )
    .join("");
}

export function generateClinicianCsv(clinician, report) {
  const payIsPending = clinician.contract.needsReview;
  const calculatedPay = payIsPending ? "Pending" : clinician.pay.total;
  const payBasis = payIsPending
    ? "Pending - legacy percent-of-clinic-income rule needs a new agreement"
    : clinician.pay.explanation;
  const rows = [
    ["Clinician", clinician.name],
    ["Pay period", `${report.period.start} to ${report.period.end}`],
    ["Pay method", describeContract(clinician.contract)],
    ["Calculated pay", calculatedPay],
    ["Pay basis", payBasis],
    ["Kept sessions", clinician.sessionCounts.total],
    [],
    ["Session counts by type"],
    ["Individual", clinician.sessionCounts.individual],
    ["Couples/Family", clinician.sessionCounts.couplesFamily],
    ["Group", clinician.sessionCounts.group],
    ["Intake", clinician.sessionCounts.intake],
    ["Other", clinician.sessionCounts.other],
    ["Total", clinician.sessionCounts.total],
    [],
    ["Paid sessions"],
    ["Service date", "Client", "Session type", "Billing code", "Line pay"],
  ];

  for (const row of clinician.appointmentRows) {
    rows.push([
      row.serviceDate,
      row.client,
      formatSessionType(row.sessionType),
      row.billingCode,
      sessionLinePay(row, clinician.contract),
    ]);
  }

  rows.push(
    [],
    ["Payments received this period"],
    ["Date paid", "Service date", "Client", "Source", "Description", "Gross amount"],
  );

  for (const row of clinician.paymentRows) {
    rows.push([
      row.datePaid,
      row.serviceDate,
      row.client,
      row.sourceLabel,
      row.description,
      row.amount,
    ]);
  }

  rows.push(
    [],
    ["Split payment detail"],
    ["Service date", "Client", "CPT", "Total fee", "Client paid", "Client unpaid", "Insurance paid", "Insurance write-off", "Insurance unpaid"],
  );

  for (const row of clinician.appointmentRows) {
    rows.push([
      row.serviceDate,
      row.client,
      row.billingCode,
      row.totalFee,
      row.clientPaid,
      row.clientUnpaid,
      row.insurancePaid,
      row.insuranceWriteOff,
      row.insuranceUnpaid,
    ]);
  }

  rows.push(
    [],
    [`Trailing payments over ${report.trailingPayments.thresholdDays} days or outside service period`],
    ["Date paid", "Service date", "Client", "Source", "Amount", "Lag days", "Classification", "Match status"],
  );

  for (const row of clinician.trailingPayments) {
    rows.push([
      row.datePaid,
      row.serviceDate,
      row.client,
      row.sourceLabel,
      row.amount,
      row.lagDays ?? "",
      row.lagBucket,
      row.matchStatus,
    ]);
  }

  rows.push(
    [],
    ["Unmatched payments"],
    ["Date paid", "Service date", "Client", "CPT", "Source", "Amount", "Reason"],
  );

  for (const row of clinician.unmatchedPayments) {
    rows.push([
      row.datePaid,
      row.serviceDate,
      row.client,
      row.billingCode,
      row.sourceLabel,
      row.amount,
      row.matchReason,
    ]);
  }

  rows.push(
    [],
    ["Unmatched appointments with balances"],
    ["Service date", "Client", "CPT", "Client unpaid", "Insurance unpaid", "Total unpaid"],
  );

  for (const row of clinician.unmatchedAppointments) {
    rows.push([
      row.serviceDate,
      row.client,
      row.billingCode,
      row.clientUnpaid,
      row.insuranceUnpaid,
      row.unpaidTotal,
    ]);
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function generateReportCsvExports(report) {
  return {
    appointmentLedger: rowsToCsv([
      ["Appointment ID", "Service date", "Clinician", "Client", "CPT", "Session type", "Total fee", "Client charge", "Client paid", "Client unpaid", "Insurance charge", "Insurance paid", "Insurance write-off", "Insurance unpaid", "Matched payments"],
      ...report.appointmentLedger.map((row) => [
        row.id,
        row.serviceDate,
        row.clinician,
        row.client,
        row.billingCode,
        formatSessionType(row.sessionType),
        row.totalFee,
        row.clientCharge,
        row.clientPaid,
        row.clientUnpaid,
        row.insuranceCharge,
        row.insurancePaid,
        row.insuranceWriteOff,
        row.insuranceUnpaid,
        centsToMoney(row.matchedPaymentCents),
      ]),
    ]),
    paymentLedger: rowsToCsv([
      ["Payment ID", "Date paid", "Service date", "Clinician", "Client", "CPT", "Source", "Description", "Reference", "Amount", "Lag days", "Classification", "Match status", "Match reason", "Appointment ID"],
      ...report.paymentLedger.map((row) => [
        row.id,
        row.datePaid,
        row.serviceDate,
        row.clinician,
        row.client,
        row.billingCode,
        row.sourceLabel,
        row.description,
        row.reference,
        row.amount,
        row.lagDays ?? "",
        row.lagBucket,
        row.matchStatus,
        row.matchReason,
        row.appointmentId,
      ]),
    ]),
    splitPaymentDetail: rowsToCsv([
      ["Appointment ID", "Service date", "Clinician", "Client", "CPT", "Total fee", "Client paid", "Client unpaid", "Insurance paid", "Insurance write-off", "Insurance unpaid"],
      ...report.appointmentLedger.map((row) => [
        row.id,
        row.serviceDate,
        row.clinician,
        row.client,
        row.billingCode,
        row.totalFee,
        row.clientPaid,
        row.clientUnpaid,
        row.insurancePaid,
        row.insuranceWriteOff,
        row.insuranceUnpaid,
      ]),
    ]),
    outlierPayments: rowsToCsv([
      ["Payment ID", "Date paid", "Service date", "Clinician", "Client", "Source", "Amount", "Lag days", "Classification", "Match status"],
      ...report.trailingPayments.payments.map((row) => [
        row.id,
        row.datePaid,
        row.serviceDate,
        row.clinician,
        row.client,
        row.sourceLabel,
        row.amount,
        row.lagDays ?? "",
        row.lagBucket,
        row.matchStatus,
      ]),
    ]),
    contributionPnl: rowsToCsv([
      ["Metric", "Value", "Status"],
      ["Report label", report.contributionPnl.label, ""],
      ["Revenue", report.contributionPnl.revenue, ""],
      ["Insurance revenue", report.contributionPnl.revenueBySource.insurance, ""],
      ["Client revenue", report.contributionPnl.revenueBySource.client, ""],
      ["Other revenue", report.contributionPnl.revenueBySource.other, ""],
      ["Clinician compensation", report.contributionPnl.clinicianCompensation, ""],
      ["Processing fees", report.contributionPnl.processingFees, report.contributionPnl.processingFeeStatus],
      ["Contribution result", report.contributionPnl.contributionResult, ""],
      ["Full PnL status", report.contributionPnl.fullPnlStatus, "unavailable"],
    ]),
  };
}

function rowsToCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

export function parseCsv(csvText) {
  const text = clean(csvText);
  if (!text) return [];

  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];

  const headers = uniqueHeaders(rows[0].map((header) => header.trim()));
  return rows
    .slice(1)
    .filter((row) => row.some((value) => clean(value)))
    .map((row) => {
      const record = {};
      headers.forEach(({ header, sourceHeader }, index) => {
        const value = clean(row[index]);
        record[header] = MONEY_FIELDS.includes(sourceHeader) ? value : value.trim();
      });
      return record;
    });
}

function uniqueHeaders(headers) {
  const counts = new Map();

  return headers.map((header, index) => {
    const sourceHeader = header || `Column ${index + 1}`;
    const count = (counts.get(sourceHeader) || 0) + 1;
    counts.set(sourceHeader, count);
    return {
      sourceHeader,
      header: count === 1 ? sourceHeader : `${sourceHeader}__${count}`,
    };
  });
}

export function inferPayPeriodFromIncomeCsv(incomeCsv) {
  const paidDates = parseCsv(incomeCsv)
    .map((row) => parseDate(row["Date Paid"]))
    .filter(Boolean)
    .sort((a, b) => a.getTime() - b.getTime());

  if (paidDates.length === 0) return null;

  const firstDate = paidDates[0];
  const year = firstDate.getFullYear();
  const month = firstDate.getMonth();
  const day = firstDate.getDate();
  const startDate = day >= 25 ? new Date(year, month, 25) : new Date(year, month - 1, 25);
  const endDate = day >= 25 ? new Date(year, month + 1, 24) : new Date(year, month, 24);

  return {
    start: dateInputValue(startDate),
    end: dateInputValue(endDate),
  };
}

export function classifySessionType(code) {
  const normalized = clean(code).match(/\d{5}/)?.[0] || "";

  if (["90837", "90834", "90832", "90839", "90840"].includes(normalized)) {
    return "individual";
  }
  if (["90847", "90846"].includes(normalized)) return "couplesFamily";
  if (normalized === "90853") return "group";
  if (normalized === "90791") return "intake";
  return "other";
}

function ensureClinician(clinicians, name) {
  if (!clinicians[name]) {
    clinicians[name] = {
      name,
      cashReceived: {
        totalCents: 0,
        insuranceCents: 0,
        clientCents: 0,
        otherCents: 0,
      },
      sessionCounts: {
        total: 0,
        individual: 0,
        couplesFamily: 0,
        group: 0,
        intake: 0,
        other: 0,
      },
      paymentRows: [],
      appointmentRows: [],
      trailingPayments: [],
      splitPaymentRows: [],
      unmatchedPayments: [],
      unmatchedAppointments: [],
    };
  }
  return clinicians[name];
}

function finalizeClinicians(clinicians, contracts, clinicIncome) {
  return Object.fromEntries(
    Object.entries(clinicians).map(([name, clinician]) => [
      name,
      finalizeClinician({
        ...clinician,
        contract: normalizeContract(contracts[name]),
        cashReceived: centsSummary({
          total: clinician.cashReceived.totalCents,
          insurance: clinician.cashReceived.insuranceCents,
          client: clinician.cashReceived.clientCents,
          other: clinician.cashReceived.otherCents,
        }),
      }, clinicIncome),
    ]),
  );
}

function finalizeClinician(clinician, clinicIncome) {
  const pay = calculatePay(clinician, clinicIncome);
  return {
    ...clinician,
    pay,
  };
}

function calculatePay(clinician, clinicIncome) {
  const contract = clinician.contract;
  const type = contract.payType;

  if (type === "flat_session") {
    const total = clinician.sessionCounts.total * contract.flatRate;
    return payResult(total, `${formatMoney(contract.flatRate)} per kept session`);
  }

  if (type === "per_session") {
    const total = SESSION_TYPES.reduce((sum, sessionType) => {
      return sum + clinician.sessionCounts[sessionType] * (contract.sessionRates[sessionType] || 0);
    }, 0);
    return payResult(total, "Session-type rates applied to kept appointments");
  }

  if (type === "percent_collections") {
    const total = clinician.cashReceived.total * (contract.percentage / 100);
    return payResult(total, `${contract.percentage}% of cash received for this clinician`);
  }

  if (contract.needsReview) {
    return payResult(0, "Legacy percent-of-clinic-income rule needs review");
  }

  return payResult(0, "No pay rule selected");
}

function payResult(total, explanation) {
  return {
    total: centsToMoney(moneyToCents(total)),
    explanation,
  };
}

function normalizeContract(contract = {}) {
  const payType = contract.payType === "percent_clinic_income"
    ? "none"
    : contract.payType || "none";
  const needsReview = Boolean(contract.needsReview || contract.payType === "percent_clinic_income");

  return {
    payType,
    legacyPayType: needsReview ? "percent_clinic_income" : "",
    needsReview,
    incomeBasis: contract.incomeBasis || "gross",
    flatRate: Number(contract.flatRate || 0),
    percentage: Number(contract.percentage || 0),
    sessionRates: {
      individual: Number(contract.sessionRates?.individual || 0),
      couplesFamily: Number(contract.sessionRates?.couplesFamily || 0),
      group: Number(contract.sessionRates?.group || 0),
      intake: Number(contract.sessionRates?.intake || 0),
      other: Number(contract.sessionRates?.other || 0),
    },
  };
}

function buildWarnings(clinicians, contracts, period) {
  const warnings = [];

  for (const clinician of Object.values(clinicians)) {
    if (clinician.contract.needsReview) {
      warnings.push({
        type: "legacy_pay_rule",
        clinician: clinician.name,
        message: `${clinician.name} has a legacy percent-of-clinic-income rule and needs a new pay agreement.`,
      });
    } else if (!contracts[clinician.name] || clinician.contract.payType === "none") {
      warnings.push({
        type: "missing_contract",
        clinician: clinician.name,
        message: `${clinician.name} needs a pay rule before payroll is final.`,
      });
    } else if (isZeroValueContract(clinician.contract, clinician)) {
      warnings.push({
        type: "zero_value_pay_rule",
        clinician: clinician.name,
        message: `${clinician.name} has a configured pay rule that currently calculates zero pay because a required rate or percentage is zero.`,
      });
    }

    if (clinician.sessionCounts.total > 0 && clinician.cashReceived.total === 0) {
      warnings.push({
        type: "sessions_without_cash",
        clinician: clinician.name,
        message: `${clinician.name} has kept sessions but no cash received this period.`,
      });
    }

    if (clinician.cashReceived.total > 0 && clinician.sessionCounts.total === 0) {
      warnings.push({
        type: "cash_without_sessions",
        clinician: clinician.name,
        message: `${clinician.name} has cash received but no matching sessions in the appointment report.`,
      });
    }

    for (const payment of clinician.paymentRows) {
      if (payment.lagBucket === "aged_trailing_service") {
        warnings.push({
          type: "old_service_payment",
          clinician: clinician.name,
          message: `${clinician.name} received ${formatMoney(payment.amount)} for ${payment.client} ${payment.lagDays} days after service date ${payment.serviceDate}.`,
          nextAction: `Review ${clinician.name}'s trailing-payment detail for ${payment.client} on service date ${payment.serviceDate}. Keep it if the payment was received in this pay period; otherwise check the income allocation appointment date or payment date.`,
        });
      }
    }
  }

  return warnings;
}

function isZeroValueContract(contract, clinician) {
  if (contract.payType === "flat_session") return Number(contract.flatRate || 0) <= 0;
  if (contract.payType === "percent_collections") return Number(contract.percentage || 0) <= 0;
  if (contract.payType !== "per_session") return false;

  const rates = contract.sessionRates || {};
  const allRatesZero = Object.values(rates).every((rate) => Number(rate || 0) <= 0);
  if (allRatesZero) return true;

  return SESSION_TYPES.some((sessionType) => {
    const count = Number(clinician.sessionCounts?.[sessionType] || 0);
    return count > 0 && Number(rates[sessionType] || 0) <= 0;
  });
}

function centsSummary(cents) {
  return {
    total: centsToMoney(cents.total),
    insurance: centsToMoney(cents.insurance),
    client: centsToMoney(cents.client),
    other: centsToMoney(cents.other),
  };
}

function buildClinicIncome(incomeCents, reconciliation) {
  const knownStripeFeeCents = moneyToCents(reconciliation.stripeFees);
  const estimatedStripeFeeCents = moneyToCents(reconciliation.stripeEstimatedFees);
  const processingFeeCents = reconciliation.processingFeeStatus === "actual"
    ? knownStripeFeeCents
    : reconciliation.processingFeeStatus === "estimated"
      ? estimatedStripeFeeCents
      : 0;
  const netCents = {
    total: incomeCents.total - knownStripeFeeCents,
    insurance: incomeCents.insurance,
    client: Math.max(0, incomeCents.client - knownStripeFeeCents),
    other: incomeCents.other,
  };
  const netAfterProcessingFeeCents = {
    total: incomeCents.total - processingFeeCents,
    insurance: incomeCents.insurance,
    client: Math.max(0, incomeCents.client - processingFeeCents),
    other: incomeCents.other,
  };

  return {
    ...centsSummary(incomeCents),
    knownStripeFees: centsToMoney(knownStripeFeeCents),
    estimatedStripeFees: centsToMoney(estimatedStripeFeeCents),
    processingFeeAdjustment: centsToMoney(processingFeeCents),
    processingFeeStatus: reconciliation.processingFeeStatus,
    processingFeeLabel: processingFeeLabel(reconciliation.processingFeeStatus),
    netAfterKnownFees: centsSummary(netCents),
    netAfterProcessingFees: centsSummary(netAfterProcessingFeeCents),
  };
}

function processingFeeLabel(status) {
  if (status === "actual") return "Actual card processing fees";
  if (status === "estimated") return "Estimated card processing fees";
  return "Processing fees unavailable";
}

function buildContributionPnl(clinicIncome, clinicians, reconciliation) {
  const clinicianCompensationCents = Object.values(clinicians).reduce(
    (sum, clinician) => sum + moneyToCents(clinician.pay.total),
    0,
  );
  const processingFeeCents = moneyToCents(clinicIncome.processingFeeAdjustment);
  const revenueCents = moneyToCents(clinicIncome.total);

  return {
    label: "Pay-period contribution PnL",
    fullPnlAvailable: false,
    fullPnlStatus: "Full PnL unavailable: operating expense data was not imported.",
    revenue: clinicIncome.total,
    revenueBySource: {
      insurance: clinicIncome.insurance,
      client: clinicIncome.client,
      other: clinicIncome.other,
    },
    clinicianCompensation: centsToMoney(clinicianCompensationCents),
    processingFees: centsToMoney(processingFeeCents),
    processingFeeStatus: reconciliation.processingFeeStatus,
    contributionResult: centsToMoney(revenueCents - clinicianCompensationCents - processingFeeCents),
  };
}

function buildReconciliation({ cardRows, paymentRows, insuranceRows, insuranceAllocationRows, period, clinicIncomeCents }) {
  const stripeRows = cardRows.filter((row) => isWithinPeriod(row["Available On (UTC)"], period));
  const stripePayoutCents = stripeRows
    .filter((row) => clean(row["Transaction Type"]).toLowerCase() === "payout")
    .reduce((sum, row) => sum + Math.abs(moneyToCents(row.Net)), 0);
  const stripeFeeCents = stripeRows.reduce((sum, row) => sum + Math.abs(moneyToCents(row.Fee)), 0);

  const simplePracticePaymentRows = paymentRows.filter((row) => isWithinPeriod(row["Date Paid"], period));
  const simplePracticePaymentCents = simplePracticePaymentRows.reduce(
    (sum, row) => sum + moneyToCents(row.Amount),
    0,
  );
  const stripeGrossPaymentCents = simplePracticePaymentRows
    .filter((row) => clean(row["Payment type"]).toLowerCase() === "stripe")
    .reduce((sum, row) => sum + moneyToCents(row.Amount), 0);
  const stripeEstimatedFeeCents = simplePracticePaymentRows
    .filter((row) => clean(row["Payment type"]).toLowerCase() === "stripe")
    .reduce((sum, row) => sum + estimateSimplePracticeCardFeeCents(moneyToCents(row.Amount)), 0);

  const insurancePaymentRows = insuranceRows.filter((row) => isWithinPeriod(row["Date Received"], period));
  const insuranceReportCents = insurancePaymentRows.reduce(
    (sum, row) => sum + moneyToCents(row.Amount),
    0,
  );
  const insuranceAllocationCents = insuranceAllocationRows.reduce(
    (sum, row) => sum + insuranceAllocationAmountCents(row),
    0,
  );
  const processingFeeStatus = stripeFeeCents > 0
    ? "actual"
    : stripeGrossPaymentCents > 0
      ? "estimated"
      : "unavailable";

  return {
    stripeDeposits: centsToMoney(stripePayoutCents),
    stripeFees: centsToMoney(stripeFeeCents),
    stripeEstimatedFees: centsToMoney(stripeEstimatedFeeCents),
    processingFeeStatus,
    cardTransactionsAvailable: cardRows.length > 0,
    paymentExportAvailable: paymentRows.length > 0,
    stripeGrossPaymentsAvailable: stripeGrossPaymentCents > 0,
    stripePayoutGapAvailable: stripeGrossPaymentCents > 0 && cardRows.length > 0,
    insurancePaymentReportAvailable: insuranceRows.length > 0,
    insurancePayerAllocationAvailable: insuranceAllocationRows.length > 0,
    paymentExportTotal: centsToMoney(simplePracticePaymentCents),
    stripeGrossPayments: centsToMoney(stripeGrossPaymentCents),
    insurancePayerAllocationTotal: centsToMoney(insuranceAllocationCents),
    insurancePaymentReportTotal: centsToMoney(insuranceReportCents),
    incomeAllocationTotal: centsToMoney(clinicIncomeCents.total),
    paymentExportDifference: centsToMoney(simplePracticePaymentCents - clinicIncomeCents.total),
    insurancePayerAllocationDifference: centsToMoney(insuranceAllocationCents - clinicIncomeCents.insurance),
    insuranceReportDifference: centsToMoney(insuranceReportCents - clinicIncomeCents.insurance),
    stripePayoutGap: centsToMoney(stripeGrossPaymentCents - stripePayoutCents),
    stripeFeesAreKnown: stripeFeeCents > 0,
    stripeFeesAreEstimated: stripeFeeCents === 0 && stripeGrossPaymentCents > 0,
  };
}

function insuranceAllocationAmountCents(row) {
  return moneyToCents(
    row.Amount ||
    row["Amount Paid"] ||
    row["Allocated Amount"] ||
    row["Insurance Amount"] ||
    row.Total,
  );
}

function estimateSimplePracticeCardFeeCents(grossPaymentCents) {
  if (grossPaymentCents <= 0) return 0;
  return Math.round(grossPaymentCents * SIMPLEPRACTICE_CARD_PERCENT + SIMPLEPRACTICE_CARD_FIXED_CENTS);
}

function normalizeIncomeRow(row, source, cents, { index, period }) {
  const paymentDate = clean(row["Date Paid"]);
  const serviceDate = clean(row.Appointment);
  const lagDays = calculateLagDays(paymentDate, serviceDate);
  const lagBucket = classifyPaymentLag(paymentDate, serviceDate, period, lagDays);

  return {
    id: `payment-${index}`,
    clinician: clean(row.Clinician) || "Unassigned",
    datePaid: paymentDate,
    serviceDate,
    billingCode: clean(row.Details),
    sessionType: classifySessionType(row.Details),
    client: clean(row.Client),
    source,
    sourceLabel: clean(row.Source),
    description: clean(row.Description),
    reference: clean(row["Insurance Check/Wire Number"]) || clean(row["Invoice or Claim #"]),
    amount: centsToMoney(cents),
    amountCents: cents,
    url: clean(row["Invoice or Claim URL"]),
    lagDays,
    lagBucket,
    matchStatus: "unmatched",
    matchReason: "No appointment match checked yet",
    appointmentId: "",
  };
}

function normalizeAppointmentRow(row, sessionType, index) {
  const clientPaidCents = moneyToCents(row.Paid);
  const insurancePaidCents = moneyToCents(row.Paid__2);
  const clientUnpaidCents = moneyToCents(row.Unpaid);
  const insuranceUnpaidCents = moneyToCents(row.Unpaid__2);

  return {
    id: `appointment-${index}`,
    serviceDate: clean(row["Date of Service"]),
    serviceDateOnly: dateKey(row["Date of Service"]),
    clinician: clean(row.Clinician) || "Unassigned",
    client: clean(row.Client),
    billingCode: clean(row["Billing Code"]),
    sessionType,
    paymentStatus: clean(row["Client Payment Status"]),
    insurancePaymentStatus: clean(row["Insurance Payment Status"]),
    totalFee: centsToMoney(moneyToCents(row["Total Fee"])),
    clientCharge: centsToMoney(moneyToCents(row.Charge)),
    clientPaid: centsToMoney(clientPaidCents),
    clientUninvoiced: centsToMoney(moneyToCents(row.Uninvoiced)),
    clientUnpaid: centsToMoney(clientUnpaidCents),
    insuranceCharge: centsToMoney(moneyToCents(row.Charge__2)),
    insurancePaid: centsToMoney(insurancePaidCents),
    insuranceWriteOff: centsToMoney(moneyToCents(row["Write-off"] || row["Write Off"] || row.WriteOff)),
    insuranceUnpaid: centsToMoney(insuranceUnpaidCents),
    paidTotal: centsToMoney(clientPaidCents + insurancePaidCents),
    unpaidTotal: centsToMoney(clientUnpaidCents + insuranceUnpaidCents),
    hasSplitPayments: clientPaidCents > 0 && insurancePaidCents > 0,
    matchedPaymentCents: 0,
  };
}

function reconcileLedgers(appointmentLedger, paymentLedger) {
  const appointmentsByKey = new Map();

  for (const appointment of appointmentLedger) {
    const key = appointmentMatchKey(appointment);
    if (!key) continue;
    if (!appointmentsByKey.has(key)) appointmentsByKey.set(key, []);
    appointmentsByKey.get(key).push(appointment);
  }

  const matchedPaymentIds = new Set();
  const ambiguousPayments = [];

  for (const payment of paymentLedger) {
    const key = paymentMatchKey(payment);
    if (!key) {
      payment.matchStatus = "unmatched";
      payment.matchReason = "Missing clinician, client, service date, or CPT code";
      continue;
    }

    const matches = appointmentsByKey.get(key) || [];
    if (matches.length === 1) {
      payment.matchStatus = "matched";
      payment.matchReason = "Matched on clinician, client, service date, and CPT code";
      payment.appointmentId = matches[0].id;
      matches[0].matchedPaymentCents += payment.amountCents;
      matchedPaymentIds.add(payment.id);
      continue;
    }

    payment.matchStatus = matches.length > 1 ? "ambiguous" : "unmatched";
    payment.matchReason = matches.length > 1
      ? "Multiple appointments share the same clinician, client, service date, and CPT code"
      : "No appointment found with the same clinician, client, service date, and CPT code";
    if (matches.length > 1) ambiguousPayments.push(payment);
  }

  const unmatchedPayments = paymentLedger.filter((payment) => payment.matchStatus !== "matched");
  const unmatchedAppointments = appointmentLedger.filter(
    (appointment) => appointment.unpaidTotal > 0 && appointment.matchedPaymentCents === 0,
  );
  const splitPaymentRows = appointmentLedger.filter((appointment) => appointment.hasSplitPayments);

  return {
    matchedPaymentCount: matchedPaymentIds.size,
    unmatchedPayments,
    ambiguousPayments,
    unmatchedAppointments,
    splitPaymentRows,
    unpaidAppointmentBalance: centsToMoney(unmatchedAppointments.reduce(
      (sum, appointment) => sum + moneyToCents(appointment.unpaidTotal),
      0,
    )),
  };
}

function applyLedgerReviewToClinicians(clinicians, ledgerReview) {
  for (const payment of ledgerReview.unmatchedPayments) {
    ensureClinician(clinicians, payment.clinician).unmatchedPayments.push(payment);
  }

  for (const appointment of ledgerReview.unmatchedAppointments) {
    ensureClinician(clinicians, appointment.clinician).unmatchedAppointments.push(appointment);
  }

  for (const appointment of ledgerReview.splitPaymentRows) {
    ensureClinician(clinicians, appointment.clinician).splitPaymentRows.push(appointment);
  }

  for (const clinician of Object.values(clinicians)) {
    clinician.trailingPayments = clinician.paymentRows.filter((payment) => payment.lagBucket !== "current_period_service");
  }
}

function appointmentMatchKey(appointment) {
  return ledgerMatchKey({
    clinician: appointment.clinician,
    client: appointment.client,
    serviceDate: appointment.serviceDate,
    billingCode: appointment.billingCode,
  });
}

function paymentMatchKey(payment) {
  return ledgerMatchKey(payment);
}

function ledgerMatchKey({ clinician, client, serviceDate, billingCode }) {
  const serviceDateOnly = dateKey(serviceDate);
  const cpt = cptKey(billingCode);
  if (!clean(clinician) || !clean(client) || !serviceDateOnly || !cpt) return "";
  return [
    normalizeMatchText(clinician),
    normalizeMatchText(client),
    serviceDateOnly,
    cpt,
  ].join("|");
}

function normalizeMatchText(value) {
  return clean(value).toLowerCase().replace(/\s+/g, " ");
}

function cptKey(value) {
  return clean(value).match(/\d{5}/)?.[0] || "";
}

function calculateLagDays(paymentDateValue, serviceDateValue) {
  const paymentDate = parseDate(paymentDateValue);
  const serviceDate = parseDate(serviceDateValue);
  if (!paymentDate || !serviceDate) return null;
  return daysBetween(serviceDate, paymentDate);
}

function classifyPaymentLag(paymentDateValue, serviceDateValue, period, lagDays) {
  const paymentDate = parseDate(paymentDateValue);
  const serviceDate = parseDate(serviceDateValue);
  if (!paymentDate || !serviceDate) return "missing_service_date";
  if (typeof lagDays === "number" && lagDays > TRAILING_PAYMENT_THRESHOLD_DAYS) return "aged_trailing_service";
  if (period.start && serviceDate < period.start) return "trailing_service";
  return "current_period_service";
}

function buildTrailingSummary(paymentLedger) {
  const trailingRows = paymentLedger.filter((payment) => payment.lagBucket !== "current_period_service");
  const missingServiceDateCount = trailingRows.filter((payment) => payment.lagBucket === "missing_service_date").length;
  const lagValues = paymentLedger
    .map((payment) => payment.lagDays)
    .filter((lagDays) => typeof lagDays === "number");

  return {
    thresholdDays: TRAILING_PAYMENT_THRESHOLD_DAYS,
    count: trailingRows.length,
    amount: centsToMoney(trailingRows.reduce((sum, payment) => sum + payment.amountCents, 0)),
    oldestLagDays: lagValues.length ? Math.max(...lagValues) : 0,
    missingServiceDateCount,
    payments: trailingRows,
  };
}

function classifyIncomeSource(source) {
  const normalized = clean(source).toLowerCase();
  if (normalized.includes("insurance")) return "insurance";
  if (normalized.includes("client")) return "client";
  return "other";
}

function isKeptAppointment(row) {
  const status = clean(row["Appointment Status"] || row.Status).toLowerCase();
  if (!status) return true;
  return ["kept", "show", "showed", "completed", "arrived"].some((word) => status.includes(word));
}

function makePeriod(start, end) {
  return {
    start: parseDate(start),
    end: parseDate(end),
  };
}

function isWithinPeriod(value, period) {
  const date = parseDate(value);
  if (!date) return true;
  if (period.start && date < period.start) return false;
  if (period.end && date > period.end) return false;
  return true;
}

function parseDate(value) {
  const text = clean(value);
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  }

  const usMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) {
    return new Date(Number(usMatch[3]), Number(usMatch[1]) - 1, Number(usMatch[2]));
  }

  const date = new Date(text);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function dateKey(value) {
  const date = parseDate(value);
  return date ? dateInputValue(date) : "";
}

function dateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function moneyToCents(value) {
  const normalized = clean(value).replace(/[$,]/g, "");
  if (!normalized) return 0;
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function centsToMoney(cents) {
  return Math.round(cents) / 100;
}

function sessionLinePay(row, contract) {
  if (contract.payType === "flat_session") return contract.flatRate;
  if (contract.payType === "per_session") return contract.sessionRates[row.sessionType] || 0;
  return "";
}

function csvCell(value) {
  const text = clean(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll("\"", "\"\"")}"`;
  return text;
}

function clean(value) {
  return value == null ? "" : String(value).trim();
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (insideQuotes && char === "\"" && nextChar === "\"") {
      field += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === "," && !insideQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  rows.push(row);

  return rows.filter((parsedRow) => parsedRow.some((value) => clean(value)));
}

function describeContract(contract) {
  if (contract.needsReview) return "Legacy pay rule needs review";
  if (contract.payType === "flat_session") return `${formatMoney(contract.flatRate)} per session`;
  if (contract.payType === "per_session") return "Different rate by session type";
  if (contract.payType === "percent_collections") return `${contract.percentage}% of clinician collections`;
  return "No pay rule selected";
}

function formatSessionType(type) {
  const labels = {
    individual: "Individual",
    couplesFamily: "Couples/Family",
    group: "Group",
    intake: "Intake",
    other: "Other",
  };
  return labels[type] || "Other";
}

function slugify(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "clinician";
}

function daysBetween(earlier, later) {
  return Math.round((later - earlier) / (1000 * 60 * 60 * 24));
}

function escapeHtml(value) {
  return clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
