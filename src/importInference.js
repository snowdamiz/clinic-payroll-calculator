const ROLE_SPECS = [
  {
    inputId: "incomeFile",
    payloadKey: "incomeCsv",
    label: "Income allocation",
    fileHints: ["pay period", "income allocation"],
    requiredHeaders: ["Clinician", "Source", "Date Paid", "Appointment", "Amount Paid"],
  },
  {
    inputId: "appointmentFile",
    payloadKey: "appointmentCsv",
    label: "Appointment status",
    fileHints: ["appointment-status", "appointment status"],
    requiredHeaders: ["Date of Service", "Client", "Clinician", "Billing Code", "Client Payment Status"],
  },
  {
    inputId: "cardFile",
    payloadKey: "cardTransactionsCsv",
    label: "Card transactions",
    fileHints: ["card_transactions", "card transactions", "transactions report"],
    requiredHeaders: ["Transaction ID", "Transaction Type", "Amount", "Fee", "Net", "Available On (UTC)"],
  },
  {
    inputId: "paymentFile",
    payloadKey: "paymentExportCsv",
    label: "Payment export",
    fileHints: ["paymentexport", "payment export"],
    requiredHeaders: ["Payment ID", "Date Paid", "Account", "Payment type", "Name", "Amount"],
  },
  {
    inputId: "insuranceFile",
    payloadKey: "insurancePaymentsCsv",
    label: "Insurance payments",
    fileHints: ["insurance_payment", "insurance payment"],
    requiredHeaders: ["Date Received", "Client", "Payer", "Amount", "Payment Reference"],
  },
];

export function inferImportFiles(files) {
  const assignments = {};
  const unmatched = [];
  const matches = files.map((file) => ({ file, role: inferFileRole(file) }));

  for (const { file, role } of matches) {
    if (!role) {
      unmatched.push(file);
      continue;
    }

    const current = assignments[role.inputId];
    if (!current || scoreFile(file, role) > scoreFile(current, role)) {
      if (current) unmatched.push(current);
      assignments[role.inputId] = file;
    } else {
      unmatched.push(file);
    }
  }

  return {
    assignments,
    unmatched,
    missing: ROLE_SPECS.filter((role) => !assignments[role.inputId]),
  };
}

export function inferFileRole(file) {
  const scoredRoles = ROLE_SPECS.map((role) => ({
    role,
    score: scoreFile(file, role),
  })).sort((a, b) => b.score - a.score);

  return scoredRoles[0]?.score > 0 ? scoredRoles[0].role : null;
}

export function importRoleSpecs() {
  return ROLE_SPECS.map((role) => ({ ...role }));
}

function scoreFile(file, role) {
  const name = clean(file.name).toLowerCase();
  const headers = firstCsvHeaders(file.text);
  const headerSet = new Set(headers.map((header) => header.toLowerCase()));
  const headerScore = role.requiredHeaders.filter((header) => headerSet.has(header.toLowerCase())).length;
  const nameScore = role.fileHints.some((hint) => name.includes(hint)) ? 2 : 0;

  if (headerScore >= Math.min(3, role.requiredHeaders.length)) return headerScore * 10 + nameScore;
  return nameScore;
}

function firstCsvHeaders(text) {
  const firstLine = clean(text).split(/\r?\n/, 1)[0] || "";
  return parseCsvLine(firstLine).map((header) => header.trim());
}

function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

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
      fields.push(field);
      field = "";
      continue;
    }

    field += char;
  }

  fields.push(field);
  return fields;
}

function clean(value) {
  return value == null ? "" : String(value).trim();
}
