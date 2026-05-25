# Payroll Reporting Expansion Plan

Date: 2026-05-25

## Reader And Outcome

This plan is for the engineer extending the clinic payroll calculator. After reading it, they should be able to implement the supported reporting changes and know which requested items are blocked by missing data.

## Request

Support the following where the provided SimplePractice sample data makes it possible:

- Trailing sessions and late-payment outliers.
- Track appointments and payments.
- Track split payments correctly when insurance and the client each pay a portion.
- Remove the obsolete percent-of-clinic-income pay rule.
- Add PnL support.
- Persist clinician pay rules between side-panel sessions and keep Reset from clearing them.

## Data Reviewed

The sample folder includes these usable exports:

| Export | Rows | Supported uses |
| --- | ---: | --- |
| Pay period report | 594 | Cash received by clinician, payment source, payment date, service date, invoice or claim reference, payment amount. |
| Appointment status report | 376 | Appointments, CPT code, clinician, payer names, total fee, client payment status, insurance payment status, client-side balances, insurance-side balances, write-offs. |
| Insurance payer allocation report | 41 | Insurance allocated by payer and clinician. Its detail rows reconcile to the pay-period insurance total. |
| Insurance payment report | 58 | Insurance payment receipts by received date, client, payer, amount, claim/reference values. Useful for reconciliation only when its exported date range matches the pay period. |
| Card transactions report | 16 | Bank payout totals by available date. In the sample it contains payout rows only, with no card charge or fee rows. |

There are two identical copies of the pay period report. Import logic should avoid double-counting duplicate files if multi-file import grows beyond one selected file per role.

## Support Decision

| Requested capability | Supported by sample data? | Decision |
| --- | --- | --- |
| Trailing sessions and late-payment outliers | Yes | Implement from the pay period report by comparing payment date to appointment date. |
| Track appointments and payments | Yes, with matching caveats | Implement normalized appointment and payment ledgers, then match payments to appointments with explicit unmatched buckets. |
| Split payments | Yes | Implement from the appointment status report and pay period report, but first fix duplicate appointment headers. |
| Percent of clinic income no longer exists | Yes | Remove the pay rule and migrate saved legacy rules to a needs-review state. |
| PnL | Partially | Implement a pay-period contribution PnL. Full PnL is blocked until an expense ledger or accounting export is provided. |
| Persistent clinician rules | Yes | Store clinician rules separately from imported files and pay-period draft state. |

## Important Data Constraints

The appointment status CSV repeats the headers `Charge`, `Paid`, and `Unpaid`. The first set belongs to the client balance and the second set belongs to the insurance balance. A plain object keyed by header name will overwrite the client values with the insurance values. Split-payment work must start by parsing those duplicate headers by position.

The sample appointment status report contains rows where both client and insurance payments are present on the same appointment. It also contains many appointments with remaining insurance balances. That is enough to build split-payment views and unpaid/outlier reporting.

The pay period report contains payment date and appointment date. In the sample, many payments received in the 2026-04-25 to 2026-05-24 pay period belong to appointments before 2026-04-25. That is enough to classify late payments and trailing-session collections.

The card transaction report cannot provide actual card processing fees in this sample because it only includes payout rows and fee values are zero. Card fees can only be known if charge/fee rows or a SimplePractice payment export are supplied. Otherwise, show the fee source as unavailable or estimated only when an eligible payment export exists.

The sample does not include rent, admin payroll, software, taxes, benefits, refunds, adjustments, owner draws, or other operating expense data. A full PnL is therefore not possible from the provided files alone.

## Implementation Plan

### 1. Normalize Imports

Create a normalized import layer that produces stable ledgers instead of passing raw CSV rows directly into calculations.

- Add duplicate-header handling for appointment status exports.
- Rename client-side appointment columns to client charge, client paid, client unpaid, and client uninvoiced.
- Rename insurance-side appointment columns to insurance charge, insurance paid, insurance write-off, and insurance unpaid.
- Preserve the existing pay period report fields for clinician, source, date paid, appointment date, CPT/detail, client, reference, URL, and amount paid.
- Add an optional insurance payer allocation import role.
- Add file fingerprinting for duplicate export detection.
- Keep all calculations local and avoid storing raw sample client names in tests or screenshots.

### 2. Add Trailing Session And Outlier Reporting

Use the pay period report as the source of actual cash received.

- Calculate `lagDays` for each payment as payment date minus appointment date.
- Classify payments as current-period service, trailing service, aged trailing service, or missing appointment date.
- Add summary cards for trailing payment count, trailing payment dollars, oldest lag, and payments missing service dates.
- Add clinician-level outlier tables so late payments can be reviewed without hunting through statements.
- Keep the existing warning behavior, but make the threshold visible and report more than the first ten items through a drill-down or export.

### 3. Track Appointments And Payments Together

Build two first-class ledgers:

- Appointment ledger: one row per appointment from the appointment status report.
- Payment ledger: one row per payment from the pay period report.

Match payments to appointments with a conservative matching strategy:

- Exact match on clinician, client, service date, and CPT code when all are present.
- Grouped match when a session has multiple payment rows, such as client payment plus insurance payment.
- Unmatched payment bucket when service detail is missing or ambiguous.
- Unmatched appointment bucket for sessions with unpaid balances and no received payment in the period.

Do not hide ambiguous matches. Same client, clinician, date, and CPT can collide if there are multiple same-day sessions and no unique appointment ID in the export.

### 4. Track Split Payments Correctly

Use appointment status for expected split responsibility and pay period report for actual cash received.

- For each appointment, show total fee, client charge, client paid, client unpaid, insurance charge, insurance paid, insurance write-off, and insurance unpaid.
- For cash-basis payroll, continue paying collection-based clinicians from actual received payment rows.
- For session-based payroll, count the appointment once even when both insurance and client payment rows exist.
- Reconcile appointment status paid totals to pay period received totals by clinician and source, with expected timing differences called out.
- Include split-payment detail in clinician statement exports.

### 5. Remove Obsolete Percent-Of-Clinic-Income Pay Rule

The current app still exposes a percent-of-total-clinic-income rule. Remove it from active payroll setup.

- Remove it from the pay-rule selector and help text.
- Migrate saved contracts using that rule to a needs-review/no-rule state.
- Show a clear legacy warning so the user knows which clinicians need a new agreement.
- Keep percent-of-clinician-collections if that agreement still exists.
- Update tests so obsolete clinic-income percentage behavior is not treated as supported payroll logic.

### 6. Add Contribution PnL, Not Full PnL

Build an MVP contribution PnL from supported data:

- Revenue: total pay period income allocation.
- Revenue by source: insurance payments, client payments, other payments.
- Clinician compensation: calculated clinician payroll from active pay rules.
- Card processing fees: actual only when fee rows are supplied, estimated only when an eligible payment export is supplied, unavailable otherwise.
- Contribution result: revenue minus clinician compensation minus known or estimated processing fees.

Label this as a pay-period contribution PnL, not a full company PnL.

Full PnL requires another source for operating expenses. Accept one of these before claiming full PnL support:

- Accounting export.
- Bank or card expense export.
- Manual expense CSV template with category, vendor, date, amount, and optional notes.
- Payroll/tax/benefit expense source if those should be included separately from clinician compensation.

### 7. UI And Export Changes

Add a review-oriented reporting surface:

- Results dashboard: income, clinician compensation, processing fees, contribution result, trailing payments, unpaid appointment balances.
- Clinician detail: session counts, split payment rows, trailing collections, unmatched appointments/payments.
- Reconciliation panel: income allocation vs insurance payer allocation, insurance payment report, card deposits, and payment export when present.
- CSV exports for appointment ledger, payment ledger, split-payment detail, outlier payments, and contribution PnL.

### 8. Persist Clinician Rules Separately From Runs

Clinician pay rules should behave like durable setup, not like pay-period import state.

- Save clinician rules to dedicated clinician-rules storage when edited.
- Restore those rules when the side panel opens and when new exports are imported.
- Make Reset clear dates, imported files, and calculated results only.
- Do not let stale draft imports overwrite newer saved clinician rules.
- Keep a manual Save Rules action as an explicit confirmation path, but do not require it for ordinary persistence.

### 9. Tests And Verification

Add tests for:

- Duplicate appointment headers preserving both client and insurance values.
- Split appointment rows where client and insurance both paid.
- Session-based pay counting one appointment once despite split payments.
- Collection-based pay including both client and insurance payment rows.
- Late-payment lag and outlier classification.
- Duplicate export detection.
- Obsolete clinic-income percentage rules migrating to needs-review.
- Contribution PnL showing unavailable fee or full-PnL states honestly.
- Clinician rules auto-saving and surviving Reset.

Use anonymized fixtures derived from the sample shape rather than real client names.

## Not Possible From The Provided Data Alone

- Full company PnL, because operating expenses are not present.
- Exact appointment identity in every edge case, because the appointment status export does not include a unique appointment ID.
- Actual card processing fee detail from the provided card transaction file, because it only contains payout rows with zero fees.
- Reliable insurance-payment-report reconciliation unless the insurance payment report covers the same date range as the pay period.

## Acceptance Criteria

- Late payments are visible by clinician, amount, service date, payment date, and lag.
- Appointment and payment ledgers can be exported separately and reviewed together.
- Split client/insurance balances are preserved and never overwritten by duplicate CSV headers.
- Collection-based pay includes all actual received portions without double-counting sessions.
- The obsolete percent-of-clinic-income rule is no longer selectable for new payroll runs.
- The PnL view is clearly labeled as contribution PnL unless a complete expense source is imported.
- Missing data is reported as unavailable, not silently estimated.
- Clinician pay rules persist across side-panel reopen and are not cleared by Reset.
