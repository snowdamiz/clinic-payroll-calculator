# Clinic Payroll Calculator

Chrome side-panel extension for calculating clinic income and clinician pay statements from SimplePractice CSV or Excel exports.

## Load The Extension

1. Open Chrome and go to `chrome://extensions`.
2. Turn on Developer mode.
3. Click Load unpacked.
4. Select `/Users/sn0w/Documents/dev/simp`.

## Prepare Chrome Web Store Upload

Run the full store preparation check:

```sh
npm run store
```

The upload-ready ZIP is written to `dist/chrome-store/clinic-payroll-calculator-0.1.0.zip`.
The ZIP contains only the extension runtime files and the packaged Excel parser dependency, with `manifest.json` at the archive root.

## Use Each Pay Period

1. Click the Clinic Payroll extension icon to open the persistent browser side panel.
2. Set the pay period dates, usually the 25th through the 24th.
3. Import the SimplePractice income allocation CSV, XLSX, or XLS export.
4. Import the appointment status CSV, XLSX, or XLS export for per-session clinicians.
5. Optionally import card transactions, payment export, insurance payment report, and insurance payer allocation exports for reconciliation.
6. Choose each clinician's pay rule:
   - Flat rate per kept session
   - Different rates by session type
   - Percent of that clinician's collections
7. Click Calculate.
8. Use Statement for one clinician, Print All for the full pay-period packet, or Download Ledger ZIP for appointment, payment, split-payment, outlier, and contribution PnL CSVs.

The extension calculates clinic income from actual payments received in the pay-period income allocation export. Appointment dates are used for session-count pay rules, while delayed insurance payments are still counted in the period when they were received.
The results include a pay-period contribution PnL, not a full company PnL; operating expenses need a separate accounting, bank, or expense export before full PnL can be supported.
