# Calibration Dataset Builder

Phase 12.1C adds an offline-only Calibration Dataset Builder for preserving completed Dalton Review Workspace evidence in a canonical dataset. The dataset prepares reviewed production and shadow evidence for future calibration engines, but it does not perform calibration and does not change production decisions.

## Purpose

The builder converts completed Dalton Review Workspaces into immutable calibration records. Each record preserves the original review package snapshots, Dalton's structured review, disagreement summaries, and review metadata exactly as supplied.

The dataset is evidence-only:

- `productionImpact` is always `none`.
- `decisionImpact` is always `none`.
- No production engine is called.
- No production output is recomputed.
- No shadow system receives authority.

## Public API

- `buildCalibrationDataset(workspaceInputs, options)`
- `validateCalibrationDataset(dataset)`
- `mergeCalibrationDatasets(datasets, options)`
- `filterCalibrationDataset(dataset, filters, options)`
- `summarizeCalibrationDataset(dataset)`
- `exportCalibrationDataset(dataset, outputPath)`
- `importCalibrationDataset(input)`
- `buildCalibrationDatasetFingerprint(dataset)`

Workspace inputs may be Dalton Review Workspace folders, loaded workspace payloads, or completed reviewed-batch exports. The builder reads and copies evidence; it does not mutate the source workspace or review package snapshots.

## Dataset Schema

Each dataset contains:

- `schemaVersion`
- `datasetId`
- `createdAt`
- `source`
- `sourceWorkspaces`
- `sourceBatchIds`
- `reviewCount`
- `listingCount`
- `categoryBreakdown`
- `confidenceBreakdown`
- `agreementMetrics`
- `disagreementMetrics`
- `calibrationCandidates`
- `records`
- `validationMetadata`
- `productionImpact`
- `decisionImpact`
- `datasetFingerprint`

Each record preserves:

- immutable listing identity
- immutable production outputs
- immutable shadow outputs
- immutable Dalton review
- immutable disagreement summaries
- immutable review metadata

The builder may summarize reviewed fields into aggregate counts, but those summaries are metadata only. They do not become valuation confidence, production thresholds, or Deal Gate rules.

## Lifecycle

1. Build or load a completed Dalton Review Workspace.
2. Convert reviewed packages into calibration records.
3. Validate dataset structure, fingerprints, duplicates, and review completeness.
4. Export the dataset as deterministic JSON when needed.
5. Future calibration engines may consume the dataset after separate governance approval.

## Determinism

For identical inputs and options, the builder preserves:

- identical record ordering,
- identical aggregate summaries,
- identical exported JSON,
- identical record fingerprints,
- identical dataset fingerprints.

Ordering is stable across workspaces, batches, listings, packages, and review fingerprints.

## Evidence Boundary

The Calibration Dataset Builder must remain offline. It must not:

- import `server.js`,
- call scanner code,
- call valuation engines,
- call Deal Gate or BUY_NOW logic,
- modify production persistence,
- modify review workspaces unless explicitly exporting a dataset to a caller-provided output path,
- grant production authority to any shadow diagnostic.

Future calibration or promotion work must treat this dataset as reviewed evidence only.
