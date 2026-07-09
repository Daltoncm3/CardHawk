# Shadow Mode Operator Guide

Shadow Mode lets CardHawk run Decision Intelligence beside production scans for observation and validation only. It is designed to help compare explanation-only intelligence against production outcomes without changing live behavior.

Shadow Mode does not affect BUY_NOW, Deal Gate, scoring, recommendations, notifications, persistence behavior, or scan timing.

## Enable Shadow Mode

Shadow Mode is controlled by the environment flag:

```sh
CARDHAWK_SHADOW_MODE_ENABLED=true
```

When the flag is missing, empty, or set to anything other than `true`, Shadow Mode remains off.

Use the same environment mechanism already used to run CardHawk locally or in the intended operating environment. Do not change code to enable Shadow Mode.

## Confirm It Is Passive

When Shadow Mode is enabled, CardHawk runs Decision Intelligence after Market Intelligence completes and writes compact observations to the dedicated Shadow Mode log.

Confirm passivity by checking these invariants:

- Production listing fields are not modified by Shadow Mode.
- Decision Intelligence output keeps `recommendationImpact: "none"`.
- Existing recommendation labels remain produced by the normal production path.
- Deal Gate pass/fail behavior remains produced by the normal production path.
- Alerts and notifications remain controlled by the normal production path.
- No marketplace calls are made by Shadow Mode tools.

The full test suite includes checks that runtime scoring output remains unchanged when Shadow Mode is enabled.

## Log Location

Shadow Mode observations are stored in:

```text
data/shadow-mode.json
```

The log is dedicated to passive Shadow Mode observations. It is bounded to the latest 1000 records, trimming the oldest records first.

Each compact record includes:

- listing identity and basic listing metadata
- scan context when available
- Decision Intelligence posture fields
- supporting signals, caution signals, blockers, and conflicts
- existing production recommendation comparison metadata
- `recommendationImpact: "none"`

## Export Shadow Reports

Use the offline Shadow Mode report exporter to summarize the log:

```sh
node validation/exportShadowModeReport.js \
  data/shadow-mode.json \
  --out validation/reports/shadow-mode-report.json
```

The report includes:

- total records
- `overallReadiness` distribution
- blocker counts
- caution signal counts
- conflict counts
- comparison against existing production recommendation labels
- confirmation summary for `recommendationImpact`

This exporter is offline and read-only for the Shadow Mode log. It writes only the requested report file.

## Compare Shadow Vs Production

First export recent production scan results:

```sh
node validation/exportScanResults.js \
  --store data/cardhawk-data.json \
  --out validation/exports/latest-scan.json
```

Then run the Shadow vs Production comparator:

```sh
node validation/compareShadowVsProduction.js \
  --shadow data/shadow-mode.json \
  --production validation/exports/latest-scan.json \
  --out validation/reports/shadow-vs-production.json
```

For a concise operator scorecard, use the wrapper:

```sh
node validation/runShadowComparisonReport.js \
  --shadow data/shadow-mode.json \
  --production validation/exports/latest-scan.json \
  --out validation/reports/shadow-comparison-scorecard.json
```

The scorecard prints:

- total compared
- disagreement count
- added caution count
- reduced confidence count
- manual review count
- top disagreement categories

The `--out` file contains the full JSON scorecard and embedded comparison report for later review.

## Interpret Disagreement Categories

Disagreement categories are review signals, not production decisions.

Common categories:

- `overall_readiness_mismatch`: Shadow Mode and production or validation evidence disagree on readiness posture.
- `blockers_mismatch`: Shadow Mode identified different blocker sources than the comparison input.
- `cautionSignals_mismatch`: Shadow Mode identified different caution sources.
- `supportingSignals_mismatch`: Shadow Mode identified different supporting sources.
- `conflicts_mismatch`: Shadow Mode identified different conflict sources.
- `missing_production_match`: a Shadow Mode record could not be matched to the production/export record by listing ID.
- `missing_production_signal_context`: the production/export record exists but does not include comparable Decision Intelligence signal context.

Counts should be reviewed as patterns. A high count does not automatically mean production is wrong; it means the listing set needs dealer review or better validation context.

## Safety Rules

Shadow Mode is allowed to:

- observe already-produced evidence
- run Decision Intelligence explanation logic
- write compact observations to `data/shadow-mode.json` when enabled
- generate offline validation reports
- compare Shadow Mode observations against exported production data

Shadow Mode must not:

- change BUY_NOW behavior
- change Deal Gate behavior
- change scoring weights or score outputs
- change recommendations
- send or suppress notifications
- change alert behavior
- change scan timing
- mutate listing state
- alter `data/cardhawk-data.json`
- call marketplace APIs
- become decision-eligible without separate approval

`recommendationImpact` must remain `"none"`.

## Rollback Steps

To disable Shadow Mode:

1. Remove or unset `CARDHAWK_SHADOW_MODE_ENABLED`.
2. Restart the CardHawk process if the environment is loaded at process start.
3. Confirm no new records are added to `data/shadow-mode.json`.
4. Leave existing Shadow Mode logs in place for review, or archive them outside the production store if needed.

To stop offline reporting:

1. Stop running the validation commands.
2. Leave generated files under `validation/exports/` and `validation/reports/` as offline artifacts.
3. Do not delete production data as part of Shadow Mode rollback.

No code rollback is required to turn Shadow Mode off because the default state is disabled.

## Final Reminder

Shadow Mode is explanation-only. It is a validation and comparison layer for dealer review.

It does not affect BUY_NOW, Deal Gate, scoring, recommendations, notifications, persistence behavior, or scan timing.
