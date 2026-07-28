# Intelligence Coverage Audit

## Executive Summary

Phase 14.0A audits CardHawk's intelligence landscape after completion of the Phase 13 Signal framework.

CardHawk now has a stable production intelligence path, a mature offline governance pipeline, and a reusable shadow-only Signal framework. The system's strongest production areas are scan orchestration, listing parsing, comp discovery, market value estimation, ROI, Deal Gate enforcement, bounded learning/validation persistence, canonical sold-evidence infrastructure, and production traceability.

The biggest remaining gap is not framework maturity. It is intelligence coverage: many existing engines still expose native outputs only and have not been onboarded into the canonical Signal framework. The next Phase 14 work should focus on migrating high-value evidence, valuation, identity, and decision-quality engines into Signal wrappers so CardHawk can compare intelligence consistently without altering production behavior.

Inventory result:

- Total intelligence-capability modules/subsystems inventoried: **78**
- Signal-migrated families: **6**
- Remaining unmigrated or not-yet-signalized modules/subsystems: **72**

Production behavior remains unchanged by this audit.

## Repository Intelligence Map

CardHawk's intelligence system is organized into these layers:

1. Production runtime engines in `engines/`
2. Production acquisition and evidence services in `services/` and `marketplaces/`
3. Shared production utilities in `utils/`
4. Offline validation and governance subsystems in `validation/`
5. Phase 13 Signal framework and migrated signal families
6. Architecture documentation and deterministic tests

The production runtime still uses native engine outputs directly. The Phase 13 Signal framework observes already-produced outputs offline and shadow-only.

## Production Intelligence Map

| Module | Purpose | Runtime status | Signal migration | Shadow comparison | Key dependencies | Main consumers | Gaps preventing production readiness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `server.js` scoring path | Orchestrates parsing, comps, valuation, ROI, quality, risk, confidence, Deal Gate, learning, notification prep | Production | Not applicable | Not applicable | Engines, services, store | Scanner, HTTP/API/UI | Large orchestrator; future work should wrap outputs externally rather than rewrite |
| `services/scoutScannerService.js` | Scheduled scan lifecycle, persistence batching, scan universe snapshot | Production | Not applicable | Not applicable | Marketplace, store, engines | Automatic scans | Stable; no Signal migration needed |
| `engines/compEngine.js` | Finds and scores comparable listings | Production | Unmigrated | None | Listings, parser identity, estimator | `scoreListing` | High-value signal target; comp quality and candidate reasons should be canonicalized |
| `engines/soldSalesEngine.js` | Sold-sales evaluation and sold evidence support | Production | Unmigrated | None | Listing universe, sold data | Comp and valuation paths | Needs canonical sold-evidence alignment before production authority expansion |
| `engines/marketValueEngine.js` | Production market value estimate | Production | Unmigrated | None | Comps, sold evidence, population | `scoreListing` | High-value signal target; must preserve no-active-as-sold boundary |
| `engines/valuationRangeEngine.js` | Supported valuation range and spread | Production/supporting | Unmigrated native engine; diagnostic wrapper exists through Range-First | Range-First diagnostic comparison exists | Market/value evidence | Range-first diagnostics, tests | Native range engine itself not directly signalized |
| `engines/roiEngine.js` | ROI, cost, and profit calculation | Production | Unmigrated | None | Price, valuation, fees | `scoreListing`, Deal Gate inputs | Decision-critical; should be onboarded after valuation/evidence signals |
| `engines/confidenceEngine.js` | Production confidence calculation | Production | Unmigrated | None | Comps, listing universe | `scoreListing` | Needs native confidence signal before calibration comparisons can be fully connected |
| `engines/riskEngine.js` | Listing and investment risk evaluation | Production | Unmigrated | None | Listing traits, quality | `scoreListing` | High-value false-positive target |
| `engines/qualityEngine.js` | Production listing quality and desirability scoring | Production | Unmigrated native engine; listing-quality diagnostic migration exists | No dedicated native quality comparison | Listing, price, confidence, ROI | `scoreListing` | Native production output still not canonicalized |
| `engines/gradingEngine.js` | Grading status and grade context | Production/supporting | Unmigrated | None | Parsed listing details | Quality, grade-premium, display | Should be grouped with condition/grading migration work |
| `engines/gradePremiumEngine.js` | Grade premium support and graded-card value context | Production/supporting | Migrated as `grade.premium.engine` | Available | Grading, sold support | Valuation/intelligence/tests | Onboarded; production authority unchanged |
| `engines/populationEngine.js` | Population scarcity context | Production/supporting | Migrated as `population.intelligence.engine` | Available | Listing identity, grading context | `scoreListing`, display | Onboarded; not sold evidence |
| `engines/canonicalIdentityEngine.js` | Canonical identity construction and eligibility | Production/supporting | Unmigrated | Identity diagnostics exist separately | Parser, listing identity | Sold evidence, validation | High-priority Signal target because identity gates evidence quality |
| `engines/legacyIdentityAdapter.js` | Bridges legacy parsed identity into canonical identity diagnostics | Production/shadow support | Unmigrated | None | Parser, canonical identity | Shadow sold and valuation comparison | High-value migration target; already optimized for clone reuse |
| `engines/comparableQualityEngine.js` | Comparable quality scoring and classification | Production/supporting | Unmigrated | None | Comp candidates and sold evidence | Evidence readiness, market value | High-value evidence-quality signal target |
| `engines/evidenceSufficiencyEngine.js` | Evidence sufficiency decisions | Production/supporting | Unmigrated; evidence readiness diagnostic exists | None | Sold, active, fallback evidence | Market value, diagnostics | Should be paired with evidence readiness migration |
| `engines/marketIntelligenceEngine.js` | Composite market intelligence | Production/supporting | Unmigrated | None | Multiple intelligence analyzers | `scoreListing`, shadow mode | Good aggregate signal, but lower priority than source signals |
| `engines/decisionEngine.js` | Decision helper/legacy decision surface | Production/legacy | Unmigrated | None | Score and listing context | Runtime/tests | Should remain secondary to Deal Gate diagnostics |
| `engines/investmentDecisionEngine.js` | Investment decision prototype/contract-backed decision intelligence | Offline/experimental | Unmigrated | None | Contract, validation fixtures | Offline tests | Keep offline until governed |
| `engines/decisionIntelligenceEngine.js` | Shadow decision intelligence evaluator | Shadow-only | Unmigrated | Shadow comparison tools exist | Evidence, comps, range, supply | Shadow Mode logger | Candidate after core evidence signals are migrated |
| `engines/capitalScoreExplanationEngine.js` | Explains capital score and investment decision dimensions | Production/supporting | Unmigrated | None | Scoring/decision context | UI/tests | Useful explainability migration target |
| `engines/notificationEngine.js` | Notification eligibility and dispatch status | Production | Unmigrated | None | Deal Gate, environment | Runtime | Production side-effect engine; migrate only diagnostic summary, never dispatch |
| `engines/learningEngine.js` | Retained learning records and prediction snapshots | Production/offline learning | Unmigrated | None | Listing outcomes, bounded retention | Scanner, validation | Should remain bounded; signal migration optional |
| `engines/predictionAccuracyEngine.js` | Tracks prediction accuracy and outcomes | Production/offline learning | Unmigrated | None | StateStore, outcomes | Scanner, reports | Governance dataset may be better than Signal wrapper |
| `engines/decisionValidationEngine.js` | Tracks decisions/outcomes for validation | Production/offline learning | Unmigrated | None | StateStore, scanner | Scanner, validation | Governance pipeline already consumes conceptually |
| `engines/historyEngine.js` | Listing history and archive active set | Production/supporting | Unmigrated | None | Listings, history store | Scanner, learning | Signal wrapper could summarize history events only |
| `engines/systemHealth.js` | System health and scan state | Production | Unmigrated | None | Runtime services | Health endpoints | Operational, not intelligence-critical |
| `engines/engineMetricsEngine.js` | Engine metrics and diagnostics | Production/supporting | Unmigrated | None | Runtime metrics | Health/debug | Operational signal candidate only |
| `engines/calibrationReportEngine.js` | Calibration report generation | Offline/supporting | Unmigrated | None | Prediction and validation state | Reports/tests | Phase 12 calibration artifacts may supersede |
| `engines/validationHarness.js` | Validation harness execution | Offline/testing | Unmigrated | None | Fixtures, engines | Tests/offline tools | Not a production Signal target |

## Supporting Intelligence Analyzers

| Module | Purpose | Runtime status | Signal migration | Consumers | Gap |
| --- | --- | --- | --- | --- | --- |
| `engines/intelligence/outlierAnalyzer.js` | Detects outlier price/evidence behavior | Production/supporting | Unmigrated | Market intelligence | Strong candidate for valuation-risk signals |
| `engines/intelligence/liquidityAnalyzer.js` | Evaluates liquidity and market depth | Production/supporting | Unmigrated | Market intelligence | Should be onboarded after evidence signals |
| `engines/intelligence/compQualityAnalyzer.js` | Assesses comp strength and weakness | Production/supporting | Unmigrated | Market intelligence | High-value evidence-quality signal |
| `engines/intelligence/pricingAnalyzer.js` | Evaluates listing price position | Production/supporting | Unmigrated | Market intelligence | Useful for suspicious-price and ROI fragility |
| `engines/intelligence/confidenceCalculator.js` | Calculates intelligence confidence | Production/supporting | Unmigrated | Market intelligence | Should align with confidence/calibration work |
| `engines/intelligence/priceConsistencyAnalyzer.js` | Checks price consistency with range/market | Production/supporting | Unmigrated | Market intelligence | High-value false-positive signal |

## Evidence and Acquisition Map

| Module | Purpose | Runtime status | Signal migration | Consumers | Gap |
| --- | --- | --- | --- | --- | --- |
| `services/soldEvidenceService.js` | Canonical sold evidence lookup/service behavior | Production | Unmigrated | Valuation, evidence tests | Highest-value evidence Signal target |
| `services/canonicalSoldComparisonService.js` | Canonical sold comparison shadow service | Shadow/supporting | Unmigrated | Shadow sold comparison | Should be onboarded after sold evidence service |
| `utils/soldEvidenceStore.js` | Durable sold-evidence store helpers | Production/supporting | Unmigrated | Sold service, import tools | Store is infrastructure; wrap query results, not store internals |
| `marketplaces/soldEvidenceAdapter.js` | Sold evidence adapter interface | Production/supporting | Unmigrated | Evidence acquisition | Adapter certification already exists; Signal wrapper optional |
| `marketplaces/mockSoldEvidenceAdapter.js` | Test adapter for sold evidence | Test/offline | Not applicable | Tests | No migration needed |
| `marketplaces/ebayAcquisitionAdapter.js` | eBay acquisition adapter | Production/acquisition | Unmigrated | Marketplace registry, certification | Compliance and evidence provenance target |
| `marketplaces/ebayResponseTranslator.js` | Translates eBay responses | Production/acquisition | Unmigrated | eBay adapter | Good provenance/normalization signal target |
| `marketplaces/ebayMarketplace.js` | Runtime eBay marketplace search/backoff | Production | Unmigrated | Scanner | Operational; avoid Signal migration unless wrapping scan result summaries |
| `marketplaces/manualAcquisitionAdapter.js` | Manual acquisition input support | Offline/manual | Unmigrated | Manual workflow | Governance/validation target |
| `marketplaces/canonicalAcquisitionInterface.js` | Canonical acquisition contract | Offline/foundation | Unmigrated | Adapter tests | Contract already documents behavior |
| `marketplaces/marketplaceRegistry.js` | Active marketplace registry | Production | Not applicable | Server/scanner | Not intelligence output |

## Offline Intelligence Map

| Module | Purpose | Maturity | Runtime status | Signal migration | Gap |
| --- | --- | --- | --- | --- | --- |
| `validation/identityParserDiagnostics.js` | Identity and parser diagnostic hardening | Mature diagnostic | Offline | Adaptable through producer adapter, not fully engine-family migrated | High-priority direct migration target |
| `validation/evidenceReadinessDiagnostics.js` | Evidence readiness and minimum support diagnostic | Mature diagnostic | Offline | Adaptable through producer adapter, not fully engine-family migrated | Highest-priority direct migration target |
| `validation/rangeFirstValuationDiagnostics.js` | Range-first valuation support diagnostic | Mature diagnostic | Offline | Migrated | Onboarded |
| `validation/confidenceCalibrationDiagnostics.js` | Offline confidence calibration diagnostic | Mature diagnostic | Offline | Migrated | Onboarded |
| `validation/listingQualityGradingDiagnostics.js` | Listing-quality and grading uncertainty diagnostic | Mature diagnostic | Offline | Migrated | Onboarded |
| `validation/opportunityFalsePositiveDiagnostics.js` | False-positive risk diagnostic combining diagnostics | Mature diagnostic | Offline | Unmigrated | High-value next decision-risk signal |
| `validation/productionIntelligenceTrace.js` | Optional trace container for production and shadow summaries | Mature contract | Offline/production-adjacent | Unmigrated | Trace report signal optional |
| `validation/realListingAccuracyValidation.js` | Real listing accuracy validation | Mature offline validation | Offline | Unmigrated | Should feed governance datasets, not direct production |
| `validation/dealerAgreementScorer.js` | Dealer/operator agreement scoring | Mature offline validation | Offline | Unmigrated | Governance metric, not immediate Signal target |
| `validation/validationCandidateSelector.js` | Selects validation candidates | Mature offline tool | Offline | Unmigrated | Operational validation support |
| `validation/investmentDecisionValidation.js` | Investment decision validation | Mature offline validation | Offline | Unmigrated | Works with Phase 12 governance |
| `validation/calibrationDatasetBuilder.js` | Builds calibration datasets | Mature governance | Offline | Not applicable | Governance subsystem |
| `validation/calibrationRecommendationBuilder.js` | Builds calibration recommendations | Mature governance | Offline | Not applicable | Governance subsystem |
| `validation/calibrationExperimentRunner.js` | Runs offline calibration experiments | Mature governance | Offline | Not applicable | Governance subsystem |
| `validation/shadowExperimentRunner.js` | Runs shadow experiment artifacts offline | Mature governance | Offline | Not applicable | Governance subsystem |
| `validation/governancePipelineValidator.js` | Validates full governance chains | Mature governance | Offline | Not applicable | Governance subsystem |
| `validation/productionProposalBuilder.js` | Builds production proposal artifacts | Mature governance | Offline | Not applicable | Governance subsystem |
| `validation/productionApprovalArtifact.js` | Captures approval evidence | Mature governance | Offline | Not applicable | Governance subsystem |
| `validation/deploymentValidationArtifact.js` | Captures deployment validation evidence | Mature governance | Offline | Not applicable | Governance subsystem |
| `validation/daltonReviewWorkspace.js` | Offline review workspace | Mature governance | Offline | Not applicable | Governance subsystem |
| `validation/realListingDecisionReviewContract.js` | Review package contract | Mature governance | Offline | Not applicable | Governance subsystem |
| `validation/realListingReviewBatchBuilder.js` | Builds review package batches | Mature governance | Offline | Not applicable | Governance subsystem |
| `validation/exportReviewWorkspaceBatch.js` | Review export utility | Mature offline tool | Offline/API export | Not applicable | Governance utility |
| `validation/runRealListingShadowValidation.js` | Shadow validation runner | Mature offline tool | Offline | Unmigrated | Could consume Signal reports later |
| `validation/compareShadowVsProduction.js` | Shadow vs production comparison | Mature offline tool | Offline | Unmigrated | Could be connected to Signal reports |
| `validation/runShadowComparisonReport.js` | Shadow comparison report CLI | Mature offline tool | Offline | Unmigrated | Reporting utility |
| `validation/exportShadowModeReport.js` | Shadow Mode export report | Mature offline tool | Offline | Unmigrated | Reporting utility |
| `validation/exportScanResults.js` | Scan result export utility | Mature offline/API tool | Offline | Not applicable | Utility |
| `validation/runDecisionValidation.js` | Decision validation runner | Mature offline tool | Offline | Not applicable | Utility |
| `validation/runDealerAgreementReport.js` | Dealer agreement report runner | Mature offline tool | Offline | Not applicable | Utility |

## Shadow Intelligence Map

| Subsystem | Purpose | Runtime status | Signal migration | Shadow comparison | Gap |
| --- | --- | --- | --- | --- | --- |
| Shadow Sold Comparison | Compares legacy sold-evidence behavior with canonical sold comparison | Shadow-only | Unmigrated | Native shadow comparison exists | High-priority signalization target after evidence readiness |
| `engines/shadowValuationEngine.js` | Shadow canonical valuation recommendation | Shadow-only | Unmigrated | Production-vs-shadow comparison exists | High-value signal after sold-evidence wrappers |
| Shadow Mode logger | Records passive decision intelligence | Shadow-only | Unmigrated | Reports exist | Keep observational; may wrap summaries later |
| Signal Alignment framework | Wraps and aligns native outputs | Offline/shadow-only | Framework complete | Core comparisons available | Stable; no more broad framework work needed |
| Signal migrated families | Six completed onboarded families | Offline/shadow-only | Complete for six families | Complete for five dedicated families plus migration parity | Continue onboarding |

## Completed Signal Migrations

| Signal family | Signal name | Migration module | Shadow comparison module | Status |
| --- | --- | --- | --- | --- |
| Grade Premium | `grade.premium.engine` | `validation/gradePremiumSignalMigration.js` | `validation/gradePremiumShadowComparison.js` | Complete |
| Population Intelligence | `population.intelligence.engine` | `validation/populationSignalMigration.js` | `validation/populationShadowComparison.js` | Complete |
| Listing Quality and Grading Diagnostics | `listing.quality.grading.diagnostics` | `validation/listingQualitySignalMigration.js` | Migration parity only | Complete |
| Range-First Valuation Diagnostics | `valuation.range_first.diagnostics` | `validation/rangeFirstValuationSignalMigration.js` | `validation/rangeFirstValuationShadowComparison.js` | Complete |
| Confidence Calibration Diagnostics | `confidence.calibration.diagnostics` | `validation/confidenceCalibrationSignalMigration.js` | `validation/confidenceCalibrationShadowComparison.js` | Complete |
| Deal Gate Diagnostics | `decision.deal_gate.diagnostics` | `validation/dealGateSignalMigration.js` | `validation/dealGateShadowComparison.js` | Complete |

## Remaining Unmigrated Engines

Highest-value unmigrated Signal targets:

1. `validation/evidenceReadinessDiagnostics.js`
2. `validation/identityParserDiagnostics.js`
3. `validation/opportunityFalsePositiveDiagnostics.js`
4. `services/soldEvidenceService.js`
5. `services/canonicalSoldComparisonService.js`
6. `engines/marketValueEngine.js`
7. `engines/compEngine.js`
8. `engines/comparableQualityEngine.js`
9. `engines/evidenceSufficiencyEngine.js`
10. `engines/confidenceEngine.js`
11. `engines/roiEngine.js`
12. `engines/riskEngine.js`
13. `engines/qualityEngine.js`
14. `engines/canonicalIdentityEngine.js`
15. `engines/legacyIdentityAdapter.js`
16. `engines/shadowValuationEngine.js`
17. `engines/decisionIntelligenceEngine.js`
18. `engines/marketIntelligenceEngine.js`
19. `engines/intelligence/compQualityAnalyzer.js`
20. `engines/intelligence/priceConsistencyAnalyzer.js`

Lower-priority or non-Signal candidates:

- scanner and persistence utilities
- governance artifact contracts
- export/import CLIs
- health and metrics engines
- marketplace registries
- memory architecture validators

These modules are important, but they are not primary intelligence signals.

## Highest-Value Intelligence Gaps

### 1. Evidence Readiness Is Not Yet A Full Signal Family

Evidence readiness was one of the earliest and most important diagnostics, but it has not been onboarded as its own full Signal migration family.

Impact:

- affects valuation trust
- affects Deal Gate interpretation
- affects false-positive detection
- affects active-only and fallback safeguards

Recommended action: migrate `validation/evidenceReadinessDiagnostics.js` next.

### 2. Identity Diagnostics Are Not Yet A Full Signal Family

Identity correctness is the root of sold evidence quality. The identity/parser diagnostic exists, but it should become a first-class Signal family.

Impact:

- incorrect card identity can poison comps
- canonical sold evidence depends on exact identity
- shadow valuation should be interpreted through identity exactness

Recommended action: migrate `validation/identityParserDiagnostics.js` after evidence readiness.

### 3. Canonical Sold Evidence Is Not Fully Signalized

Canonical sold-evidence services and comparison outputs are production-critical but not yet represented as canonical Signals.

Impact:

- evidence source quality is not uniformly reported through the Signal framework
- canonical sold support cannot yet be compared across reports as a signal family
- no full Signal chain exists for source provenance, exclusions, and exact/contextual matches

Recommended action: signalize sold evidence service outputs and canonical sold comparison summaries after evidence readiness and identity.

### 4. Production Valuation Engine Output Is Native-Only

Range-first diagnostics are migrated, but the production `marketValueEngine` output is still native-only.

Impact:

- production valuation and diagnostic range interpretation cannot yet be compared as peer signals
- valuation confidence semantics remain split across engines

Recommended action: migrate `marketValueEngine` after sold-evidence and identity signalization.

### 5. False-Positive Reduction Diagnostic Is Not Yet Signalized

The false-positive diagnostic combines several Phase 10 diagnostics and is directly aligned with CardHawk's BUY_NOW safety goals.

Impact:

- weak or unsafe candidates are not yet represented as canonical advisory signals
- signal reports cannot fully summarize contradiction against positive Deal Gate outcomes

Recommended action: migrate `validation/opportunityFalsePositiveDiagnostics.js` after evidence and identity signals.

## Recommended Onboarding Priority

1. Evidence Readiness Diagnostics
2. Identity Parser Diagnostics
3. Opportunity False-Positive Diagnostics
4. Canonical Sold Comparison Service
5. Sold Evidence Service query result summaries
6. Market Value Engine
7. Comparable Quality Engine
8. Comp Engine candidate summary
9. Confidence Engine
10. ROI Engine
11. Risk Engine
12. Quality Engine native output
13. Shadow Valuation Engine
14. Decision Intelligence Engine
15. Market Intelligence Engine aggregate

The order intentionally prioritizes accuracy and evidence trust over UI polish or aggregate scoring.

## Recommended Phase 14 Roadmap

### Phase 14.0B - Evidence Readiness Signal Migration

Objective: onboard `validation/evidenceReadinessDiagnostics.js` as a full Signal family with migration and shadow comparison.

Why first:

- highest leverage for valuation and Deal Gate quality
- already diagnostic-only
- already enforces active/fallback boundaries
- clean fit for the shared Signal framework

### Phase 14.0C - Identity Parser Diagnostics Signal Migration

Objective: onboard `validation/identityParserDiagnostics.js` as a full Signal family.

Why second:

- identity quality is foundational to comps, sold evidence, valuation, and false-positive reduction
- supports future canonical sold evidence governance

### Phase 14.1 - False-Positive Diagnostic Signal Migration

Objective: onboard `validation/opportunityFalsePositiveDiagnostics.js`.

Why next:

- directly evaluates weak BUY_NOW candidates
- combines existing diagnostic outputs
- remains advisory and shadow-only

### Phase 14.2 - Canonical Sold Evidence Signalization

Objective: wrap canonical sold comparison and sold evidence service result summaries.

Why:

- source provenance, exact/contextual matching, exclusions, stale evidence, and ineligible evidence should become comparable Signals

### Phase 14.3 - Production Valuation Signalization

Objective: wrap `marketValueEngine` output and align it against Range-First diagnostic signals.

Why:

- closes the gap between production point estimate and diagnostic uncertainty interpretation

### Phase 14.4 - Comp and Comparable Quality Signalization

Objective: wrap `compEngine`, `comparableQualityEngine`, and supporting comp-quality analyzers.

Why:

- exposes the quality of evidence feeding valuation and Deal Gate

### Phase 14.5 - Decision Context Signalization

Objective: wrap ROI, risk, confidence, and market-intelligence aggregates.

Why:

- enables end-to-end advisory reports for production decisions without changing production authority

### Phase 14.6 - Signal Coverage Certification

Objective: certify signal coverage across identity, evidence, valuation, risk, confidence, Deal Gate, and shadow diagnostics.

Why:

- validates whether Phase 14 has enough signal coverage to feed Phase 12 governance at scale

## Production Readiness Observations

Current production reliability blockers are not evident from this audit. Phase 11 memory and serialization work stabilized production, and Phase 13 framework work did not touch runtime behavior.

The remaining production-readiness gaps are intelligence-confidence gaps:

- canonical evidence coverage
- identity exactness
- valuation support quality
- false-positive interpretation
- consistent confidence semantics
- reviewed outcome feedback loops

These should be addressed through offline/shadow Signal onboarding first, then Phase 12 governance, before any production authority changes.

## Explicit Non-Goals

This audit does not:

- modify runtime code
- execute engines
- change scanner behavior
- change valuation
- change Deal Gate
- change BUY_NOW
- change notifications
- change persistence
- grant production authority
- approve shadow systems
- replace existing native engine outputs

## Final Recommendation

Begin Phase 14.0B with **Evidence Readiness Signal Migration**.

It is the cleanest, highest-value next step because it improves CardHawk's ability to interpret valuation and Deal Gate support while preserving all production safety boundaries.
