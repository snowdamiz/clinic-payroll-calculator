# Chrome Web Store Submission Notes

## Upload Package

Run:

```sh
npm run store
```

Upload:

```text
dist/chrome-store/clinic-payroll-calculator-0.1.0.zip
```

The package contains `manifest.json`, `sidepanel.html`, `src/`, `icons/`, and the packaged Excel parser dependency only. `manifest.json` is at the ZIP root.

## Store Listing

Name:

```text
Clinic Payroll Calculator
```

Short description:

```text
Calculate clinic income and clinician pay statements from SimplePractice exports.
```

Detailed description:

```text
Clinic Payroll Calculator helps clinics calculate pay-period income and clinician pay statements from SimplePractice CSV or Excel exports.

Import income allocation, appointment status, card transaction, payment, and insurance payment CSV or Excel reports. The extension identifies clinicians, applies each clinician's configured pay rule, summarizes gross income, processing fees, net income, reconciliation gaps, kept sessions, and calculated pay.

Supported pay rules include flat rate per kept session, different rates by session type, percent of clinician collections, and percent of total clinic income. Results can be printed as clinician statements or exported as summary and clinician-level CSV files.

All processing happens locally in the browser. The extension does not send file contents, client names, clinician names, payments, appointments, or payroll results to any external server.
```

Category:

```text
Productivity
```

Single purpose:

```text
Calculate clinic income and clinician pay statements from user-selected SimplePractice CSV or Excel exports.
```

## Permission Justifications

`storage`:

```text
Used to save clinician pay rules and the current local draft so the side panel can restore payroll work between sessions.
```

`unlimitedStorage`:

```text
Used to keep larger user-selected SimplePractice CSV or Excel exports in local Chrome extension storage without interrupting payroll workflows due to the default storage quota.
```

`sidePanel`:

```text
Used to display the payroll calculator in Chrome's persistent browser side panel so file picker interactions do not close the extension UI.
```

## Privacy Practices

Suggested dashboard disclosures:

```text
The extension processes user-selected CSV or Excel exports locally in the browser. Files may include client names, clinician names, appointment dates, billing/CPT codes, payment amounts, payer names, payment references, pay rules, and generated payroll results.

The extension does not collect, transmit, sell, share, or remotely store user data. It does not use analytics, advertising, tracking, remote code, or third-party APIs.
```

Privacy policy URL for the Chrome Web Store dashboard:

```text
https://gist.github.com/snowdamiz/9e743678f0067be10ed3f05cc21c4867
```

## Test Instructions

```text
1. Open the extension side panel by clicking the Clinic Payroll extension icon.
2. Select a pay period.
3. Import SimplePractice CSV or Excel exports using Import folder or the individual file controls.
4. Configure a clinician pay rule.
5. Click Calculate.
6. Verify the Results section shows clinic income, reconciliation cards, clinician rows, statement printing, and CSV downloads.

No login or external account is required.
```

## Assets Checklist

- Extension icons are included in `icons/` at 16, 32, 48, and 128 px.
- Add Chrome Web Store screenshots from a loaded extension side panel before final submission.
- Add a public privacy policy URL before final submission.
