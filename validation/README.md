# CardHawk Offline Validation Tools

These tools support offline Decision Intelligence validation against exported CardHawk scan data. They are for review and analysis only.

They do not start the server, run scans, call marketplace APIs, send notifications, modify persistence, or affect BUY_NOW, Deal Gate, scoring, recommendations, alerts, or scan timing.

## Tools

- `exportScanResults.js`: reads an existing CardHawk store JSON file and exports recent listings into validation-ready JSON.
- `runDecisionValidation.js`: runs the evidence-only Decision Intelligence validation report against exported listing JSON.
- `exportAndValidate.js`: runs both steps in one offline workflow and prints a concise summary.

## Export Scan Results

Export recent scan results from the persisted store:

```sh
node validation/exportScanResults.js \
  --store data/cardhawk-data.json \
  --out validation/exports/latest-scan.json
```

The exporter reads `data/cardhawk-data.json` with plain file reads. It does not write back to the store.

By default, it tries to export listings seen inside the latest scan timestamp window. If that window is missing or invalid, it safely falls back to the newest listings by `lastSeenAt`.

Useful options:

- `--limit 100`: maximum listings to export.
- `--since 2026-07-09T00:00:00.000Z`: export listings seen after a timestamp.
- `--all`: export newest listings without using the latest scan window.

## Run Validation

Run Decision Intelligence validation against an exported scan file:

```sh
node validation/runDecisionValidation.js \
  validation/exports/latest-scan.json \
  validation/reports/latest-decision-validation.json
```

The validation runner consumes the exported listings and produces an evidence-only report. It does not produce BUY_NOW, PASS, or recommendation labels.

## Export And Validate

Run the complete offline workflow in one command:

```sh
node validation/exportAndValidate.js \
  --store data/cardhawk-data.json
```

By default, this writes:

- exports to `validation/exports/`
- reports to `validation/reports/`

You can override the output root:

```sh
node validation/exportAndValidate.js \
  --store data/cardhawk-data.json \
  --output-root validation
```

You can also provide exact paths:

```sh
node validation/exportAndValidate.js \
  --store data/cardhawk-data.json \
  --export validation/exports/manual-export.json \
  --report validation/reports/manual-report.json
```

## Export Shape

Scan export files include:

- `source`
- `mode`
- `exportedAt`
- `inputStore`
- `selection`
- `listingCount`
- `missingEvidenceCount`
- `warnings`
- `listings`

Each exported listing includes `evidenceAvailability`, which marks whether the evidence needed by Decision Intelligence is present:

- `evidenceSufficiency`
- `listingSimilarity`
- `comparableQuality`
- `valuationRange`
- `supplyPressure`

If evidence is missing, validation still runs and degrades safely.

## Report Shape

Validation reports include:

- `source`
- `mode`
- `generatedAt`
- `inputFile`
- `listingCount`
- `results`

Each result includes:

- `overallReadiness`
- `evidencePosture`
- `compPosture`
- `valuationPosture`
- `resalePressurePosture`
- `recommendationImpact`
- `supportingSignals`
- `cautionSignals`
- `blockers`
- `conflicts`
- `summary`

`recommendationImpact` should remain `"none"`.

## Interpreting Output

- `overallReadiness` explains whether the evidence is ready for review context.
- `supportingSignals` list evidence that supports confidence in the listing context.
- `cautionSignals` list evidence that needs human review.
- `blockers` identify evidence gaps or conflicts that make the context not ready.
- `conflicts` identify mixed signals, such as usable valuation with elevated resale pressure.
- `summary` gives a concise human-readable explanation.

These reports are validation artifacts only. They do not affect runtime recommendations.
