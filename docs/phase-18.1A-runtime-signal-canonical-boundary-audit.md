# Phase 18.1A - Runtime Signal Display vs Canonical Signal Boundary Audit

This audit verifies the architectural boundary between CardHawk's production runtime signal display utilities and the offline Canonical Intelligence Signal Framework. It uses the current repository as implementation evidence and Approved Project State v9.0, supplied in the Codex conversation, as authoritative architectural intent.

No production code, tests, runtime behavior, `server.js`, persistence, existing architecture documents, Signal migrations, shadow comparisons, Deal Gate, BUY_NOW, alerts, notifications, or Governance implementations were modified.

## 1. Executive Summary

Primary determination: **B. The systems require a documented compatibility mapping but no runtime integration.**

Verified repository fact: production runtime signal handling is implemented by `utils/signalContractRegistry.js`, `utils/signalSemantics.js`, `utils/signalAnnotation.js`, and `server.js`. This stack is display-oriented. It annotates raw production values, neutralizes buy-like wording for non-authoritative signals, marks signal authority for UI/explanation purposes, and preserves Deal Gate as the only production decision signal.

Verified repository fact: the Canonical Intelligence Signal Framework is implemented under `validation/`. It creates immutable signal contracts, registry definitions, alignments, batches, runs, conflict analyses, reports, migration artifacts, shadow comparison artifacts, and Decision Intelligence/Governance references. It consumes already-generated native outputs. It does not execute production engines, does not alter native outputs, and does not integrate into the production scanner or Deal Gate.

v9.0 architectural intent: production authority remains with Deal Gate; BUY_NOW remains a human-reviewed scouting label; offline, shadow, governance, prototype, and validation artifacts remain non-authoritative unless explicitly promoted through future governance.

Inference: the two systems intentionally overlap in vocabulary but not authority. Runtime display utilities own production presentation safety. Canonical Signals own offline/shadow evidence packaging and future governance readiness. A future compatibility mapping audit is useful because names, status values, confidence semantics, and authority labels are similar but not identical. Immediate consolidation or runtime integration is not justified by the verified source.

## 2. Audit Scope and Method

Reviewed production/runtime-oriented signal files:

- `utils/signalAnnotation.js`
- `utils/signalSemantics.js`
- `utils/signalContractRegistry.js`
- `server.js`
- `services/scoutScannerService.js`
- runtime display, alert, notification, persistence, and route call sites that consume display signal data

Reviewed canonical/offline signal files:

- `validation/canonicalIntelligenceSignalContract.js`
- `validation/intelligenceSignalRegistry.js`
- `validation/signalAlignmentContract.js`
- `validation/signalAlignmentBatch.js`
- `validation/signalAlignmentEngine.js`
- `validation/signalAlignmentReport.js`
- `validation/signalConflictAnalyzer.js`
- `validation/signalAlignmentValidationSuite.js`
- `validation/signalProducerAdapter.js`
- `validation/signalMigrationCore.js`
- `validation/signalMigrationCoreContract.js`
- `validation/signalMigrationAdapterContract.js`
- `validation/signalShadowComparisonCore.js`
- `validation/signalShadowComparisonCoreContract.js`
- per-family `validation/*SignalMigration.js`
- per-family `validation/*ShadowComparison.js`
- Decision Intelligence and Governance consumers that reference canonical Signal artifacts

Reviewed tests and documents:

- `tests/signal-annotation.test.js`
- `tests/signal-semantics.test.js`
- `tests/signal-contract-registry.test.js`
- `tests/production-decision-explanation-ui.test.js`
- `tests/canonical-intelligence-signal-contract.test.js`
- `tests/intelligence-signal-registry.test.js`
- `tests/signal-alignment-*.test.js`
- `tests/signal-migration-*.test.js`
- `tests/signal-shadow-comparison-*.test.js`
- onboarding tests for Grade Premium, Population, Listing Quality, Range-First Valuation, Confidence Calibration, Deal Gate, Evidence Readiness, Identity Parser, False Positive, Canonical Sold Evidence, Production Valuation, Comparable Quality, and Decision Context
- `docs/architecture/intelligence-signal-catalog.md`
- `docs/architecture/signal-framework-stability-baseline.md`
- `docs/architecture/phase-13-intelligence-roadmap.md`
- `docs/architecture/signal-governance-integration.md`
- `docs/architecture/decision-intelligence-*`

Method:

- Static source inspection with exact line references.
- Import and call-site search with `rg`.
- Public API inventory from `module.exports` blocks and source definitions.
- Focused tests with the bundled Node runtime.
- `git diff --check`.
- `git status --short`.

## 3. Architectural Source Rules

Repository source is the implementation source of truth.

Approved Project State v9.0 is the architectural intent source of truth.

If repository and v9.0 differ, this audit documents the discrepancy. It does not reconcile or implement the difference.

File existence is not runtime integration.

Runtime integration is not decision authority.

Offline, validation, shadow, prototype, Governance, and contract-only modules do not gain production authority by being imported by tests or other offline modules.

`Insufficient Source Material` is used only when neither repository source nor v9.0 intent supports a conclusion.

## 4. Verified Files

| File | Current role | Imports/call status | Authority | v9.0 comparison |
| --- | --- | --- | --- | --- |
| `utils/signalContractRegistry.js` | Runtime display contract registry for production/raw signals | Imported by `utils/signalAnnotation.js:3` and `utils/signalSemantics.js:3` | Production Explanation Only | Matches v9.0 boundary: display metadata, not production authority |
| `utils/signalAnnotation.js` | Builds display annotations from runtime raw signal values | Imported by `server.js:39`; called by `server.js:1493-1494` and `server.js:2070` | Production Explanation Only | Matches v9.0 boundary |
| `utils/signalSemantics.js` | Neutralizes non-authoritative buy-like wording and describes display authority | Imported by `server.js:40`; called by `server.js:1443-1450`, `1614`, `1631`, `1664`, `2016`, `2037-2047` | Production Explanation Only | Matches v9.0 boundary |
| `server.js` | Production runtime, display, Deal Gate, alerts, notifications, persistence | Imports runtime signal utilities only; does not import canonical signal contract | Production Authoritative only through Deal Gate | Matches v9.0 boundary |
| `services/scoutScannerService.js` | Production scanner loop | Calls `saveScoutedListing` at `services/scoutScannerService.js:147-151`; no runtime signal utility imports | Production runtime orchestration | Matches v9.0 boundary |
| `validation/canonicalIntelligenceSignalContract.js` | Immutable canonical signal artifact contract | Imported by canonical registry, alignment, migration, comparison, and tests | Offline/Shadow/Advisory | Matches v9.0 boundary |
| `validation/intelligenceSignalRegistry.js` | Offline canonical signal definition registry | Imports canonical signal validation at `validation/intelligenceSignalRegistry.js:16-23` | Offline/Advisory | Matches v9.0 boundary |
| `validation/signalProducerAdapter.js` | First adapter for supplied diagnostic native outputs | Imports canonical signal, registry, and alignment contracts at `validation/signalProducerAdapter.js:15-28` | Offline/Observation Only | Matches v9.0 boundary |
| `validation/signalAlignmentContract.js` | Immutable alignment artifact contract | Imports canonical signal and registry contracts | Offline/Observation Only | Matches v9.0 boundary |
| `validation/signalAlignmentBatch.js` | Immutable alignment batch builder | Imports canonical signal/alignment contracts | Offline/Observation Only | Matches v9.0 boundary |
| `validation/signalAlignmentEngine.js` | Offline orchestration over already-supplied outputs | Imports producer adapter and batch modules at `validation/signalAlignmentEngine.js:7-17` | Offline/Observation Only | Matches v9.0 boundary |
| `validation/signalConflictAnalyzer.js` | Relationship classification for existing alignments | Imports alignment modules; does not resolve conflicts | Offline/Observation Only | Matches v9.0 boundary |
| `validation/signalAlignmentReport.js` | Human-readable immutable signal report | Imports alignment, batch, and conflict modules | Offline/Observation Only | Matches v9.0 boundary |
| `validation/signalAlignmentValidationSuite.js` | End-to-end offline validation suite | Imports registry, alignment, conflict, and report modules | Offline validation | Matches v9.0 boundary |
| `validation/signalMigrationCore.js` | Shared migration lifecycle | Executes wrapper lifecycle over supplied native outputs; no production import | Offline/Shadow Only | Matches v9.0 boundary |
| `validation/signalShadowComparisonCore.js` | Shared native-to-shadow comparison lifecycle | Executes comparison over supplied artifacts; no production import | Offline/Shadow Only | Matches v9.0 boundary |
| `validation/*SignalMigration.js` | Engine-specific signal migrations | Import canonical signal, registry, alignment, and migration core modules | Offline/Shadow Only | Matches v9.0 boundary |
| `validation/*ShadowComparison.js` | Engine-specific shadow comparisons | Import shadow comparison core and canonical/alignment validators | Offline/Shadow Only | Matches v9.0 boundary |
| `validation/decisionIntelligenceArtifactBuilder.js` | Consumes Signal references for offline Decision Intelligence artifact | Normalizes signal refs at `validation/decisionIntelligenceArtifactBuilder.js:266-293` | Offline/Advisory | Matches v9.0 boundary |
| `validation/decisionIntelligenceGovernanceBindingAdapter.js` | Binds Decision Intelligence artifacts into Governance by reference | Builds references and warning/readiness propagation; no production import | Offline Governance Only | Matches v9.0 boundary |

Files verified: 58. This count includes the major runtime signal files, canonical signal framework files, per-family signal migrations and shadow comparisons, directly related Decision Intelligence/Governance consumers, tests, and architecture documents inspected for this audit.

## 5. Production Signal Runtime Map

### Runtime Imports

Verified repository fact:

- `server.js:39` imports `./utils/signalAnnotation`.
- `server.js:40` imports `./utils/signalSemantics`.
- `utils/signalAnnotation.js:3` imports `./signalContractRegistry`.
- `utils/signalSemantics.js:3` imports `./signalContractRegistry`.
- `server.js` does not import `validation/canonicalIntelligenceSignalContract.js`, `validation/intelligenceSignalRegistry.js`, `validation/signalAlignmentEngine.js`, `validation/signalMigrationCore.js`, or canonical per-family signal migrations.

### Raw Signal Collection

Verified repository fact: `server.js:1472-1490` builds raw display signal values:

- `legacy_score`
- `quality_score`
- `quality_bucket`
- `deal_grade`
- `market_confidence`
- `sold_evidence_confidence`
- `intelligence_score`
- `confidence_score`
- `trust_level`
- `roi_recommendation`
- `decision_intelligence`
- `deal_gate`

`server.js:1493-1494` passes these raw values into `signalAnnotation.annotateSignals`.

Inputs are already-produced runtime values from scoring, quality, market intelligence, ROI, Decision Intelligence context, and Deal Gate. No canonical Signal artifact is created in this flow.

### Runtime Display Contracts

Verified repository fact: `utils/signalContractRegistry.js:5-28` defines runtime display categories:

- `SIGNAL_TYPES`: `evidence`, `context`, `financial`, `legacy`, `production_decision`
- `DECISION_ELIGIBILITY`: `none`, `context_only`, `evidence_only`, `decision_support`, `production_decision`
- `DISPLAY_LANGUAGE`: `neutral`, `context_only`, `financial_only`, `evidence_only`, `production_decision`, `legacy_context`

Verified repository fact: `utils/signalContractRegistry.js:30-199` defines 12 display contracts. Only `deal_gate` has `signalType: production_decision` and `decisionEligibility: production_decision` at `utils/signalContractRegistry.js:186-195`.

### Runtime Annotation

Verified repository fact: `utils/signalAnnotation.js:13-29` returns display annotations with:

- `signalId`
- `owner`
- `signalType`
- `decisionEligibility`
- `evidencePolicy`
- `allowedDisplayLanguage`
- `confidenceMeaning`
- `displayPriority`
- `rawValue`

`utils/signalAnnotation.js:32-38` sorts annotations by display priority.

`utils/signalAnnotation.js:41-45` can filter production-decision annotations, which resolves to the Deal Gate display contract.

### Runtime Semantics

Verified repository fact: `utils/signalSemantics.js:5-9` detects buy-like wording.

Verified repository fact: `utils/signalSemantics.js:15-30` neutralizes recommendation labels such as `elite`, `strong buy candidate`, `BUY_NOW`, and other buy-like strings for non-production signals.

Verified repository fact: `utils/signalSemantics.js:41-70` permits production decision language only when the signal contract is `production_decision`. It specifically neutralizes `deal_grade` and `roi_recommendation`.

Verified repository fact: `utils/signalSemantics.js:72-80` maps runtime display signal authority to display strings such as `production_decision`, `financial_context_only`, `evidence_only_non_authoritative`, `legacy_context_only`, and `context_only_non_authoritative`.

### Production Display Output

Verified repository fact: `server.js:1714-1788` builds production decision explanation from Deal Gate only. It sets:

- `source: deal_gate_presentation`
- `authoritativeDecisionSource: deal_gate`
- `decisionType: production_decision`
- `authoritative: true`
- `decision: BUY_NOW`, `REJECTED`, or `UNREVIEWED`

Verified repository fact: `server.js:1816-1840` builds Evidence Readiness display from runtime Decision Intelligence context and sets:

- `authoritativeDecisionSource: deal_gate`
- `productionImpact: none`
- `contextualOnly: true`
- `rawDecisionIntelligencePreserved: true`

Verified repository fact: `server.js:1865-2005` builds unified decision presentation with Deal Gate sections first and all other signals as evidence, financial, market, or legacy context.

Verified repository fact: `server.js:2008-2079` creates the final display object. It sets `authoritativeDecisionSource` to `deal_gate`, derives `authoritativeDecision` from `dealGate.passed`, neutralizes legacy/ROI labels, adds annotations, and preserves canonical identity diagnostics.

### Deal Gate, BUY_NOW, Alerts, Notifications, and Persistence

Verified repository fact: `server.js:2082-2597` implements `dealGate`. `server.js:2535-2556` builds a Deal Gate breakdown with `decisionImpact: none` for the diagnostic breakdown, but `server.js:2561-2568` returns the authoritative production gate result with `decision: BUY_NOW` or `REJECT`.

Verified repository fact: `server.js:2599-2641` calls `scoreListing` and then `dealGate(saved)`.

Verified repository fact: `server.js:2642-2711` records prediction, decision validation, and learning diagnostics using the Deal Gate result.

Verified repository fact: `server.js:2713` persists compact retained listings.

Verified repository fact: `server.js:2716-2757` creates and sends a new alert only when `gate.passed` is true. Runtime signal annotations do not create alerts by themselves.

Verified repository fact: `services/scoutScannerService.js:141-151` obtains marketplace results and calls `saveScoutedListing`; it does not call runtime signal annotation utilities directly.

## 6. Canonical Signal Architecture Map

### Canonical Contract

Verified repository fact: `validation/canonicalIntelligenceSignalContract.js:21-119` defines canonical vocabularies:

- `SIGNAL_TYPES`
- `DECISION_ROLES`
- `AUTHORITY_LEVELS`
- `PRODUCER_CATEGORIES`
- `CONFIDENCE_LEVELS`
- `CONFIDENCE_KINDS`
- `UNCERTAINTY_LEVELS`
- `EVIDENCE_QUALITY_LEVELS`
- `SIGNAL_STATUSES`

Verified repository fact: `validation/canonicalIntelligenceSignalContract.js:121-151` defines required canonical Signal fields, including `productionImpact`, `decisionImpact`, `executionAuthority`, `rawOutput`, `normalizedOutput`, `sourceFingerprint`, and `signalFingerprint`.

Verified repository fact: `validation/canonicalIntelligenceSignalContract.js:386-429` creates immutable canonical Signals. It forces `productionImpact: none`, `decisionImpact: none`, and `executionAuthority: none`.

Verified repository fact: `validation/canonicalIntelligenceSignalContract.js:360-367` determines canonical signal status from blockers, conflicting signals, warnings, or missing raw output.

Verified repository fact: `validation/canonicalIntelligenceSignalContract.js:369-378` determines signal authority while forcing all impact/execution fields to `none`.

Verified repository fact: `validation/canonicalIntelligenceSignalContract.js:492-523` validates that canonical signals and evidence references do not grant production or decision impact.

### Canonical Registry

Verified repository fact: `validation/intelligenceSignalRegistry.js:46-75` requires signal definition fields such as signal name, version, producer, signal type, decision role, authority level, evidence role, expected inputs/outputs, allowed statuses, governance requirements, deprecation status, and fingerprint.

Verified repository fact: `validation/intelligenceSignalRegistry.js:171-213` creates signal definitions and forces `productionImpact`, `decisionImpact`, and `executionAuthority` to `none`.

Verified repository fact: `validation/intelligenceSignalRegistry.js:247-320` validates definitions, including authority and fingerprint integrity.

### Adaptation, Alignment, Batch, Conflict, and Report

Verified repository fact: `validation/signalProducerAdapter.js:33-105` supports `identityParserDiagnostics` and `evidenceReadinessDiagnostics` as supplied native-output producers.

Verified repository fact: `validation/signalProducerAdapter.js:240-260` builds canonical signal input from supplied native output and marks producer metadata with `executesNativeEngine: false`.

Verified repository fact: `validation/signalAlignmentEngine.js:238-271` runs alignment over supplied diagnostics through the producer adapter; it does not execute production engines.

Verified repository fact: `validation/signalAlignmentEngine.js:122-149` summarizes runs with `productionImpact: none`, `decisionImpact: none`, and `executionAuthority: none`.

Verified repository fact: `validation/signalMigrationCore.js:108-203` orchestrates shared migration lifecycle: extract native output, resolve registry definition, build canonical signal, build alignment, create batch, create run, analyze conflicts, create report, verify parity, and return immutable artifacts with no authority.

Verified repository fact: `validation/signalMigrationCore.js:79-99` verifies exact native output parity by comparing supplied native output with canonical/adapted raw output.

Verified repository fact: `validation/signalShadowComparisonCore.js` orchestrates comparison over existing migration artifacts and never repairs mismatches.

### Onboarded Canonical Signal Families

Verified repository fact: `docs/architecture/intelligence-signal-catalog.md:7-18` says six Phase 13 families were cataloged at that point and that no cataloged signal has production authority.

Verified repository fact: the repository now also includes Phase 14 migrations for Evidence Readiness, Identity Parser, False Positive Diagnostics, Canonical Sold Evidence, Production Valuation, Comparable Quality, and Decision Context. These are present as `validation/*SignalMigration.js` and `validation/*ShadowComparison.js` files and import the shared canonical Signal stack.

### Decision Intelligence and Governance Consumers

Verified repository fact: `validation/decisionIntelligenceArtifactBuilder.js:11-25` expects Signal names including identity, evidence readiness, canonical sold evidence, production valuation, comparable quality, confidence calibration, false-positive diagnostics, Deal Gate diagnostics, and decision context.

Verified repository fact: `validation/decisionIntelligenceArtifactBuilder.js:266-293` normalizes Signal references by ID, name, fingerprint, role, status, confidence, evidence quality, warnings, blockers, and provenance.

Verified repository fact: `validation/decisionIntelligenceGovernanceBindingAdapter.js:157-235` binds Decision Intelligence artifacts, pipeline runs, baselines, certifications, registry, lifecycle, review session, and workspace references by reference/fingerprint. It does not import `server.js`.

## 7. Public API Inventory

Runtime display public APIs:

| Module | Public APIs |
| --- | --- |
| `utils/signalAnnotation.js` | `annotateSignal`, `annotateSignals`, `getProductionDecisionAnnotations` |
| `utils/signalSemantics.js` | `hasBuyLikeWording`, `getAllowedSignalLabel`, `describeSignalAuthority` |
| `utils/signalContractRegistry.js` | `SCHEMA_VERSION`, `SIGNAL_TYPES`, `DECISION_ELIGIBILITY`, `DISPLAY_LANGUAGE`, `listSignalContracts`, `getSignalContract`, `hasSignalContract`, `getDecisionEligibleSignals`, `getProductionDecisionSignals` |
| `server.js` audited signal/display exports | `dealGate`, `scoreListing`, `buildDisplayInterpretation`, `buildSignalAnnotationsForDisplay` |

Canonical/offline Signal public APIs inventoried:

| Module | Public API count | Representative APIs |
| --- | ---: | --- |
| `validation/canonicalIntelligenceSignalContract.js` | 22 | `createCanonicalSignal`, `validateCanonicalSignal`, `determineSignalAuthority`, `buildCanonicalSignalFingerprint` |
| `validation/intelligenceSignalRegistry.js` | 19 | `createSignalDefinition`, `createSignalRegistry`, `registerSignalDefinition`, `getSignalDefinition`, `validateSignalRegistry` |
| `validation/signalAlignmentContract.js` | 9 | `createSignalAlignment`, `validateSignalAlignment`, `attachRegistryReference`, `attachCanonicalSignal` |
| `validation/signalAlignmentBatch.js` | 8 | `createAlignmentBatch`, `validateAlignmentBatch`, `filterAlignmentBatch`, `sortAlignmentBatch` |
| `validation/signalAlignmentEngine.js` | 7 | `runSignalAlignment`, `runSignalAlignmentBatch`, `validateSignalAlignmentRun` |
| `validation/signalAlignmentReport.js` | 10 | `createSignalAlignmentReport`, `validateSignalAlignmentReport`, `exportSignalAlignmentReport` |
| `validation/signalConflictAnalyzer.js` | 8 | `analyzeSignalConflicts`, `classifySignalRelationship`, `validateConflictAnalysis` |
| `validation/signalAlignmentValidationSuite.js` | 4 | `runSignalAlignmentValidationSuite`, `validateSignalAlignmentPipeline` |
| `validation/signalProducerAdapter.js` | 5 | `adaptDiagnosticSignal`, `adaptSignalBatch`, `validateAdaptedSignal` |
| `validation/signalMigrationCore.js` | 5 | `executeSignalMigrationLifecycle`, `verifyExactNativeOutputParity` |
| `validation/signalMigrationCoreContract.js` | 5 | `createSignalMigrationArtifact`, `validateSignalMigrationArtifact` |
| `validation/signalMigrationAdapterContract.js` | 5 | `createSignalMigrationAdapter`, `validateSignalMigrationAdapter` |
| `validation/signalShadowComparisonCore.js` | 5 | `executeSignalShadowComparisonLifecycle`, `validateSignalShadowComparisonLifecycle` |
| `validation/signalShadowComparisonCoreContract.js` | 5 | `createSignalShadowComparisonArtifact`, `validateSignalShadowComparisonArtifact` |
| `validation/decisionIntelligenceArtifactBuilder.js` | 7 | `buildDecisionIntelligenceArtifact`, `deriveDecisionEvidence`, `summarizeDecisionArtifact` |
| `validation/decisionIntelligenceGovernanceBindingAdapter.js` | 8 | `buildDecisionIntelligenceGovernanceBinding`, `validateDecisionIntelligenceGovernanceBinding` |

Public APIs inventoried: 132. This count includes runtime display APIs, audited `server.js` signal/display exports, and canonical/offline Signal, Decision Intelligence, and Governance Binding APIs directly relevant to this boundary.

API findings:

- Verified repository fact: runtime display APIs are compact and purpose-built for UI/explanation safety.
- Verified repository fact: canonical APIs are broad, immutable, fingerprinted, and validation-oriented.
- Inference: replacing runtime display APIs with canonical APIs directly would be unsafe without a compatibility mapping because fields, vocabulary, and purposes differ.
- v9.0 architectural intent: no offline or shadow API should gain production authority merely by existing.

## 8. Signal Responsibility Ownership Matrix

| Responsibility | Current owner | Evidence |
| --- | --- | --- |
| Runtime display signal naming | Production signal display utilities | `utils/signalContractRegistry.js:30-199` |
| Canonical signal naming | Canonical Signal Framework | `validation/canonicalIntelligenceSignalContract.js:121-151`; `validation/intelligenceSignalRegistry.js:46-75` |
| Source identity | Both | Runtime uses `owner`; canonical uses `producer`, `source`, `sourceFingerprint` |
| Versioning | Both | Runtime `schemaVersion`; canonical `schemaVersion`, `producerVersion`, `signalVersion`, registry versions |
| Signal type | Both, incompatible vocabularies | Runtime has 5 display types; canonical has broader engine/governance types |
| Decision role | Canonical Signal Framework | `validation/canonicalIntelligenceSignalContract.js:44-52` |
| Decision eligibility | Runtime display utilities | `utils/signalContractRegistry.js:13-19` |
| Authority level | Canonical Signal Framework | `validation/canonicalIntelligenceSignalContract.js:54-63` |
| Display authority label | Runtime display utilities | `utils/signalSemantics.js:72-80` |
| Polarity | Neither as a single canonical field | Inferred from native output, status, warnings, blockers, or Deal Gate |
| Score | Native engines and runtime display | Runtime annotates raw values; canonical preserves raw/normalized output |
| Confidence | Both, different semantics | Runtime `confidenceMeaning`; canonical structured `confidence` and `confidenceLevel` |
| Confidence level | Canonical Signal Framework | `validation/canonicalIntelligenceSignalContract.js:76-83` |
| Status | Both, different semantics | Runtime display status is implicit/sectional; canonical has `available`, `blocked`, `conflicted`, `warning`, `unavailable` |
| Severity | Neither as a shared universal taxonomy | Some diagnostics carry native severity/reason codes |
| Warning propagation | Both | Runtime copies native warnings; canonical has `warnings` arrays and validation warnings |
| Readiness propagation | Both | Runtime Evidence Readiness display; offline DI/Governance readiness fields |
| Evidence basis | Canonical Signal Framework | `validation/canonicalIntelligenceSignalContract.js:303-316` |
| Evidence policy | Runtime display utilities | `utils/signalAnnotation.js:5-10` |
| Explanation | Runtime display utilities and Decision Intelligence artifacts | `server.js:1714-1840`; offline DI builder |
| Display formatting | Production signal display utilities | `utils/signalSemantics.js`; `server.js` display builders |
| Registry ownership | Both, separate registries | `utils/signalContractRegistry.js`; `validation/intelligenceSignalRegistry.js` |
| Schema validation | Canonical Signal Framework | `validateCanonicalSignal`, registry/alignment validators |
| Migration | Canonical Signal Framework | `validation/signalMigrationCore.js`; per-family migrations |
| Persistence | Runtime app store for display fields; offline artifacts for validation | `server.js:2713`; validation modules return artifacts |
| Governance Binding | Decision Intelligence/Governance offline modules | `validation/decisionIntelligenceGovernanceBindingAdapter.js` |
| Decision Intelligence consumption | Both, separate roles | Runtime display consumes engine output; offline DI consumes Signal refs |
| Deal Gate consumption | Production runtime only | `server.js:2082-2597`; canonical Deal Gate signal migration is offline wrapper |

Conclusion: ownership is mostly distinct. The main overlap is terminology and metadata shape, not production authority.

## 9. Vocabulary and Schema Comparison

| Concept | Runtime display vocabulary | Canonical vocabulary | Finding |
| --- | --- | --- | --- |
| Signal type | `evidence`, `context`, `financial`, `legacy`, `production_decision` | `scan`, `parser`, `identity`, `evidence`, `valuation`, `range`, `confidence`, `risk`, `quality`, `grading`, `financial`, `decision`, `notification`, `learning`, `review`, `calibration`, `governance`, `diagnostic`, `context`, `unknown` | Overlap but not identical |
| Decision role/eligibility | `none`, `context_only`, `evidence_only`, `decision_support`, `production_decision` | `authoritative`, `blocking_input`, `supporting_context`, `diagnostic_only`, `review_only`, `none`, `unknown` | Needs compatibility mapping |
| Authority | `production_decision`, `financial_context_only`, `evidence_only_non_authoritative`, `legacy_context_only`, `context_only_non_authoritative` | `production_decision`, `production_context`, `shadow_observation`, `offline_validation`, `governance`, `display_metadata`, `advisory`, `unknown` | Similar terms, different purposes |
| Display language | `neutral`, `context_only`, `financial_only`, `evidence_only`, `production_decision`, `legacy_context` | No direct equivalent | Runtime-owned |
| Signal status | Not a central runtime contract; display derives reviewed/rejected/context values | `available`, `blocked`, `conflicted`, `warning`, `unavailable` | Canonical-owned |
| Alignment status | None | `aligned`, `aligned_with_warnings`, `incomplete`, `definition_missing`, `version_mismatch`, `invalid`, `blocked` | Canonical-only |
| Readiness | `supported_context`, `limited_context`, `cautious_context`, `not_ready`, `unknown` in Evidence Readiness display | DI/Governance readiness fields and validation statuses | Overlap requires mapping |
| Confidence | Raw numeric and prose `confidenceMeaning` | structured `confidence`, `confidenceLevel`, `confidence.kind`, `confidence.scale`, `confidence.basis` | Related but not interchangeable |
| Evidence quality | Runtime sold evidence count/policy; native quality data | `strong`, `adequate`, `limited`, `weak`, `insufficient`, `not_applicable`, `unknown` | Canonical is richer |
| Unknown values | Runtime often uses `null`, empty string, or `unknown` | explicit `unknown` constant | Mapping needed |
| Warning structures | Arrays/strings on native runtime fields and display explanations | arrays of warning reason strings plus validation warnings | Compatible with mapping |
| Reason codes | Native/runtime-specific strings | validation `reasonCodes`, migration mismatch codes | Related but not unified |

Discrepancy: vocabulary is intentionally non-identical. That creates future integration risk if canonical fields are connected to runtime display without a documented compatibility map.

## 10. Warning and Readiness Comparison

Runtime warning/readiness facts:

- `server.js:2630-2631` persists `qualityReasons` and `qualityWarnings` from scoring.
- `server.js:2739-2741` copies `riskLevel`, `qualityReasons`, and `qualityWarnings` into alerts.
- `server.js:1816-1840` preserves Decision Intelligence blockers, cautions, conflicts, supporting context, summary, and raw Decision Intelligence in Evidence Readiness display.
- `server.js:1834-1837` explicitly states Evidence Readiness is contextual only and cannot override Deal Gate.

Canonical warning/readiness facts:

- `validation/canonicalIntelligenceSignalContract.js:412-413` stores `warnings` and `blockers`.
- `validation/canonicalIntelligenceSignalContract.js:360-367` treats blockers, conflicts, warnings, and missing raw output as status drivers.
- `validation/signalAlignmentEngine.js:101-119` identifies registry lookup failures and blocked signals.
- `validation/decisionIntelligenceGovernanceBindingAdapter.js` collects warning propagation and separates review readiness from certification readiness.

v9.0 intent: warnings and readiness must remain visible, non-authoritative, and never silently upgraded.

Finding: both systems preserve warnings and readiness, but they do so with separate vocabularies. No verified source shows warnings being silently discarded in the production signal display path or canonical path. No verified source shows readiness being converted into approval.

## 11. Authority Verification

| Authority assertion | Result | Evidence |
| --- | --- | --- |
| Deal Gate remains the sole production recommendation authority | Verified | `server.js:2082-2597`; `server.js:2561-2568` |
| Runtime display utilities do not independently create BUY_NOW authority | Verified | `utils/signalSemantics.js:41-70`; `tests/signal-semantics.test.js:64-68` |
| Canonical signal artifacts do not independently create BUY_NOW authority | Verified | `validation/canonicalIntelligenceSignalContract.js:386-429`, `492-523`; tests at `tests/canonical-intelligence-signal-contract.test.js:109-130` |
| Decision Intelligence remains contextual/offline/shadow according to wiring | Verified | Runtime Evidence Readiness display at `server.js:1816-1840`; offline DI artifacts under `validation/decisionIntelligence*` |
| Governance Binding remains offline | Verified | `validation/decisionIntelligenceGovernanceBindingAdapter.js`; no `server.js` import found |
| Signal confidence does not silently become valuation confidence | Verified | Runtime confidence dimensions separate valuation, market, sold evidence, and decision confidence at `server.js:1590-1694`; canonical confidence is structured metadata |
| Signal status does not silently become Deal Gate approval | Verified | Deal Gate approval derives from `dealGate` rules, not canonical status |
| Missing signals do not silently become positive evidence | Verified | Runtime annotation ignores unknown signal IDs at `utils/signalAnnotation.js:13-17`; canonical missing raw output becomes `unavailable`/warning at `validation/canonicalIntelligenceSignalContract.js:360-367`, `615-617` |
| Warnings are not silently discarded | Verified | Runtime and canonical warning fields are preserved in inspected paths |
| Readiness is not silently upgraded | Verified | Evidence Readiness is contextual only at `server.js:1834-1837`; Governance readiness is offline only |

Safety conclusion: no silent authority escalation was found.

## 12. Compatibility and Migration Findings

Compatibility aliases and transitional APIs:

- `decisionEngine.js` has multiple aliases (`evaluateDecision`, `makeDecision`, `decide`, `getDecision`) outside the direct signal boundary; this remains a broader legacy compatibility issue.
- Runtime display has `decision_intelligence` as a display signal ID, while canonical Signal families use names such as `evidence.readiness.diagnostics`, `decision.deal_gate.diagnostics`, and `valuation.production.output`.
- Runtime display uses `owner`; canonical uses structured `producer`.
- Runtime display uses `decisionEligibility`; canonical uses `decisionRole` and `authorityLevel`.
- Runtime display allows only `deal_gate` to retain production decision language. Canonical may wrap Deal Gate native output but keeps wrapper authority neutral.
- Runtime display preserves raw fields in UI shape. Canonical migrations preserve raw native output inside immutable artifacts.

Consumers that require current output shapes:

- `server.js` display helpers and routes expect `display` fields from `buildDisplayInterpretation`.
- `tests/signal-semantics.test.js` locks label neutralization and Deal Gate-only decision language.
- `tests/production-decision-explanation-ui.test.js` locks Deal Gate-first display hierarchy and raw value preservation.
- canonical Signal tests lock immutable, fingerprinted, advisory-only artifact shape.
- Signal onboarding tests lock parity between native output and wrappers.

Migration risk:

- Replacing runtime display utilities with canonical Signal objects directly would risk UI shape breakage and authority ambiguity.
- Replacing canonical artifacts with runtime display annotations would lose immutable fingerprints, registry definitions, evidence references, migration lifecycle, shadow comparison, and Governance compatibility.

Inference: the lowest-risk next work is a documentation/specification phase for compatibility mapping, not consolidation or runtime integration.

## 13. Test Coverage

Relevant test coverage verified by source inspection:

- `tests/signal-semantics.test.js:9-21` verifies quality/context signals cannot emit buy-like wording.
- `tests/signal-semantics.test.js:23-32` verifies ROI labels use neutral financial language.
- `tests/signal-semantics.test.js:34-43` verifies legacy grade actions are labeled as legacy context.
- `tests/signal-semantics.test.js:45-62` verifies evidence-only signals remain non-authoritative.
- `tests/signal-semantics.test.js:64-68` verifies Deal Gate is the only production-decision signal allowed to keep decision language.
- `tests/production-decision-explanation-ui.test.js:77-116` verifies rejected listings show authoritative Deal Gate rejection and failed reasons first.
- `tests/production-decision-explanation-ui.test.js:118-133` verifies passed listings show `BUY_NOW` through Deal Gate.
- `tests/production-decision-explanation-ui.test.js:153-180` verifies display explanation is additive and preserves raw Deal Gate and value fields.
- `tests/canonical-intelligence-signal-contract.test.js:94-107` verifies canonical Signal public APIs.
- `tests/canonical-intelligence-signal-contract.test.js:109-130` verifies minimum canonical Signals remain immutable and non-authoritative with explicit unknown values.
- `tests/canonical-intelligence-signal-contract.test.js:132-145` verifies deterministic raw output preservation.

Focused tests run for this audit:

- `/Users/daltonmarsh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/signal-annotation.test.js tests/signal-semantics.test.js tests/signal-contract-registry.test.js tests/production-decision-explanation-ui.test.js tests/canonical-intelligence-signal-contract.test.js tests/intelligence-signal-registry.test.js tests/signal-alignment-contract.test.js tests/signal-alignment-engine.test.js tests/signal-alignment-report.test.js tests/signal-alignment-validation-suite.test.js`

## 14. Architectural Discrepancies

| ID | Finding | Repository fact | v9.0 intent | Classification | Recommended handling |
| --- | --- | --- | --- | --- | --- |
| P18.1A-D001 | Runtime signal registry and canonical Signal registry are separate | `utils/signalContractRegistry.js` and `validation/intelligenceSignalRegistry.js` define different registries | Signals should remain governed and explainable without authority drift | Transitional compatibility architecture | Create compatibility mapping spec |
| P18.1A-D002 | Runtime and canonical vocabularies differ | Runtime uses `decisionEligibility`; canonical uses `decisionRole` and `authorityLevel` | Unknowns and authority boundaries must remain explicit | Vocabulary mismatch | Map terms before integration |
| P18.1A-D003 | Runtime Evidence Readiness and canonical Signal readiness/status are different concepts | `server.js:1816-1840` vs canonical statuses | Readiness must not be silently upgraded | Status ambiguity | Map readiness vocabulary |
| P18.1A-D004 | Runtime confidence display and canonical confidence contract differ | `server.js:1590-1694` vs `validation/canonicalIntelligenceSignalContract.js:239-275` | Confidence should remain explainable and not imply authority | Semantic mismatch | Map confidence semantics |
| P18.1A-D005 | Canonical Signal framework is not production-wired | No `server.js` import of validation Signal modules | Offline/shadow systems should not gain authority without governance | Intended boundary, not defect | No runtime integration now |
| P18.1A-D006 | Runtime display annotations are not immutable canonical artifacts | `utils/signalAnnotation.js:13-29` returns display metadata only | Future governance needs immutable artifacts | Intentional architecture split | Preserve both until mapping exists |
| P18.1A-D007 | `decision_intelligence` runtime display ID is broader than canonical DI artifact inputs | Runtime displays raw Decision Intelligence; offline DI consumes many Signal refs | Future Governance binding requires explicit provenance | Naming overlap | Clarify in mapping |

Architectural discrepancies: 7.

## 15. Safety Findings

- Verified repository fact: only `deal_gate` is registered as a production decision signal in `utils/signalContractRegistry.js:186-195`.
- Verified repository fact: non-production runtime labels are neutralized by `utils/signalSemantics.js:15-70`.
- Verified repository fact: Display `BUY_NOW` is derived from Deal Gate pass state at `server.js:1746-1747` and `server.js:2021-2023`.
- Verified repository fact: alerts are created only when `gate.passed` is true at `server.js:2716-2757`.
- Verified repository fact: canonical Signal creation forces `productionImpact`, `decisionImpact`, and `executionAuthority` to `none` at `validation/canonicalIntelligenceSignalContract.js:401-403`.
- Verified repository fact: canonical validation rejects authority violations at `validation/canonicalIntelligenceSignalContract.js:492-523`.
- Verified repository fact: canonical migrations preserve native output and mark `nativeEngineExecuted: false` at `validation/signalMigrationCore.js:150-178`.
- v9.0 intent: no Signal, shadow output, Governance artifact, Decision Intelligence artifact, Investment Decision output, or Capital Score output may bypass Deal Gate or create BUY_NOW authority.

Safety conclusion: no material architectural conflict was found. The boundary is safe as long as no one treats canonical Signal status, readiness, or confidence as runtime decision approval.

## 16. Recommended Next Phase

Recommended next phase: **Phase 18.1B - Runtime-to-Canonical Signal Compatibility Mapping Specification**.

Objective:

- Document a non-runtime, non-authoritative compatibility mapping between runtime display signal contracts and canonical Signal definitions.

Scope:

- Map runtime `signalId` to canonical `signalName` where a safe relationship exists.
- Map `SIGNAL_TYPES` to canonical `SIGNAL_TYPES`.
- Map `DECISION_ELIGIBILITY` to canonical `DECISION_ROLES` and `AUTHORITY_LEVELS`.
- Map runtime confidence display dimensions to canonical confidence semantics.
- Map runtime Evidence Readiness display values to canonical status/readiness concepts.
- Map warning and reason-code structures without suppressing unknowns.
- Explicitly mark unmappable fields as unmapped rather than inventing equivalence.

Non-goals:

- No runtime integration.
- No canonical Signal promotion.
- No Signal migration changes.
- No Deal Gate changes.
- No BUY_NOW changes.
- No notification changes.
- No production persistence changes.

Why this phase instead of consolidation:

- The systems are both doing valid work.
- Their overlap is semantic, not authoritative.
- Consolidation now would risk breaking production display shape or weakening offline artifact guarantees.
- A mapping specification is the smallest safe next step.

## 17. Final Determination

**B. The systems require a documented compatibility mapping but no runtime integration.**

Support:

- Production signal display utilities own runtime presentation safety.
- Canonical Signal Framework owns offline/shadow immutable evidence artifacts.
- Deal Gate remains the only production recommendation authority.
- BUY_NOW remains downstream of Deal Gate and human-reviewed.
- Canonical Signals do not influence production runtime.
- Decision Intelligence and Governance Binding remain contextual/offline unless explicitly promoted.
- No silent authority escalation was found.
- Vocabulary overlap is real and should be documented before any future integration.

This audit does not recommend consolidation, migration, or shadow integration as the next step. It recommends a compatibility mapping specification only.
