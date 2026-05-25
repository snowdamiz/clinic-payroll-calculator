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
  {
    inputId: "insuranceAllocationFile",
    payloadKey: "insuranceAllocationCsv",
    label: "Insurance payer allocation",
    fileHints: ["insurance payer allocation", "insurance_payer_allocation", "payer allocation"],
    requiredHeaders: ["Clinician", "Payer", "Amount"],
  },
];

const DEFAULT_CANDIDATE_OPTIONS = {
  maxFiles: 25,
  maxBytes: 50 * 1024 * 1024,
  maxFileBytes: 20 * 1024 * 1024,
  maxNameMatchesPerRole: 4,
  maxFallbackFiles: 8,
};

export function inferImportFiles(files) {
  const assignments = {};
  const unmatched = [];
  const duplicates = [];
  const fingerprints = new Map();
  const uniqueFiles = [];

  for (const file of files) {
    const fingerprint = fingerprintImportFile(file);
    const duplicateOf = fingerprints.get(fingerprint);
    if (duplicateOf) {
      duplicates.push({ file, duplicateOf, fingerprint });
      unmatched.push(file);
      continue;
    }
    fingerprints.set(fingerprint, file);
    uniqueFiles.push(file);
  }

  const matches = uniqueFiles.map((file) => ({ file, role: inferFileRole(file) }));

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
    duplicates,
    missing: ROLE_SPECS.filter((role) => !assignments[role.inputId]),
  };
}

export function fingerprintImportFile(file) {
  const role = inferFileRole(file)?.inputId || "unknown";
  const text = normalizeForFingerprint(file?.text || "");
  return `${role}:${hashText(text)}`;
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

export function prioritizeImportCandidates(files, options = {}) {
  const settings = {
    ...DEFAULT_CANDIDATE_OPTIONS,
    ...options,
  };
  const entries = files.map((file, index) => ({
    file,
    index,
    size: Number(file?.size || 0),
    roleScores: ROLE_SPECS.map((role) => ({
      role,
      score: scoreFileName(file, role),
    })).filter(({ score }) => score > 0),
  }));
  const selected = new Map();
  const oversized = new Set();
  let selectedBytes = 0;

  function trySelect(entry) {
    if (selected.has(entry.index)) return false;
    if (settings.maxFiles && selected.size >= settings.maxFiles) return false;
    if (settings.maxFileBytes && entry.size > settings.maxFileBytes) {
      oversized.add(entry.index);
      return false;
    }
    if (settings.maxBytes && entry.size && selectedBytes + entry.size > settings.maxBytes) return false;

    selected.set(entry.index, entry);
    selectedBytes += entry.size;
    return true;
  }

  for (const role of ROLE_SPECS) {
    let selectedForRole = 0;
    const roleEntries = entries
      .filter((entry) => entry.roleScores.some((roleScore) => roleScore.role.inputId === role.inputId))
      .sort((a, b) => compareCandidatesForRole(a, b, role));
    for (const entry of roleEntries) {
      if (selectedForRole >= settings.maxNameMatchesPerRole) break;
      if (trySelect(entry)) selectedForRole += 1;
    }
  }

  entries
    .filter((entry) => entry.roleScores.length === 0)
    .sort(compareFallbackCandidates)
    .slice(0, settings.maxFallbackFiles)
    .forEach(trySelect);

  const candidates = [...selected.values()]
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.file);
  const skipped = entries
    .filter((entry) => !selected.has(entry.index) && !oversized.has(entry.index))
    .map((entry) => entry.file);

  return {
    candidates,
    skipped,
    oversized: [...oversized].map((index) => files[index]),
    supportedCount: files.length,
    selectedBytes,
  };
}

function scoreFile(file, role) {
  const name = clean(file.name).toLowerCase();
  const headers = firstCsvHeaders(file.text);
  const headerSet = new Set(headers.map((header) => header.toLowerCase()));
  const headerScore = role.requiredHeaders.filter((header) => headerSet.has(header.toLowerCase())).length;
  const nameScore = scoreFileName({ name }, role);

  if (headerScore >= Math.min(3, role.requiredHeaders.length)) return headerScore * 10 + nameScore;
  return nameScore;
}

function scoreFileName(file, role) {
  const name = clean(file?.name).toLowerCase();
  return role.fileHints.some((hint) => name.includes(hint)) ? 2 : 0;
}

function compareCandidatesForRole(a, b, role) {
  const roleScoreDifference = roleScore(b, role) - roleScore(a, role);
  if (roleScoreDifference) return roleScoreDifference;
  return compareNewestThenSmallest(a, b);
}

function compareFallbackCandidates(a, b) {
  const csvDifference = isCsvLike(b.file) - isCsvLike(a.file);
  if (csvDifference) return csvDifference;
  return compareNewestThenSmallest(a, b);
}

function compareNewestThenSmallest(a, b) {
  const newestDifference = Number(b.file?.lastModified || 0) - Number(a.file?.lastModified || 0);
  if (newestDifference) return newestDifference;
  const sizeDifference = a.size - b.size;
  if (sizeDifference) return sizeDifference;
  return a.index - b.index;
}

function roleScore(entry, role) {
  return entry.roleScores.find((roleScoreEntry) => roleScoreEntry.role.inputId === role.inputId)?.score || 0;
}

function isCsvLike(file) {
  return /\.csv$/i.test(String(file?.name || ""));
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

function normalizeForFingerprint(text) {
  return clean(text)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function clean(value) {
  return value == null ? "" : String(value).trim();
}
