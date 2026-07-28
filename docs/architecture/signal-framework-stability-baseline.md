# Signal Framework Stability Baseline

## Executive Summary

Phase 13.8A establishes the completed Signal framework as a stable offline and shadow-only architectural subsystem.

The framework has now supported six signal-family onboardings:

- Grade Premium
- Population Intelligence
- Listing Quality and Grading Diagnostics
- Range-First Valuation Diagnostics
- Confidence Calibration Diagnostics
- Deal Gate Diagnostics

The shared framework has reached the point of diminishing returns for foundational development. Its core contracts, lifecycle orchestration, adapter model, shadow comparison core, validation suite, and report layer are stable enough to preserve. Future Phase 13 work should focus on onboarding additional intelligence signals and improving evidence coverage rather than continuing broad framework refactors.

Stability assessment: **Stable for continued offline signal onboarding**.

This baseline grants no production authority. All migrated signals remain offline-only, shadow-only, advisory, evidence-preserving, and explicitly non-authoritative.

## Files Reviewed

Shared contracts and registry:

- `validation/canonicalIntelligenceSignalContract.js`
- `validation/intelligenceSignalRegistry.js`
- `validation/signalAlignmentContract.js`
- `validation/signalMigrationCoreContract.js`
- `validation/signalMigrationAdapterContract.js`
- `validation/signalShadowComparisonCoreContract.js`

Shared lifecycle modules:

- `validation/signalProducerAdapter.js`
- `validation/signalAlignmentBatch.js`
- `validation/signalAlignmentEngine.js`
- `validation/signalConflictAnalyzer.js`
- `validation/signalAlignmentReport.js`
- `validation/signalAlignmentValidationSuite.js`
- `validation/signalMigrationCore.js`
- `validation/signalShadowComparisonCore.js`

Completed migrations:

- `validation/gradePremiumSignalMigration.js`
- `validation/populationSignalMigration.js`
- `validation/listingQualitySignalMigration.js`
- `validation/rangeFirstValuationSignalMigration.js`
- `validation/confidenceCalibrationSignalMigration.js`
- `validation/dealGateSignalMigration.js`

Completed shadow comparisons:

- `validation/gradePremiumShadowComparison.js`
- `validation/populationShadowComparison.js`
- `validation/rangeFirstValuationShadowComparison.js`
- `validation/confidenceCalibrationShadowComparison.js`
- `validation/dealGateShadowComparison.js`

Architecture documents reviewed include the Phase 13 roadmap, intelligence signal audit, canonical signal contract, signal registry, alignment engine architecture, migration conformance audit, migration core architecture, reuse certification, shared core documents, and all completed signal onboarding notes.

## Framework Maturity Level

The Signal framework is mature for its current purpose: offline, shadow-only wrapping and parity validation of existing intelligence outputs.

The mature components are:

- canonical signal envelope
- deterministic registry definitions
- immutable alignment artifacts
- alignment batches
- alignment runs
- conflict analysis
- alignment reports
- migration lifecycle orchestration
- adapter contract
- shadow comparison lifecycle orchestration
- authority-boundary validation
- deterministic fingerprinting
- explicit unknown-value preservation

The framework should not be considered mature for production runtime authority. That is intentional. The current architecture is designed to observe, validate, compare, and document intelligence signals without changing production decisions.

## API Stability Assessment

The public APIs should now be treated as stable for offline consumers.

Stable API families:

- canonical signal creation, validation, cloning, and fingerprinting
- registry definition creation, lookup, sorting, filtering, and fingerprinting
- alignment artifact creation and validation
- migration artifact creation and validation
- migration adapter creation and compatibility validation
- migration lifecycle execution
- shadow comparison lifecycle execution
- report creation, validation, filtering, sorting, export, import, and fingerprinting

The framework-level APIs should remain backwards-compatible. Future engine onboarding should add engine-specific modules around these APIs rather than changing the shared contracts.

Any future contract change should be versioned and additive. Existing migrated signal families should not be forced into shape changes unless a documented governance phase approves a compatibility migration.

## Backwards Compatibility Guarantees

The framework currently preserves:

- native output exactly as supplied
- existing production and diagnostic engine outputs
- public engine-specific migration APIs
- public engine-specific comparison APIs
- deterministic fingerprint behavior for identical inputs
- explicit `unknown` values
- authority boundaries of `productionImpact: "none"`, `decisionImpact: "none"`, and `executionAuthority: "none"`
- immutable source artifacts
- no-runtime-import boundaries for migrated signal families

These guarantees should be maintained for all future signal onboarding.

## Remaining Technical Debt

Some technical debt remains, but none currently justifies additional framework-wide refactoring before the next engine migration.

Known debt:

- Early migrations such as Grade Premium and Population predate the full adapter/core artifact style later used by Range-First, Confidence Calibration, and Deal Gate.
- Engine-specific modules still duplicate some local helper names for summaries, reason codes, and field comparisons.
- There is no single migration catalog that lists all onboarded signal families, their registry definitions, and their comparison coverage.
- No formal compatibility matrix exists for signal versions versus adapter versions.
- Shadow comparison modules are not yet present for every migrated family if a family only needed migration certification.
- The validation suite proves framework behavior with representative scenarios, but it is not yet a complete onboarding certification runner for every existing and future signal family.

These are maintenance and visibility gaps, not production reliability blockers.

## Intentional Engine-Specific Responsibilities

The following responsibilities should remain engine-specific:

- signal identity and producer naming
- native-output aliases
- required and optional native fields
- native-to-canonical semantic mapping
- evidence interpretation
- confidence interpretation
- uncertainty interpretation
- status interpretation
- metadata interpretation
- mismatch reason-code wording
- domain-specific parity rules
- human-readable summaries

Keeping these local prevents the shared core from becoming a domain-specific decision engine. The shared framework should orchestrate lifecycle and enforce contracts; it should not learn card valuation, grading, population, confidence, or Deal Gate semantics.

## Additional Refactoring Assessment

Additional broad framework refactoring is not justified now.

The completed onboardings show that:

- migration orchestration is centralized
- comparison orchestration is centralized
- immutable contract behavior is shared
- fingerprint construction follows stable projection rules
- authority enforcement is consistent
- unknown-value preservation is consistent
- native output parity is testable
- new signal families can be onboarded with mostly semantic glue

Further consolidation would risk over-abstracting the few parts that should remain domain-specific. Framework development should stop unless a future onboarding exposes repeated lifecycle code that cannot be expressed through the existing core, adapter, or comparison hooks.

## Remaining Architectural Risks

Primary risks:

- A future migration may accidentally introduce runtime imports without a no-runtime-integration test.
- Registry definitions can drift from adapter mappings if onboarding documentation is not kept aligned.
- Engine-specific semantic parity rules may become inconsistent if reason-code conventions are not reviewed during onboarding.
- The framework can produce many immutable artifacts; offline batch tooling should avoid treating reports as production payloads.
- Production decision language wrapped inside a canonical signal, especially Deal Gate or BUY_NOW context, may be misunderstood unless authority fields remain prominent.

Mitigations:

- Keep no-runtime-import tests mandatory.
- Require native-output parity tests for every onboarding.
- Require authority-boundary tests for every migration and comparison.
- Add a future registry/reporting inventory rather than changing existing contracts.
- Keep all Phase 13 artifacts out of production authority until promoted through Phase 12 governance.

## Long-Term Maintenance Guidance

Treat the Signal framework as a stable subsystem.

Maintenance rules:

1. Prefer additive APIs over modifying existing contracts.
2. Preserve existing engine-specific public APIs.
3. Keep shared lifecycle code in `signalMigrationCore.js` and `signalShadowComparisonCore.js`.
4. Keep domain semantics inside signal-family modules.
5. Add tests before onboarding each new signal family.
6. Require deterministic fingerprints for all generated artifacts.
7. Require explicit `unknown` values instead of inferred defaults.
8. Require `productionImpact`, `decisionImpact`, and `executionAuthority` to remain `none`.
9. Do not introduce runtime integration through the Signal framework.
10. Use Phase 12 governance before any signal influences production behavior.

## Recommended Future Development Strategy

New framework development should stop for now.

Future work should focus on onboarding additional existing intelligence outputs into the stable framework, then using reports to identify evidence and decision-quality gaps.

Recommended strategy:

1. Continue migrating existing offline diagnostics and intelligence outputs one family at a time.
2. Add a lightweight signal onboarding checklist or registry report only if repeated manual review becomes a bottleneck.
3. Use the completed Signal Alignment Report and shadow comparison artifacts as inputs to Phase 12 governance datasets.
4. Avoid production runtime integration until enough reviewed evidence supports a governed production proposal.
5. Prioritize signal families that improve identity correctness, sold-evidence sufficiency, valuation reliability, and false-positive reduction.

## Recommended Roadmap After Phase 13

Near-term Phase 13 work:

- Continue signal onboarding for the next highest-value existing diagnostic family.
- Build an offline signal coverage report only after additional migrated families make manual tracking inefficient.
- Compare migrated signal families through reports and conflict analyses to identify evidence gaps.

Medium-term work:

- Use real listing review outcomes to evaluate which signal families best predict Dalton's decisions.
- Feed reviewed signal reports into calibration datasets and recommendation artifacts.
- Identify signal families that consistently surface false positives or missed opportunities.

Long-term work:

- Prepare governed production proposals only after offline and shadow evidence demonstrates measurable improvement.
- Keep any AI-assisted interpretation advisory and evidence-only unless explicitly promoted through the governance chain.
- Preserve CardHawk's priority order: accuracy, reliability, scalability, speed, UI polish.

## Recommended Next Phase

Recommended next phase: **Phase 13.8B - Signal Coverage and Onboarding Priority Audit**.

That phase should be audit-only and should identify the next signal families to migrate by reviewing existing intelligence outputs against CardHawk's highest-value goals:

- card identity correctness
- trustworthy sold evidence
- valuation reliability
- false-positive reduction
- Deal Gate and BUY_NOW quality
- notification precision

The next phase should not add new framework primitives unless the audit discovers a concrete gap that blocks onboarding.

## Explicit Non-Goals

This baseline does not:

- grant production authority
- change production scoring
- change Deal Gate
- change BUY_NOW
- change valuation
- change parser behavior
- change scanner behavior
- change persistence
- execute intelligence engines
- approve shadow systems for production use
- recommend broad framework refactoring
- replace Phase 12 governance

## Final Baseline

The Phase 13 Signal framework is stable for continued offline signal onboarding.

Framework development should pause. Future work should migrate additional existing intelligence signals, collect comparable shadow evidence, and feed reviewed findings into the established governance pipeline.
