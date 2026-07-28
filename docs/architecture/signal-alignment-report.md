# Signal Alignment Report

## Purpose

The Signal Alignment Report is an offline-only, observation-only human-review artifact for Phase 13. It combines Signal Alignment runs, Signal Alignment batches, validation summaries, and Signal Conflict analyses into one immutable report.

The report presents evidence only. It never resolves conflicts, ranks signals, selects winners, creates recommendations, changes confidence, or influences production behavior.

## Public API

`validation/signalAlignmentReport.js` exports:

- `createSignalAlignmentReport`
- `validateSignalAlignmentReport`
- `summarizeSignalAlignmentReport`
- `filterSignalAlignmentReport`
- `sortSignalAlignmentReport`
- `exportSignalAlignmentReport`
- `importSignalAlignmentReport`
- `buildSignalAlignmentReportFingerprint`

## Report Schema

Reports include:

- run identity and fingerprint,
- registry identity and fingerprint,
- alignment summary,
- validation summary,
- conflict summary,
- immutable alignment artifacts,
- immutable relationship artifacts,
- missing definitions,
- version mismatches,
- blocked alignments,
- unknown relationships,
- warnings and errors,
- review status,
- reviewer notes,
- source artifacts,
- authority boundary fields,
- deterministic report fingerprint.

## Source Artifact Relationships

Reports preserve source artifacts under `sourceArtifacts`:

- `alignmentRun`
- `alignmentBatch`
- `conflictAnalysis`

Validation checks that report-level run references match the preserved source run. Source artifacts are cloned and frozen; report creation, filtering, sorting, export, and import do not mutate them.

## Review Lifecycle

Supported review statuses are:

- `unreviewed`
- `review_pending`
- `reviewed`
- `needs_follow_up`
- `invalid`

Reviewer notes are observational only. They may document human interpretation but cannot alter alignments, relationships, validation results, production decisions, or authority.

## Conflict Presentation

Relationship artifacts from the Signal Conflict Analyzer are presented as evidence. Contradictions, duplicates, and unknown relationships remain unresolved. The report does not choose winners or suppress conflicting evidence.

## Validation Model

Validation returns:

- `valid`
- `errors`
- `warnings`
- `reasonCodes`
- `missingRequiredFields`
- `authorityViolations`
- `fingerprintViolations`
- `sourceReferenceViolations`
- `reviewStatusViolations`

Existing alignment-run, alignment-batch, and conflict-analysis validators are reused rather than duplicated.

## Fingerprint Model

Report fingerprints use the existing deterministic fingerprint projection helper and exclude only the report fingerprint field. Source artifact fingerprints are preserved and validated through their native helpers.

## Authority Boundaries

Every report preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

Reports cannot modify scanner behavior, parser behavior, identity behavior, valuation, Deal Gate, BUY_NOW, notifications, persistence, marketplace behavior, configuration, confidence, recommendations, or production authority.

## Future Integration

Future governance and shadow-comparison workflows can consume Signal Alignment Reports as review evidence. Any production use remains gated by the Phase 12 governance pipeline and explicit Dalton approval.
