# User Experience Improvement Plan

Date: 2026-05-25

## Reader And Outcome

This plan is for the product and engineering owner improving the Clinic Payroll Calculator. After reading it, they should be able to prioritize UX work that reduces payroll mistakes, shortens each pay-period run, and increases user confidence before statements or exports are produced.

## UX Goal

Make the extension feel like a guided payroll review workflow, not a collection of file inputs and reports. The ideal user can open the side panel, import SimplePractice exports, resolve anything missing or risky, calculate payroll, review exceptions, and export statements without wondering what to do next or whether the result is trustworthy.

## Current Strengths

- The side panel keeps the workflow persistent while users gather files.
- The current run banner summarizes imports, rules, and result state.
- Bulk import, drag-and-drop, and individual file fallback support multiple working styles.
- The app already distinguishes core, session, and optional exports.
- Pay rules are explained in context and saved separately from a single payroll run.
- Results include summary metrics, reconciliation cards, warnings, statement printing, and downloadable ledgers.
- Processing happens locally, which is a strong trust and privacy story for payroll data.

## Primary UX Risks

- Users can reach calculation before they fully understand what is required, optional, missing, or risky.
- Import matching is helpful but opaque: users need clearer evidence for why files were accepted, skipped, duplicated, or considered missing.
- Pay-rule setup is repetitive and may allow accidental zero-value or unfinished agreements to blend in with valid rules.
- Warnings are visible, but they need stronger triage: severity, category, next action, and reviewed state.
- Results present many valuable numbers at once; users need a stronger hierarchy between payroll totals, reconciliation checks, and review exceptions.
- The side panel is carrying too many jobs at once: setup form, import console, pay-rule editor, results dashboard, warning review, and export center. After results are calculated, the long scrollbar makes the workflow feel like a crowded widget instead of a focused payroll review surface.
- The side-panel width makes wide tables and dense button rows harder to scan.
- Help patterns rely partly on hover and punctuation-style help controls, which can be weak for keyboard, touch, and assistive technology users.

## Target User Journey

1. Open the side panel.
2. Confirm or adjust the pay period.
3. Import the SimplePractice export folder or selected export files.
4. Review which exports were matched, which are missing, and whether any file needs attention.
5. Configure or confirm clinician pay rules.
6. Run a preflight check before calculation.
7. Calculate payroll.
8. Review summary totals, reconciliation gaps, and warnings.
9. Open clinician-level detail when something needs investigation.
10. Print statements or download CSV/ZIP exports.
11. Leave with saved pay rules and a recoverable local draft for the next run.

## Improvement Principles

- Guide the next action. Every state should answer: "What should I do now?"
- Make confidence visible. Show how the app inferred files, dates, clinicians, and warning categories.
- Separate setup from review. Imports and pay rules should feel like preparation; warnings and results should feel like final review.
- Prevent quiet mistakes. Missing core data, zero pay values, legacy rules, and suspicious reconciliation gaps should be impossible to overlook.
- Keep payroll data private by design. Reinforce local-only processing at moments when files are selected, saved, cleared, or exported.
- Preserve side-panel ergonomics. Optimize for a narrow working surface before optimizing for desktop-wide layouts.
- Treat the side panel as a workflow controller, not the only place every detail must live. Keep the current task in the panel and move deep review into drawers, tabs, accordions, or a separate report view.
- Switch modes after calculation. Setup controls should collapse into a concise run summary once the user is reviewing results.

## Side-Panel Density Strategy

The biggest UX improvement is to reduce vertical sprawl after results are calculated. The app should not show the full setup workflow, every import control, every pay-rule editor, every metric, and the full clinician results table in one continuous scroll.

Recommended structure:

- Setup mode: pay period, import review, and pay-rule completion are expanded because the user is preparing the run.
- Review mode: after Calculate, setup collapses into a compact run summary with Edit buttons for Pay Period, Imports, and Pay Rules.
- Results overview: show only the critical totals, unresolved warning count, and export actions at the top of review mode.
- Detail surfaces: put reconciliation details, clinician rows, ledgers, and warning lists behind tabs, accordions, drawers, or a full report page.
- Persistent actions: keep Calculate during setup and Export/Print during review in a sticky action area, instead of repeating large action rows inside the scroll.
- Progressive disclosure: default to collapsed completed sections, but make incomplete or risky sections expand automatically.
- Escape hatch: offer "Open full report" in a new extension page for dense tables and deep reconciliation, while the side panel remains the compact command center.

Success means the side panel feels like a guided control surface. Dense payroll evidence remains available, but it no longer competes with the user's immediate next action.

## Prioritized Roadmap

### Phase 1: Quick Confidence Wins

Scope: 1 to 2 days.

- Disable Calculate until the minimum required inputs are present, or keep it enabled with a clear preflight dialog explaining blockers.
- Add a compact "Next step" line to the current run banner.
- After calculation, collapse Pay Period, Imports, and Clinician Pay Rules into a compact run summary with Edit buttons.
- Show a persistent autosave status for imported files, dates, and pay rules.
- Add validation badges to clinician pay-rule cards: Complete, Missing rate, Legacy rule, or Not configured.
- Warn when a configured pay rule has all-zero rates or a zero collection percentage.
- Convert hover-only help into click/focus popovers that can be dismissed with Escape.
- Add a focus trap and focus return behavior to the warning drawer.
- Make Reset copy more explicit: what it clears, what it keeps, and whether files remain stored locally.

### Phase 2: Guided Import Review

Scope: 3 to 5 days.

- Replace the import status paragraph with an import review panel.
- For each export role, show state, selected file name, match reason, and whether it is required, recommended, or optional.
- Explain skipped files by category: duplicate, unsupported format, too large, lower-priority candidate, or unrecognized export.
- Show a small preview for matched files: detected headers, row count, and inferred date range when available.
- Let users manually reassign a selected file to an import role if inference chooses incorrectly.
- Highlight pay-period inference as a reviewable suggestion, especially when it changes the current dates.
- Add a "Use this folder next time" style note only if Chrome extension APIs can support it safely without overpromising persistent filesystem access.

### Phase 3: Faster Pay-Rule Setup

Scope: 3 to 5 days.

- Group clinicians by pay-rule completion state so unfinished rules rise to the top.
- Add bulk actions for repeated agreements: apply flat rate to selected clinicians, copy rates from another clinician, and reset selected clinicians to no rule.
- Keep session-count context visible, but collapse detailed session chips by default once a rule is complete.
- Add inline examples for each rule result, such as "12 sessions x $80 = $960" or "$4,000 collections x 60% = $2,400."
- Add a review filter for clinicians with sessions but no complete pay rule.
- Save edits automatically, but keep the manual Save Rules button as a reassuring confirmation action.

### Phase 4: Review And Warning Triage

Scope: 1 week.

- Categorize warnings into severity levels: Blocker, Review, Info.
- Add warning filters for category, clinician, amount, and status.
- Allow warnings to be marked reviewed for the current run.
- Link warning rows to the relevant clinician detail or ledger rows when possible.
- Add a pre-export checklist that blocks or warns before Print All and ZIP downloads if unresolved blocker warnings remain.
- Make reconciliation gaps actionable by showing expected cause, available source data, and recommended next step.
- Add empty success states, such as "No warning-level issues found for this run."

### Phase 5: Results And Workspace Information Architecture

Scope: 1 to 2 weeks.

- Split results into clear sections: Payroll totals, Reconciliation, Exceptions, Clinicians, and Exports.
- Put the most decision-critical numbers first: gross income, clinician compensation, contribution result, unresolved warnings, and reconciliation gap.
- Introduce setup and review modes so the side panel does not keep the full setup form expanded after calculation.
- Collapse completed setup sections after calculation and show a one-screen run summary: period, matched imports, clinician rule completion, warning count, and result status.
- Add a clinician detail drawer or expandable row for session mix, trailing payments, split payments, unmatched payments, and open appointments.
- Turn dense review counts into clickable chips with labels and counts.
- Add sticky result actions after calculation so Print All and downloads remain reachable without scrolling back to the heading.
- Replace the wide clinician results table in the side panel with compact clinician rows or cards. Move the dense table to a full report view, export preview, or detail drawer.
- Add a tabbed review area for Summary, Warnings, Clinicians, Reconciliation, and Exports if accordions still produce too much vertical scroll.
- Add an "Open full report" action for spreadsheet-like review, where wide tables and ledgers can breathe outside the side panel.

### Phase 6: Export And Statement Polish

Scope: 3 to 5 days.

- Add a statement preview before printing all clinicians.
- Show exactly which clinicians will be included in each export.
- Explain the difference between Download CSV, Download Clinician ZIP, and Download Ledger ZIP at the point of action.
- Add export-complete feedback with filename and count of generated files.
- Add safeguards for empty exports and clinician statements with no kept sessions.
- Consider adding a "copy summary" action for payroll totals if users paste results into another accounting workflow.

### Phase 7: Accessibility And Input Ergonomics

Scope: ongoing, start with 2 to 3 days.

- Ensure all interactive targets are at least 32px high and easy to hit in the side panel.
- Replace punctuation-only help controls with named icon buttons or text labels that expose meaningful accessible names.
- Ensure every modal or drawer has focus management, Escape handling, and focus restoration.
- Add visible focus states for all custom file controls, warning summaries, help controls, and mini buttons.
- Avoid relying on color alone for loaded, missing, warning, and success states.
- Confirm screen reader announcements for import progress, calculate success, validation failures, and drawer results.
- Add keyboard paths for import review, pay-rule editing, warning review, and exports.

### Phase 8: Performance And Perceived Speed

Scope: 1 to 2 weeks if large exports feel slow in practice.

- Keep progress messages for file scanning, but add stable progress placement so text changes do not shift layout.
- For larger files, consider moving parsing and import inference into a Web Worker.
- Render long warning lists and clinician rows incrementally or with virtualization if real clinics produce large datasets.
- Keep user-triggered transitions under 300ms and avoid animation for high-frequency editing.
- Preserve drafts before expensive work starts so failed imports or calculations do not cost the user their setup.

## UX Measurement

Track these manually at first, then instrument locally if appropriate:

- Time from opening the side panel to a successful calculation.
- Number of unresolved required items before calculation.
- Number of clinicians with incomplete or zero-value pay rules.
- Number of warnings reviewed before export.
- Number of import files manually reassigned after inference.
- User-reported confidence score after reviewing results.
- Support questions related to missing exports, pay rules, reconciliation, or statements.

## Suggested First Milestone

Build a "guided run" MVP:

- Current run banner includes next action.
- Calculate has preflight validation.
- Import checklist explains match reason and missing status.
- Pay-rule cards show completion badges and zero-value warnings.
- After calculation, setup collapses into a run summary and the side panel switches to review mode.
- Warning drawer has severity filters and reviewed state.
- Results actions warn before export when blockers remain.

This milestone improves trust without changing the payroll calculation model.

## Acceptance Criteria

- A first-time user can identify the next action on every major screen state.
- Required, recommended, optional, missing, duplicate, and skipped imports are visually distinct and explained.
- Users cannot accidentally treat incomplete or zero-value pay rules as finished.
- Warnings communicate severity and next action, not only count.
- Export actions clearly state what will be produced before files are generated.
- The warning drawer and help popovers are keyboard accessible.
- The side panel remains usable at narrow widths without horizontal scrolling for the primary workflow.
- After calculation, the user can see the run summary, critical totals, warning status, and primary export actions without scrolling through the full setup form.
- Dense clinician and reconciliation details are available on demand, but they do not create one long default scrollbar.
- Local-only processing and saved local draft behavior are explained in the workflow where trust questions arise.
