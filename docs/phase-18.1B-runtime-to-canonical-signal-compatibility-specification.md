# Phase 18.1B - Runtime-to-Canonical Signal Compatibility Mapping Specification

## 1. Executive Summary

This specification defines the authoritative compatibility boundary between CardHawk's production runtime signal/display system and the offline Canonical Intelligence Signal Framework.

Final specification determination: **B. Compatibility is sufficiently defined for an offline adapter and conformance phase.**

The systems are compatible only through an explicit, non-authoritative, warning-preserving, readiness-preserving translation boundary. They are not interchangeable. Runtime display fields are presentation and production explanation metadata. Canonical Signals are immutable offline/shadow evidence artifacts. Neither system may silently assume the authority, vocabulary, schema, or lifecycle semantics of the other.

The production runtime system remains unchanged:

- Deal Gate remains the sole production recommendation authority.
- BUY_NOW remains derived only from Deal Gate pass state and remains human-review oriented.
- Runtime display annotations remain display-safe wrappers around already-produced runtime values.
- Runtime labels remain guarded against non-authoritative buy-like wording.
- Alerts and notifications remain gated by `gate.passed`.

The canonical Signal system remains unchanged:

- Canonical Signals remain immutable, fingerprinted, advisory/offline/shadow artifacts.
- Canonical migrations consume already-generated native outputs.
- Canonical migrations do not execute production engines.
- Canonical status, confidence, readiness, and decision roles do not grant runtime authority.
- Governance and Decision Intelligence bindings remain offline/non-authoritative under current wiring.

This document does not implement an adapter, schema, registry, migration, or runtime integration. It defines the compatibility requirements that a future offline adapter and conformance test phase would need to satisfy.

## 2. Purpose and Scope

The purpose of this specification is to prevent semantic drift between two intentionally separate systems:

1. The production runtime signal/display system implemented by `utils/signalContractRegistry.js`, `utils/signalAnnotation.js`, `utils/signalSemantics.js`, and runtime display builders in `server.js`.
2. The offline Canonical Intelligence Signal Framework implemented under `validation/`, including canonical signal contracts, registries, alignments, migrations, shadow comparisons, reports, Decision Intelligence artifacts, and Governance bindings.

Scope includes:

- Field-level compatibility.
- Vocabulary compatibility.
- Warning preservation.
- Readiness preservation.
- Confidence preservation.
- Authority boundary preservation.
- Transformation categories.
- Future adapter contract requirements.
- Migration and promotion gates.

Scope excludes:

- Runtime integration.
- Signal migration code.
- Mapping code.
- Production adapter code.
- Server changes.
- Deal Gate changes.
- BUY_NOW changes.
- Alert or notification changes.
- Persistence changes.
- Canonical schema changes.
- Existing architecture-document changes.
- Production promotion.

## 3. Authoritative Sources

Authoritative architecture sources:

- Approved Project State v9.0, supplied in the CardHawk Codex conversation, remains the architectural intent source of truth.
- `docs/phase-18.1A-runtime-signal-canonical-boundary-audit.md` is the verified boundary audit for this phase.

Runtime source files reviewed:

- `utils/signalContractRegistry.js`
- `utils/signalAnnotation.js`
- `utils/signalSemantics.js`
- `server.js`
- `services/scoutScannerService.js` as the production scanner caller of `saveScoutedListing`

Canonical/offline source files reviewed:

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
- Per-family `validation/*SignalMigration.js`
- Per-family `validation/*ShadowComparison.js`
- Decision Intelligence and Governance Binding consumers identified in Phase 18.1A

Relevant test sources reviewed conceptually through Phase 18.1A:

- Runtime signal annotation, semantics, and registry tests.
- Production decision explanation UI tests.
- Canonical Signal, Registry, Alignment, Migration, Shadow Comparison, and Signal stack tests.
- Decision Intelligence and Governance tests that consume Signal references.

## 4. Compatibility Principles

1. Runtime behavior remains unchanged.

   Compatibility mapping is descriptive only. It cannot change display output, persisted listings, alerts, scanner flow, scoring, valuation, Deal Gate, BUY_NOW, or notifications.

2. Canonical Signals remain non-authoritative.

   Canonical `decisionRole`, `authorityLevel`, `status`, `confidence`, and `evidenceQuality` fields remain offline/shadow/advisory metadata unless a future governed production phase explicitly changes that boundary.

3. Compatibility does not equal integration.

   A field being compatible means a future adapter could represent it safely. It does not mean either system currently consumes the other.

4. Compatibility does not equal migration completion.

   A mapping specification is not a runtime migration, not a shadow integration, and not a public API replacement.

5. Compatibility does not grant production approval.

   No runtime or canonical field may create `BUY_NOW`, override `REJECT`, satisfy Deal Gate, or send an alert.

6. Semantic meaning may not silently change.

   Similar names are not sufficient. For example, runtime `decisionEligibility` is a display/contract policy, while canonical `decisionRole` is an offline artifact role.

7. Missing data may not become positive evidence.

   `null`, empty string, missing fields, and canonical `unknown` must remain missing/unknown unless the original source explicitly supports a more specific value.

8. Warnings may not be discarded.

   Runtime warning strings, warning arrays, cautions, conflicts, blockers, failed reasons, validation warnings, and unknown warning codes must remain visible.

9. Readiness may not be upgraded.

   Runtime readiness such as `supported_context` is contextual only. It cannot be transformed into approval, eligibility, or evidence sufficiency beyond its verified source meaning.

10. Confidence may not be reinterpreted as valuation confidence.

   Runtime market confidence, sold evidence support, Decision Intelligence confidence, valuation confidence, and canonical structured confidence are distinct unless a future adapter records the exact source and basis.

11. Status may not be reinterpreted as Deal Gate approval.

   Canonical `available`, `warning`, `blocked`, or alignment statuses cannot be mapped to Deal Gate pass/fail or BUY_NOW.

12. Native outputs remain preserved.

   Any future adapter must preserve original runtime/native values in canonical `rawOutput` or equivalent source-artifact fields with deterministic fingerprints.

## 5. System Boundary Summary

Runtime production signal/display system:

- Owns display contract metadata for 12 runtime signal IDs.
- Owns UI-safe labels and neutralization of buy-like wording.
- Owns runtime display annotations.
- Owns production decision presentation sourced from Deal Gate.
- Owns Evidence Readiness display as contextual-only presentation.
- Owns alert creation only through Deal Gate pass state.
- Does not create canonical Signal artifacts.
- Does not import canonical Signal framework modules.

Offline Canonical Intelligence Signal Framework:

- Owns immutable canonical Signal artifacts.
- Owns canonical Signal definitions and registries.
- Owns alignment, batch, run, conflict, report, migration, and shadow comparison artifacts.
- Owns native-output parity validation for offline/shadow migrations.
- Owns Decision Intelligence and Governance artifact references.
- Does not execute production engines.
- Does not import `server.js`.
- Does not grant production authority.

Boundary rule:

Runtime fields may be copied or represented inside canonical wrappers only as preserved evidence. Canonical fields may inform future offline review only. Neither direction may create production authority.

## 6. Compatibility Classification Definitions

| Classification | Definition | Allowed use |
| --- | --- | --- |
| DIRECT | Source field can be copied with the same semantic meaning and no transformation beyond cloning. | Only when type, meaning, and authority are identical. |
| DERIVED | Target field can be computed from source fields while preserving source provenance and reason code. | Only when derivation is deterministic and documented. |
| CONDITIONAL | Field can map only under specified signal family, source, value, or authority conditions. | Must fail closed to `unknown`, warning, or unmapped when conditions are not met. |
| ONE_WAY_ONLY | Runtime value may be represented in canonical evidence, or canonical value may be displayed offline, but reverse use is unsafe. | Must not be used to drive runtime decisions. |
| INTENTIONALLY_UNMAPPED | Field exists in one system but should not be mapped because the other system has no equivalent responsibility. | Preserve as metadata only when necessary. |
| INCOMPATIBLE | Field names or values appear related but have materially different semantics. | Do not transform. Preserve only as raw source data. |
| LEGACY_ALIAS | Runtime field is a legacy display alias for a newer or broader canonical concept. | Must preserve alias provenance and avoid implying schema equivalence. |

## 7. Complete Field Mapping Matrix

The following matrix is normative for future compatibility work. It does not describe implemented mapping code.

| ID | Runtime field name | Canonical field name | Runtime meaning | Canonical meaning | Classification | Transformation required | Allowed fallback | Information-loss risk | Authority risk | Warning/readiness implications | Migration notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-01 | `signalId` | `signalId`, `signalName` | Runtime display contract ID such as `deal_gate` or `quality_score`. | Immutable artifact identity and human-readable canonical signal name. | LEGACY_ALIAS | Preserve runtime ID as alias; derive canonical name only from approved registry definition. | Preserve runtime `signalId`; canonical name `unknown` if no definition. | Medium: runtime IDs are display-oriented. | Medium: `deal_gate` name resembles authority. | Missing registry definition must produce warning. | Future adapter must keep runtime ID in provenance. |
| F-02 | `owner` | `producer.name` | Runtime display owner string such as `server.dealGate`. | Structured producer identity. | DERIVED | Parse or copy owner into producer name; optionally split module/function only if exact. | Producer fields `unknown`. | Low. | Low. | None. | Preserve original owner verbatim in metadata. |
| F-03 | `owner` | `producer.module`, `producer.functionName` | Compact runtime owner string. | Structured module and function metadata. | CONDITIONAL | Split only when owner format is unambiguous. | `unknown`. | Medium. | Low. | None. | Do not infer module paths not present in source. |
| F-04 | `schemaVersion` | `schemaVersion` | Runtime display registry schema version. | Canonical artifact schema version. | INCOMPATIBLE | No direct mapping. Preserve runtime version as source metadata. | Canonical schema remains canonical default. | High if treated as same schema. | Medium. | Version mismatch warning required if compared. | Runtime `1.0.0` and canonical `1.0.0` are not interchangeable. |
| F-05 | `schemaVersion` | `producerVersion` | Runtime contract version. | Version of signal producer. | DERIVED | May be used as producer version only for runtime display utility provenance. | `unknown`. | Medium. | Low. | None. | Must label as runtime display contract version. |
| F-06 | `signalType` | `signalType` | Runtime display category. | Canonical evidence/engine/governance category. | CONDITIONAL | Translate using vocabulary matrix. | `unknown`. | Medium. | Medium. | Unknown category must warn. | `production_decision` requires special authority guard. |
| F-07 | `decisionEligibility` | `decisionRole` | Runtime display eligibility/language policy. | Canonical role in offline decision analysis. | CONDITIONAL | Translate only to non-authoritative roles except documented Deal Gate raw evidence. | `none` or `unknown`. | High. | High. | Never upgrade readiness or approval. | `production_decision` maps to preserved raw role only, not runtime authority. |
| F-08 | `decisionEligibility` | `authorityLevel` | Runtime display policy. | Canonical authority metadata. | CONDITIONAL | Runtime display signals generally map to `display_metadata` or `advisory`; Deal Gate wrapper remains non-authoritative. | `advisory`. | High. | High. | Authority warning on escalation. | Canonical `productionImpact` remains `none`. |
| F-09 | `allowedDisplayLanguage` | No direct canonical field | Runtime display wording policy. | No canonical equivalent. | INTENTIONALLY_UNMAPPED | Preserve as metadata if needed. | Omit from canonical normalized fields. | Low. | Medium if mistaken for authority. | None. | Runtime-only presentation guard. |
| F-10 | `confidenceMeaning` | `confidence.basis` | Human explanation of what runtime value means. | Structured confidence basis. | DERIVED | Copy text into confidence basis or metadata. | `unknown`. | Low. | Medium if misread as confidence value. | Missing basis warning optional. | Do not convert prose into numeric confidence. |
| F-11 | `rawValue` | `rawOutput` | Already-produced runtime value for display annotation. | Preserved native output. | DIRECT | Deep clone. | `unknown` only if runtime value missing. | Low. | Low if raw only. | Missing raw output may make canonical status `unavailable`. | Must be fingerprinted before/after wrapping. |
| F-12 | `rawValue` | `normalizedOutput` | Display annotation source value. | Optional normalized representation. | CONDITIONAL | Normalize only with approved adapter rules. | Preserve `rawOutput`; set normalized output `unknown`. | Medium. | Medium. | Normalization warnings must be retained. | Never overwrite raw output. |
| F-13 | `requiresTrueSold` | `evidenceRequirements.requiresTrueSold` | Display evidence policy. | Canonical registry evidence requirement. | DIRECT | Copy boolean. | `unknown` if contract missing. | Low. | Medium if used as approval. | Missing policy warning. | Requirement is not evidence satisfaction. |
| F-14 | `allowsActiveEvidence` | `evidenceRequirements.allowsActiveEvidence` | Whether active listings may appear in runtime context. | Registry-level evidence permission. | DIRECT | Copy boolean. | `unknown`. | Low. | Medium. | None. | Active context must not become sold evidence. |
| F-15 | `allowsFallbackEvidence` | `evidenceRequirements.allowsFallbackEvidence` | Whether fallback evidence is allowed in display context. | Registry-level evidence permission. | DIRECT | Copy boolean. | `unknown`. | Low. | Medium. | None. | Permission is not proof fallback was used. |
| F-16 | `allowsFallbackEvidence` | `evidenceBasis.fallbackUsed` | Runtime policy flag. | Actual evidence-basis fact. | INCOMPATIBLE | Prohibited. Preserve policy only. | `unknown`. | High. | High. | Must not upgrade evidence readiness. | Policy cannot become observed evidence. |
| F-17 | `displayPriority` | `metadata.displayPriority` | Runtime display ordering. | Canonical artifact metadata. | ONE_WAY_ONLY | Copy only as metadata. | Omit. | Low. | Low. | None. | Canonical sorting remains separate. |
| F-18 | Display label fields | `normalizedOutput.displayLabel` | UI labels after neutralization. | Optional normalized display metadata. | DERIVED | Copy post-guard label with source field name. | `unknown`. | Medium. | High for buy-like labels. | Label warning if neutralized. | Must not replace canonical signal name. |
| F-19 | `describeSignalAuthority()` output | `authorityLevel` | Runtime display authority phrase. | Canonical authority category. | CONDITIONAL | Translate only through authority vocabulary matrix. | `advisory` or `unknown`. | Medium. | High. | Authority warnings on unsupported values. | `production_decision` display label does not grant canonical execution authority. |
| F-20 | `authoritativeDecisionSource` | `metadata.authoritativeDecisionSource` | Runtime source of production decision, normally `deal_gate`. | Provenance metadata. | ONE_WAY_ONLY | Preserve as metadata. | `unknown`. | Low. | High if mapped to authority. | None. | May never set canonical execution authority. |
| F-21 | `productionImpact` | `productionImpact` | Runtime display sections may mark contextual-only impact as `none`. | Canonical authority boundary field. | DIRECT | Copy only when value is exactly `none`. | Force canonical `none`. | Low. | High for non-`none`. | Any non-`none` is violation. | Future adapter must reject escalation. |
| F-22 | `recommendationImpact` | `decisionImpact` | Runtime display explanation of Deal Gate outcome such as `approved_by_deal_gate`. | Canonical authority boundary field, forced `none`. | INCOMPATIBLE | Prohibited. Preserve as raw/metadata only. | Canonical `decisionImpact: none`. | High. | Critical. | None. | Never map to canonical decision impact. |
| F-23 | `decision` | `rawOutput.decision` | Runtime Deal Gate/display decision values. | Preserved native output field. | ONE_WAY_ONLY | Preserve inside raw output. | `unknown`. | Medium. | Critical if mapped to status/approval. | Rejection reasons must remain visible. | Only Deal Gate runtime may produce BUY_NOW authority. |
| F-24 | `passed`, `approved`, `pass`, `shouldBuy`, `buyNowAllowed` | `rawOutput` | Deal Gate boolean aliases. | Preserved native output fields. | ONE_WAY_ONLY | Preserve all aliases exactly. | `unknown`. | Low if raw preserved. | Critical if used by canonical adapter. | Failed reasons must remain blockers/raw. | Alias consistency can be validated offline only. |
| F-25 | `dealGateBreakdown.rules` | `normalizedOutput.ruleBreakdown` | Runtime rule audit for Deal Gate. | Optional normalized representation. | DERIVED | Copy rule records and preserve raw breakdown. | `unknown`. | Medium. | High if rule pass becomes approval. | Failed rule reasons must become blockers or raw warnings. | Preserve order and rule IDs. |
| F-26 | `failedReasons`, `rejectionReasons`, `reasons` | `blockers`, `warnings`, `normalizedOutput.failedReasons` | Runtime reasons blocking Deal Gate or explaining rejection. | Canonical blockers/warnings and normalized evidence. | DERIVED | Copy strings to normalized output; use blockers only when source is blocking. | Empty array if verified empty, otherwise `unknown`. | Medium. | High. | Blocking semantics must be preserved. | Do not convert missing reasons into pass. |
| F-27 | `passedReasons`, `positives` | `normalizedOutput.passedReasons`, `supportingSignals` | Runtime positive Deal Gate explanations. | Supporting context or normalized output. | CONDITIONAL | Copy to normalized output; supportingSignals only if references are real Signal refs. | Empty array if verified empty, otherwise `unknown`. | Medium. | High. | Positive context cannot erase warnings. | Do not map positives to approval. |
| F-28 | `qualityWarnings` | `warnings` | Runtime/native quality warning strings. | Canonical warning array. | CONDITIONAL | Copy warning strings verbatim where source is known. | Empty array only if source explicitly empty. | Low. | Medium. | Must preserve unknown warning codes. | Preserve original warning container in raw output. |
| F-29 | `cautionSignals` | `warnings` | Decision Intelligence caution strings. | Canonical warnings. | DERIVED | Copy to warnings with provenance. | `unknown` or empty only if explicit. | Low. | Medium. | Cautions must not be dropped. | May also remain in normalized output. |
| F-30 | `conflicts` | `conflictingSignals`, `normalizedOutput.conflicts` | Runtime Decision Intelligence conflict descriptions. | Canonical conflicting signal references or normalized conflicts. | CONDITIONAL | Use `conflictingSignals` only when signal refs/fingerprints exist; otherwise normalized output. | `unknown`. | Medium. | Medium. | Conflict state may drive canonical status `conflicted`. | Do not invent signal references. |
| F-31 | `supportingSignals` | `supportingSignals`, `normalizedOutput.supportingContext` | Runtime supporting context strings or objects. | Canonical signal references. | CONDITIONAL | Use canonical references only with ID/fingerprint; otherwise preserve as normalized context. | `unknown`. | Medium. | Medium. | Supporting context cannot override blockers. | Do not infer fingerprints. |
| F-32 | `blockers` | `blockers` | Runtime Decision Intelligence blocker strings. | Canonical blocker strings. | DIRECT | Copy strings verbatim. | Empty only if explicitly empty. | Low. | Medium. | Blockers may drive canonical `blocked`. | Blockers cannot become Deal Gate rejection unless source is Deal Gate. |
| F-33 | `evidenceReadiness` | `normalizedOutput.readiness` | Runtime contextual Evidence Readiness value. | Preserved normalized readiness value. | ONE_WAY_ONLY | Copy as readiness metadata. | `unknown`. | Low. | High if upgraded. | Readiness cannot become approval. | Keep `contextualOnly` reason. |
| F-34 | `overallReadiness` | `status` | Runtime/native readiness posture. | Canonical signal lifecycle status. | INCOMPATIBLE | Prohibited direct mapping. | Canonical status determined by canonical rules. | High. | High. | Prevent readiness upgrade. | Readiness can inform normalized output only. |
| F-35 | `dealGateAlignment` | `relationshipSummary` | Display comparison between Evidence Readiness and Deal Gate. | Canonical relationship summary. | CONDITIONAL | Map only as relationship metadata, not conflict resolution. | `unknown`. | Medium. | High. | Conflicting alignment remains visible. | Cannot change Deal Gate. |
| F-36 | `soldEvidenceCount` | `evidenceBasis.trueSoldCount` | Runtime display count selected from several sources. | Canonical count of true sold evidence. | DERIVED | Copy only if source confirms true sold count; otherwise preserve in normalized output. | `unknown`; never zero unless verified zero. | Medium. | High. | Missing count cannot become sufficient evidence. | Source path must be recorded. |
| F-37 | `compCount` | `evidenceBasis.trueSoldCount` | Runtime comp count, not always true sold evidence. | Canonical true sold count. | CONDITIONAL | Map only when comp source is true sold eligible. | `unknown`. | High. | High. | Evidence sufficiency cannot be inferred. | Active/aggregate comps are not sold evidence. |
| F-38 | `marketConfidence` | `confidence` | Runtime market context confidence. | Canonical structured confidence. | CONDITIONAL | Use `kind: reported`, scale only if verified. | `unknown`. | Medium. | High. | Confidence cannot approve purchase. | Preserve confidence meaning and source. |
| F-39 | `confidenceScore` | `confidence` | Market Intelligence confidence score. | Canonical structured confidence. | CONDITIONAL | Use only for its native signal family. | `unknown`. | Medium. | High. | Low confidence may warn; high confidence cannot approve. | Do not merge with valuation confidence. |
| F-40 | Runtime numeric confidence bands | `confidenceLevel` | Runtime may use scores without universal level. | Canonical `high`, `moderate`, `low`, etc. | DERIVED | Derive only with adapter-specific thresholds and reason code. | `unknown`. | High. | Medium. | Derived level warning if thresholds are adapter-defined. | Thresholds require fixture coverage. |
| F-41 | `valuationConfidence` | `confidence` | Runtime valuation confidence dimension. | Canonical confidence of the specific valuation signal. | CONDITIONAL | Map only to valuation signal wrapper. | `unknown`. | Medium. | High. | Cannot become market/evidence confidence. | Preserve valuation provenance. |
| F-42 | Native `severity` | `warnings`, `metadata.severity` | Diagnostic severity where present. | Canonical warnings/metadata; no universal severity field. | CONDITIONAL | Preserve severity verbatim; optionally normalize warning severity metadata. | `unknown`. | Medium. | Medium. | Severity must not be discarded. | No global canonical severity taxonomy is implemented. |
| F-43 | Native `status` | `normalizedOutput.nativeStatus`, `status` | Engine-specific status. | Canonical signal status. | CONDITIONAL | Preserve native status; canonical status only via canonical rules. | `unknown`. | High. | High. | Native blocked/warning may inform canonical status. | Do not translate pass-like status to approval. |
| F-44 | Native engine status | `metadata.nativeEngineStatus` | Engine-specific execution/status output already produced. | Source metadata. | ONE_WAY_ONLY | Preserve verbatim. | `unknown`. | Low. | Medium. | Warnings retained. | Future adapter must not execute the engine. |
| F-45 | Runtime display registry identity | `registryId`, `registryFingerprint` | Runtime registry has no canonical registry artifact identity. | Canonical registry binding. | INTENTIONALLY_UNMAPPED | Do not synthesize authoritative canonical registry binding. | `unknown` or supplied offline registry. | Medium. | Medium. | Missing definition warning required. | Future adapter must use offline registry if supplied. |
| F-46 | Runtime source object | `sourceFingerprint` | No universal runtime source fingerprint. | Fingerprint of preserved source output. | DERIVED | Build from preserved raw output/projection in future adapter. | `unknown` only before adapter phase. | Medium. | Low. | Fingerprint warning if absent. | Must be deterministic. |
| F-47 | `firstSeenAt`, `lastSeenAt`, display timestamps | `createdAt`, provenance timestamps | Runtime listing/display times. | Artifact creation/provenance time. | CONDITIONAL | Use explicit adapter `createdAt` for artifact; preserve runtime timestamps in provenance. | `unknown`. | Medium. | Low. | Missing timestamps warning optional. | Do not rewrite listing timestamps. |
| F-48 | Runtime listing identity | `metadata.listingReference`, evidence references | Listing ID, item ID, marketplace, query, lane. | Artifact/source provenance. | DERIVED | Preserve by reference/fingerprint where available. | `unknown`. | Medium. | Low. | Missing provenance warning. | Do not invent listing identity. |
| F-49 | Runtime-only annotation object | `normalizedOutput.displayAnnotation` | Display-safe annotation. | Optional normalized display metadata. | ONE_WAY_ONLY | Preserve annotation as metadata/normalized output. | Omit if unavailable. | Low. | Medium. | Display warnings preserved. | Canonical cannot replace runtime annotation. |
| F-50 | Migration metadata | `metadata`, migration artifact fields | Runtime has none. | Offline migration lifecycle metadata. | INTENTIONALLY_UNMAPPED | No mapping from runtime display. | Future migration artifact supplies it. | Low. | Low. | Missing metadata can be `incomplete`. | Adapter phase owns migration metadata. |
| F-51 | Artifact identity | `alignmentId`, `reportId`, `migrationId`, `signalFingerprint` | Runtime has no immutable artifact identity. | Offline artifact IDs/fingerprints. | INTENTIONALLY_UNMAPPED | Do not synthesize outside adapter/artifact creation. | Generated only by future offline adapter. | Medium. | Low. | Missing IDs block conformance. | Not part of runtime. |
| F-52 | `contextualOnly`, `contextualOnlyReason` | `governanceFlags`, `metadata.contextualOnly` | Runtime statement that Evidence Readiness cannot decide. | Offline authority/advisory flags and metadata. | DIRECT | Copy as metadata/flag while preserving `none` authority. | `unknown`. | Low. | Low if preserved. | Reinforces readiness boundary. | Required for readiness adapters. |
| F-53 | `rawFieldsPreserved`, `rawDecisionIntelligencePreserved` | `metadata.rawOutputPreserved` | Runtime display guarantee that raw fields were preserved. | Wrapper provenance metadata. | DIRECT | Copy boolean. | `unknown`. | Low. | Low. | Warning if false. | Future adapter must independently verify parity. |
| F-54 | Unknown, `null`, empty string | `unknown` | Runtime missingness uses multiple forms. | Canonical explicit unknown value. | CONDITIONAL | Normalize only when field is truly missing, not falsy valid value. | `unknown`. | Medium. | Medium. | Unknown values must remain visible. | Do not convert unknown to zero, false, pass, available, or sufficient. |

Field mapping summary:

- Runtime fields mapped: 54.
- Canonical fields mapped: 46.
- Classification totals: DIRECT 9, DERIVED 15, CONDITIONAL 14, ONE_WAY_ONLY 7, INTENTIONALLY_UNMAPPED 5, INCOMPATIBLE 3, LEGACY_ALIAS 1.

## 8. Vocabulary Compatibility Matrix

The following vocabulary classifications are normative. `Exact match` means the string is shared and meaning is compatible in the named context. `Safe translation` means deterministic non-authoritative translation is permitted. `Conditional translation` requires source-specific guardrails. `No equivalent` means preserve as metadata/raw only. `Prohibited translation` means never map to the target concept.

| ID | Vocabulary family | Runtime or canonical value | Compatibility rule | Notes |
| --- | --- | --- | --- | --- |
| V-01 | Runtime signal type | `evidence` | Exact match to canonical `evidence` only for evidence-context signals. | Still non-authoritative. |
| V-02 | Runtime signal type | `context` | Exact match to canonical `context`. | Display context only. |
| V-03 | Runtime signal type | `financial` | Exact match to canonical `financial`. | Financial context is not approval. |
| V-04 | Runtime signal type | `legacy` | Safe translation to canonical `context` or `diagnostic`; no exact canonical `legacy` type. | Preserve legacy alias. |
| V-05 | Runtime signal type | `production_decision` | Conditional translation to canonical `decision` or metadata; prohibited as production authority. | Only runtime Deal Gate can use production decision language. |
| V-06 | Runtime decision eligibility | `none` | Safe translation to canonical `none`. | No decision role. |
| V-07 | Runtime decision eligibility | `context_only` | Safe translation to canonical `supporting_context`. | May also use advisory/display metadata authority. |
| V-08 | Runtime decision eligibility | `evidence_only` | Safe translation to canonical `supporting_context` or `diagnostic_only`. | Evidence only is not approval. |
| V-09 | Runtime decision eligibility | `decision_support` | Conditional translation to canonical `supporting_context`. | Never authoritative. |
| V-10 | Runtime decision eligibility | `production_decision` | Conditional raw preservation only; prohibited as canonical execution authority. | Deal Gate wrapper remains `productionImpact: none`. |
| V-11 | Runtime display language | `neutral` | No equivalent. | Runtime presentation guard. |
| V-12 | Runtime display language | `context_only` | Safe translation to metadata. | Not canonical decision role by itself. |
| V-13 | Runtime display language | `financial_only` | Safe translation to metadata. | Do not map to valuation confidence. |
| V-14 | Runtime display language | `evidence_only` | Safe translation to metadata. | Do not map to evidence sufficiency. |
| V-15 | Runtime display language | `production_decision` | Conditional raw/display metadata only. | Prohibited for canonical authority. |
| V-16 | Runtime display language | `legacy_context` | Safe translation to metadata. | Preserve alias. |
| V-17 | Runtime authority label | `production_decision` | Conditional translation to metadata; prohibited as execution authority. | Runtime-only for Deal Gate display. |
| V-18 | Runtime authority label | `financial_context_only` | Safe translation to canonical `display_metadata` or `advisory`. | Financial context only. |
| V-19 | Runtime authority label | `evidence_only_non_authoritative` | Safe translation to canonical `advisory` with evidence metadata. | Non-authoritative preserved. |
| V-20 | Runtime authority label | `legacy_context_only` | Safe translation to canonical `display_metadata`. | Legacy-only. |
| V-21 | Runtime authority label | `context_only_non_authoritative` | Safe translation to canonical `advisory` or `display_metadata`. | Non-authoritative. |
| V-22 | Runtime readiness | `supported_context` | Conditional translation to normalized readiness only. | Cannot become `available`, approval, or sufficient evidence by itself. |
| V-23 | Runtime readiness | `limited_context` | Conditional translation to normalized readiness plus warning. | May indicate limited evidence. |
| V-24 | Runtime readiness | `cautious_context` | Conditional translation to normalized readiness plus caution warning. | Cannot upgrade readiness. |
| V-25 | Runtime readiness | `not_ready` | Safe translation to normalized readiness and possible blocker/warning. | Does not equal Deal Gate rejection unless source says so. |
| V-26 | Runtime readiness | `unknown` | Exact match to canonical `unknown` missingness. | Preserve unknown. |
| V-27 | Runtime Deal Gate decision | `BUY_NOW` | Prohibited translation to canonical authority; preserve raw only. | Runtime authority only from Deal Gate. |
| V-28 | Runtime Deal Gate decision | `REJECT` | Preserve raw and blocking reasons. | Does not make canonical status `blocked` unless wrapper rules say so. |
| V-29 | Runtime display decision | `REJECTED` | Preserve display label/raw. | Display value, not canonical status. |
| V-30 | Runtime display decision | `UNREVIEWED` | Safe translation to normalized display state. | Not canonical unavailable unless raw output missing. |
| V-31 | Runtime recommendation | `buy_now` | Prohibited translation to canonical authority. | Preserve raw only. |
| V-32 | Runtime recommendation | `reject` | Preserve raw and reasons. | Not a canonical failure by itself. |
| V-33 | Runtime recommendation | `PASS` | Preserve raw only. | PASS is not canonical `available`. |
| V-34 | Canonical signal type | `scan` | No runtime equivalent. | Canonical-only. |
| V-35 | Canonical signal type | `parser` | No runtime display equivalent except source metadata. | Canonical-only. |
| V-36 | Canonical signal type | `identity` | No direct runtime display type. | Runtime identity diagnostics are separate display fields. |
| V-37 | Canonical signal type | `valuation` | Conditional translation from runtime valuation/financial fields. | Requires valuation source. |
| V-38 | Canonical signal type | `range` | No runtime display equivalent. | Canonical/offline only. |
| V-39 | Canonical signal type | `confidence` | Conditional translation from confidence-specific runtime signals. | Preserve confidence kind. |
| V-40 | Canonical signal type | `risk` | Conditional translation from runtime risk diagnostics. | Risk is not rejection unless Deal Gate says so. |
| V-41 | Canonical signal type | `quality` | Conditional translation from quality diagnostics. | Context only. |
| V-42 | Canonical signal type | `grading` | Conditional translation from grading diagnostics. | Legacy grade cannot recommend purchase. |
| V-43 | Canonical signal type | `decision` | Conditional for Deal Gate/Decision Intelligence wrappers only. | No authority by default. |
| V-44 | Canonical signal type | `notification` | No runtime signal mapping in this boundary. | Notifications remain production runtime. |
| V-45 | Canonical signal type | `learning` | No runtime display mapping. | Offline/diagnostic. |
| V-46 | Canonical signal type | `review` | No runtime display mapping. | Governance/manual review. |
| V-47 | Canonical signal type | `calibration` | No runtime display mapping. | Offline-only. |
| V-48 | Canonical signal type | `governance` | No runtime display mapping. | Offline-only. |
| V-49 | Canonical signal type | `diagnostic` | Conditional translation from runtime diagnostic outputs. | Observation-only. |
| V-50 | Canonical signal type | `unknown` | Exact missingness target. | Preserve unknown. |
| V-51 | Canonical decision role | `authoritative` | Prohibited for runtime-to-canonical adapter output under current boundary. | No canonical authority. |
| V-52 | Canonical decision role | `blocking_input` | Conditional only for preserved blockers in offline evidence. | Cannot block runtime Deal Gate. |
| V-53 | Canonical decision role | `supporting_context` | Safe translation from runtime context/evidence/financial support. | Non-authoritative. |
| V-54 | Canonical decision role | `diagnostic_only` | Safe translation for diagnostic signals. | Non-authoritative. |
| V-55 | Canonical decision role | `review_only` | No runtime equivalent; offline review only. | Preserve if supplied. |
| V-56 | Canonical decision role | `none` | Safe default. | Preferred fallback. |
| V-57 | Canonical decision role | `unknown` | Safe missingness fallback. | Requires warning if required. |
| V-58 | Canonical authority level | `production_decision` | Prohibited for generated canonical artifacts under current boundary. | Do not grant authority. |
| V-59 | Canonical authority level | `production_context` | Prohibited for runtime-to-canonical adapter output unless a future governed phase approves. | Current boundary is offline. |
| V-60 | Canonical authority level | `shadow_observation` | Safe only for shadow/offline artifacts. | No production impact. |
| V-61 | Canonical authority level | `offline_validation` | Safe for validation artifacts. | No production impact. |
| V-62 | Canonical authority level | `governance` | Safe only for Governance artifacts. | Still no production authority. |
| V-63 | Canonical authority level | `display_metadata` | Safe translation for runtime display annotations. | Preferred for display wrappers. |
| V-64 | Canonical authority level | `advisory` | Safe default for non-authoritative signals. | No authority. |
| V-65 | Canonical authority level | `unknown` | Safe missingness fallback. | Warning if required. |
| V-66 | Canonical confidence level | `high` | Conditional derivation from numeric confidence only with approved thresholds. | Not approval. |
| V-67 | Canonical confidence level | `moderate` | Conditional derivation with approved thresholds. | Not approval. |
| V-68 | Canonical confidence level | `low` | Conditional derivation with approved thresholds. | May warn. |
| V-69 | Canonical confidence level | `insufficient` | Conditional from missing/low evidence-confidence sources. | Does not equal Deal Gate rejection. |
| V-70 | Canonical confidence level | `not_applicable` | Safe when source has no confidence semantics. | Use for labels/grades. |
| V-71 | Canonical confidence level | `unknown` | Safe missingness fallback. | Preserve unknown. |
| V-72 | Canonical signal status | `available` | Prohibited translation from runtime readiness or confidence alone. | Determined by canonical rules. |
| V-73 | Canonical signal status | `blocked` | Conditional from canonical blockers/errors only. | Not Deal Gate rejection unless raw source is Deal Gate and still offline. |
| V-74 | Canonical signal status | `conflicted` | Conditional from preserved conflicts. | Conflict remains visible. |
| V-75 | Canonical signal status | `warning` | Conditional from preserved warnings. | Warning retained. |
| V-76 | Canonical signal status | `unavailable` | Safe for missing raw output. | Missing is not positive evidence. |
| V-77 | Alignment status | `aligned` | Canonical-only. | No runtime equivalent. |
| V-78 | Alignment status | `aligned_with_warnings` | Canonical-only. | Warnings remain visible. |
| V-79 | Alignment status | `definition_missing` | Canonical-only. | Blocks registry conformance. |
| V-80 | Alignment status | `version_mismatch` | Canonical-only. | Blocks safe migration. |
| V-81 | Alignment status | `incomplete` | Canonical-only. | Missing metadata. |
| V-82 | Alignment status | `invalid` | Canonical-only. | Validation failure. |
| V-83 | Alignment status | `blocked` | Canonical-only. | Fail closed. |
| V-84 | Evidence quality | `strong`, `adequate`, `limited`, `weak`, `insufficient` | Conditional derivation from evidence-specific sources only. | Cannot use active listings as true sold evidence. |
| V-85 | Evidence quality | `not_applicable`, `unknown` | Safe fallback/missingness. | Preserve explicit unknown. |
| V-86 | Warning category | Unknown warning/reason code | Safe preservation only. | Do not normalize away unknown warnings. |

Vocabulary values classified: 86.

## 9. Warning Preservation Rules

1. Runtime warnings correspond to canonical warnings only when the runtime field is explicitly warning-like, caution-like, blocker-like, failure-like, or conflict-like.

2. The following runtime fields must be preserved verbatim when present:

   - `qualityWarnings`
   - `confidenceReasons`
   - `qualityReasons`
   - `failedReasons`
   - `rejectionReasons`
   - `reasons`
   - `blockers`
   - `cautionSignals`
   - `conflicts`
   - Rule-level `reason`
   - Validation warning `code`, `message`, and `field` fields in offline artifacts

3. Warning fields may be normalized only by wrapping them with provenance. The original string or object must remain available in `rawOutput`, `normalizedOutput`, or source artifact metadata.

4. Multiple warnings must remain multiple warnings. Combining warnings into prose is allowed only as a derived summary that references the underlying warning array.

5. Unknown warning codes must remain visible. A future adapter may add a compatibility warning such as `unknown_runtime_warning_code`, but it may not drop or rewrite the original code.

6. Warning severity must be preserved when the native output provides severity. Because no universal runtime/canonical severity taxonomy currently exists, severity normalization is conditional and must keep the original severity field.

7. Missing warning information must remain explicit:

   - If a source field is absent, use `unknown` for required canonical contexts.
   - If a source field is explicitly empty, preserve an empty array.
   - If a warning source cannot be inspected, emit a compatibility warning rather than assuming no warnings.

8. Future adapters must include warning-loss tests that prove warning-bearing runtime examples retain every warning after wrapping.

## 10. Readiness Preservation Rules

Runtime Evidence Readiness is contextual presentation. Canonical status/readiness fields are offline artifact metadata. They are related but not interchangeable.

Runtime readiness values:

- `supported_context`
- `limited_context`
- `cautious_context`
- `not_ready`
- `unknown`

Rules:

1. Runtime readiness may map to `normalizedOutput.readiness` or metadata.
2. Runtime readiness may not map directly to canonical `status`.
3. Runtime readiness may not map to Deal Gate `passed`, `approved`, `buyNowAllowed`, or `BUY_NOW`.
4. Runtime readiness may not satisfy evidence sufficiency unless the source also provides sufficient true sold evidence.
5. `supported_context` is compatible only as contextual support.
6. `limited_context` must preserve limitation semantics and may require a warning.
7. `cautious_context` must preserve caution semantics and may require a warning.
8. `not_ready` may become a warning or blocker only when the source semantics define it as blocking.
9. Missing readiness maps to `unknown`.
10. Readiness cannot be upgraded during transformation.
11. Readiness differs from decision eligibility: readiness describes evidence/context posture; decision eligibility describes display or canonical role.
12. Readiness differs from Deal Gate approval: only Deal Gate pass state authorizes the runtime BUY_NOW path.

## 11. Confidence Preservation Rules

Runtime confidence meanings are signal-specific:

- `market_confidence` describes confidence in market context.
- `sold_evidence_confidence` describes true sold evidence posture/count support.
- `confidence_score` describes Market Intelligence confidence.
- `decision_intelligence` confidence is explanation/evidence readiness context.
- `valuationConfidence` describes valuation context.
- `deal_gate` is a binary production gate and not a confidence score.
- `legacy_score`, `quality_score`, `quality_bucket`, `deal_grade`, `trust_level`, and `roi_recommendation` are not universal confidence fields.

Canonical confidence is structured:

- `confidence.kind`
- `confidence.value`
- `confidence.scale`
- `confidence.basis`
- `confidence.calibrated`
- `confidence.level`
- `confidenceLevel`

Rules:

1. Numeric runtime confidence values may map to canonical `confidence.value` only for the same signal family.
2. Numeric scale may be set only when verified. A score that appears to be 0-100 must not be assumed unless source behavior or fixtures confirm it.
3. `confidenceMeaning` may map to `confidence.basis`; it must not map to `confidence.value`.
4. Confidence levels may be derived only with approved thresholds and explicit derivation reason codes.
5. Missing confidence becomes `unknown`; it may not become zero or `low` unless the source explicitly says zero/low.
6. Confidence may not be used as valuation confidence unless the source is the valuation signal family.
7. Confidence may not be used as Deal Gate authority.
8. High confidence may not create BUY_NOW.
9. Low confidence may contribute warnings in offline artifacts, but it does not automatically create a runtime rejection.
10. Confidence derivation introduces information-loss risk and requires conformance fixtures.

## 12. Authority Boundary Rules

1. Deal Gate remains the sole production recommendation authority.
2. Compatibility mappings cannot create `BUY_NOW`.
3. Compatibility mappings cannot override Deal Gate.
4. Compatibility mappings cannot suppress Deal Gate rejection reasons.
5. Canonical `decisionRole` is not production recommendation authority.
6. Canonical `authorityLevel` is not runtime authority under current wiring.
7. Canonical `status` is not purchase approval.
8. Runtime readiness is not purchase approval.
9. Runtime confidence is not purchase approval.
10. Runtime display annotations are not canonical decision contracts.
11. Governance Binding remains offline.
12. Decision Intelligence remains contextual, shadow, or offline under current wiring.
13. Future runtime integration requires a separate governed phase.
14. Any adapter output must preserve:

    - `productionImpact: none`
    - `decisionImpact: none`
    - `executionAuthority: none`

15. Any non-`none` value in those fields is an authority-boundary violation.

Prohibited mappings documented:

1. Runtime `BUY_NOW` to canonical `productionImpact`.
2. Runtime `BUY_NOW` to canonical `decisionImpact`.
3. Runtime `BUY_NOW` to canonical `executionAuthority`.
4. Runtime `recommendationImpact: approved_by_deal_gate` to canonical `decisionImpact`.
5. Runtime `production_decision` display language to canonical execution authority.
6. Runtime `decisionEligibility: production_decision` to canonical runtime authority.
7. Runtime readiness `supported_context` to Deal Gate approval.
8. Runtime confidence `high` or high numeric score to BUY_NOW.
9. Canonical `status: available` to Deal Gate pass.
10. Canonical `alignmentStatus: aligned` to production readiness.
11. Runtime `allowsFallbackEvidence` to canonical `evidenceBasis.fallbackUsed`.
12. Runtime active/aggregate comp count to true sold evidence count without source proof.

## 13. Permitted and Prohibited Transformations

| Transformation category | Allowed when | Prohibited when | Required provenance | Required reason code | Information-loss handling |
| --- | --- | --- | --- | --- | --- |
| Direct copy | Field meaning, type, and authority match. | Target field has broader authority or different schema role. | Source file/function/field. | `direct_copy` if audited by adapter. | None; preserve exact clone. |
| Normalized alias | Runtime alias is intentionally retained under canonical metadata. | Alias would hide newer canonical identity. | Original alias and target field. | `legacy_alias_preserved`. | Store original alias. |
| Computed derivation | Derivation is deterministic and fixtures cover it. | Derivation changes semantic family or authority. | Inputs, rule name, output field. | `derived_field`. | Preserve all inputs in raw output. |
| Guarded fallback | Required canonical field lacks source data. | Fallback would convert unknown into positive evidence. | Missing source field and fallback value. | `guarded_fallback_unknown`. | Use `unknown`, not zero/pass. |
| Null preservation | Source is truly null/missing. | Source uses falsy but meaningful value such as `0` or `false`. | Source field path. | `null_preserved`. | Preserve `null` in raw output and `unknown` in canonical required field. |
| Unknown preservation | Source explicitly says `unknown`. | A downstream consumer wants a default. | Source field path. | `unknown_preserved`. | Keep unknown visible. |
| Warning-preserving wrapper | Source contains warnings/cautions/blockers/conflicts. | Wrapper drops or merges warnings without references. | Warning source and original value. | `warning_preserved`. | Preserve array and derived summary separately. |
| Prohibited transformation | Mapping would grant authority, repair evidence, or reinterpret status/confidence. | Never allowed. | Source field and rejected target. | `prohibited_authority_mapping` or specific violation code. | Preserve raw only; emit validation error. |

## 14. Compatibility Examples

These are specification examples. They are not asserted to be current runtime fixture output unless their shape is explicitly described as runtime source behavior.

### Example 1: Fully compatible positive context signal

Runtime source:

```json
{
  "signalId": "market_confidence",
  "owner": "server.scoreListing",
  "signalType": "context",
  "decisionEligibility": "decision_support",
  "rawValue": 82
}
```

Permitted canonical representation:

- `rawOutput` preserves `82`.
- `signalType` may translate to `context`.
- `decisionRole` may translate to `supporting_context`.
- `authorityLevel` may translate to `display_metadata` or `advisory`.
- `productionImpact`, `decisionImpact`, and `executionAuthority` remain `none`.

### Example 2: Warning-bearing signal

Runtime source:

```json
{
  "signalId": "decision_intelligence",
  "rawValue": {
    "overallReadiness": "cautious_context",
    "cautionSignals": ["Comparable support is thin"]
  }
}
```

Required compatibility behavior:

- Preserve raw output exactly.
- Preserve `cautionSignals` as warnings or normalized output.
- Preserve readiness as contextual readiness.
- Do not convert cautious readiness into rejection, approval, or canonical authority.

### Example 3: Insufficient-evidence signal

Runtime source:

```json
{
  "signalId": "sold_evidence_confidence",
  "rawValue": {
    "trueSoldCompCount": 1
  }
}
```

Required compatibility behavior:

- `trueSoldCompCount` may map to `evidenceBasis.trueSoldCount` if source is verified true sold evidence.
- Evidence quality may be derived only by approved thresholds.
- Insufficient evidence may become warning/blocker context in offline artifacts.
- It may not be treated as Deal Gate approval or rejection by the adapter.

### Example 4: Missing confidence

Runtime source:

```json
{
  "signalId": "confidence_score",
  "rawValue": null
}
```

Required compatibility behavior:

- Preserve raw `null`.
- Canonical confidence becomes `unknown`.
- Canonical raw output may be `unknown` if no raw source exists, or preserved `null` if null is the explicit raw value under the adapter contract.
- Do not convert missing confidence to zero.

### Example 5: Unknown status

Runtime source:

```json
{
  "signalId": "identity_parser_diagnostics",
  "rawValue": {
    "status": "needs_manual_review"
  }
}
```

Required compatibility behavior:

- Preserve native status verbatim in raw/normalized output.
- Do not invent a canonical status unless adapter rules define it.
- If no mapping exists, canonical status remains determined by canonical status rules and a warning documents the unknown native status.

### Example 6: Runtime-only display annotation

Runtime source:

```json
{
  "signalId": "roi_recommendation",
  "allowedDisplayLanguage": "financial_only",
  "displayPriority": 65
}
```

Required compatibility behavior:

- Preserve display language and display priority as metadata only.
- Do not map financial display language to valuation confidence.
- Do not allow ROI recommendation labels to become purchase recommendation authority.

### Example 7: Canonical-only decision-role field

Canonical target need:

```json
{
  "decisionRole": "review_only"
}
```

Required compatibility behavior:

- Runtime display fields do not directly produce `review_only`.
- A future offline review or Governance adapter may set `review_only`.
- Runtime compatibility adapter should default to `none`, `supporting_context`, `diagnostic_only`, or `unknown` as appropriate.

### Example 8: Legacy alias

Runtime source:

```json
{
  "signalId": "deal_grade",
  "signalType": "legacy",
  "rawValue": {
    "grade": "A",
    "action": "BUY_NOW"
  }
}
```

Required compatibility behavior:

- Preserve native raw output.
- Preserve `legacy` as alias/provenance.
- Neutralized display label remains display-only.
- Do not map `action: BUY_NOW` to canonical authority.
- Deal Gate still decides runtime BUY_NOW.

### Example 9: Intentionally unmapped field

Runtime source:

```json
{
  "allowedDisplayLanguage": "legacy_context"
}
```

Required compatibility behavior:

- Preserve as display metadata only.
- No canonical field is required to represent display wording policy.

### Example 10: Prohibited mapping that would create authority

Prohibited transformation:

```json
{
  "runtime": {
    "signalId": "decision_intelligence",
    "overallReadiness": "supported_context"
  },
  "canonical": {
    "decisionRole": "authoritative",
    "productionImpact": "BUY_NOW"
  }
}
```

Required compatibility behavior:

- Reject as authority escalation.
- Preserve runtime readiness as contextual evidence only.
- Emit an authority-boundary violation.
- Do not create BUY_NOW.

## 15. Future Adapter Contract

This section defines the minimum contract for any future compatibility adapter. It does not create the adapter.

Inputs:

- Already-produced runtime display fields.
- Runtime signal annotations.
- Runtime raw values.
- Optional Deal Gate output as preserved raw source.
- Optional offline canonical registry reference.
- Explicit `createdAt` timestamp supplied by the caller.
- Optional listing/provenance references.

Outputs:

- Immutable compatibility result or adapter artifact.
- Preserved source runtime fields.
- Canonical Signal artifact candidates or references, if the future phase allows them.
- Structured validation result.
- Warning preservation report.
- Readiness preservation report.
- Authority boundary report.
- Deterministic fingerprints.

Validation requirements:

- Validate source required fields.
- Validate target canonical fields if created.
- Validate warning preservation.
- Validate readiness preservation.
- Validate confidence semantics.
- Validate vocabulary translation.
- Validate unknown-value preservation.
- Validate authority fields remain `none`.
- Validate no adapter path creates BUY_NOW or overrides Deal Gate.

Provenance requirements:

- Record source file/function/field where known.
- Preserve runtime `signalId`.
- Preserve runtime `owner`.
- Preserve raw output before normalization.
- Record transformation category and reason code.
- Record registry ID/fingerprint only when a real offline registry is supplied.

Schema version requirements:

- Runtime display schema version and canonical schema version must remain distinct.
- Adapter schema version must be separate from both.
- Version mismatches must remain visible.

Warning preservation requirements:

- Preserve every source warning, caution, blocker, conflict, failed reason, and validation warning.
- Preserve unknown warning codes.
- Include warning-loss tests.

Readiness preservation requirements:

- Preserve readiness as contextual readiness.
- Prevent readiness upgrades.
- Include readiness-upgrade prevention tests.

Authority preservation requirements:

- Force adapter/canonical artifacts to `productionImpact: none`, `decisionImpact: none`, and `executionAuthority: none`.
- Reject authority escalation.
- Never create production decisions.

Deterministic behavior:

- Identical inputs must produce identical ordering, outputs, warnings, summaries, and fingerprints.

Idempotence:

- Running the adapter twice over the same preserved source must not duplicate warnings, alter raw output, or change fingerprints.

Failure behavior:

- Fail closed.
- Emit structured validation errors.
- Preserve raw source when possible.
- Use `unknown`, `blocked`, `incomplete`, or equivalent offline statuses rather than positive defaults.

Unknown-field handling:

- Unknown runtime fields must be preserved in raw output or metadata.
- Unknown canonical-required fields must be explicit `unknown`.
- Unknown values must not be discarded or upgraded.

Backward compatibility:

- Existing runtime display output must remain unchanged.
- Existing canonical artifacts must remain unchanged.
- Existing consumers must not receive new shapes unless a later phase explicitly introduces them.

Test requirements:

- Fixture coverage for every runtime signal ID.
- Field mapping conformance tests.
- Vocabulary mapping tests.
- Unknown-value tests.
- Warning-loss tests.
- Readiness-upgrade prevention tests.
- Authority-escalation prevention tests.
- Native-output preservation tests.
- Deterministic fingerprint tests.
- Idempotence tests.
- Regression tests proving no runtime imports or behavior changes.

## 16. Migration and Promotion Gates

Before any future adapter phase:

1. This specification must be approved.
2. Runtime fixtures must exist for all 12 runtime signal IDs.
3. Canonical fixture outputs must cover all currently onboarded Signal families relevant to runtime display.
4. Field mapping conformance tests must exist.
5. Vocabulary mapping tests must exist.
6. Unknown-value tests must exist.
7. Warning-loss tests must exist.
8. Readiness-upgrade prevention tests must exist.
9. Authority-escalation prevention tests must exist.
10. Native-output preservation tests must exist.
11. Deterministic fingerprint tests must exist.
12. Idempotence tests must exist.
13. Shadow-only validation must pass before any shadow wiring proposal.
14. Explicit architecture approval must precede any runtime or shadow integration.
15. No production promotion occurs by default.

Before any future shadow-only integration:

1. Offline adapter/conformance phase must pass.
2. Shadow artifacts must remain observation-only.
3. Deal Gate output must be preserved unchanged.
4. BUY_NOW labels must remain sourced from runtime Deal Gate only.
5. Alerts and notifications must remain unchanged.
6. Governance must record but not approve the integration.

Before any future production integration:

1. A separate production proposal must exist.
2. Phase 12 Governance chain must validate the proposal.
3. Explicit Dalton approval must be recorded.
4. Full validation must pass.
5. Rollback plan must exist.
6. Post-deployment monitoring must be specified.
7. Deal Gate and BUY_NOW safeguards must remain explicit.

## 17. Known Limitations

1. This specification does not implement mapping code.
2. This specification does not create fixtures.
3. This specification does not create conformance tests.
4. Runtime and canonical schema versions currently share the string `1.0.0` in places, but they are not the same schema.
5. Runtime severity is not a universal taxonomy.
6. Runtime readiness and canonical status remain different concepts.
7. Runtime confidence fields use source-specific semantics.
8. Some runtime counts may be active, fallback, aggregate, or true sold depending on source path.
9. Canonical registry definitions are offline artifacts and cannot be inferred from runtime registry contracts.
10. Decision Intelligence runtime display and offline Decision Intelligence artifacts share names but not lifecycle semantics.
11. This document cites Approved Project State v9.0 as conversation-supplied architectural intent because it is not a repository file.
12. Future adapters will require fixture validation before any trustworthy implementation claim.

## 18. Recommended Next Phase

Recommended next phase: **Phase 18.1C - Offline Runtime-to-Canonical Signal Compatibility Adapter Contract and Conformance Fixtures**.

Recommended objective:

- Define and test an offline-only adapter contract that consumes preserved runtime display signal fixtures and verifies compatibility against this specification without integrating into runtime.

Recommended scope:

- No `server.js` changes.
- No production runtime imports.
- No scanner changes.
- No Deal Gate changes.
- No BUY_NOW changes.
- No alert or notification changes.
- No persistence changes.
- Create fixture-based conformance tests only.
- Prove warning preservation, readiness preservation, unknown preservation, deterministic fingerprints, and authority-boundary enforcement.

Do not begin this phase from this specification.

## 19. Final Specification Determination

**B. Compatibility is sufficiently defined for an offline adapter and conformance phase.**

Rationale:

- The Phase 18.1A audit verified that runtime signal display and canonical Signal artifacts are intentionally separate and currently safe.
- This specification defines the compatibility principles, field mappings, vocabulary rules, preservation requirements, authority boundaries, examples, adapter contract requirements, and migration gates needed for an offline adapter/conformance phase.
- Runtime integration is not justified.
- Shadow integration is not yet justified.
- Production promotion is explicitly out of scope.
- Material unresolved semantic conflicts do not require another specification phase before offline conformance work, because all high-risk fields are classified as conditional, one-way-only, intentionally unmapped, or incompatible with explicit fail-closed rules.

Final boundary statement:

Runtime signals may be wrapped as preserved offline evidence only. Canonical Signals may be reviewed as offline evidence only. Deal Gate remains the sole production recommendation authority, and compatibility mapping cannot create, modify, or approve BUY_NOW.
