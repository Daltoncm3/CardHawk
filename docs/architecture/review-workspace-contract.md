# Review Workspace Contract

## Purpose

The Review Workspace Contract is an offline-only Phase 7.2A aggregation layer.

It gathers every existing intelligence artifact for a single listing into one deterministic review object. It does not create new intelligence, calculate scores, modify decisions, or influence runtime behavior.

## Scope

The workspace aggregates:

- listing snapshot
- production outputs
- shadow outputs
- Investment Decision
- Strategy Lane context
- Canonical Identity
- Shadow Valuation
- Shadow Sold Comparison
- Validation Candidate
- Dalton review placeholder
- actual outcome placeholder
- audit metadata

If a component is missing, the workspace records the missing component explicitly. It does not regenerate the component.

## Workspace Object

Each workspace contains:

- `schemaVersion`
- `source`
- `version`
- `workspaceId`
- `listingId`
- `reviewMode`
- `productionImpact`
- `decisionImpact`
- `listingSnapshot`
- `productionOutputs`
- `shadowOutputs`
- `investmentDecision`
- `strategyLane`
- `canonicalIdentity`
- `shadowValuation`
- `shadowSoldComparison`
- `validationCandidate`
- `daltonReview`
- `actualOutcome`
- `auditMetadata`
- `workspaceHash`

## Audit Metadata

Audit metadata includes:

- generation timestamp
- generator source
- `aggregationOnly: true`
- `createsNewIntelligence: false`
- component availability map
- missing component list
- input fingerprint
- production fingerprint
- shadow fingerprint
- Investment Decision fingerprint
- Validation Candidate fingerprint

The workspace hash protects the aggregate review object from accidental rewrite.

## Review Workflow

1. Export or assemble a real listing snapshot.
2. Include existing production outputs.
3. Include existing shadow outputs.
4. Include existing Investment Decision output.
5. Include existing Validation Candidate output when available.
6. Build a Review Workspace offline.
7. Dalton reviews the workspace and fills the review placeholder.
8. Actual market outcomes can be added later.
9. Validated workspaces can feed the Investment Decision Validation Harness.

## Future UI Integration

A future review UI can use the workspace as a single read model for one listing. The UI should not call production engines from this contract. It should display the workspace sections, highlight missing components, and capture Dalton review notes without changing production behavior.

## Validation Workflow

The Review Workspace is intended to connect:

- Validation Candidate Selector
- Investment Decision Validation Harness
- Shadow Sold Comparison
- Shadow Valuation
- Dalton review
- eventual actual outcome tracking

This creates one stable object for review, audit, and future learning.

## Safety Guarantees

- Offline only.
- Aggregation only.
- No new intelligence creation.
- No runtime integration.
- No `server.js` changes.
- No Deal Gate changes.
- No BUY_NOW changes.
- No valuation, ROI, scoring, grading, Market Intelligence, recommendation, notification, persistence, or scan timing changes.
