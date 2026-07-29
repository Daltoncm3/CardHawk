# Signal Coverage Certification

Phase 14.6 certifies the completion status of CardHawk's Signal migration initiative after the Phase 13 shared Signal framework and the Phase 14 coverage migrations.

This certification is audit-only and documentation-only. It does not grant production authority to any Signal artifact, shadow comparison, migration, report, or validation result.

## Executive Summary

Certification decision: **Coverage Complete for the Current Architecture, Offline and Shadow Only**.

The planned Phase 14 migration roadmap has been completed. CardHawk now has canonical Signal coverage for the core intelligence families needed to explain current production decisions without changing production behavior:

- identity and parser quality
- evidence readiness
- canonical sold evidence
- comparable quality
- production valuation
- range-first valuation
- grade premium
- population intelligence
- confidence calibration
- false-positive risk
- Deal Gate diagnostics
- decision context

The Signal framework can now be considered coverage-complete for the current architecture's offline review, shadow comparison, and governance-evidence needs.

This does not mean every repository intelligence module has been migrated. Some modules remain intentionally outside the Signal framework because they are runtime orchestrators, persistence systems, lower-level analyzers already represented by aggregated Signals, governance artifacts, or operational utilities. They should stay native unless a future architecture phase identifies a concrete evidence gap.

No Signal artifact has production authority. Production still consumes native outputs directly, and any future production integration must move through the Phase 12 governance chain.

## Sources Reviewed

Certification reviewed:

- `docs/architecture/intelligence-coverage-audit.md`
- `docs/architecture/intelligence-signal-catalog.md`
- `docs/architecture/signal-framework-stability-baseline.md`
- `docs/architecture/signal-framework-reuse-certification.md`
- `docs/architecture/phase-13-intelligence-roadmap.md`
- all Signal migration modules under `validation/`
- all Signal shadow comparison modules under `validation/`
- shared Signal contracts, registry, alignment, migration, comparison, validation, and reporting modules
- Phase 13 and Phase 14 onboarding documents

## Onboarded Signal Families

| Phase | Signal family | Signal name | Migration module | Shadow comparison | Status |
| --- | --- | --- | --- | --- | --- |
| 13.3A | Grade Premium | `grade.premium.engine` | `validation/gradePremiumSignalMigration.js` | `validation/gradePremiumShadowComparison.js` | Complete |
| 13.4A | Population Intelligence | `population.intelligence.engine` | `validation/populationSignalMigration.js` | `validation/populationShadowComparison.js` | Complete |
| 13.5B | Listing Quality and Grading Diagnostics | `listing.quality.grading.diagnostics` | `validation/listingQualitySignalMigration.js` | Migration parity through migration artifact | Complete |
| 13.7A | Range-First Valuation Diagnostics | `valuation.range_first.diagnostics` | `validation/rangeFirstValuationSignalMigration.js` | `validation/rangeFirstValuationShadowComparison.js` | Complete |
| 13.7C | Confidence Calibration Diagnostics | `confidence.calibration.diagnostics` | `validation/confidenceCalibrationSignalMigration.js` | `validation/confidenceCalibrationShadowComparison.js` | Complete |
| 13.7D | Deal Gate Diagnostics | `decision.deal_gate.diagnostics` | `validation/dealGateSignalMigration.js` | `validation/dealGateShadowComparison.js` | Complete |
| 14.0B | Evidence Readiness | `evidence.readiness.diagnostics` | `validation/evidenceReadinessSignalMigration.js` | `validation/evidenceReadinessShadowComparison.js` | Complete |
| 14.0C | Identity Parser Diagnostics | `identity.parser.diagnostics` | `validation/identityParserSignalMigration.js` | `validation/identityParserShadowComparison.js` | Complete |
| 14.1 | False-Positive Diagnostics | `false_positive.risk.diagnostics` | `validation/falsePositiveSignalMigration.js` | `validation/falsePositiveShadowComparison.js` | Complete |
| 14.2 | Canonical Sold Evidence | `canonical.sold_evidence.diagnostics` | `validation/canonicalSoldEvidenceSignalMigration.js` | `validation/canonicalSoldEvidenceShadowComparison.js` | Complete |
| 14.3 | Production Valuation | `production.valuation.diagnostics` | `validation/productionValuationSignalMigration.js` | `validation/productionValuationShadowComparison.js` | Complete |
| 14.4 | Comparable Quality | `comparable.quality.diagnostics` | `validation/comparableQualitySignalMigration.js` | `validation/comparableQualityShadowComparison.js` | Complete |
| 14.5 | Decision Context | `decision.context.diagnostics` | `validation/decisionContextSignalMigration.js` | `validation/decisionContextShadowComparison.js` | Complete |

## Coverage Statistics

- Total onboarded Signal families: **13**
- Planned Phase 14 families: **7**
- Completed Phase 14 families: **7**
- Phase 14 completion rate: **100%**
- Onboarded families with dedicated shadow comparison modules: **12**
- Onboarded families with migration parity only: **1**
- Production runtime integrations added by the Signal framework: **0**
- Production authority granted to Signal artifacts: **0**

The one migration-parity-only family is Listing Quality and Grading Diagnostics. It remains acceptable for the current architecture because its migration verifies native-output parity and produces canonical alignment artifacts, while later families use the consolidated shadow comparison core when explicit native-to-shadow semantic parity checks are required.

## Current Coverage Map

| Mission area | Covered Signal families | Certification status |
| --- | --- | --- |
| Card identity correctness | Identity Parser Diagnostics, Listing Quality and Grading Diagnostics | Covered for offline review |
| Sold evidence sufficiency | Evidence Readiness, Canonical Sold Evidence | Covered for offline review |
| Comparable trust | Comparable Quality, Listing Quality and Grading Diagnostics | Covered for offline review |
| Market value and valuation uncertainty | Production Valuation, Range-First Valuation Diagnostics | Covered for offline review |
| Grading and premium context | Grade Premium, Listing Quality and Grading Diagnostics | Covered for offline review |
| Scarcity and population context | Population Intelligence | Covered for offline review |
| Confidence quality | Confidence Calibration Diagnostics | Covered for offline review |
| False-positive risk | False-Positive Diagnostics | Covered for offline review |
| Deal Gate quality | Deal Gate Diagnostics | Covered for offline review |
| End-to-end decision context | Decision Context | Covered for offline review |

## Remaining Intentionally Excluded Modules

The following module categories remain outside Signal migration intentionally.

### Runtime Orchestrators

- `server.js`
- `services/scoutScannerService.js`
- marketplace adapters
- scan scheduling and persistence coordinators

Reason: these systems coordinate runtime behavior. They are not intelligence evidence outputs and should not become Signal producers unless a future phase creates offline scan-summary artifacts.

### Persistence, Retention, and Memory Governance

- `utils/stateStore.js`
- `utils/appStore.js`
- `utils/persistenceCoordinator.js`
- `utils/activeListingRetention.js`
- `engines/historyEngine.js`
- memory architecture validators

Reason: these systems protect reliability and durability. They may produce operational metrics, but they are not current decision-evidence signals.

### Lower-Level Analyzers Represented by Aggregated Signals

- `engines/intelligence/liquidityAnalyzer.js`
- `engines/intelligence/priceConsistencyAnalyzer.js`
- `engines/intelligence/compQualityAnalyzer.js`
- similar component analyzers consumed by broader intelligence outputs

Reason: these analyzers are valuable internals, but their decision-relevant context is currently represented through higher-level Signals such as Comparable Quality, Evidence Readiness, Production Valuation, Range-First Valuation, and Decision Context. Direct migration should wait until a concrete explainability gap appears.

### Governance and Review Artifacts

- review workspace contracts
- calibration dataset contracts
- calibration recommendation contracts
- offline experiment contracts and runners
- shadow experiment contracts and runners
- production proposal, approval, deployment validation, and pipeline validation artifacts

Reason: these are governance containers and validators. They consume evidence; they do not need to be wrapped as intelligence Signals.

### Learning and Outcome Tracking

- `engines/learningEngine.js`
- `engines/predictionAccuracyEngine.js`
- `engines/decisionValidationEngine.js`

Reason: these systems track outcomes and calibration history. Their data should feed Phase 12 datasets and future calibration work rather than become production-like Signal outputs prematurely.

### Native Production Decision Components

- Deal Gate runtime decision logic
- BUY_NOW logic
- valuation formulas
- scoring formulas

Reason: the Signal framework wraps already-produced outputs. It must not replace or alter native production decision components without explicit governance approval.

## Architectural Observations

The Signal framework has achieved the intended wrapper-first architecture:

- native outputs are preserved in canonical `rawOutput`
- migrations accept supplied outputs instead of executing engines
- shadow comparisons identify parity mismatches without repairing them
- deterministic fingerprints connect native output, canonical signal, alignment, batch, run, report, migration, and comparison artifacts
- authority fields remain explicit and fail closed
- unknown values remain explicit
- engine-specific code is limited to identity, mapping, semantic interpretation, parity rules, summaries, and reason codes

The Phase 14 additions materially improve coverage. The system can now create offline advisory reports that explain a listing across identity, evidence, valuation, confidence, false-positive risk, Deal Gate, and decision context without changing production behavior.

## Remaining Risks

1. **Registry drift**

   Signal registry definitions and adapter mappings must remain synchronized. A future registry report or onboarding checklist could reduce manual drift risk.

2. **Catalog drift**

   The Intelligence Signal Catalog predates the later Phase 14 onboardings. Future documentation maintenance should update the catalog or generate it from registry-style metadata.

3. **No production integration path yet**

   Coverage is complete for offline and shadow observation, not runtime consumption. Production integration requires a separate architecture phase and Phase 12 governance.

4. **Lower-level analyzer visibility**

   Some component analyzers remain represented through aggregate Signals. If future reviews need deeper explanations, those analyzers may need direct Signal wrappers.

5. **Outcome feedback not yet connected**

   Review outcomes, prediction accuracy, resale outcomes, and decision validation are not yet connected to Signal reports as a governed feedback loop.

6. **Listing Quality shadow comparison asymmetry**

   Listing Quality has migration parity but no dedicated shadow comparison module. This is acceptable now, but a future certification runner may want uniform dedicated comparison coverage for all families.

## Future Production Integration Prerequisites

Before any production runtime integration is considered:

1. Build an offline Signal report generator that consumes real review packages.
2. Bind Signal reports to Phase 12 review, calibration, experiment, shadow experiment, production proposal, approval, and deployment validation artifacts.
3. Define explicit production integration contracts.
4. Validate against completed Dalton review datasets.
5. Run offline experiments and shadow experiments.
6. Produce a production proposal.
7. Obtain explicit Dalton approval.
8. Implement any production change as code or configuration, not as self-authorizing Signal output.
9. Run full validation and deployment readiness checks.
10. Add post-deployment monitoring and rollback criteria.

No Signal wrapper should directly influence Deal Gate, BUY_NOW, valuation, notification, scanner, marketplace, or persistence behavior before this chain is complete.

## Certification Decision

Decision: **Coverage Complete for the Current Architecture, Offline and Shadow Only**.

Rationale:

- every planned Phase 14 migration has been completed
- the highest-value identity, evidence, valuation, confidence, risk, Deal Gate, comparable-quality, and decision-context families now have Signal coverage
- the shared Signal framework has already been certified as reusable
- later onboardings demonstrate practical reuse of the shared migration and comparison cores
- all Signal artifacts remain immutable, deterministic, evidence-only, and authority-neutral
- remaining exclusions are intentional architecture boundaries rather than blockers

This certification closes the Signal migration initiative for the current architecture. Additional Signal families may still be added later, but they should be driven by concrete review, governance, or explainability gaps instead of broad framework expansion.

## Recommended Next Architectural Initiative

Recommended next initiative: **Phase 15.0A - Signal-to-Governance Review Integration Architecture**.

Objective:

Design how completed Signal Alignment Reports and Shadow Comparison artifacts become evidence inputs to the Phase 12 governance pipeline and Dalton's Real Listing Decision Review workflow.

Why this should come next:

- Signal coverage is now broad enough to support end-to-end review packages.
- Production reliability is stable.
- The next bottleneck is not additional wrapping; it is turning aligned evidence into structured review and calibration material.
- The work can remain offline-only and governance-controlled.
- It preserves the rule that Signals do not grant production authority.

Recommended scope:

- map Signal reports into review packages
- define cross-artifact bindings between Signal artifacts and Phase 12 governance artifacts
- define review metrics that use Signal coverage
- identify required report summarization for Dalton review
- preserve all authority boundaries
- avoid production runtime integration

## Explicit Non-Goals

- Do not integrate Signals with production runtime.
- Do not replace native engine outputs.
- Do not change scoring, valuation, Deal Gate, BUY_NOW, scanner, marketplace, notifications, persistence, or configuration.
- Do not execute production engines from Signal modules.
- Do not allow shadow comparisons to resolve conflicts or choose winners.
- Do not grant production authority to Signal artifacts.
- Do not continue framework refactoring without a concrete blocker.
