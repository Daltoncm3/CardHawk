# Real Listing Decision Review Contract

Phase 12.0B adds the permanent offline contract for Real Listing Decision Review.

## Purpose

The contract freezes existing production and shadow outputs into one deterministic evidence package for Dalton's manual review. It exists to measure identity correctness, evidence sufficiency, valuation quality, confidence calibration, false positives, missed opportunities, production-versus-shadow disagreement, Deal Gate quality, BUY_NOW quality, and notification quality.

The contract does not create new intelligence and does not grant authority to shadow systems.

## Public API

The module is `validation/realListingDecisionReviewContract.js`.

Primary helpers:

- `createRealListingDecisionReviewPackage(input, options)`
- `validateRealListingDecisionReviewPackage(reviewPackage)`
- `createHumanReviewRecord(input, options)`
- `validateHumanReviewRecord(reviewRecord)`
- `attachHumanReviewRecord(reviewPackage, reviewRecord)`
- `buildRealListingDecisionReviewPackageFingerprint(reviewPackage)`
- `buildRealListingDecisionReviewSnapshotFingerprint(input)`
- `buildHumanReviewFingerprint(reviewRecord)`
- `determineReviewStatus(value)`
- `cloneRealListingDecisionReviewPackage(reviewPackage)`

The module also exports schema/version constants, review statuses, review enums, reason categories, disagreement categories, and required-field lists.

## Review Package Schema

A package contains:

- schema and source metadata
- package, batch, listing, marketplace, creation, and capture identifiers
- `productionImpact: "none"`
- `decisionImpact: "none"`
- immutable listing snapshot
- identity snapshot
- production snapshot
- shadow snapshot
- disagreement snapshot
- audit metadata
- snapshot fingerprint
- package fingerprint

The package accepts already-generated production and shadow outputs. Missing data remains explicit as `unknown`, empty arrays, or empty objects depending on the field shape.

## Human Review Schema

A review record captures Dalton's structured judgment:

- identity correctness
- evidence sufficiency
- valuation reasonableness
- confidence appropriateness
- buy posture
- notification posture
- production correctness
- whether shadow was better
- BUY_NOW quality
- Deal Gate quality
- reason categories
- disagreement categories
- review confidence
- notes
- reviewer and timestamp
- deterministic review fingerprint

Unsupported enum values are rejected by validation.

## Lifecycle

1. Candidate selected by existing offline validation tooling.
2. Review package generated from immutable production and shadow snapshots.
3. Dalton completes a structured human review record.
4. The review record is attached by creating a new reviewed package object.
5. Offline validation metrics can consume reviewed packages later.
6. Future intelligence work may use aggregate outcomes as evidence only.

Attaching a review never mutates the original package or immutable snapshots.

## Evidence-Only Boundary

Review outcomes are evidence only. They do not change:

- production scoring
- valuation
- confidence thresholds
- Deal Gate
- BUY_NOW
- notifications
- marketplace behavior
- scan timing
- persistence
- Canonical Sold Evidence writes
- shadow authority

Any future production use requires a separate approved promotion phase.

## Future Extension Rules

Future marketplaces, canonical sold evidence, provider-backed sold evidence, diagnostics, and purchase/resale outcomes should be added through namespaced additive fields. Existing package fingerprints must continue to protect the exact snapshot that Dalton reviewed.

The contract should remain offline and deterministic. Runtime integration, engine recomputation, and production authority changes are out of scope.
