# Signal Conflict Analyzer

## Purpose

The Signal Conflict Analyzer is an offline-only, observation-only Phase 13 module. It evaluates already-created Signal Alignment artifacts and identifies deterministic relationships between canonical signals.

The analyzer never executes intelligence engines, never recomputes diagnostics, never resolves conflicts, never chooses winners, never modifies alignments, and never influences production decisions.

## Relationship Model

Supported relationship types are:

- `agreement`: two alignments describe the same canonical signal and their normalized status and uncertainty agree.
- `contradiction`: two alignments describe the same canonical signal but their normalized status conflicts.
- `supporting`: one signal explicitly references the other as supporting evidence.
- `independent`: two valid signals have no direct relationship.
- `duplicate`: two relationships refer to the same alignment or same canonical signal output.
- `unknown`: required canonical signal metadata is missing, incomplete, blocked, invalid, or otherwise insufficient for classification.

Unknown metadata remains unknown. The analyzer does not infer missing definitions, missing evidence, or missing signal relationships.

## Public API

`validation/signalConflictAnalyzer.js` exports:

- `analyzeSignalConflicts`
- `summarizeSignalConflicts`
- `classifySignalRelationship`
- `buildConflictAnalysisFingerprint`
- `validateConflictAnalysis`

## Conflict Classification

Classification is pairwise and deterministic. Inputs are cloned and sorted by canonical signal identity, producer, source output fingerprint, and alignment fingerprint. Relationship artifacts preserve both side fingerprints and record `resolution: "not_attempted"`.

Duplicate relationships are reported as evidence. They are not removed automatically.

## Validation Model

Validation checks:

- required analysis fields,
- schema and source,
- alignment and relationship counts,
- individual alignment validity through `validateSignalAlignment`,
- alignment batch validity through `validateAlignmentBatch`,
- relationship type validity,
- authority boundaries,
- deterministic analysis fingerprint integrity.

Validation returns:

- `valid`
- `errors`
- `warnings`
- `reasonCodes`
- `relationshipSummary`
- `duplicateRelationships`
- `unknownRelationships`
- `authorityViolations`

## Authority Boundaries

Every analysis preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The analyzer cannot change scanner behavior, parser behavior, identity behavior, valuation, Deal Gate, BUY_NOW, notifications, persistence, marketplace behavior, or configuration.

## Future Governance Integration

Future Signal Alignment reports and governance review packages can use conflict analyses as evidence. A contradiction or agreement reported here is advisory evidence only; any production use must pass through the Phase 12 governance pipeline and explicit Dalton approval.
