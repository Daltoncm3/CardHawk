# Manual Canonical Sold Evidence Dataset

This folder is the offline workspace for building CardHawk's first manually verified canonical sold evidence dataset.

Nothing in this folder affects runtime behavior. These files do not change valuation, ROI, Deal Gate, BUY_NOW, grading, scoring, confidence, recommendations, notifications, persistence, or scan timing.

## Files

- `manual-sold-evidence-template.json`: exact JSON shape for each incremental batch.
- `starter-dataset.json`: empty starter batch that can be copied for the first verified records.

## Reviewer Acceptance Criteria

Only mark a record `human_verified` when all of the following are true:

- The record is a completed sale, not an active listing, asking price, aggregate price, estimate, or guide value.
- The final sold price is visible and entered in `soldPrice`.
- The sold date is visible and entered in `soldAt`.
- The source URL points to the reviewed sale evidence.
- The card identity is exact: category, sport/game, subject, year, brand/product, set name, card number, parallel or base designation, rookie flag, autograph flag, memorabilia flag, and serial-numbered flag.
- Grade and condition are entered when visible.
- Marketplace provenance is present: adapter, retrieval method, source reliability, acquisition timestamp, and source record ID when available.
- Reviewer name, review timestamp, review status, and reviewer notes are present.

Use `needs_second_review` when identity is plausible but not certain.
Use a `rejected_*` status when the record is not eligible for canonical true-sold evidence.

## Review Statuses

Accepted verified statuses:

- `human_verified`
- `dealer_verified`
- `second_review_verified`
- `verified`

Recommended non-accepted statuses:

- `unreviewed`
- `needs_second_review`
- `rejected_active_listing`
- `rejected_identity_mismatch`
- `rejected_missing_price`
- `rejected_missing_date`
- `rejected_non_transactional`
- `rejected_unclear_source`

## Incremental Batch Workflow

1. Copy `starter-dataset.json` to a new batch file, for example:
   `validation/sold-evidence-dataset/batches/2026-07-verified-ebay-batch-001.json`
2. Add manually verified sold records to `records`.
3. Run the pilot validator:

```bash
node validation/soldEvidenceDatasetPilot.js \
  --batch validation/sold-evidence-dataset/batches/2026-07-verified-ebay-batch-001.json \
  --out validation/reports/sold-evidence-pilot-report.json \
  --dataset-id manual-canonical-sold-evidence-v1 \
  --target-identities 100 \
  --target-records 750 \
  --sample-size 25
```

4. For multiple incremental batches, repeat `--batch`:

```bash
node validation/soldEvidenceDatasetPilot.js \
  --batch validation/sold-evidence-dataset/batches/batch-001.json \
  --batch validation/sold-evidence-dataset/batches/batch-002.json \
  --out validation/reports/sold-evidence-pilot-report.json
```

5. Review the report sections:
   - `validationReport.invalidRecords`
   - `validationReport.duplicateSourceRecords`
   - `validationReport.duplicateSales`
   - `manifest.coverageReport`
   - `manifest.biasReport`
   - `manifest.provenanceValidation`
   - `manifest.randomAuditSample`

## Important Safeguards

- Do not scrape sold data.
- Do not invent sold records.
- Do not enter active listings as true sold evidence.
- Do not import these batches into the production canonical sold evidence store until a later phase explicitly approves it.
- Keep source/license notes in `provenance.licenseType` and `provenance.allowedUses` whenever known.
