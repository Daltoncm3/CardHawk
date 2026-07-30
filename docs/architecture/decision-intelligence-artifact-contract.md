# Decision Intelligence Artifact Contract

Phase 17.1B defines the canonical offline Decision Intelligence artifact for CardHawk.

This contract is architecture-only and offline-only. It does not implement runtime code, modify `server.js`, modify Deal Gate, modify BUY_NOW, change scoring, change Signals, change Governance, or create production authority.

## Executive Summary

The Decision Intelligence artifact represents CardHawk's complete advisory investment assessment for a single listing. It binds existing production outputs, shadow outputs, Signal artifacts, valuation context, confidence interpretation, evidence quality, comparable quality, risks, opportunities, unknowns, and explanations into one immutable review-ready object.

The artifact is a frozen evidence package, not a decision engine. It consumes already-produced evidence and references it by ID and fingerprint. It does not recompute Signals, valuation, Deal Gate, BUY_NOW, parser output, scoring, confidence, or notification eligibility.

The artifact is suitable for future Governance binding because it preserves provenance, explicit unknown values, and authority boundaries:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

No Decision Intelligence artifact may authorize a purchase, override Deal Gate, change BUY_NOW, or grant runtime authority.

## Purpose

The contract exists to make one listing's investment assessment reviewable without changing production behavior.

It should answer, as evidence:

- What listing is being assessed?
- Which production, shadow, Signal, valuation, and governance artifacts support the assessment?
- What does the existing production pipeline believe?
- What does shadow and offline evidence suggest?
- Where do the systems agree?
- Where do they disagree?
- What is unknown?
- What evidence is missing?
- What supports the advisory recommendation?
- What opposes the advisory recommendation?
- What should Dalton review before trusting the opportunity?

It should not answer by changing runtime behavior.

## Artifact Schema

Recommended top-level shape:

```json
{
  "schemaVersion": "decision_intelligence_artifact.v1",
  "artifactId": "decision-intelligence:<listing-id>:<fingerprint>",
  "artifactType": "decision_intelligence_assessment",
  "createdAt": "2026-07-30T00:00:00.000Z",
  "capturedAt": "2026-07-30T00:00:00.000Z",
  "listingRef": {},
  "canonicalIdentityRef": {},
  "signalRefs": [],
  "valuationRefs": {},
  "productionDecisionRef": {},
  "dealGateRef": {},
  "buyNowRef": {},
  "shadowRefs": {},
  "governanceRefs": {},
  "confidenceInterpretation": {},
  "evidenceQualityAssessment": {},
  "comparableQualityAssessment": {},
  "agreementAnalysis": {},
  "riskAssessment": {},
  "opportunityAssessment": {},
  "explanationSummary": {},
  "advisoryRecommendation": {},
  "supportingReasons": [],
  "opposingReasons": [],
  "unknownValues": [],
  "outstandingEvidenceGaps": [],
  "provenance": {},
  "immutability": {},
  "compatibility": {},
  "productionImpact": "none",
  "decisionImpact": "none",
  "executionAuthority": "none",
  "artifactFingerprint": "sha256:<stable-fingerprint>"
}
```

All sections should be present. Missing data should be represented explicitly with `status: "unknown"`, `value: "unknown"`, `available: false`, or a structured missing-field entry. Builders must not invent data.

## Artifact Identity

Required fields:

- `schemaVersion`
- `artifactId`
- `artifactType`
- `createdAt`
- `capturedAt`
- `artifactFingerprint`

`schemaVersion` should be stable and explicit. The initial version should be `decision_intelligence_artifact.v1`.

`artifactId` should be deterministic for identical inputs when the caller supplies deterministic timestamps. A recommended pattern is:

```text
decision-intelligence:<listing-id>:<artifactFingerprint>
```

`artifactType` should be `decision_intelligence_assessment`.

`createdAt` records when the artifact was created. `capturedAt` records when the source evidence snapshot was captured. These may differ when older evidence is packaged later.

## Listing Identity Reference

The artifact should reference the listing being assessed without becoming the source of truth for listing persistence.

Recommended fields:

- `listingId`
- `marketplace`
- `source`
- `marketplaceItemId`
- `title`
- `url`
- `askingPrice`
- `shipping`
- `totalCost`
- `sellerSummary`
- `listingState`
- `capturedAt`
- `listingFingerprint`
- `sourceArtifactId`
- `sourceArtifactFingerprint`

The listing reference may include a compact snapshot for reviewer convenience, but the authoritative review package or production listing remains external.

## Canonical Identity Reference

The artifact should bind identity evidence by reference and fingerprint.

Recommended fields:

- `canonicalIdentityId`
- `canonicalIdentityFingerprint`
- `canonicalIdentitySummary`
- `legacyParsedIdentityFingerprint`
- `identityEligibility`
- `diagnosticStatus`
- `ambiguity`
- `confirmedFields`
- `missingFields`
- `conflictingFields`
- `inferredFields`
- `warnings`
- `blockingIssues`

Identity references should preserve the distinction between parsed identity, canonical identity, and diagnostics. Unknown identity fields must remain explicit and should not be inferred by the artifact.

## Signal References

The artifact should reference canonical Signal evidence rather than embed large source artifacts by default.

Each Signal reference should include:

- `signalFamily`
- `signalName`
- `signalVersion`
- `signalId`
- `signalFingerprint`
- `alignmentId`
- `alignmentFingerprint`
- `migrationFingerprint`
- `shadowComparisonFingerprint`
- `reportFingerprint`
- `coverageStatus`
- `parityStatus`
- `authorityStatus`
- `sourceOutputFingerprint`
- `summary`

Expected Signal families for a complete current-architecture artifact:

- `grade.premium.engine`
- `population.intelligence.engine`
- `listing.quality.grading.diagnostics`
- `valuation.range_first.diagnostics`
- `confidence.calibration.diagnostics`
- `decision.deal_gate.diagnostics`
- `evidence.readiness.diagnostics`
- `identity.parser.diagnostics`
- `false_positive.risk.diagnostics`
- `canonical.sold_evidence.diagnostics`
- `production.valuation.diagnostics`
- `comparable.quality.diagnostics`
- `decision.context.diagnostics`

Missing expected Signals should be listed in `outstandingEvidenceGaps`, not silently ignored.

## Valuation References

The artifact should preserve valuation evidence without recomputation.

Recommended fields:

- `productionValuation`
- `rangeFirstValuation`
- `shadowValuation`
- `marketValueReference`
- `estimatedValue`
- `estimatedProfit`
- `roi`
- `floorValue`
- `expectedValue`
- `ceilingValue`
- `valuationConfidence`
- `valuationRangeQuality`
- `valuationSourceFingerprints`
- `valuationWarnings`
- `valuationBlockers`

Production valuation and shadow valuation should remain separate. Active market context may be referenced, but active listings must not be treated as sold evidence.

## Production Decision References

The artifact should preserve the existing production decision context.

Recommended fields:

- `decisionEngineRef`
- `decisionEngineFingerprint`
- `decision`
- `recommendation`
- `action`
- `decisionScore`
- `evidenceScore`
- `opportunityScore`
- `decisionConfidence`
- `decisionMatrix`
- `componentScores`
- `positives`
- `warnings`
- `blockingFactors`
- `summary`

This section describes what the native decision engine produced. It does not become the final production decision authority.

## Deal Gate and BUY_NOW References

Deal Gate and BUY_NOW references must preserve current production boundaries.

Recommended Deal Gate fields:

- `dealGateId`
- `dealGateFingerprint`
- `decision`
- `recommendation`
- `passed`
- `approved`
- `buyNowAllowed`
- `reasons`
- `rejectionReasons`
- `positives`
- `dealGateBreakdown`
- `ruleOutcomes`
- `hardBlockers`
- `finalApprovalChecks`

Recommended BUY_NOW fields:

- `buyNowEligible`
- `buyNowSource`
- `buyNowExplanation`
- `notificationEligible`
- `humanReviewRequired`
- `purchaseAuthority`

`purchaseAuthority` must always be `none` in this artifact. BUY_NOW should remain a high-priority review candidate, not an automated purchase authorization.

## Confidence Interpretation

The confidence section should explain confidence across evidence types without inventing certainty.

Recommended fields:

- `overallConfidencePosture`
- `decisionConfidence`
- `valuationConfidence`
- `identityConfidence`
- `evidenceConfidence`
- `comparableConfidence`
- `confidenceCalibrationStatus`
- `overconfidenceRisks`
- `underconfidenceRisks`
- `confidenceConflicts`
- `confidenceUnknowns`
- `confidenceExplanation`

Allowed posture values:

- `high`
- `moderate`
- `limited`
- `low`
- `conflicted`
- `unknown`

Confidence interpretation should identify what each confidence score means and whether the available evidence supports it. It should not alter native confidence values.

## Evidence Quality Assessment

Recommended fields:

- `evidenceReadinessStatus`
- `soldEvidenceSufficiency`
- `canonicalSoldEvidenceStatus`
- `trueSoldCount`
- `activeContextCount`
- `staleEvidenceCount`
- `excludedEvidenceCount`
- `evidenceQualityScore`
- `evidenceQualityLevel`
- `provenanceQuality`
- `fallbackEvidenceUsed`
- `activeOnlyEvidence`
- `warnings`
- `blockers`
- `summary`

The artifact must preserve the rule that active listings are not sold evidence.

## Comparable Quality Assessment

Recommended fields:

- `comparableQualityStatus`
- `averageComparableQualityScore`
- `qualityDistribution`
- `scoredComparableCount`
- `acceptedComparableCount`
- `rejectedComparableCount`
- `identityMismatchCount`
- `similaritySummary`
- `priceReliabilitySummary`
- `conditionMatchSummary`
- `warnings`
- `blockers`
- `summary`

Comparable quality may support or weaken valuation confidence. It should not independently authorize BUY_NOW.

## Agreement and Disagreement Analysis

The agreement section should make production/shadow/Signal relationships visible.

Recommended fields:

- `overallAgreementStatus`
- `productionVsShadowDecision`
- `productionVsShadowValuation`
- `productionVsSignals`
- `dealGateVsDecisionEngine`
- `valuationVsEvidence`
- `valuationVsComparableQuality`
- `confidenceVsCalibration`
- `identityVsEvidence`
- `riskVsOpportunity`
- `conflicts`
- `unresolvedDisagreements`
- `reviewFocus`

Allowed agreement statuses:

- `agreement`
- `partial_agreement`
- `disagreement`
- `conflicted`
- `insufficient_evidence`
- `unknown`

The artifact should report disagreement. It must not resolve disagreement by choosing a winner.

## Risk Assessment

Recommended fields:

- `overallRiskPosture`
- `riskEngineRef`
- `riskScore`
- `riskLevel`
- `falsePositiveRisk`
- `marketRisk`
- `liquidityRisk`
- `pricingRisk`
- `identityRisk`
- `evidenceRisk`
- `conditionRisk`
- `supplyPressureRisk`
- `resaleRisk`
- `riskWarnings`
- `riskBlockers`
- `summary`

Allowed risk postures:

- `low`
- `moderate`
- `elevated`
- `high`
- `critical`
- `unknown`

Risk assessment should preserve all native risk outputs and Signal references.

## Opportunity Assessment

Recommended fields:

- `overallOpportunityPosture`
- `estimatedProfit`
- `roi`
- `floorProfit`
- `expectedProfit`
- `ceilingProfit`
- `investmentQuality`
- `marketQuality`
- `liquidity`
- `trend`
- `populationScarcity`
- `gradePremiumSupport`
- `opportunityDrivers`
- `opportunityLimits`
- `summary`

Allowed opportunity postures:

- `strong`
- `promising`
- `watch`
- `limited`
- `not_supported`
- `unknown`

Opportunity assessment should separate attractive upside from evidence sufficiency. High ROI without sufficient sold evidence should remain a caution or blocker.

## Explanation Summary

The explanation section should be presentation-neutral and suitable for future UI or Governance reports.

Recommended fields:

- `headline`
- `plainLanguageSummary`
- `decisionTrace`
- `supportingEvidenceTrace`
- `opposingEvidenceTrace`
- `dealGateTrace`
- `signalTrace`
- `confidenceTrace`
- `missingEvidenceTrace`
- `reviewFocus`

Trace entries should include:

- `traceId`
- `source`
- `sourceArtifactId`
- `sourceFingerprint`
- `category`
- `severity`
- `message`
- `relatedSignalNames`
- `relatedRuleIds`

Allowed severity values:

- `info`
- `supporting`
- `caution`
- `blocking`
- `unknown`

## Advisory Recommendation

The recommendation section should be explicitly advisory.

Recommended fields:

- `recommendationType`
- `recommendationPosture`
- `recommendationConfidence`
- `reviewPriority`
- `humanReviewRequired`
- `productionAuthority`
- `purchaseAuthority`
- `recommendationImpact`
- `summary`

Allowed `recommendationType` values:

- `advisory_buy_candidate`
- `advisory_watch`
- `advisory_monitor`
- `advisory_pass`
- `advisory_review_required`
- `unknown`

Allowed `recommendationPosture` values:

- `supportive`
- `cautious`
- `blocked`
- `conflicted`
- `insufficient_evidence`
- `unknown`

`productionAuthority` and `purchaseAuthority` must be `none`.

The artifact should never emit a self-authorizing `BUY_NOW` command. If it references BUY_NOW, it must do so as observed production output or advisory review context.

## Supporting and Opposing Reasons

Each reason should be structured.

Recommended fields:

- `reasonId`
- `category`
- `source`
- `sourceArtifactId`
- `sourceFingerprint`
- `severity`
- `message`
- `evidenceRefs`
- `signalRefs`
- `ruleRefs`

Reason categories should include:

- `identity`
- `evidence`
- `valuation`
- `comparable_quality`
- `confidence`
- `risk`
- `opportunity`
- `deal_gate`
- `buy_now`
- `shadow_disagreement`
- `governance`
- `unknown`

Supporting reasons and opposing reasons should remain separate so reviewers can see both sides of the assessment.

## Unknown Values

Unknown values must be explicit.

Recommended fields:

- `field`
- `category`
- `reason`
- `source`
- `expectedSource`
- `impact`
- `blocking`

Allowed impact values:

- `none`
- `review_only`
- `confidence_limiting`
- `evidence_limiting`
- `blocking`
- `unknown`

Unknown values must not be converted to defaults such as zero confidence, no risk, or sufficient evidence unless the source artifact explicitly says so.

## Outstanding Evidence Gaps

Recommended fields:

- `gapId`
- `category`
- `description`
- `expectedEvidence`
- `missingArtifactType`
- `missingSignalName`
- `reviewImpact`
- `certificationImpact`
- `blocking`

Evidence gaps should distinguish:

- missing source artifact
- missing Signal
- missing fingerprint
- missing canonical identity
- missing sold evidence
- insufficient sold evidence
- missing shadow comparison
- missing confidence calibration
- missing provenance
- unresolved conflict

## Provenance

The provenance section should make the artifact auditable.

Recommended fields:

- `sourceSystem`
- `builderName`
- `builderVersion`
- `inputArtifactIds`
- `inputFingerprints`
- `sourceFileReferences`
- `createdBy`
- `createdAt`
- `capturedAt`
- `reviewBatchId`
- `workspaceId`
- `governancePipelineId`

Provenance should preserve lineage from native production outputs through Signal and Governance artifacts.

## Fingerprint Requirements

The artifact fingerprint must be deterministic for identical inputs.

Fingerprint rules:

- Use stable canonical stringification.
- Exclude `artifactFingerprint` from its own fingerprint payload.
- Preserve deterministic array ordering.
- Include schema version.
- Include source artifact IDs and fingerprints.
- Include explicit unknown values and evidence gaps.
- Include authority fields.
- Do not include non-deterministic runtime-only object identity.

Recommended fingerprint field:

```text
artifactFingerprint
```

Recommended format:

```text
sha256:<hex digest>
```

## Immutability Requirements

Decision Intelligence artifacts must be immutable after creation.

Rules:

- Builders must deep-clone accepted input projections before embedding them.
- Attachment helpers must return a new artifact rather than mutate an existing artifact.
- Review annotations should be separate Governance or Review artifacts, not mutations of this artifact.
- Supersession should create a new artifact with a provenance reference to the prior artifact.
- Expiration or invalidation should be represented by a separate lifecycle artifact or wrapper status, not mutation.

## Validation Requirements

Future validators should return structured validation:

```json
{
  "valid": true,
  "errors": [],
  "warnings": [],
  "reasonCodes": [],
  "missingRequiredFields": [],
  "authorityViolations": [],
  "fingerprintViolations": [],
  "sourceReferenceViolations": [],
  "unknownValueViolations": [],
  "evidenceGapViolations": [],
  "compatibilityViolations": []
}
```

Required validation checks:

- schema version is supported
- required top-level fields are present
- authority fields are all `none`
- recommendation is advisory-only
- purchase authority is `none`
- source references include IDs and fingerprints where available
- Signal references preserve expected family names and fingerprints
- Deal Gate and BUY_NOW references are observational
- unknown values are explicit
- evidence gaps are explicit
- fingerprint matches deterministic payload
- artifact is immutable
- artifact does not claim production authority

## Compatibility Guarantees

The contract must preserve:

- existing production Deal Gate behavior
- existing BUY_NOW behavior
- existing scoring logic
- existing valuation calculations
- existing Signal outputs
- existing Governance artifacts
- existing scanner behavior
- existing parser and identity behavior
- existing notification behavior
- existing persistence format
- existing marketplace behavior

Future implementation should be additive and wrapper-first. Existing production consumers should continue consuming native outputs until a later governed production proposal is explicitly approved and implemented.

## Governance Binding Suitability

The artifact should be suitable for future binding into:

- Signal Governance Evidence Bundles
- Governance Review Reports
- Review Packages
- Governance Artifact Registry
- Governance Artifact Lifecycle Manager
- Governance Review Sessions
- Governance Review Workspace summaries
- Calibration Datasets
- Calibration Recommendations
- Offline Experiments
- Shadow Experiments
- Production Proposals

Binding should occur by artifact ID and fingerprint. Governance consumers should never recompute the artifact's source evidence.

## Authority Rules

The following rules are permanent for this contract:

- The artifact is advisory only.
- The artifact never authorizes a purchase.
- The artifact never modifies Deal Gate.
- The artifact never modifies BUY_NOW.
- The artifact never modifies scoring logic.
- The artifact never modifies valuation.
- The artifact never modifies Signals.
- The artifact never modifies Governance.
- The artifact never executes production engines.
- The artifact never recomputes source evidence.
- The artifact never grants production, decision, or execution authority.

## Open Questions

1. Should the first implementation embed compact source summaries or reference all source artifacts externally by default?

   Recommendation: use references by default and embed only deterministic compact summaries required for review ergonomics.

2. Should Decision Intelligence have its own Signal family?

   Recommendation: yes, but only after the artifact contract exists. The Signal wrapper should describe the artifact, not replace it.

3. Should the artifact include server display explanations?

   Recommendation: only as source-referenced explanation text until a dedicated Decision Explanation Graph exists.

4. Should advisory recommendations reuse `BUY_NOW` terminology?

   Recommendation: no. Use advisory recommendation types such as `advisory_buy_candidate` and preserve BUY_NOW only as observed production output.

5. Should missing required Signals block artifact creation?

   Recommendation: no for minimum artifact creation, yes for certification readiness. Missing Signals should create explicit evidence gaps.

## Recommended Next Phase

Recommended next phase: **Phase 17.1C - Offline Decision Intelligence Artifact Contract Implementation**.

That phase should implement immutable contract helpers under `validation/`, with focused tests for determinism, immutability, authority boundaries, explicit unknowns, source-reference validation, and fingerprint stability.

It should remain offline-only and should not execute production engines, recompute Signals, modify Deal Gate, modify BUY_NOW, modify scoring, modify valuation, or integrate with production runtime.

## Final Confirmation

This contract is documentation-only. It defines the architecture for future offline artifacts and does not change production behavior.
