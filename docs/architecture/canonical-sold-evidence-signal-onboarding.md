# Canonical Sold Evidence Signal Onboarding

Phase 14.2 adds an offline, shadow-only Signal Framework wrapper for existing Canonical Sold Evidence output.

## Purpose

Canonical Sold Evidence is CardHawk's long-term source of transaction-level sold evidence. This onboarding makes supplied sold-evidence store or query output visible to the shared Signal Alignment Framework without executing the sold evidence subsystem or changing production valuation behavior.

## Scope

The migration consumes already-generated Canonical Sold Evidence output. It does not import or execute `soldEvidenceStore`, `soldEvidenceService`, `canonicalSoldComparisonService`, scanner code, valuation code, Deal Gate, BUY_NOW, notifications, marketplace adapters, persistence, or `server.js`.

## Wrapper-First Flow

1. `createCanonicalSoldEvidenceAdapter()` defines declarative mappings from supplied native sold-evidence output into the canonical signal schema.
2. `migrateCanonicalSoldEvidenceSignal()` runs the shared Signal Migration Core lifecycle.
3. The native output is preserved exactly as `nativeOutput`, `canonicalSignal.rawOutput`, and `adaptedSignal.nativeOutput`.
4. The migration creates the canonical signal, alignment, alignment batch, alignment run, conflict analysis, alignment report, and Signal Migration Core artifact.
5. `compareCanonicalSoldEvidenceNativeToShadow()` runs the shared Signal Shadow Comparison Core lifecycle to verify native-to-wrapper parity.

## Signal Identity

- Signal name: `canonical.sold_evidence.store`
- Producer: `canonicalSoldEvidence`
- Producer category: `service`
- Signal type: `evidence`
- Decision role: `diagnostic_only`
- Authority level: `shadow_observation`
- Evidence role: `diagnostic_context`

## Sold Evidence Semantics

The canonical wrapper treats supplied store statistics, provenance summaries, and dataset-quality summaries as diagnostic evidence context:

- `stats.recordCount` is represented as `trueSoldCount`
- `stats.identityCount`, duplicate metadata, stale counts, and rejected counts remain details
- `provenanceSummary` remains provenance context
- `evidenceQualitySummary` or `datasetQuality` supplies diagnostic quality and confidence semantics

The migration does not infer missing evidence, manufacture sold records, recompute canonical identity, or evaluate valuation sufficiency.

## Parity Verification

The shadow comparison verifies:

- every native field is preserved in `canonicalSignal.rawOutput`
- supplied record and identity counts are preserved
- duplicate insertion metadata remains explicit
- evidence quality and diagnostic confidence mappings preserve supplied values
- source and schema metadata are preserved
- unknown values remain explicit

Mismatches are reported as observation-only artifacts. The comparison never repairs mismatches or chooses a preferred output.

## Authority Boundaries

All artifacts preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

This migration does not grant Canonical Sold Evidence new runtime authority. Production valuation, Deal Gate, BUY_NOW, notifications, and scanner behavior remain unchanged.

## Future Onboarding

Future sold-evidence signal work should continue to separate supplied evidence payloads from engine execution. If future production integration is proposed, it must pass through the Phase 12 governance pipeline before any production authority changes.
