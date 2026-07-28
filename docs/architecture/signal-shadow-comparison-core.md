# Signal Shadow Comparison Core

Phase 13.6F introduces the shared Signal Shadow Comparison Core for behavior-preserving consolidation of shadow-comparison lifecycle code.

The core extracts common orchestration from the Grade Premium and Population shadow-comparison modules. It does not execute native intelligence engines, change migrations, repair mismatches, infer semantic equivalence, or influence production decisions.

## Shared Comparison Lifecycle

The shared core coordinates:

1. Resolve a supplied offline migration artifact or invoke the existing offline migration fallback when the comparison module already supported that behavior.
2. Clone native output and source artifacts immutably.
3. Invoke engine-specific comparison functions for:
   - raw native fields
   - evidence
   - confidence
   - status
   - metadata
   - unknown values
4. Collect mismatch evidence.
5. Sort mismatches deterministically by reason code and field.
6. Validate migration, canonical signal, alignment, alignment run, and alignment report artifacts.
7. Aggregate warnings and structured validation errors.
8. Ask the engine-specific parity resolver for the final parity status.
9. Build the comparison artifact using the existing engine-specific return shape.
10. Attach the engine-specific summary, validation, and fingerprint.

## Module Boundaries

`validation/signalShadowComparisonCore.js` owns orchestration only.

It provides:

- `executeSignalShadowComparisonLifecycle`
- `validateSignalShadowComparisonLifecycle`
- `summarizeSignalShadowComparisonLifecycle`
- `buildSignalShadowComparisonLifecycleFingerprint`

It also exposes `buildSignalShadowComparisonContractArtifact` as a projection helper for the Phase 13.6E contract.

The core does not import Grade Premium or Population comparison modules. It receives all engine-specific behavior as configuration from the existing modules.

## Engine-Specific Responsibilities

Each comparison module retains:

- semantic comparison rules
- evidence interpretation
- confidence interpretation
- status interpretation
- metadata interpretation
- unknown-value interpretation
- engine-specific mismatch messages
- engine-specific summary shape
- engine-specific validation rules
- engine-specific reason codes
- engine-specific public API
- engine-specific fingerprint helper

This preserves the existing behavior of:

- `gradePremiumShadowComparison`
- `populationShadowComparison`

## Behavior-Preservation Guarantees

The consolidation is designed to produce no intentional observable changes.

The existing modules continue to return the same fields:

- `fieldComparisons`
- `evidenceComparison`
- `confidenceComparison`
- `statusComparison`
- `metadataComparison`
- `unknownValueComparison`
- `parityStatus`
- `mismatchCount`
- `mismatches`
- `warnings`
- `errors`
- `sourceArtifacts`
- `summary`
- `validation`
- `comparisonFingerprint`

Existing public exports remain unchanged.

## Authority Boundaries

The shared core always preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

It cannot affect scanner behavior, valuation, Deal Gate, BUY_NOW, notifications, persistence, marketplace behavior, configuration, deployment, or production authority.

## Failure Behavior

The core fails closed.

When required lifecycle hooks are missing or execution cannot safely continue, it returns a blocked comparison artifact with structured errors and no execution authority.

The core must never:

- alter native outputs
- repair mismatches
- infer semantic parity
- convert advisory evidence into decisions
- grant production authority

## Future Comparison Modules

Future shadow comparisons should provide the core with:

- schema version
- comparison source
- migration artifact aliases
- default comparison ID prefix
- comparison scope
- offline migration fallback, if already part of the module's public behavior
- native field comparison function
- evidence comparison function
- confidence comparison function
- status comparison function
- metadata comparison function
- unknown-value comparison function
- parity status resolver
- migration validator
- comparison summarizer
- comparison validator
- comparison fingerprint helper

This keeps shared lifecycle behavior centralized while preserving engine-specific semantics.
