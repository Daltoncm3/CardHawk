# Phase 18.0A - Production Architecture Verification Audit

This report is the read-only Phase 18.0A verification audit for CardHawk. It compares the current repository implementation against the approved Project State v9.0 architectural intent supplied in the Codex conversation.

No production code, tests, runtime behavior, architecture documents, persistence formats, recommendations, Deal Gate behavior, BUY_NOW behavior, notifications, scanner behavior, marketplace behavior, shadow behavior, or Governance implementations were modified by this audit.

## 1. Executive Summary

The repository implementation is generally consistent with the major architectural boundaries described in the Phase 18.0A brief: production recommendation authority remains in `server.js` Deal Gate, BUY_NOW remains a human-reviewed scouting label rather than an automated purchase action, shadow and canonical systems are largely observation-only, and Phase 12-17 Governance, Signal, and Decision Intelligence systems are implemented primarily as offline validation artifacts.

The audit verified that production runtime wiring is concentrated in:

- `server.js`
- `services/scoutScannerService.js`
- `marketplaces/marketplaceRegistry.js`
- `marketplaces/ebayMarketplace.js`
- `utils/appStore.js`
- `utils/stateStore.js`
- `utils/persistenceCoordinator.js`
- core engines imported by `server.js`

The repository also contains a large offline validation architecture under `validation/`, with implemented contracts and test coverage for Signal Framework, Governance Framework, Production Proposal governance, Deployment Validation, Decision Intelligence, and Decision Intelligence to Governance Binding.

The most important verified findings are:

- `server.js:2640-2568` applies Deal Gate and emits `BUY_NOW` or `REJECT`; downstream prediction, learning, alerts, and notification paths consume this result.
- `server.js:2716-2757` only creates and sends alerts after `gate.passed`; notifications do not independently invent purchase authority.
- `server.js:165-188` runs Shadow Mode Decision Intelligence only when enabled and catches all failures so shadow output cannot fail production runtime.
- `services/scoutScannerService.js:71-151` coordinates scout scan batching and calls `saveScoutedListing`; it does not call Governance Binding or Signal Alignment.
- `validation/decisionIntelligenceGovernanceBindingAdapter.js` and `validation/decisionIntelligenceGovernanceIntegrationValidation.js` are implemented and tested, but no verified production import path reaches them.
- `validation/canonicalIntelligenceSignalContract.js`, `validation/intelligenceSignalRegistry.js`, `validation/signalAlignment*.js`, and signal migration modules implement canonical/offline signal artifacts, but production runtime display still uses `utils/signalAnnotation.js`, `utils/signalSemantics.js`, and `utils/signalContractRegistry.js` rather than the Phase 13 canonical signal validation stack.
- `engines/investmentDecisionEngine.js` and `engines/capitalScoreExplanationEngine.js` are present, tested, and exported, but no verified production path imports them from `server.js`.
- Approved Project State v9.0 is now treated as the authoritative architectural intent. Direct comparison confirms the repository preserves v9.0's major authority boundaries: production authority remains in Deal Gate, offline/shadow artifacts remain non-authoritative, Decision Intelligence to Governance Binding is present but not production-promoted, and Investment Decision and Capital Score remain prototype/offline.

Final determination: **B. Repository implementation is generally consistent with approved Project State v9.0, with documented gaps requiring future phases.**

## 2. Audit Scope and Method

### Scope

The audit inspected repository systems intersecting:

- Governance Binding
- Decision Intelligence
- Canonical Signals
- Signal Annotation
- Signal Semantics
- Warning Propagation
- Readiness Propagation
- Authority Boundaries
- Investment Decision
- Capital Score
- Strategy Lanes
- Review Workspace
- Validation systems
- Certification Registry
- Production integration points
- Shadow integration points
- Offline-only integration points
- Related services, utilities, persistence, routes, reports, and tests

### Method

Verified facts were gathered from static repository inspection using:

- path discovery with `find`
- source search with `rg`
- line-number inspection with `nl -ba` and `sed`
- static extraction of `module.exports` blocks from relevant modules
- targeted test execution for architecture-adjacent tests
- `git diff --check`

No runtime server was started. No production engines were executed for mutation. No files were changed except this standalone audit report.

### Source Material

Approved Project State v9.0 was supplied in this Codex conversation and is treated as authoritative architectural intent for this correction pass. The repository remains the source of current implementation. Where the repository and v9.0 differ, the audit documents the difference without treating repository behavior as an amendment to v9.0.

The v9.0 manual was not modified and was not added to the repository by this correction pass.

## 3. Source Precedence and Comparison Rule

The Phase 18.0A comparison rule is preserved:

- Repository source is treated as current implementation.
- Approved v9.0 is treated as architectural intent.
- Differences are documented.
- Conversation-supplied v9.0 intent is used for architecture comparison; repository source remains the implementation evidence.
- File existence is not treated as runtime integration.
- Runtime integration is not treated as production authority.
- Passing tests are not treated as proof of production wiring unless runtime imports and call paths are independently verified.

Approved Project State v9.0 is available as conversation-supplied architectural intent for this correction pass. `Insufficient Source Material` is now used only when neither the repository nor the supplied v9.0 intent supports a conclusion.

## 4. Verified Files

Implementation status values use the required vocabulary. Authority is classified separately.

| Path | Architectural responsibility | Current status | Imported | Invoked | Production-reachable | Shadow-only | Offline-only | Test-only | Unused/orphaned | v9.0 role match |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `server.js` | Express app, production routes, scoring orchestration, Deal Gate, display, persistence, notifications | Fully Implemented | entry point; imports engines/services/utils | Yes | Yes | No | No | No | No | Matches v9.0 boundary |
| `services/scoutScannerService.js` | Scout scan lifecycle, marketplace scan loop, persistence batching | Fully Implemented | `server.js:43` | Yes, `server.js:2801` | Yes | No | No | No | No | Matches v9.0 boundary |
| `marketplaces/marketplaceRegistry.js` | Active marketplace registry | Fully Implemented | `server.js:28` | Yes | Yes | No | No | No | No | Matches v9.0 boundary |
| `marketplaces/ebayMarketplace.js` | Live eBay marketplace provider | Fully Implemented | `marketplaceRegistry.js` | Yes via active marketplace | Yes | No | No | No | No | Matches v9.0 boundary |
| `marketplaces/mockMarketplace.js` | Test/mock marketplace provider | Fully Implemented | `marketplaceRegistry.js` | Available | No verified production active path | No | No | Yes | No | Matches v9.0 boundary |
| `marketplaces/canonicalAcquisitionInterface.js` | Canonical acquisition normalization | Fully Implemented | acquisition validators/translators | Verified offline/test | No verified production path from `server.js` | No | Yes | No | No | Matches v9.0 boundary |
| `marketplaces/ebayAcquisitionAdapter.js` | eBay acquisition adapter | Fully Implemented | tests/validation | Verified offline/test | No verified production path from `server.js` | No | Yes | No | No | Matches v9.0 boundary |
| `marketplaces/ebayResponseTranslator.js` | eBay response normalization | Fully Implemented | tests/validation | Verified offline/test | No verified production path from `server.js` | No | Yes | No | No | Matches v9.0 boundary |
| `marketplaces/manualAcquisitionAdapter.js` | Manual acquisition adapter | Fully Implemented | tests/validation | Verified offline/test | No | No | Yes | No | No | Matches v9.0 boundary |
| `services/soldEvidenceService.js` | Query canonical sold evidence stores | Fully Implemented | `server.js:44` | Yes, evidence queries | Yes | No | No | No | No | Matches v9.0 boundary |
| `services/canonicalSoldComparisonService.js` | Legacy/canonical sold comparison | Fully Implemented | `server.js:19` | Yes in shadow comparison helpers | Shadow reachable | Yes | No | No | No | Matches v9.0 boundary |
| `engines/decisionEngine.js` | Production decision scoring input | Fully Implemented | `server.js:10` | Yes, `server.js:1369` | Yes | No | No | No | No | Matches v9.0 boundary |
| `engines/marketIntelligenceEngine.js` | Market intelligence, evidence diagnostics, Decision Intelligence embedding | Fully Implemented | `server.js:15` | Yes, `server.js:1341` | Yes | No | No | No | No | Matches v9.0 boundary |
| `engines/decisionIntelligenceEngine.js` | Evidence-readiness/advisory Decision Intelligence | Fully Implemented | `marketIntelligenceEngine.js:5`; lazy shadow import `server.js:159` | Yes | Production Evidence Only via `marketIntelligenceEngine`; Shadow logging optional | Partial | No | No | No | Matches v9.0 boundary |
| `engines/investmentDecisionEngine.js` | Investment Decision prototype | Fully Implemented | validation/tests; not `server.js` | Offline/test verified | No | No | Yes/Prototype | No | No | Matches v9.0 boundary |
| `engines/capitalScoreExplanationEngine.js` | Capital Score explanation/readiness | Fully Implemented | tests; not `server.js` | Offline/test verified | No | No | Yes/Prototype | No | No | Matches v9.0 boundary |
| `engines/notificationEngine.js` | Notification qualification and delivery | Fully Implemented | `server.js:17` | Yes, `server.js:2757`, `3517`, `3556` | Yes | No | No | No | No | Matches v9.0 boundary |
| `engines/legacyIdentityAdapter.js` | Legacy parsed identity to canonical diagnostics | Fully Implemented | `server.js:25` | Yes, score/shadow helpers | Production Evidence Only and Shadow support | Partial | No | No | No | Matches v9.0 boundary |
| `engines/canonicalIdentityEngine.js` | Canonical identity construction | Fully Implemented | canonical sold comparison service, tests | Verified service path | Shadow/canonical evidence reachable | Yes for comparison | No | No | No | Matches v9.0 boundary |
| `engines/shadowValuationEngine.js` | Shadow valuation | Fully Implemented | `server.js:20` | Yes, `server.js:725` via helper | No production authority | Yes | No | No | No | Matches v9.0 boundary |
| `utils/appStore.js` | Production app store load/save/lookup | Fully Implemented | `server.js:33` | Yes | Yes | No | No | No | No | Matches v9.0 boundary |
| `utils/stateStore.js` | Atomic JSON load/save | Fully Implemented | app/persistence modules | Yes | Yes | No | No | No | No | Matches v9.0 boundary |
| `utils/persistenceCoordinator.js` | Scan-scoped persistence batching | Fully Implemented | `server.js:34` | Yes, server/scanner | Yes | No | No | No | No | Matches v9.0 boundary |
| `utils/shadowModeLogger.js` | Shadow Mode persistence and scan batching | Fully Implemented | `server.js:38`, scanner dependency | Yes | Shadow persistence only | Yes | No | No | No | Matches v9.0 boundary |
| `utils/signalAnnotation.js` | Production display annotation of raw signals | Fully Implemented | `server.js:39` | Yes, `server.js:1494` | Production Explanation Only | No | No | No | No | Matches v9.0 boundary |
| `utils/signalSemantics.js` | Production display label/authority semantics | Fully Implemented | `server.js:40` | Yes, display helpers | Production Explanation Only | No | No | No | No | Matches v9.0 boundary |
| `utils/signalContractRegistry.js` | Runtime signal display contract registry | Fully Implemented | `signalSemantics.js` | Yes | Production Explanation Only | No | No | No | No | Matches v9.0 boundary |
| `utils/soldEvidenceStore.js` | Canonical sold evidence JSON store | Fully Implemented | `server.js:41`, service/import | Yes | Production Evidence Only | No | No | No | No | Matches v9.0 boundary |
| `utils/operatorAuditLog.js` | Operator audit persistence | Fully Implemented | `server.js:37` | Yes, route actions | Yes | No | No | No | No | Matches v9.0 boundary |
| `validation/canonicalIntelligenceSignalContract.js` | Canonical Signal immutable contract | Fully Implemented | Signal registry/migration modules | Offline/test | No verified production path | No | Yes | No | No | Matches v9.0 boundary |
| `validation/intelligenceSignalRegistry.js` | Offline canonical signal definition registry | Fully Implemented | Signal alignment/migration modules | Offline/test | No | No | Yes | No | No | Matches v9.0 boundary |
| `validation/signalMigrationCore.js` | Shared signal migration lifecycle | Fully Implemented | migration modules | Offline/test | No | Yes/offline shadow | Yes | No | No | Matches v9.0 boundary |
| `validation/signalShadowComparisonCore.js` | Shared shadow comparison lifecycle | Fully Implemented | shadow comparison modules | Offline/test | No | Yes/offline shadow | Yes | No | No | Matches v9.0 boundary |
| `validation/*SignalMigration.js` | Per-family Signal Framework onboarding | Fully Implemented | tests/validation | Offline/test | No | Yes/offline shadow | Yes | No | No | Matches v9.0 boundary |
| `validation/*ShadowComparison.js` | Per-family native-to-shadow comparison | Fully Implemented | tests/validation | Offline/test | No | Yes/offline shadow | Yes | No | No | Matches v9.0 boundary |
| `validation/decisionIntelligenceEvidenceBundle.js` | Offline DI evidence bundle | Fully Implemented | DI pipeline modules/tests | Offline/test | No | No | Yes | No | No | Matches v9.0 boundary |
| `validation/decisionIntelligenceArtifactBuilder.js` | Offline DI artifact builder | Fully Implemented | DI pipeline/conformance/tests | Offline/test | No | No | Yes | No | No | Matches v9.0 boundary |
| `validation/decisionIntelligenceArtifactConformance.js` | Offline DI artifact conformance | Fully Implemented | DI pipeline/baseline/tests | Offline/test | No | No | Yes | No | No | Matches v9.0 boundary |
| `validation/decisionIntelligencePipelineOrchestrator.js` | Offline DI pipeline orchestration | Fully Implemented | DI baseline/binding/integration | Offline/test | No | No | Yes | No | No | Matches v9.0 boundary |
| `validation/decisionIntelligencePipelineStabilityBaseline.js` | Offline DI baseline/certification | Fully Implemented | DI binding/integration | Offline/test | No | No | Yes | No | No | Matches v9.0 boundary |
| `validation/decisionIntelligenceGovernanceBindingAdapter.js` | DI to Governance binding artifact | Fully Implemented | DI integration validation/tests | Offline/test | No | No | Yes | No | No | Matches v9.0 boundary |
| `validation/decisionIntelligenceGovernanceIntegrationValidation.js` | End-to-end DI Governance validation | Fully Implemented | tests only | Offline/test | No | No | Yes | No | No | Matches v9.0 boundary |
| `validation/governanceArtifactRegistry.js` | Offline Governance artifact registry | Fully Implemented | Governance modules/DI integration | Offline/test | No | No | Yes | No | No | Matches v9.0 boundary |
| `validation/governanceArtifactLifecycleManager.js` | Offline Governance artifact lifecycle | Fully Implemented | Governance modules/DI integration | Offline/test | No | No | Yes | No | No | Matches v9.0 boundary |
| `validation/governanceReviewSessionManager.js` | Offline Governance review sessions | Fully Implemented | Governance workspace/e2e modules | Offline/test | No | No | Yes | No | No | Matches v9.0 boundary |
| `validation/governanceReviewWorkspaceOrchestrator.js` | Offline Governance workspace orchestration | Fully Implemented | Governance e2e/stability modules | Offline/test | No | No | Yes | No | No | Matches v9.0 boundary |
| `validation/governancePipelineEndToEndValidation.js` | Offline Governance pipeline validation | Fully Implemented | Governance baseline/tests | Offline/test | No | No | Yes | No | No | Matches v9.0 boundary |
| `validation/governancePipelineStabilityBaseline.js` | Offline Governance pipeline certification | Fully Implemented | tests | Offline/test | No | No | Yes | No | No | Matches v9.0 boundary |
| `validation/investmentDecisionContract.js` | Investment Decision contract | Fully Implemented | investment engine/validation/tests | Offline/test | No | No | Prototype/Offline | No | No | Matches v9.0 boundary |
| `validation/investmentDecisionValidation.js` | Investment Decision validation batch/report | Fully Implemented | tests/CLI | Offline/test | No | No | Yes | No | No | Matches v9.0 boundary |
| `validation/strategyLaneContract.js` | Strategy lane contract | Fully Implemented | investment engine/tests | Offline/test | No | No | Prototype/Offline | No | No | Matches v9.0 boundary |
| `validation/certificationArtifactRegistry.js` | Certification artifact registry | Fully Implemented | provider evaluation/manual workflow/tests | Offline/test; persists registry | No verified production runtime path | No | Yes | No | No | Matches v9.0 boundary |
| `validation/reviewWorkspaceContract.js` | Review workspace contract | Fully Implemented | tests/validation | Offline/test | No | No | Yes | No | No | Matches v9.0 boundary |
| `validation/exportReviewWorkspaceBatch.js` | Runtime review workspace batch exporter | Fully Implemented | `server.js:42` | Yes, `server.js:915` | Production route/export reachable | No | No | No | No | Matches v9.0 boundary |

Additional relevant docs and tests verified by path discovery include `docs/architecture/*signal*`, `docs/architecture/*governance*`, `docs/architecture/decision-intelligence-*`, `docs/architecture/production-*`, `tests/*signal*`, `tests/*governance*`, `tests/decision-intelligence-*`, `tests/investment-decision-*`, `tests/review-workspace-*`, and `tests/smoke.test.js`.

## 5. Runtime Dependency Map

### Production Path

Text diagram with edge classifications:

```text
services/scoutScannerService.js:createScoutScanner.runScoutScan
  -> activeMarketplace.searchWithBackoff
     [Verified Runtime Edge: services/scoutScannerService.js:141-149]
  -> server.js:saveScoutedListing
     [Verified Runtime Edge: services/scoutScannerService.js:147-151]
  -> server.js:scoreListing
     [Verified Runtime Edge: server.js:2599-2603]
  -> market/evidence/valuation/risk/quality engines imported in server.js
     [Verified Runtime Edge: server.js:3-24, 1338-1439]
  -> engines/marketIntelligenceEngine.evaluateMarketIntelligence
     [Verified Runtime Edge: server.js:1340-1348]
  -> engines/decisionIntelligenceEngine.evaluateDecisionIntelligence
     [Verified Runtime Edge as production evidence inside market intelligence: engines/marketIntelligenceEngine.js:757-763]
  -> engines/decisionEngine.makeDecision
     [Verified Runtime Edge: server.js:1369-1380]
  -> gradingEngine.gradeDeal
     [Verified Runtime Edge: server.js:1382-1399]
  -> server.js:dealGate
     [Verified Runtime Edge: server.js:2640]
  -> predictionAccuracyEngine / decisionValidationEngine / learningEngine
     [Verified Runtime Edge: server.js:2642-2711]
  -> appStore/stateStore persistence
     [Verified Runtime Edge: server.js:2713, services/scoutScannerService.js:337-341]
  -> notificationEngine.sendDealAlert when gate.passed
     [Verified Runtime Edge: server.js:2716-2757]
```

### Shadow and Canonical Path

```text
server.js:scoreListing
  -> legacyIdentityAdapter.buildLegacyIdentityDiagnostics
     [Verified Runtime Edge: server.js imports at line 25 and exports diagnostic helper at 3963; call path inside scoreListing verified by identity diagnostics around shadow helpers]
  -> services/canonicalSoldComparisonService
     [Verified Runtime Edge: server.js:19, 535-631]
  -> server.js:buildShadowSoldComparison
     [Verified Runtime Edge: server.js:1349-1354]
  -> server.js:buildShadowValuation
     [Verified Runtime Edge: server.js:1355-1364]
  -> engines/shadowValuationEngine.evaluateShadowValuation
     [Verified Runtime Edge: server.js:725-748]
  -> server.js:runShadowModeDecisionIntelligence
     [Verified Runtime Edge: server.js:1365-1367]
  -> utils/shadowModeLogger.logShadowModeDecision
     [Verified Runtime Edge when CARDHAWK_SHADOW_MODE_ENABLED=true: server.js:165-188]
```

Shadow failures are isolated by `try/catch` in `server.js:177-188` and `services/scoutScannerService.js:125-130`, `327-334`.

### Governance-Related Path

```text
Native/offline inputs
  -> validation/canonicalIntelligenceSignalContract.js
     [Verified Offline Edge]
  -> validation/intelligenceSignalRegistry.js
     [Verified Offline Edge]
  -> validation/signalMigrationCore.js and per-family signal migrations
     [Verified Offline Edge]
  -> validation/signalShadowComparisonCore.js and per-family comparisons
     [Verified Offline Edge]
  -> validation/decisionIntelligenceEvidenceBundle.js
     [Verified Offline Edge]
  -> validation/decisionIntelligenceArtifactBuilder.js
     [Verified Offline Edge]
  -> validation/decisionIntelligenceArtifactConformance.js
     [Verified Offline Edge]
  -> validation/decisionIntelligencePipelineOrchestrator.js
     [Verified Offline Edge]
  -> validation/decisionIntelligencePipelineStabilityBaseline.js
     [Verified Offline Edge]
  -> validation/decisionIntelligenceGovernanceBindingAdapter.js
     [Verified Offline Edge]
  -> validation/decisionIntelligenceGovernanceIntegrationValidation.js
     [Verified Offline Edge]
  -> validation/governanceArtifactRegistry.js and validation/governanceArtifactLifecycleManager.js
     [Verified Offline Edge]
```

No verified production import path reaches `validation/decisionIntelligenceGovernanceBindingAdapter.js` or `validation/decisionIntelligenceGovernanceIntegrationValidation.js`.

### Edge Table

| Edge | Classification | Evidence |
| --- | --- | --- |
| Scanner to marketplace search | Verified Runtime Edge | `services/scoutScannerService.js:141-149` |
| Scanner to `saveScoutedListing` | Verified Runtime Edge | `services/scoutScannerService.js:147-151` |
| `saveScoutedListing` to `scoreListing` | Verified Runtime Edge | `server.js:2599-2603` |
| `scoreListing` to Market Intelligence | Verified Runtime Edge | `server.js:1340-1348` |
| Market Intelligence to Decision Intelligence | Verified Runtime Edge, Production Evidence Only | `engines/marketIntelligenceEngine.js:757-763` |
| `scoreListing` to Decision Engine | Verified Runtime Edge | `server.js:1369-1380` |
| `saveScoutedListing` to Deal Gate | Verified Runtime Edge | `server.js:2640` |
| Deal Gate to alert creation | Verified Runtime Edge | `server.js:2716-2757` |
| Alert to notification delivery | Verified Runtime Edge | `server.js:2757`, `notificationEngine.sendDealAlert` |
| Runtime display to Signal Annotation | Verified Runtime Edge, Production Explanation Only | `server.js:1493-1494`, `2070` |
| Runtime display to canonical signal validation stack | Not Present | No `server.js` import of `validation/canonicalIntelligenceSignalContract.js` |
| Signal migrations to production runtime | Not Present | No `server.js` or scanner import of `validation/*SignalMigration.js` |
| Governance Binding to production runtime | Not Present | No `server.js` import of `validation/decisionIntelligenceGovernanceBindingAdapter.js` |
| Investment Decision to production runtime | Not Present | No `server.js` import of `engines/investmentDecisionEngine.js` |
| Certification Registry to live safety gate | Verified Offline Edge, not production runtime | `validation/certificationArtifactRegistry.js`; no `server.js` import |

Corrected v9.0 dependency interpretation:

- Production scan, score, Deal Gate, alert, and notification edges match v9.0's production-authoritative runtime boundary.
- Shadow Decision Intelligence, shadow valuation, canonical sold comparison, and shadow logging remain observation-only, matching v9.0's shadow boundary.
- Governance Binding, Signal Alignment, Investment Decision, Capital Score, and certification registries remain offline/prototype or validation-only unless explicitly promoted through future governance. Their absence from `server.js` is not itself a defect.
- Runtime display annotations are production explanation-only; they do not grant canonical Signal authority.

## 6. Public API Inventory

| Module | Public exports |
| --- | --- |
| `server.js` | `app`, `dealGate`, `scoreListing`, `createLegacyScoreBreakdown`, `buildDisplayInterpretation`, `buildSignalAnnotationsForDisplay`, `buildCanonicalIdentityDiagnostics`, `buildShadowSoldComparison`, `buildShadowValuation`, `isShadowModeEnabled`, `runShadowModeDecisionIntelligence`, `__setShadowModeDecisionIntelligenceEvaluatorForTest`, `__setShadowModeDecisionLoggerForTest`, `__setCanonicalSoldEvidenceStoreForTest`, `__setStoreForTest`, `__getStoreForTest`, `buildRuntimeReviewWorkspaceExport`, `normalizeReviewWorkspaceExportQuery`, `getCanonicalSoldEvidenceForListing` |
| `services/scoutScannerService.js` | `createScoutScanner` |
| `utils/signalAnnotation.js` | `annotateSignal`, `annotateSignals`, `getProductionDecisionAnnotations` |
| `utils/signalSemantics.js` | `hasBuyLikeWording`, `getAllowedSignalLabel`, `describeSignalAuthority` |
| `utils/signalContractRegistry.js` | `SCHEMA_VERSION`, `SIGNAL_TYPES`, `DECISION_ELIGIBILITY`, `DISPLAY_LANGUAGE`, `listSignalContracts`, `getSignalContract`, `hasSignalContract`, `getDecisionEligibleSignals`, `getProductionDecisionSignals` |
| `validation/canonicalIntelligenceSignalContract.js` | `AUTHORITY_LEVELS`, `CANONICAL_INTELLIGENCE_SIGNAL_SCHEMA_VERSION`, `CANONICAL_INTELLIGENCE_SIGNAL_SOURCE`, `CONFIDENCE_KINDS`, `CONFIDENCE_LEVELS`, `DECISION_ROLES`, `EVIDENCE_QUALITY_LEVELS`, `PRODUCER_CATEGORIES`, `REQUIRED_CANONICAL_SIGNAL_FIELDS`, `SIGNAL_STATUSES`, `SIGNAL_TYPES`, `UNCERTAINTY_LEVELS`, `UNKNOWN_VALUE`, `attachEvidenceReference`, `attachProducerMetadata`, `buildCanonicalSignalBatchFingerprint`, `buildCanonicalSignalFingerprint`, `cloneCanonicalSignal`, `createCanonicalSignal`, `determineSignalAuthority`, `determineSignalConfidence`, `determineSignalStatus`, `validateCanonicalSignal` |
| `validation/intelligenceSignalRegistry.js` | `DEPRECATION_STATUSES`, `EVIDENCE_ROLES`, `INTELLIGENCE_SIGNAL_REGISTRY_SCHEMA_VERSION`, `INTELLIGENCE_SIGNAL_REGISTRY_SOURCE`, `REQUIRED_SIGNAL_DEFINITION_FIELDS`, `REQUIRED_SIGNAL_REGISTRY_FIELDS`, `buildSignalDefinitionFingerprint`, `buildSignalRegistryFingerprint`, `createSignalDefinition`, `createSignalRegistry`, `exportSignalRegistry`, `filterSignalDefinitions`, `getSignalDefinition`, `importSignalRegistry`, `listSignalDefinitions`, `registerSignalDefinition`, `sortSignalDefinitions`, `summarizeSignalRegistry`, `unregisterSignalDefinition`, `validateCanonicalSignal`, `validateSignalDefinition`, `validateSignalRegistry` |
| `validation/signalAlignmentContract.js` | `ALIGNMENT_STATUSES`, `REQUIRED_SIGNAL_ALIGNMENT_FIELDS`, `SIGNAL_ALIGNMENT_SCHEMA_VERSION`, `SIGNAL_ALIGNMENT_SOURCE`, `attachCanonicalSignal`, `attachRegistryReference`, `buildSignalAlignmentBatchFingerprint`, `buildSignalAlignmentFingerprint`, `cloneSignalAlignment`, `createSignalAlignment`, `determineAlignmentStatus`, `determineAuthorityAlignment`, `validateSignalAlignment` |
| `validation/signalAlignmentBatch.js` | `SIGNAL_ALIGNMENT_BATCH_SCHEMA_VERSION`, `SIGNAL_ALIGNMENT_BATCH_SOURCE`, `addAlignmentToBatch`, `buildAlignmentBatchFingerprint`, `createAlignmentBatch`, `filterAlignmentBatch`, `removeAlignmentFromBatch`, `sortAlignmentBatch`, `summarizeAlignmentBatch`, `validateAlignmentBatch` |
| `validation/signalAlignmentEngine.js` | `REQUIRED_SIGNAL_ALIGNMENT_RUN_FIELDS`, `SIGNAL_ALIGNMENT_ENGINE_SCHEMA_VERSION`, `SIGNAL_ALIGNMENT_ENGINE_SOURCE`, `buildSignalAlignmentRunFingerprint`, `runSignalAlignment`, `runSignalAlignmentBatch`, `summarizeSignalAlignmentRun`, `validateSignalAlignmentRun` |
| `validation/signalAlignmentReport.js` | `REQUIRED_SIGNAL_ALIGNMENT_REPORT_FIELDS`, `REVIEW_STATUSES`, `SIGNAL_ALIGNMENT_REPORT_SCHEMA_VERSION`, `SIGNAL_ALIGNMENT_REPORT_SOURCE`, `buildSignalAlignmentReportFingerprint`, `createSignalAlignmentReport`, `exportSignalAlignmentReport`, `filterSignalAlignmentReport`, `importSignalAlignmentReport`, `sortSignalAlignmentReport`, `summarizeSignalAlignmentReport`, `validateSignalAlignmentReport` |
| `validation/signalConflictAnalyzer.js` | `RELATIONSHIP_TYPES`, `REQUIRED_CONFLICT_ANALYSIS_FIELDS`, `SIGNAL_CONFLICT_ANALYSIS_SCHEMA_VERSION`, `SIGNAL_CONFLICT_ANALYZER_SOURCE`, `analyzeSignalConflicts`, `buildConflictAnalysisFingerprint`, `classifySignalRelationship`, `summarizeSignalConflicts`, `validateConflictAnalysis` |
| `validation/signalMigrationCore.js` | `SIGNAL_MIGRATION_CORE_RUNTIME_SOURCE`, `buildSignalMigrationLifecycleFingerprint`, `executeSignalMigrationLifecycle`, `summarizeSignalMigrationLifecycle`, `validateSignalMigrationLifecycle`, `verifyExactNativeOutputParity` |
| `validation/signalShadowComparisonCore.js` | `SIGNAL_SHADOW_COMPARISON_CORE_SOURCE`, `buildSignalShadowComparisonContractArtifact`, `buildSignalShadowComparisonLifecycleFingerprint`, `executeSignalShadowComparisonLifecycle`, `summarizeSignalShadowComparisonLifecycle`, `validateSignalShadowComparisonLifecycle` |
| `validation/decisionIntelligenceEvidenceBundle.js` | `DECISION_INTELLIGENCE_EVIDENCE_BUNDLE_SCHEMA_VERSION`, `DECISION_INTELLIGENCE_EVIDENCE_BUNDLE_SOURCE`, `REQUIRED_BUNDLE_FIELDS`, `buildDecisionIntelligenceEvidenceBundle`, `validateDecisionIntelligenceEvidenceBundle`, `summarizeDecisionIntelligenceEvidenceBundle`, `buildDecisionIntelligenceEvidenceBundleFingerprint`, `compareDecisionIntelligenceEvidenceBundles` |
| `validation/decisionIntelligenceArtifactBuilder.js` | `DECISION_INTELLIGENCE_ARTIFACT_SCHEMA_VERSION`, `EXPECTED_SIGNAL_NAMES`, `buildDecisionIntelligenceArtifact`, `validateDecisionIntelligenceArtifact`, `deriveDecisionEvidence`, `deriveDecisionConfidence`, `deriveDecisionExplanation`, `summarizeDecisionArtifact`, `buildDecisionIntelligenceArtifactFingerprint` |
| `validation/decisionIntelligenceArtifactConformance.js` | `DECISION_INTELLIGENCE_CONFORMANCE_SCHEMA_VERSION`, `DECISION_INTELLIGENCE_CONFORMANCE_SOURCE`, `CONFORMANCE_STAGES`, `validateDecisionIntelligenceArtifactConformance`, `buildDecisionIntelligenceConformanceReport`, `summarizeDecisionIntelligenceConformance`, `compareDecisionIntelligenceArtifacts`, `buildConformanceFingerprint`, `validateSchemaAndRequiredFields`, `validateImmutability`, `validateFingerprintIntegrity`, `validateProvenanceIntegrity`, `validateAdvisoryOnlyBoundaries`, `validateReferenceIntegrity`, `validateDeterministicConstruction`, `validateUnknownValuePreservation`, `validateEvidenceGapPreservation`, `validateExplanationCompleteness`, `validateGovernanceBindingCompatibility` |
| `validation/decisionIntelligencePipelineOrchestrator.js` | `DECISION_INTELLIGENCE_PIPELINE_SCHEMA_VERSION`, `DECISION_INTELLIGENCE_PIPELINE_SOURCE`, `PIPELINE_STAGES`, `runDecisionIntelligencePipeline`, `validateDecisionIntelligencePipeline`, `buildDecisionIntelligencePipelineReport`, `summarizeDecisionIntelligencePipeline`, `compareDecisionIntelligencePipelineRuns` |
| `validation/decisionIntelligencePipelineStabilityBaseline.js` | `CERTIFICATION_STATUSES`, `DECISION_INTELLIGENCE_PIPELINE_BASELINE_SCHEMA_VERSION`, `DECISION_INTELLIGENCE_PIPELINE_BASELINE_SOURCE`, `DECISION_INTELLIGENCE_PIPELINE_CERTIFICATION_SOURCE`, `buildDecisionIntelligencePipelineBaseline`, `validateDecisionIntelligencePipelineBaseline`, `compareDecisionIntelligencePipelineBaselines`, `buildDecisionIntelligencePipelineCertification`, `summarizeDecisionIntelligencePipelineBaseline` |
| `validation/decisionIntelligenceGovernanceBindingAdapter.js` | `DECISION_INTELLIGENCE_GOVERNANCE_BINDING_SCHEMA_VERSION`, `DECISION_INTELLIGENCE_GOVERNANCE_BINDING_SOURCE`, `DECISION_INTELLIGENCE_GOVERNANCE_BINDING_TYPE`, `REQUIRED_BINDING_FIELDS`, `buildDecisionIntelligenceGovernanceBinding`, `validateDecisionIntelligenceGovernanceBinding`, `summarizeDecisionIntelligenceGovernanceBinding`, `buildDecisionIntelligenceGovernanceBindingFingerprint`, `compareDecisionIntelligenceGovernanceBindings` |
| `validation/decisionIntelligenceGovernanceIntegrationValidation.js` | `DECISION_INTELLIGENCE_GOVERNANCE_VALIDATION_SCHEMA_VERSION`, `DECISION_INTELLIGENCE_GOVERNANCE_VALIDATION_SOURCE`, `VALIDATION_STAGES`, `runDecisionIntelligenceGovernanceValidation`, `validateDecisionIntelligenceGovernanceIntegration`, `buildDecisionIntelligenceGovernanceValidationReport`, `summarizeDecisionIntelligenceGovernanceValidation` |
| `validation/governanceArtifactRegistry.js` | `ARTIFACT_TYPES`, `GOVERNANCE_ARTIFACT_REGISTRY_SCHEMA_VERSION`, `GOVERNANCE_ARTIFACT_REGISTRY_SOURCE`, `REQUIRED_REGISTRATION_FIELDS`, `buildGovernanceArtifactRegistryFingerprint`, `buildRegistrationFingerprint`, `createArtifactRegistration`, `createGovernanceArtifactRegistry`, `detectSupersession`, `getArtifact`, `getArtifactByFingerprint`, `listArtifacts`, `normalizeRegistry`, `registerArtifact`, `summarizeRegistry`, `validateArtifactRegistration` |
| `validation/governanceArtifactLifecycleManager.js` | `ALLOWED_TRANSITIONS`, `GOVERNANCE_ARTIFACT_LIFECYCLE_SCHEMA_VERSION`, `GOVERNANCE_ARTIFACT_LIFECYCLE_SOURCE`, `LIFECYCLE_EVENT_TYPES`, `LIFECYCLE_STATES`, `buildLifecycleEventFingerprint`, `buildLifecycleFingerprint`, `createLifecycle`, `registerLifecycleEvent`, `validateLifecycleTransition`, `getLifecycleState`, `detectSupersededArtifacts`, `summarizeLifecycle`, `validateLifecycleIntegrity` |
| `validation/governanceReviewSessionManager.js` | `GOVERNANCE_REVIEW_SESSION_SCHEMA_VERSION`, `GOVERNANCE_REVIEW_SESSION_SOURCE`, `REVIEW_SESSION_STATUSES`, `attachReviewPackage`, `buildReviewPackageReference`, `buildReviewPackageReferenceFingerprint`, `buildReviewSessionFingerprint`, `createReviewSession`, `getReviewSessionState`, `summarizeReviewSession`, `validateReviewSession`, `validateReviewSessionIntegrity` |
| `validation/governanceReviewWorkspaceOrchestrator.js` | `CERTIFICATION_READINESS`, `GOVERNANCE_REVIEW_WORKSPACE_SCHEMA_VERSION`, `GOVERNANCE_REVIEW_WORKSPACE_SOURCE`, `WORKSPACE_REVIEW_READINESS`, `assembleWorkspaceSummary`, `buildWorkspaceReviewFingerprint`, `createWorkspaceReview`, `deriveWorkspaceReadiness`, `listWorkspaceFindings`, `summarizeWorkspaceReview`, `validateWorkspaceReview` |
| `validation/governancePipelineEndToEndValidation.js` | `GOVERNANCE_PIPELINE_E2E_SCHEMA_VERSION`, `GOVERNANCE_PIPELINE_E2E_SOURCE`, `PIPELINE_STAGES`, `summarizePipelineValidation`, `validateArtifactFlow`, `validateGovernancePipeline`, `validatePipelineDeterminism`, `validatePipelineIntegrity`, `validatePipelineStages` |
| `validation/governancePipelineStabilityBaseline.js` | `CERTIFICATION_STATUSES`, `GOVERNANCE_PIPELINE_BASELINE_SCHEMA_VERSION`, `GOVERNANCE_PIPELINE_BASELINE_SOURCE`, `GOVERNANCE_PIPELINE_CERTIFICATION_SOURCE`, `buildGovernancePipelineBaseline`, `buildGovernancePipelineBaselineFingerprint`, `buildGovernancePipelineCertification`, `buildGovernancePipelineCertificationFingerprint`, `compareGovernancePipelineBaseline`, `summarizeGovernancePipelineBaseline`, `validateGovernancePipelineBaseline`, `validateGovernancePipelineCertification` |
| `validation/investmentDecisionContract.js` | `ARCHITECTURAL_RULES`, `CAPITAL_SCORE_CONTRACT`, `CAPITAL_SCORE_INPUTS`, `CONTRACT_SCHEMA_VERSION`, `CONTRACT_VERSION`, `ENGINE_RESPONSIBILITIES`, `INVESTMENT_POSTURES`, `OUT_OF_SCOPE_RESPONSIBILITIES`, `REQUIRED_INPUT_FIELDS`, `REQUIRED_OUTPUT_FIELDS`, `SOURCE`, `normalizeInvestmentDecisionOutput`, `validateInvestmentDecisionContract`, `validateInvestmentDecisionInput`, `validateInvestmentDecisionOutput` |
| `validation/investmentDecisionValidation.js` | `OUTCOME_CATEGORIES`, `REVIEW_DECISIONS`, `SCHEMA_VERSION`, `SOURCE`, `buildAggregateInvestmentMetrics`, `buildInvestmentValidationBatch`, `createInvestmentValidationRecord`, `deriveValidationOutcome`, `fingerprint`, `normalizeOutcomeCategory`, `normalizeReviewDecision`, `runInvestmentDecisionValidation`, `validateInvestmentValidationRecord`, `writeJsonFile` |
| `validation/strategyLaneContract.js` | `ARCHITECTURAL_RULES`, `CONTRACT_SCHEMA_VERSION`, `CONTRACT_VERSION`, `OUT_OF_SCOPE_RESPONSIBILITIES`, `REQUIRED_LANE_FIELDS`, `REQUIRED_LANE_OUTPUT_FIELDS`, `REQUIRED_PROFILE_INPUT_FIELDS`, `SOURCE`, `STRATEGY_LANE_DEFINITIONS`, `STRATEGY_LANES`, `getStrategyLaneDefinition`, `isValidStrategyLane`, `normalizeStrategyLaneOutput`, `validateStrategyLaneDefinition`, `validateStrategyLaneDefinitions`, `validateStrategyLaneOutput`, `validateStrategyProfileInput` |
| `validation/certificationArtifactRegistry.js` | `APPROVAL_STATUS`, `DEFAULT_REGISTRY_PATH`, `REGISTRY_VERSION`, `SOURCE`, `buildRegistryEntryFingerprint`, `buildRegistryEntryId`, `createCertificationArtifactRegistryEntry`, `createEmptyCertificationArtifactRegistry`, `loadCertificationArtifactRegistry`, `normalizeRegistry`, `registerCertificationArtifact`, `resolveCertificationArtifact`, `resolveCertificationArtifactFromRegistry`, `saveCertificationArtifactRegistry`, `stableStringify`, `validateRegistryEntry` |
| `validation/reviewWorkspaceContract.js` | `REQUIRED_COMPONENTS`, `SCHEMA_VERSION`, `SOURCE`, `VERSION`, `buildReviewWorkspaceBatch`, `createReviewWorkspace`, `fingerprint`, `validateReviewWorkspace` |
| `engines/investmentDecisionEngine.js` | `SOURCE`, `VERSION`, `STAGE_NAMES`, `evaluateInvestmentDecision`, `summarizeInvestmentDecision` |
| `engines/capitalScoreExplanationEngine.js` | `CAPITAL_SCORE_STATUS`, `READINESS_CATEGORIES`, `SOURCE`, `VERSION`, `buildFutureCapitalScoreInputs`, `buildReadinessSummary`, `explainCapitalScore` |
| `engines/decisionIntelligenceEngine.js` | `evaluateDecisionIntelligence`, `summarizeDecisionIntelligence` |
| `engines/decisionEngine.js` | `evaluateDecision`, `makeDecision`, `decide`, `getDecision`, `summarizeDecision` |
| `engines/notificationEngine.js` | `sendDealAlert`, `sendTestAlert`, `getStatus`, `buildSmsBody`, `buildEmailBody`, `evaluateAlertRules`, `getAlertThresholds`, `__setNotificationStateFileForTests`, `__setResendPosterForTests`, `__resetForTests` |

Duplicate or overlapping public entry points:

- `decisionEngine.js` exports aliases `evaluateDecision`, `makeDecision`, `decide`, `getDecision`; this is Legacy Compatibility.
- Decision Intelligence has both runtime engine exports (`engines/decisionIntelligenceEngine.js`) and offline artifact pipeline exports (`validation/decisionIntelligence*.js`); this is overlapping by design but can create terminology ambiguity.
- Runtime signal display APIs in `utils/signal*` coexist with offline canonical signal APIs in `validation/canonicalIntelligenceSignalContract.js`; this is a verified split between production display semantics and offline canonical signal contracts.

Corrected v9.0 API comparison:

- No v9.0-required production authority API is missing from the verified production runtime: Deal Gate, BUY_NOW labeling, notification dispatch, scanner flow, marketplace flow, and persistence remain present.
- APIs present in the repository but intentionally offline or prototype include Signal migrations, Governance artifacts, Decision Intelligence Governance Binding, Investment Decision, Capital Score, certification registries, and conformance/stability baselines.
- Duplicate public Decision Engine aliases are retained as compatibility aliases, not competing authority surfaces.
- The main authority ambiguity is terminology-level: production display signals and offline canonical Signals use related language but remain separate APIs.

## 7. Canonical Signal Verification

### Where Canonical Signals Are Created

Canonical Signal artifacts are created through `validation/canonicalIntelligenceSignalContract.js:createCanonicalSignal`. Signal definitions are managed by `validation/intelligenceSignalRegistry.js:createSignalDefinition` and `createSignalRegistry`.

Per-family migrations are present for:

- `validation/gradePremiumSignalMigration.js`
- `validation/populationSignalMigration.js`
- `validation/listingQualitySignalMigration.js`
- `validation/rangeFirstValuationSignalMigration.js`
- `validation/confidenceCalibrationSignalMigration.js`
- `validation/dealGateSignalMigration.js`
- `validation/evidenceReadinessSignalMigration.js`
- `validation/identityParserSignalMigration.js`
- `validation/falsePositiveSignalMigration.js`
- `validation/canonicalSoldEvidenceSignalMigration.js`
- `validation/productionValuationSignalMigration.js`
- `validation/comparableQualitySignalMigration.js`
- `validation/decisionContextSignalMigration.js`

Implementation status: **Fully Implemented**. Authority: **Offline Only** and **Shadow Only** depending on the migration/comparison artifact.

### Runtime Signal Semantics

Production display does not use the offline canonical signal contract. Runtime display uses:

- `utils/signalAnnotation.js`
- `utils/signalSemantics.js`
- `utils/signalContractRegistry.js`

Verified runtime call sites:

- `server.js:39-40` imports signal utilities.
- `server.js:1475-1494` builds raw display signal values and annotates them.
- `server.js:2016-2070` uses signal semantics and annotations in display interpretation.

Implementation status: **Fully Implemented**. Authority: **Production Explanation Only**.

### Engine Coverage

| Engine or subsystem | Emits canonical signal | Consumes canonical signal | Legacy fallback | Production use |
| --- | --- | --- | --- | --- |
| Grade Premium | Yes via `validation/gradePremiumSignalMigration.js` | Offline only | Native output preserved | No verified production canonical signal use |
| Population Intelligence | Yes via `validation/populationSignalMigration.js` | Offline only | Native output preserved | No verified production canonical signal use |
| Listing Quality Diagnostics | Yes via `validation/listingQualitySignalMigration.js` | Offline only | Native output preserved | No verified production canonical signal use |
| Range-First Valuation | Yes via `validation/rangeFirstValuationSignalMigration.js` | Offline only | Native output preserved | No verified production canonical signal use |
| Confidence Calibration | Yes via `validation/confidenceCalibrationSignalMigration.js` | Offline only | Native output preserved | No verified production canonical signal use |
| Deal Gate Diagnostics | Yes via `validation/dealGateSignalMigration.js` | Offline only | Native output preserved | Production Deal Gate remains native |
| Evidence Readiness | Yes via `validation/evidenceReadinessSignalMigration.js` | Offline only | Native output preserved | Runtime display consumes `decisionIntelligence` readiness, not canonical signal |
| Identity Parser | Yes via `validation/identityParserSignalMigration.js` | Offline only | Native output preserved | Production parser/identity remains legacy/native |
| False Positive Diagnostics | Yes via `validation/falsePositiveSignalMigration.js` | Offline only | Native output preserved | No verified production canonical signal use |
| Canonical Sold Evidence | Yes via `validation/canonicalSoldEvidenceSignalMigration.js` | Offline only | Native output preserved | Runtime evidence uses store/service directly |
| Production Valuation | Yes via `validation/productionValuationSignalMigration.js` | Offline only | Native output preserved | Runtime valuation remains native |
| Comparable Quality | Yes via `validation/comparableQualitySignalMigration.js` | Offline only | Native output preserved | Runtime comparable quality remains native |
| Decision Context | Yes via `validation/decisionContextSignalMigration.js` | Offline only | Native output preserved | No verified production canonical signal use |

Corrected v9.0 comparison: the canonical signal framework is implemented offline/shadow, while production display uses `utils/signal*` contracts. This is a documented transitional boundary rather than a material conflict because v9.0 does not grant canonical Signals production scoring, Deal Gate, BUY_NOW, notification, or marketplace authority.

## 8. Warning Propagation Verification

### Production Warning Sources

Verified warning sources include:

- `engines/marketIntelligenceEngine.js:796-899` accumulates market warnings such as no sold comps, fallback valuation support, low confidence, high spread, high volatility, unsupported ROI.
- `server.js:2630-2631` persists `qualityReasons` and `qualityWarnings` from scoring into saved listings.
- `server.js:2739-2742` copies quality warning context into alerts.
- `server.js:2779-2791` copies quality warning context into rejections.
- `server.js:3419-3446` exposes notification rule failures and quality warnings in alert debug output.

### Decision Intelligence Warning Propagation

Offline Decision Intelligence warning propagation is verified in:

- `validation/decisionIntelligenceArtifactConformance.js`, which emits warning codes for provenance, explanation, and Governance compatibility.
- `validation/decisionIntelligencePipelineOrchestrator.js`, which includes stage warnings in pipeline reports.
- `validation/decisionIntelligencePipelineStabilityBaseline.js`, which preserves warnings and known limitations.
- `validation/decisionIntelligenceGovernanceBindingAdapter.js`, which collects warnings into `warningPropagation`.
- `validation/decisionIntelligenceGovernanceIntegrationValidation.js:262-289`, which validates warning propagation into bindings.

Implementation status: **Fully Implemented** for offline DI/Governance. Authority: **Offline Only**.

### Warning Gaps

| Finding | Verification |
| --- | --- |
| Runtime production warning propagation is native and field-specific, not canonicalized through Phase 13 signal warnings. | Verified by `server.js` using raw `qualityWarnings`, `confidenceReasons`, market fields, and runtime signal display helpers. |
| Offline DI/Governance warnings are structured reason codes and propagated through binding/integration validation. | Verified by `validation/decisionIntelligenceGovernanceIntegrationValidation.js:262-289`. |
| No verified production path persists offline DI/Governance warning bundles. | No `server.js` import of DI Governance Binding modules. |
| Warnings can be converted to prose for UI display. | Verified in display/explanation functions such as `server.js:1816-1840` and alert preview/debug routes. |

No source-backed evidence shows warnings are silently suppressed in the Deal Gate path. Some warnings are not propagated into canonical offline artifacts at production scan time because those artifacts are not production-reachable.

Corrected v9.0 comparison: v9.0 requires warning preservation and non-suppression, not automatic production promotion of every offline warning artifact. Repository behavior is therefore generally aligned, with a future mapping gap between native runtime warnings and offline Governance warning taxonomies.

## 9. Readiness Propagation Verification

### Readiness Sources

Verified readiness/status concepts:

- Decision Intelligence runtime: `overallReadiness`, `evidencePosture`, `compPosture`, `valuationPosture`, `resalePressurePosture` consumed by `server.js:1810-1839`.
- Offline DI pipeline readiness: `readyForGovernanceReview` and `readyForGovernanceBinding` in `validation/decisionIntelligencePipelineOrchestrator.js:122`, `154-155`, `352-353`.
- DI Governance Binding readiness: `reviewReadiness` and `certificationReadiness` in `validation/decisionIntelligenceGovernanceBindingAdapter.js`.
- DI Governance Integration Validation readiness stages: `review_readiness_propagation`, `certification_readiness_propagation` in `validation/decisionIntelligenceGovernanceIntegrationValidation.js`.
- Governance Workspace readiness: `WORKSPACE_REVIEW_READINESS`, `CERTIFICATION_READINESS` in `validation/governanceReviewWorkspaceOrchestrator.js`.

### Propagation Findings

| Path | Status | Evidence |
| --- | --- | --- |
| Market Intelligence to runtime display | Fully Implemented | `marketIntelligenceEngine.js:757-956`; `server.js:1810-1840` |
| Runtime display to production authority | Not Present | Display sets `contextualOnly: true` and `authoritativeDecisionSource: 'deal_gate'` at `server.js:1821-1837` |
| Offline DI pipeline to Governance Binding | Fully Implemented | `decisionIntelligenceGovernanceBindingAdapter.js` exports and tests |
| Governance Binding to production runtime | Not Present | No `server.js` import |
| Review readiness vs certification readiness separation | Fully Implemented offline | `decisionIntelligenceGovernanceIntegrationValidation.js:238-258`; tests verify separation |

Potential propagation ambiguity:

- Runtime evidence readiness is a display explanation and can be `supported_context`, `limited_context`, `cautious_context`, `not_ready`, or `unknown` depending on Decision Intelligence output. It is not the same enum system as offline Governance readiness.
- Production scanner does not build offline DI Governance Binding artifacts, so runtime readiness is not automatically the same as Governance readiness.

Corrected v9.0 comparison: v9.0 preserves review readiness and certification readiness as separate non-authoritative concepts. The repository implements that separation offline, while runtime readiness remains display/explanation context only.

## 10. Authority Verification

| Subsystem | Implementation status | Authority | Evidence |
| --- | --- | --- | --- |
| Marketplace Adapter | Fully Implemented | Production Evidence Only | Active marketplace search in `services/scoutScannerService.js:141-149` |
| Parser | Fully Implemented | Production Evidence Only | Parser injected into scanner and used by active marketplace search options |
| Identity compatibility layer | Fully Implemented | Production Evidence Only | `listingIdentity`, `legacyIdentityAdapter`, canonical diagnostics |
| Canonical Identity | Fully Implemented | Shadow Only / Production Evidence Only where evidence query uses identity | `canonicalIdentityEngine.js`, `canonicalSoldComparisonService.js` |
| Evidence Engines | Fully Implemented | Production Evidence Only | Market/evidence engines feed scoring and Deal Gate but do not alone decide BUY_NOW |
| Market Value Engine | Fully Implemented | Production Evidence Only | Imported by `server.js:5` |
| ROI Engine | Fully Implemented | Production Evidence Only | Imported by `server.js:8`; alert/report fields copy ROI |
| Risk Engine | Fully Implemented | Production Evidence Only | Imported by `server.js:9`; Deal Gate uses risk |
| Quality Engine | Fully Implemented | Production Evidence Only | Imported by `server.js:24`; warnings persisted |
| Market Intelligence | Fully Implemented | Production Evidence Only | `server.js:1340-1348`; Deal Gate consumes trust/recommendation |
| Decision Intelligence runtime | Fully Implemented | Production Evidence Only / Production Explanation Only | `marketIntelligenceEngine.js:757-763`; `server.js:1810-1840` |
| Decision Engine | Fully Implemented | Production Evidence Only | `server.js:1369-1380`; final authority remains Deal Gate |
| Grading Engine | Fully Implemented | Production Evidence Only | `server.js:1382-1399` |
| Deal Gate | Fully Implemented | Production Authoritative | `server.js:2082-2568`, `2640-2641` |
| Notification Engine | Fully Implemented | Production Explanation Only / downstream delivery | `server.js:2716-2757`, `3517-3556` |
| Shadow Valuation | Fully Implemented | Shadow Only | `server.js:711-769`, `1355-1364` |
| Investment Decision | Fully Implemented | Prototype Only / Offline Only | no `server.js` import; `engines/investmentDecisionEngine.js` |
| Capital Score | Fully Implemented | Prototype Only / Offline Only | no `server.js` import; `engines/capitalScoreExplanationEngine.js` |
| Governance Binding | Fully Implemented | Offline Only | validation module only, no production import |
| Review Workspace runtime export | Fully Implemented | Production Explanation Only / Offline review support | `server.js:909-923`, export only |
| Human Operator | Fully Implemented operationally | Human authority outside code automation | Basic auth/operator audit; no automated purchase code |

Explicit authority checks:

- No recommendation bypasses Deal Gate: verified current alert creation checks `gate.passed` at `server.js:2716`.
- BUY_NOW authority remains unchanged: verified `dealGate` returns `BUY_NOW` only when `buyNowAllowed` is true at `server.js:2541`, `2567`.
- No shadow output changes production behavior: verified shadow `try/catch` and observation-only comments at `server.js:184-188`.
- Investment Decision prototype does not influence production: no verified `server.js` import.
- Capital Score output does not influence production: no verified `server.js` import.
- Review Workspace action mutating production decisions: not present in reviewed runtime export; export builds review batch at `server.js:915-923`.
- Governance Binding silently replacing authority: not present; no production import.
- Notification Engine inventing recommendation authority: not present; notification candidates are gated by `gate.passed` or `evaluateAlertRules` on existing alerts.
- Active listings as canonical true sold evidence: no verified canonical sold evidence query treats active listings as true sold; `server.js:281` calls `querySoldEvidence(..., { trueSoldOnly: true })`.

## 11. Production vs Shadow Verification

| Dimension | Production | Shadow |
| --- | --- | --- |
| Source data | Active marketplace listings via `activeMarketplace.searchWithBackoff` | Production listing context and canonical sold evidence |
| Identity source | Parser/legacy parsed identity plus compatibility helpers | Legacy Identity Adapter and Canonical Identity diagnostics |
| Evidence source | Native comp, sold sales, canonical sold evidence query, market engines | Canonical sold comparison and shadow valuation |
| Valuation owner | `marketValueEngine`, `valuationRangeEngine`, ROI/risk/quality inputs | `shadowValuationEngine` |
| Decision owner | `server.js:dealGate` final authority; `decisionEngine` evidence input | Decision Intelligence/shadow comparison only |
| Persistence target | `data/cardhawk-data.json` via `appStore`/`stateStore` | `data/shadow-mode.json` via `shadowModeLogger` |
| Logging target | scans, alerts, rejections, audit log | Shadow mode decision records |
| Notification eligibility | `gate.passed` and notification rules | None |
| Failure behavior | Production errors captured by scanner/system health | Shadow failures caught and suppressed from runtime behavior |
| Human review path | Review workspace export from runtime store | Offline validation/reporting artifacts |
| Promotion status | Production-authoritative only in Deal Gate | No promotion; offline/shadow only |

Verified shadow isolation:

- `server.js:165-188` wraps Shadow Mode Decision Intelligence and logger failures.
- `server.js:711-769` fail-safes shadow valuation.
- `services/scoutScannerService.js:125-130`, `327-334` catch Shadow Mode persistence batch errors.

## 12. Investment Decision Verification

Implementation status: **Fully Implemented**. Authority: **Prototype Only** and **Offline Only**.

Verified files:

- `engines/investmentDecisionEngine.js`
- `validation/investmentDecisionContract.js`
- `validation/investmentDecisionValidation.js`
- `validation/strategyLaneContract.js`
- `engines/capitalScoreExplanationEngine.js`
- `tests/investment-decision-engine.test.js`
- `tests/investment-decision-contract.test.js`
- `tests/investment-decision-validation.test.js`
- `tests/capital-score-explanation-engine.test.js`
- `docs/architecture/investment-decision-contract.md`
- `docs/architecture/investment-decision-engine-prototype.md`
- `docs/architecture/capital-score-explanation-framework.md`
- `docs/architecture/strategy-lane-contract.md`

Public API evidence:

- `engines/investmentDecisionEngine.js` exports `evaluateInvestmentDecision` and `summarizeInvestmentDecision`.
- `validation/investmentDecisionContract.js` exports `INVESTMENT_POSTURES`, contract validation helpers, and required field constants.
- `validation/strategyLaneContract.js` exports `STRATEGY_LANES`, `STRATEGY_LANE_DEFINITIONS`, and validators.

Supported postures from contract:

- `IGNORE`
- `MONITOR`
- `NEGOTIATE`
- `BUY`
- `PRIORITY_BUY`

Verified behavior from source/tests:

- Deal Gate failure blocking BUY/PRIORITY_BUY is covered by investment decision architecture/tests.
- Strategy Lane affects evaluation context in `engines/investmentDecisionEngine.js:411-479`.
- Capital Score readiness is represented by `capitalScoreStatus` and readiness helpers in `engines/capitalScoreExplanationEngine.js`.
- The subsystem has no verified production import from `server.js`.

Conclusion: Investment Decision is present and non-production. This matches v9.0's prototype/offline authority boundary and should not be treated as production-reachable without a future governed promotion phase.

## 13. Review Workspace Verification

### Runtime Export

Runtime review workspace export is implemented through:

- `server.js:42` importing `validation/exportReviewWorkspaceBatch`
- `server.js:878-923` normalizing query options and building runtime review workspace export
- `server.js:3973-3974` exporting helpers for tests

The export consumes stored listings and can exclude completed reviews via `listingHasCompletedReview` at `server.js:900-907`.

Implementation status: **Fully Implemented**. Authority: **Production Explanation Only** / offline review support.

### Offline Workspace

Offline Governance workspace modules are implemented:

- `validation/reviewWorkspaceContract.js`
- `validation/daltonReviewWorkspace.js`
- `validation/governanceReviewSessionManager.js`
- `validation/governanceReviewWorkspaceOrchestrator.js`

The workspace orchestrator is offline and validates/reports artifact readiness; it is not production runtime.

### Verified Review Workspace Properties

| Question | Verification |
| --- | --- |
| How workspaces are created | Runtime batch export via `buildRuntimeReviewWorkspaceExport`; offline workspace via `daltonReviewWorkspace` and `reviewWorkspaceContract` |
| Preserve production outputs | Runtime export consumes stored production listings |
| Preserve shadow outputs | Stored listings include `shadowSoldComparison` and `shadowValuation` when present |
| Include warnings/readiness | Runtime display and stored listing fields include warning/readiness context; offline Governance workspace has finding/readiness fields |
| Deterministic exports | Tested by `tests/review-workspace-export-endpoint.test.js` and `tests/export-review-workspace-batch.test.js` |
| Export limits | `server.js:882-885` caps runtime export count at 500 |
| Mutate production state | No verified mutation in export builder; runtime export reads store |
| Manual review separation | `listingHasCompletedReview` checks review fields separately from machine output |
| Evidence/provenance attributable | Partially Implemented in runtime export; Fully Implemented in offline Governance artifacts |

## 14. Certification and Registry Verification

### Certification Artifact Registry

`validation/certificationArtifactRegistry.js` implements:

- `createEmptyCertificationArtifactRegistry`
- `loadCertificationArtifactRegistry`
- `saveCertificationArtifactRegistry`
- `registerCertificationArtifact`
- `resolveCertificationArtifact`
- `resolveCertificationArtifactFromRegistry`
- `validateRegistryEntry`

It persists to `data/certification-artifact-registry.json` by default.

Implementation status: **Fully Implemented**. Authority: **Offline Only** unless consumed by a validation/safety-gate module.

### Governance Artifact Registry

`validation/governanceArtifactRegistry.js` implements immutable offline governance artifact registration with ID/fingerprint lookup. It does not grant production approval.

Implementation status: **Fully Implemented**. Authority: **Offline Only**.

### Safety-Gate and Certification Consumption

Verified related modules:

- `validation/liveIngestionSafetyGate.js`
- `validation/marketplaceAdapterCertification.js`
- `validation/providerEvaluation.js`
- `validation/canonicalArtifactIntegrity.js`

No verified `server.js` production import reaches `validation/certificationArtifactRegistry.js`.

Certification registry existence does not itself grant production approval. `certificationArtifactRegistry.js` has approval statuses and resolution checks, but production runtime does not consume this registry directly.

Corrected v9.0 comparison: this matches the approved boundary that registries and certifications are evidence/control artifacts only until an explicit governed production integration exists.

## 15. Persistence and Artifact Verification

### Persistence Targets

| Target | Owner | Purpose | Authority |
| --- | --- | --- | --- |
| `data/cardhawk-data.json` | `utils/appStore.js`, `utils/stateStore.js`, `server.js` | Production app state: listings, scans, alerts, rejections | Production runtime state |
| `data/sold-evidence.json` | `utils/soldEvidenceStore.js`, `services/soldEvidenceService.js` | Canonical sold evidence | Production Evidence Only |
| `data/shadow-mode.json` | `utils/shadowModeLogger.js` | Shadow Mode observations | Shadow Only |
| `data/operatorAuditLog.json` | `utils/operatorAuditLog.js` | Operator audit log | Production audit |
| `data/certification-artifact-registry.json` | `validation/certificationArtifactRegistry.js` | Certification artifact registry | Offline Only |
| `data/canonical-ingestion-runs.json` | ingestion run repository | Canonical ingestion run artifacts | Offline/Canonical |
| `data/canonical-source-decision-dossiers.json` | dossier validation modules | Canonical source dossiers | Offline/Canonical |
| Decision Validation state | `engines/decisionValidationEngine.js` | Production decision validation records | Production diagnostics |
| Prediction Accuracy state | `engines/predictionAccuracyEngine.js` | Prediction tracking | Production diagnostics |
| Learning records | `engines/learningEngine.js` | Learning snapshots/outcomes | Production diagnostics |
| Review workspace files | `validation/daltonReviewWorkspace.js` | Offline review workspace artifacts | Offline Only |

### Persistence Batching

Verified production batching:

- `server.js:148-151` creates `persistenceCoordinator`.
- `services/scoutScannerService.js:71-74` begins scan persistence batch.
- `services/scoutScannerService.js:337-341` flushes app state batch.
- `services/scoutScannerService.js:109-130`, `310-334` batches Decision Validation, Prediction Accuracy, and Shadow Mode persistence.

### Artifact Ownership

No verified overlap grants production authority to offline artifacts. The largest ownership ambiguity is conceptual rather than runtime: production display signal contracts and offline canonical signal contracts coexist without a production bridge.

Corrected v9.0 comparison: v9.0 allows this as a staged architecture. The missing bridge is a future architecture topic, not an immediate production reliability defect.

## 16. Test Verification

Relevant test coverage identified:

| Test file group | Subsystem covered | Notes |
| --- | --- | --- |
| `tests/smoke.test.js` | Core runtime safety | Includes config, state store, notification idempotency, route hardening |
| `tests/review-workspace-export-endpoint.test.js`, `tests/export-review-workspace-batch.test.js` | Runtime/offline review exports | Determinism, limits, auth, read-only behavior |
| `tests/signal-*.test.js` | Signal Framework contracts, alignment, reports, validation suite | Offline canonical signal stack |
| `tests/*-signal-onboarding.test.js`, `tests/*-shadow-comparison.test.js` | Signal migrations and native-to-shadow parity | Offline/shadow only |
| `tests/governance-*.test.js` | Governance registry/lifecycle/session/workspace/e2e/baseline | Offline governance |
| `tests/decision-intelligence-*.test.js` | Runtime DI engine and offline DI artifacts/binding/integration | Mix of production evidence engine tests and offline artifacts |
| `tests/investment-decision-*.test.js` | Investment Decision contract, engine, validation | Prototype/offline |
| `tests/capital-score-explanation-engine.test.js` | Capital Score explanation | Prototype/offline |
| `tests/certification-artifact-registry.test.js`, `tests/marketplace-adapter-certification.test.js` | Certification/registry | Offline governance/acquisition |
| `tests/sold-evidence-*.test.js` | Canonical sold evidence | Store/service/import/runtime integration tests |
| `tests/shadow-*.test.js` | Shadow Mode, shadow valuation, shadow comparison | Shadow/offline |
| `tests/deal-gate-*.test.js`, `tests/display-consistency-guard.test.js`, `tests/unified-decision-presentation.test.js` | Deal Gate and display boundaries | Production authority/display tests |

Focused tests run for this audit:

- `tests/decision-intelligence-evidence-bundle.test.js`
- `tests/decision-intelligence-artifact-builder.test.js`
- `tests/decision-intelligence-artifact-conformance.test.js`
- `tests/decision-intelligence-pipeline-orchestrator.test.js`
- `tests/decision-intelligence-pipeline-stability-baseline.test.js`
- `tests/decision-intelligence-governance-binding-adapter.test.js`
- `tests/decision-intelligence-governance-integration-validation.test.js`
- `tests/governance-artifact-registry.test.js`
- `tests/governance-artifact-lifecycle-manager.test.js`
- `tests/governance-review-session-manager.test.js`
- `tests/governance-review-workspace-orchestrator.test.js`
- `tests/governance-pipeline-end-to-end-validation.test.js`

Result: focused tests passed during audit validation.

Test caveat: Passing tests do not prove production runtime wiring unless the runtime imports/call paths were independently verified. For Governance Binding, no production runtime path was verified.

## 17. Architectural Drift Report

| ID | Subsystem | v9.0 architectural intent | Current repository implementation | Classification | Production impact | Safety impact | Compatibility impact | Evidence | Recommended future phase | Urgency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P18A-D002 | Canonical Signals | Canonical Signal Framework exists and wraps signals | Offline canonical stack implemented; production display uses `utils/signal*` registry | Implementation Partial | None verified | Low; authority intact | Potential terminology/API split | `server.js:39-40`, `validation/canonicalIntelligenceSignalContract.js` | Phase 18.1A - Runtime Signal Display vs Canonical Signal Boundary Audit | Medium |
| P18A-D003 | Governance Binding | DI Governance Binding exists | Implemented offline; no production consumer | Implementation Partial | None | Low; offline boundary intact | Governance review UI not yet connected to runtime export | No `server.js` import; binding module exports present | Phase 18.2A - Offline Governance Workspace DI Binding Summary | Medium |
| P18A-D004 | Warning propagation | Warnings should survive through review/governance | Offline warnings structured; production warning fields are native/prose-specific | Warning Propagation Gap | None verified | Low | Review outputs may need mapping | `server.js` warning fields; DI binding warningPropagation | Phase 18.1B - Warning Taxonomy Mapping Audit | Low |
| P18A-D005 | Readiness propagation | Readiness should remain explicit | Multiple readiness vocabularies exist: runtime DI readiness, DI Governance readiness, workspace readiness | Status Ambiguity | None verified | Low | Consumers may confuse readiness categories | `server.js:1810-1840`; DI/Governance modules | Phase 18.1C - Readiness Vocabulary Reconciliation Audit | Medium |
| P18A-D006 | Investment Decision | Contract/prototype exists | Present offline/prototype; no production path | Implementation Partial | None | Low; prototype isolated | Future promotion needs separate validation | no `server.js` import; exports verified | Phase 18.3A - Investment Decision Production Readiness Audit | Low |
| P18A-D007 | Capital Score | Explanation/readiness exists | Present offline/prototype; no production path | Implementation Partial | None | Low | Future promotion needs Governance | no `server.js` import; exports verified | Phase 18.3B - Capital Score Evidence Binding Audit | Low |
| P18A-D008 | Review Workspace | Review workspace should support evidence review | Runtime export exists; Governance Workspace orchestrator exists offline; no verified combined production-to-governance UI | Implementation Partial | None | Low | Reviewer workflow gap | `server.js:909-923`; `governanceReviewWorkspaceOrchestrator.js` | Phase 18.2A - Offline Governance Workspace DI Binding Summary | High |
| P18A-D009 | Certification Registry | Registry exists and does not grant authority | Implemented offline; no production runtime consumer | Fully Implemented / Offline Only | None | Low | Live admission depends on future explicit wiring | `certificationArtifactRegistry.js`, no `server.js` import | Phase 18.4A - Certification Registry Runtime Boundary Audit | Low |
| P18A-D010 | Production authority | Deal Gate remains authoritative | Verified | Fully Implemented | Positive | High safety preserved | Compatible | `server.js:2640`, `2541`, `2567` | None | None |
| P18A-D011 | Shadow failure isolation | Shadow failures should not affect production | Verified for shadow DI/logger/valuation batching | Fully Implemented | Positive | High safety preserved | Compatible | `server.js:165-188`; scanner catches | None | None |
| P18A-D012 | Active listings as sold evidence | Active listings must not become true sold evidence | Query uses `trueSoldOnly: true`; active comps still used in market context separately | Fully Implemented for verified paths | Positive | High safety preserved | Compatible | `server.js:281`; `marketValueEngine.js` separates sold/active | None | None |
| P18A-D013 | Public API clarity | Canonical APIs should be clear | Multiple aliases in Decision Engine and split signal registries | Legacy Compatibility / Duplicate Ownership | None | Low | Future consumers may choose wrong API | `decisionEngine.js` aliases; `utils/signal*` vs `validation/signal*` | Phase 18.1A | Low |
| P18A-D014 | DI Governance Integration | End-to-end DI Governance validation exists | Implemented offline and tested; no persisted registry/session integration from runtime | Implementation Partial | None | Low | Future review requires adapter/report surface | DI integration module; no `server.js` import | Phase 18.2A | Medium |

Documented discrepancies: 13.

## 18. Missing Components

Missing/partial components based on verified repository state and Phase 18.0A scope:

| Component | Status | Authority | Evidence | Notes |
| --- | --- | --- | --- | --- |
| Runtime production consumer for canonical signal validation stack | Not Present | Future Architecture | no `server.js` import of validation signal stack | Current runtime uses `utils/signal*` display semantics |
| Runtime production consumer for DI Governance Binding | Not Present | Future Architecture | no `server.js` import | Offline only |
| Governance Workspace display of DI Governance Binding | Partially Implemented | Offline Only | Governance workspace modules exist; DI binding summary adapter not verified | Future offline integration |
| Single warning taxonomy across production/native/offline DI/Governance | Partially Implemented | Future Architecture | structured offline warnings, native production warnings | Needs mapping audit |
| Single readiness vocabulary across runtime DI, DI Governance, Governance Workspace | Partially Implemented | Future Architecture | multiple enums/statuses | Needs reconciliation |
| Production promotion path for Investment Decision | Not Present | Future Architecture | no runtime import | Must remain absent until governed |
| Production promotion path for Capital Score | Not Present | Future Architecture | no runtime import | Must remain absent until governed |
| Canonical Signal use in production scoring | Not Present | Future Architecture | no runtime integration | Explicit future phase only |
| Certification Registry live admission path | Not Present | Future Architecture | no runtime import | Registry existence does not grant approval |
| Review Workspace mutation controls beyond export/read-only path | Partially Implemented | Future Architecture | export path read-only; full UI mutation path not verified | Needs route/UI-specific audit if planned |

Missing or partial components: 10.

## 19. Safety Findings

| Safety requirement | Verification | Result |
| --- | --- | --- |
| Active listings are not canonical true sold evidence | `server.js:281` uses `{ trueSoldOnly: true }`; market value separates sold/active evidence | Verified for inspected paths |
| Missing evidence produces insufficient/withheld states | Market Intelligence warnings and Decision Intelligence readiness preserve not-ready context | Verified |
| Warnings are not silently suppressed | Offline DI/Governance warnings preserved; production warnings are native fields/prose | Partially verified |
| Readiness is not silently upgraded | Runtime display marks Decision Intelligence contextual only; offline validation separates readiness | Verified for inspected paths |
| Shadow failures remain isolated | `server.js:165-188`; scanner catches shadow persistence errors | Verified |
| Deal Gate remains production authority | `server.js:2640`; `dealGate` emits BUY_NOW/REJECT | Verified |
| BUY_NOW remains human-reviewed | UI copy at `server.js:2946`; no automated purchase code found | Verified |
| Notifications remain downstream | Alerts created only when `gate.passed`; send-pending uses notification rules on alerts | Verified |
| No automated purchase execution exists | No purchase execution path found | Verified within inspected source |
| No unapproved adapter performs governed live admission | Certification registry not imported by `server.js` | Verified |
| Quarantine cannot satisfy canonical evidence queries | Canonical artifact integrity/quarantine are validation artifacts; no runtime evidence query from quarantine verified | Partially verified |
| Replay does not overwrite original artifacts | Replay modules are validation/offline; no production import verified | Verified for runtime boundary |
| Credentials and secrets are not exposed | Config readiness masks secrets; operator auth exists | Partially verified, not a full security audit |
| Production and shadow persistence remain separated | `data/cardhawk-data.json` vs `data/shadow-mode.json`; separate batching | Verified |

## 20. Recommended Future Phases

1. **Phase 18.1A - Runtime Signal Display vs Canonical Signal Boundary Audit**
   - Objective: audit the split between `utils/signal*` production display semantics and `validation/canonicalIntelligenceSignalContract.js`.
   - Supported by: P18A-D002, P18A-D013.
   - Type: audit-only.

2. **Phase 18.1B - Warning Taxonomy Mapping Audit**
   - Objective: map production warnings, Signal warnings, DI warnings, Governance warnings, and Review Workspace findings.
   - Supported by: P18A-D004.
   - Type: audit-only.

3. **Phase 18.1C - Readiness Vocabulary Reconciliation Audit**
   - Objective: compare runtime Decision Intelligence readiness, offline DI Governance readiness, and Governance Workspace readiness.
   - Supported by: P18A-D005.
   - Type: audit-only.

4. **Phase 18.2A - Offline Governance Workspace Decision Intelligence Binding Summary**
   - Objective: design an offline workspace summary for DI Governance Binding and integration validation artifacts.
   - Supported by: P18A-D003, P18A-D008, P18A-D014.
   - Type: architecture-only before implementation.

5. **Phase 18.3A - Investment Decision Production Readiness Audit**
   - Objective: audit whether Investment Decision should remain prototype-only or prepare for a governed shadow validation.
   - Supported by: P18A-D006.
   - Type: audit-only.

6. **Phase 18.3B - Capital Score Evidence Binding Audit**
   - Objective: audit how Capital Score should bind into Decision Intelligence/Governance without production authority.
   - Supported by: P18A-D007.
   - Type: audit-only.

7. **Phase 18.4A - Certification Registry Runtime Boundary Audit**
   - Objective: verify certification registry boundaries before any live admission path is considered.
   - Supported by: P18A-D009.
   - Type: audit-only.

Recommended future phases: 7.

## 21. Final Determination

**B. Repository implementation is generally consistent with approved Project State v9.0, with documented gaps requiring future phases.**

Support:

- Production authority remains in Deal Gate.
- BUY_NOW remains downstream of Deal Gate and human-reviewed.
- Shadow and offline systems remain isolated from production authority.
- Decision Intelligence and Governance Binding are implemented offline, not production-promoted.
- Canonical Signal Framework is implemented offline/shadow but not production-wired.
- Investment Decision and Capital Score are present but prototype/offline, with no verified production reachability.
- The approved v9.0 manual was available as conversation-supplied architectural intent for this correction pass, and no longer limits the direct v9.0 comparison.
