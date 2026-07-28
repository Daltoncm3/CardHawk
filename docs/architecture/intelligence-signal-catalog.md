# Intelligence Signal Catalog

## Executive Summary

This catalog is the authoritative Phase 13 index of Signal families currently supported by CardHawk's shared Signal framework.

The catalog covers the six onboarded families:

1. Grade Premium
2. Population Intelligence
3. Listing Quality and Grading Diagnostics
4. Range-First Valuation Diagnostics
5. Confidence Calibration Diagnostics
6. Deal Gate Diagnostics

All listed signals are offline-only and shadow-only. They wrap already-produced native outputs, preserve those outputs exactly, and create canonical Signal, Alignment, Batch, Run, Conflict Analysis, Report, Migration, and Shadow Comparison artifacts where applicable.

No cataloged signal has production authority. No signal changes scoring, valuation, Deal Gate, BUY_NOW, notifications, persistence, scanner behavior, marketplace behavior, or configuration.

## Framework Version

Current framework baseline: **Phase 13.8A stable offline Signal framework**.

Relevant framework contracts and cores:

- `validation/canonicalIntelligenceSignalContract.js`
- `validation/intelligenceSignalRegistry.js`
- `validation/signalAlignmentContract.js`
- `validation/signalAlignmentBatch.js`
- `validation/signalAlignmentEngine.js`
- `validation/signalConflictAnalyzer.js`
- `validation/signalAlignmentReport.js`
- `validation/signalAlignmentValidationSuite.js`
- `validation/signalMigrationCoreContract.js`
- `validation/signalMigrationAdapterContract.js`
- `validation/signalMigrationCore.js`
- `validation/signalShadowComparisonCoreContract.js`
- `validation/signalShadowComparisonCore.js`

Stable authority boundary for every cataloged signal:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

## Onboarding Timeline

| Phase | Signal family | Primary artifact |
| --- | --- | --- |
| 13.3A | Grade Premium | `validation/gradePremiumSignalMigration.js` |
| 13.3B | Grade Premium Shadow Comparison | `validation/gradePremiumShadowComparison.js` |
| 13.4A | Population Intelligence | `validation/populationSignalMigration.js` |
| 13.4B | Population Shadow Comparison | `validation/populationShadowComparison.js` |
| 13.5B | Listing Quality and Grading Diagnostics | `validation/listingQualitySignalMigration.js` |
| 13.6D | Shared Signal Migration Core consolidation | `validation/signalMigrationCore.js` |
| 13.6F | Shared Signal Shadow Comparison Core consolidation | `validation/signalShadowComparisonCore.js` |
| 13.7A | Range-First Valuation Diagnostics | `validation/rangeFirstValuationSignalMigration.js` and `validation/rangeFirstValuationShadowComparison.js` |
| 13.7C | Confidence Calibration Diagnostics | `validation/confidenceCalibrationSignalMigration.js` and `validation/confidenceCalibrationShadowComparison.js` |
| 13.7D | Deal Gate Diagnostics | `validation/dealGateSignalMigration.js` and `validation/dealGateShadowComparison.js` |
| 13.8A | Signal Framework Stability Baseline | `docs/architecture/signal-framework-stability-baseline.md` |
| 13.8B | Intelligence Signal Catalog | `docs/architecture/intelligence-signal-catalog.md` |

## Dependency Relationships

All cataloged migrations depend on the shared Signal contracts and registry. Later migrations also use the shared migration and comparison cores.

Common dependency chain:

1. Supplied native output
2. Intelligence Signal Registry definition
3. Canonical Intelligence Signal
4. Signal Alignment artifact
5. Signal Alignment Batch
6. Signal Alignment Run
7. Signal Conflict Analysis
8. Signal Alignment Report
9. Migration artifact
10. Shadow Comparison artifact, when available

The framework observes native output only. It does not execute the native engine that produced the output.

## Signal Families

### Grade Premium

Signal name: `grade.premium.engine`

Purpose: Wrap Grade Premium Engine output so grading premium support, risk, and sold-support context can participate in Signal alignment and offline governance.

Native diagnostic source: `gradePremiumEngine` output supplied to `validation/gradePremiumSignalMigration.js`.

Canonical signal identity:

- producer: `gradePremiumEngine`
- producer category: `production_engine`
- signal type: `grading`
- decision role: `diagnostic_only`
- authority level: `shadow_observation`
- evidence role: `diagnostic_context`

Evidence produced:

- grade-premium support context
- sold-support details when supplied
- premium justification
- premium risk level
- warnings, positives, dimensions, and summary fields from the native output

Confidence semantics:

- Native Grade Premium output contains score and support context, not calibrated confidence.
- Canonical confidence remains explicitly `unknown` when native confidence is not supplied.
- Evidence quality is mapped from native support/risk context.

Primary reason codes:

- `native_output_parity_mismatch`
- `changed_native_field`
- `missing_wrapper_field`
- `unexpected_wrapper_field`
- `changed_evidence_value`
- `changed_confidence_value`
- `changed_status_value`
- `changed_metadata_value`
- `authority_boundary_violation`

Shadow comparison availability: Available through `validation/gradePremiumShadowComparison.js`.

Migration status: Onboarded and parity-validated.

Production integration status: Offline / Shadow Only.

Related architecture documents:

- `docs/architecture/grade-premium-signal-migration.md`
- `docs/architecture/grade-premium-shadow-comparison.md`
- `docs/architecture/signal-framework-reuse-certification.md`

### Population Intelligence

Signal name: `population.intelligence.engine`

Purpose: Wrap Population Intelligence output so scarcity, population-count, and availability context can participate in Signal alignment and offline governance.

Native diagnostic source: `populationEngine` output supplied to `validation/populationSignalMigration.js`.

Canonical signal identity:

- producer: `populationEngine`
- producer category: `production_engine`
- signal type: `context`
- decision role: `diagnostic_only`
- authority level: `shadow_observation`
- evidence role: `diagnostic_context`

Evidence produced:

- population counts
- scarcity level
- population source metadata
- population update timestamps
- availability and evidence-quality context

Confidence semantics:

- Native population confidence maps to canonical confidence value and confidence level.
- Population counts are not true sold evidence.
- Population context contributes scarcity context only.

Primary reason codes:

- `native_output_parity_mismatch`
- `changed_native_field`
- `missing_wrapper_field`
- `unexpected_wrapper_field`
- `changed_population_evidence_value`
- `changed_confidence_value`
- `changed_status_value`
- `changed_metadata_value`
- `authority_boundary_violation`

Shadow comparison availability: Available through `validation/populationShadowComparison.js`.

Migration status: Onboarded and parity-validated.

Production integration status: Offline / Shadow Only.

Related architecture documents:

- `docs/architecture/population-signal-migration.md`
- `docs/architecture/population-shadow-comparison.md`
- `docs/architecture/signal-framework-reuse-certification.md`

### Listing Quality and Grading Diagnostics

Signal name: `listing.quality.grading.diagnostics`

Purpose: Wrap Listing Quality and Grading Diagnostics output so listing-quality risk, grading ambiguity, false-positive risk, and review context can participate in Signal alignment.

Native diagnostic source: Supplied output from `validation/listingQualityGradingDiagnostics.js`, consumed by `validation/listingQualitySignalMigration.js`.

Canonical signal identity:

- producer: `listingQualityGradingDiagnostics`
- producer category: `offline_validation`
- signal type: `quality`
- decision role: `diagnostic_only`
- authority level: `shadow_observation`
- evidence role: `diagnostic_context`

Evidence produced:

- listing-quality status
- grading diagnostic status
- risk level
- blocking issues
- warnings
- confirmed, ambiguous, and unsupported attributes
- grading support summary
- listing-history context

Confidence semantics:

- Native Listing Quality and Grading Diagnostics do not report production confidence.
- Canonical confidence remains explicitly `unknown`.
- Evidence quality is inferred only from supplied diagnostic risk/status fields, not recomputed from production engines.

Primary reason codes:

- `native_output_parity_mismatch`
- `changed_native_field`
- `missing_wrapper_field`
- `unexpected_wrapper_field`
- `changed_evidence_value`
- `changed_confidence_value`
- `changed_status_value`
- `changed_metadata_value`
- `authority_boundary_violation`

Shadow comparison availability: Migration parity is available through the shared migration lifecycle. A dedicated external shadow comparison module is not currently listed for this family.

Migration status: Onboarded and parity-validated.

Production integration status: Offline / Shadow Only.

Related architecture documents:

- `docs/architecture/listing-quality-signal-migration.md`
- `docs/architecture/listing-quality-grading-diagnostics.md`
- `docs/architecture/signal-migration-conformance-audit.md`

### Range-First Valuation Diagnostics

Signal name: `valuation.range_first.diagnostics`

Purpose: Wrap Range-First Valuation Diagnostics output so valuation uncertainty, supported range, confidence-cap recommendation, and evidence-readiness context can participate in Signal alignment and shadow comparison.

Native diagnostic source: Supplied output from `validation/rangeFirstValuationDiagnostics.js`, consumed by `validation/rangeFirstValuationSignalMigration.js`.

Canonical signal identity:

- producer: `rangeFirstValuationDiagnostics`
- producer category: `offline_validation`
- signal type: `valuation`
- decision role: `diagnostic_only`
- authority level: `shadow_observation`
- evidence role: `diagnostic_context`

Evidence produced:

- production point estimate context
- valuation range context
- lower, midpoint, and upper bound context
- spread and uncertainty context
- supporting evidence summary
- excluded evidence summary
- confidence-cap recommendation
- warnings and blockers

Confidence semantics:

- Confidence represents diagnostic cap guidance, not production confidence.
- Confidence-cap recommendations remain advisory and cannot change production thresholds.
- Uncertainty level maps from supplied range-first diagnostic status and spread context.

Primary reason codes:

- `native_output_parity_mismatch`
- `changed_native_field`
- `missing_wrapper_field`
- `unexpected_wrapper_field`
- `changed_evidence_value`
- `changed_confidence_value`
- `changed_status_value`
- `changed_metadata_value`
- `authority_boundary_violation`

Shadow comparison availability: Available through `validation/rangeFirstValuationShadowComparison.js`.

Migration status: Onboarded through the shared framework and parity-validated.

Production integration status: Offline / Shadow Only.

Related architecture documents:

- `docs/architecture/range-first-valuation-signal-onboarding.md`
- `docs/architecture/range-first-valuation-diagnostics.md`
- `docs/architecture/signal-framework-reuse-certification.md`

### Confidence Calibration Diagnostics

Signal name: `confidence.calibration.diagnostics`

Purpose: Wrap Confidence Calibration Diagnostics output so reported confidence, outcome availability, calibration gap, and overconfidence or underconfidence risk can participate in Signal alignment and shadow comparison.

Native diagnostic source: Supplied output from `validation/confidenceCalibrationDiagnostics.js`, consumed by `validation/confidenceCalibrationSignalMigration.js`.

Canonical signal identity:

- producer: `confidenceCalibrationDiagnostics`
- producer category: `offline_validation`
- signal type: `confidence`
- decision role: `diagnostic_only`
- authority level: `shadow_observation`
- evidence role: `diagnostic_context`

Evidence produced:

- reported confidence context
- evidence-readiness context
- reviewed outcome metrics
- sample-size context
- calibration gap
- overconfidence indicators
- underconfidence indicators
- recommended confidence cap

Confidence semantics:

- Reported confidence is preserved as supplied.
- Confidence support level maps to canonical confidence level.
- Calibration gaps and caps remain diagnostic and do not alter production confidence.

Primary reason codes:

- `native_output_parity_mismatch`
- `changed_native_field`
- `missing_wrapper_field`
- `unexpected_wrapper_field`
- `changed_evidence_value`
- `changed_confidence_value`
- `changed_status_value`
- `changed_metadata_value`
- `authority_boundary_violation`

Shadow comparison availability: Available through `validation/confidenceCalibrationShadowComparison.js`.

Migration status: Onboarded through the shared framework and parity-validated.

Production integration status: Offline / Shadow Only.

Related architecture documents:

- `docs/architecture/confidence-calibration-signal-onboarding.md`
- `docs/architecture/confidence-calibration-diagnostics.md`
- `docs/architecture/signal-framework-stability-baseline.md`

### Deal Gate Diagnostics

Signal name: `decision.deal_gate.diagnostics`

Purpose: Wrap supplied Deal Gate diagnostic output so pass/reject status, BUY_NOW eligibility, threshold context, evidence context, and decision reasoning can participate in Signal alignment and shadow comparison without granting production authority.

Native diagnostic source: Supplied Deal Gate output consumed by `validation/dealGateSignalMigration.js`.

Canonical signal identity:

- producer: `dealGate`
- producer category: `production_engine`
- signal type: `decision`
- decision role: `diagnostic_only`
- authority level: `shadow_observation`
- evidence role: `diagnostic_context`

Evidence produced:

- pass or rejection status
- supplied BUY_NOW eligibility
- decision or recommendation label
- threshold and rule-breakdown context
- sold-comparable count context
- confidence score context
- reasons and positives

Confidence semantics:

- Supplied Deal Gate confidence score is preserved as diagnostic context.
- Confidence level maps from supplied score bands.
- Production decision language such as `BUY_NOW` remains observational inside the wrapper.

Primary reason codes:

- `native_output_parity_mismatch`
- `changed_native_field`
- `missing_wrapper_field`
- `unexpected_wrapper_field`
- `changed_evidence_value`
- `changed_confidence_value`
- `changed_status_value`
- `changed_metadata_value`
- `authority_boundary_violation`

Shadow comparison availability: Available through `validation/dealGateShadowComparison.js`.

Migration status: Onboarded through the shared framework and parity-validated.

Production integration status: Offline / Shadow Only.

Related architecture documents:

- `docs/architecture/deal-gate-signal-onboarding.md`
- `docs/architecture/deal-gate-breakdown.md`
- `docs/architecture/signal-framework-stability-baseline.md`

## Current Signal Coverage Summary

| Family | Signal name | Migration | Shadow comparison | Production integration |
| --- | --- | --- | --- | --- |
| Grade Premium | `grade.premium.engine` | Complete | Complete | Offline / Shadow Only |
| Population Intelligence | `population.intelligence.engine` | Complete | Complete | Offline / Shadow Only |
| Listing Quality | `listing.quality.grading.diagnostics` | Complete | Migration parity only | Offline / Shadow Only |
| Range-First Valuation | `valuation.range_first.diagnostics` | Complete | Complete | Offline / Shadow Only |
| Confidence Calibration | `confidence.calibration.diagnostics` | Complete | Complete | Offline / Shadow Only |
| Deal Gate Diagnostics | `decision.deal_gate.diagnostics` | Complete | Complete | Offline / Shadow Only |

## Future Onboarding Checklist

Every new Signal family should satisfy this checklist:

1. Select an existing native engine or diagnostic output.
2. Confirm the migration accepts supplied native output only.
3. Confirm the migration does not import or execute the native engine.
4. Define the registry signal name, version, producer, category, signal type, decision role, authority level, and evidence role.
5. Preserve native output exactly in the migration artifact, canonical signal raw output, and adapted signal.
6. Use `signalMigrationCore.js` for lifecycle orchestration unless a documented gap blocks reuse.
7. Use `signalMigrationAdapterContract.js` for declarative mapping metadata.
8. Use `signalMigrationCoreContract.js` for lifecycle artifact projection when compatible with the signal family.
9. Add shadow comparison through `signalShadowComparisonCore.js` when native-to-wrapper semantic parity needs explicit comparison.
10. Keep signal-family code limited to identity, mappings, semantic interpretation, summaries, and reason codes.
11. Preserve explicit `unknown` values.
12. Preserve deterministic ordering and fingerprints.
13. Add no-runtime-integration tests.
14. Add native-output parity tests.
15. Add authority-boundary tests.
16. Document evidence and confidence semantics.

## Governance Expectations

Adding a new Signal family does not change production behavior.

Each onboarded family remains evidence-only until it moves through the Phase 12 governance chain:

1. Real listing review
2. Calibration dataset
3. Recommendation
4. Offline experiment
5. Shadow experiment
6. Production proposal
7. Explicit Dalton approval
8. Code or configuration change
9. Full validation
10. Deployment
11. Post-deployment monitoring

No Signal wrapper, migration, comparison, report, or catalog entry may bypass this chain.

## Catalog Maintenance

This catalog should be updated whenever a new Signal family is onboarded or when a signal family gains a dedicated shadow comparison.

Updates should include:

- signal name and version
- native source
- canonical identity
- evidence produced
- confidence semantics
- reason-code family
- comparison coverage
- migration status
- production integration status
- related architecture documents

Catalog updates should remain documentation-only unless a future phase explicitly requests implementation.
