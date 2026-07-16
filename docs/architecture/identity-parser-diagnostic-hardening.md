# Identity and Parser Diagnostic Hardening

Phase 10.2 adds a standalone diagnostic layer for identity uncertainty and parser-to-canonical mismatch risk.

The module is diagnostic-only. It does not change parser behavior, Canonical Identity behavior, production scoring, Deal Gate, `BUY_NOW`, valuation, notifications, marketplace requests, scan timing, or Canonical Sold Evidence writes.

## Module

`validation/identityParserDiagnostics.js`

Public API:

- `evaluateIdentityParserDiagnostics(input)`
- `buildIdentityParserDiagnosticFingerprint(result)`
- `summarizeIdentityParserDiagnostics(result)`
- `normalizeListingProfile`
- `DIAGNOSTIC_STATUS`
- `AMBIGUITY_LEVEL`
- `REVIEW_ACTION`
- `IDENTITY_PARSER_DIAGNOSTIC_SCHEMA_VERSION`
- `IDENTITY_PARSER_DIAGNOSTIC_SOURCE`
- `UNKNOWN_VALUE`

## Diagnostic Coverage

The diagnostic evaluates:

- parsed identity completeness,
- canonical identity completeness,
- parser-to-canonical disagreements,
- raw versus graded ambiguity,
- grading company ambiguity,
- grade-number ambiguity,
- base versus parallel ambiguity,
- autograph ambiguity,
- relic or memorabilia ambiguity,
- serial-number ambiguity,
- card-number ambiguity,
- subject/player ambiguity,
- year/set/product ambiguity,
- lot or multi-card risk,
- reprint/custom/proxy risk,
- title-only inference risk,
- unsupported identity fields.

## Statuses

- `exact`: supplied parser and canonical fields agree and canonical identity is valuation eligible.
- `strong_candidate`: identity is strong enough for review context but still not production authority.
- `partial`: required identity facts are missing or unknown.
- `ambiguous`: one or more ambiguity warnings or non-blocking conflicts require manual review.
- `unsupported`: identity type or parser fields are outside the current supported schema.
- `blocked`: blocker-level identity risk is present, such as lot/reprint risk or critical field conflict.

## Rules

Blocking diagnostic issues include:

- lot or multi-card identity risk,
- reprint/custom/proxy identity risk,
- raw-versus-graded conflict,
- grading-company conflict,
- grade-number conflict,
- autograph conflict,
- card-number conflict,
- subject/player conflict,
- fatal listing-similarity mismatches when supplied.

Warnings include:

- raw-versus-graded ambiguity,
- grading-company ambiguity,
- grade-number ambiguity,
- base-versus-parallel ambiguity or conflict,
- relic ambiguity,
- serial-number ambiguity or conflict,
- card-number ambiguity,
- subject/player ambiguity,
- year/set/product ambiguity or conflict,
- title-only inference risk,
- unsupported identity fields.

These are diagnostic classifications only. They are not production penalties or Deal Gate blockers.

## Trace Integration

`validation/productionIntelligenceTrace.js` can now record a supplied identity diagnostic result in `identityDiagnosticSummary`.

The trace does not compute identity diagnostics itself and no production runtime file imports the diagnostic module. Future runtime integration should remain additive unless a later approved authority-migration phase explicitly changes production behavior.

## Fingerprint

The diagnostic result includes a deterministic `stableFingerprint` built from the result projection with the fingerprint field removed. The fingerprint proves deterministic equality of the diagnostic record; it does not prove source truth, marketplace validity, or production decision correctness.
