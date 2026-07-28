# Signal Alignment Validation Suite

## Purpose

The Signal Alignment Validation Suite is an offline-only, observation-only validation layer for Phase 13 Signal Alignment.

It exercises the complete canonical signal pipeline end to end:

1. Canonical Intelligence Signal Contract
2. Intelligence Signal Registry
3. Signal Producer Adapter
4. Signal Alignment Contract
5. Signal Alignment Batch
6. Signal Alignment Engine
7. Signal Conflict Analyzer
8. Signal Alignment Report

The suite validates that these artifacts work together deterministically. It does not execute production engines, modify runtime behavior, resolve signal conflicts, create recommendations, or grant authority to any signal.

## Public API

`validation/signalAlignmentValidationSuite.js` exposes:

- `runSignalAlignmentValidationSuite(input, options)`
- `validateSignalAlignmentPipeline(input, options)`
- `summarizeValidationSuite(suite)`
- `buildValidationSuiteFingerprint(suite)`

`runSignalAlignmentValidationSuite` and `validateSignalAlignmentPipeline` are aliases by design. Both consume deterministic validation scenarios and return an immutable validation-suite artifact.

## Validation Stages

Each scenario is evaluated through these stages:

- `registry`
- `alignment_run`
- `alignment_batch`
- `conflict_analysis`
- `alignment_report`
- `authority_boundaries`
- `fingerprint_chain`
- `immutability`
- `unknown_value_preservation`
- `runtime_boundary`

Every stage returns structured status, errors, warnings, and reason codes. Stage output is aggregated into the suite-level validation result.

## Expected Artifacts

Each scenario may produce:

- a Signal Alignment run
- a Signal Alignment batch
- a Signal Conflict analysis
- a Signal Alignment report

These artifacts are preserved as immutable validation evidence. The suite does not alter them after creation.

## Validation Summary

The suite-level result includes:

- `valid`
- `errors`
- `warnings`
- `reasonCodes`
- `stageResults`
- `pipelineSummary`
- `authorityViolations`
- `fingerprintViolations`

The pipeline summary includes deterministic counts for scenarios, stages, adapted signals, aligned signals, blocked signals, reports, and conflict relationships.

## Authority Boundaries

All validation-suite artifacts preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The suite must never:

- execute intelligence engines
- modify native outputs
- alter parser, identity, valuation, Deal Gate, BUY_NOW, notification, scanner, marketplace, persistence, or configuration behavior
- resolve signal conflicts
- rank or select signal winners
- generate production recommendations
- grant runtime authority

## Unknown Values

Unknown values remain explicit as `unknown`. Missing registry definitions, version mismatches, blocked alignments, and unknown relationships are surfaced for review rather than filled with assumptions.

## Determinism

The suite uses deterministic ordering and existing fingerprint helpers. For identical inputs, it produces identical validation summaries and suite fingerprints.

## Future Role

The validation suite is intended to become a Phase 13 production-readiness checkpoint for future signal families. A future governance workflow may require a passing validation suite before an aligned signal family can move from offline validation into live shadow observation.

That future workflow must still pass through the Phase 12 governance pipeline before any production authority can change.
