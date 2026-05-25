const MONEY_FIELDS = ["Amount Paid", "Paid", "Charge", "Net", "Fee", "Amount"];
const SESSION_TYPES = ["individual", "couplesFamily", "group", "intake", "other"];
const SIMPLEPRACTICE_CARD_PERCENT = 0.0315;
const SIMPLEPRACTICE_CARD_FIXED_CENTS = 30;

export function buildPayrollReport({
  incomeCsv = "",
  appointmentCsv = "",
  cardTransactionsCsv = "",
  paymentExportCsv = "",
  insurancePaymentsCsv = "",
  contracts = {},
  periodStart,
  periodEnd,
} = {}) {
  const incomeRows = parseCsv(incomeCsv);
  const appointmentRows = parseCsv(appointmentCsv);
  const cardRows = parseCsv(cardTransactionsCsv);
  const paymentRows = parseCsv(paymentExportCsv);
  const insuranceRows = parseCsv(insurancePaymentsCsv);
  const period = makePeriod(periodStart, periodEnd);
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
    clinician.paymentRows.push(normalizeIncomeRow(row, source, cents));
  }

  for (const row of appointmentRows) {
    if (!isWithinPeriod(row["Date of Service"], period)) continue;
    if (!isKeptAppointment(row)) continue;

    const clinicianName = clean(row.Clinician) || "Unassigned";
    const sessionType = classifySessionType(row["Billing Code"]);
    const clinician = ensureClinician(clinicians, clinicianName);
    clinician.sessionCounts.total += 1;
    clinician.sessionCounts[sessionType] += 1;
    clinician.appointmentRows.push(normalizeAppointmentRow(row, sessionType));
  }

  const reconciliation = buildReconciliation({
    cardRows,
    paymentRows,
    insuranceRows,
    period,
    clinicIncomeCents: incomeCents,
  });
  const clinicIncome = buildClinicIncome(incomeCents, reconciliation);
  const finalizedClinicians = finalizeClinicians(clinicians, contracts, clinicIncome);

  return {
    period: {
      start: periodStart || "",
      end: periodEnd || "",
    },
    clinicIncome,
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
  const payIsPending = clinician.contract.payType === "percent_clinic_income";
  const calculatedPay = payIsPending ? "Pending" : clinician.pay.total;
  const payBasis = payIsPending
    ? "Pending - total clinic income percentage requires overhead adjustments"
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

  const headers = rows[0].map((header) => header.trim());
  return rows
    .slice(1)
    .filter((row) => row.some((value) => clean(value)))
    .map((row) => {
      const record = {};
      headers.forEach((header, index) => {
        const value = clean(row[index]);
        record[header] = MONEY_FIELDS.includes(header) ? value : value.trim();
      });
      return record;
    });
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

  if (type === "percent_clinic_income") {
    const useNetAfterProcessingFees =
      contract.incomeBasis === "net_after_processing_fees" ||
      contract.incomeBasis === "net_after_known_fees";
    const basisTotal = useNetAfterProcessingFees
      ? clinicIncome.netAfterProcessingFees.total
      : clinicIncome.total;
    const basisLabel = useNetAfterProcessingFees
      ? "net clinic income after card processing fees"
      : "total clinic income received in this pay period";
    const total = basisTotal * (contract.percentage / 100);
    return payResult(
      total,
      `${contract.percentage}% of ${basisLabel}`,
    );
  }

  if (type === "percent_collections") {
    const total = clinician.cashReceived.total * (contract.percentage / 100);
    return payResult(total, `${contract.percentage}% of cash received for this clinician`);
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
  return {
    payType: contract.payType || "none",
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
    if (!contracts[clinician.name]) {
      warnings.push({
        type: "missing_contract",
        clinician: clinician.name,
        message: `${clinician.name} needs a pay rule before payroll is final.`,
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
      const serviceDate = parseDate(payment.serviceDate);
      if (period.start && serviceDate && daysBetween(serviceDate, period.start) > 45) {
        warnings.push({
          type: "old_service_payment",
          clinician: clinician.name,
          message: `${clinician.name} received ${formatMoney(payment.amount)} for ${payment.client} from service date ${payment.serviceDate}.`,
        });
      }
    }
  }

  return warnings;
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
  const processingFeeCents = knownStripeFeeCents || estimatedStripeFeeCents;
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
    netAfterKnownFees: centsSummary(netCents),
    netAfterProcessingFees: centsSummary(netAfterProcessingFeeCents),
  };
}

function buildReconciliation({ cardRows, paymentRows, insuranceRows, period, clinicIncomeCents }) {
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

  return {
    stripeDeposits: centsToMoney(stripePayoutCents),
    stripeFees: centsToMoney(stripeFeeCents),
    stripeEstimatedFees: centsToMoney(stripeEstimatedFeeCents),
    paymentExportTotal: centsToMoney(simplePracticePaymentCents),
    stripeGrossPayments: centsToMoney(stripeGrossPaymentCents),
    insurancePaymentReportTotal: centsToMoney(insuranceReportCents),
    incomeAllocationTotal: centsToMoney(clinicIncomeCents.total),
    paymentExportDifference: centsToMoney(simplePracticePaymentCents - clinicIncomeCents.total),
    insuranceReportDifference: centsToMoney(insuranceReportCents - clinicIncomeCents.insurance),
    stripePayoutGap: centsToMoney(stripeGrossPaymentCents - stripePayoutCents),
    stripeFeesAreKnown: stripeFeeCents > 0,
  };
}

function estimateSimplePracticeCardFeeCents(grossPaymentCents) {
  if (grossPaymentCents <= 0) return 0;
  return Math.round(grossPaymentCents * SIMPLEPRACTICE_CARD_PERCENT + SIMPLEPRACTICE_CARD_FIXED_CENTS);
}

function normalizeIncomeRow(row, source, cents) {
  return {
    datePaid: clean(row["Date Paid"]),
    serviceDate: clean(row.Appointment),
    billingCode: clean(row.Details),
    sessionType: classifySessionType(row.Details),
    client: clean(row.Client),
    source,
    sourceLabel: clean(row.Source),
    description: clean(row.Description),
    reference: clean(row["Insurance Check/Wire Number"]) || clean(row["Invoice or Claim #"]),
    amount: centsToMoney(cents),
    url: clean(row["Invoice or Claim URL"]),
  };
}

function normalizeAppointmentRow(row, sessionType) {
  return {
    serviceDate: clean(row["Date of Service"]),
    client: clean(row.Client),
    billingCode: clean(row["Billing Code"]),
    sessionType,
    paymentStatus: clean(row["Client Payment Status"]),
    charge: centsToMoney(moneyToCents(row.Charge)),
    paid: centsToMoney(moneyToCents(row.Paid)),
    unpaid: centsToMoney(moneyToCents(row.Unpaid)),
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
  if (contract.payType === "flat_session") return `${formatMoney(contract.flatRate)} per session`;
  if (contract.payType === "per_session") return "Different rate by session type";
  if (contract.payType === "percent_clinic_income") return `${contract.percentage}% of clinic income`;
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
