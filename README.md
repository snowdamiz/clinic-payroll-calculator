# Clinic Payroll Calculator

Chrome extension for calculating clinic income and clinician pay statements from SimplePractice CSV or Excel exports.

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

1. Set the pay period dates, usually the 25th through the 24th.
2. Import the SimplePractice income allocation CSV, XLSX, or XLS export.
3. Import the appointment status CSV, XLSX, or XLS export for per-session clinicians.
4. Optionally import card transactions, payment export, and insurance payment reports for reconciliation.
5. Choose each clinician's pay rule:
   - Flat rate per kept session
   - Different rates by session type
   - Percent of that clinician's collections
   - Percent of total clinic income
6. Click Calculate.
7. Use Statement for one clinician or Print All for the full pay-period packet.

The extension calculates clinic income from actual payments received in the pay-period income allocation export. Appointment dates are used for session-count pay rules, while delayed insurance payments are still counted in the period when they were received.
