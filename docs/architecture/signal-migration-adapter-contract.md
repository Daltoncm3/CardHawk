# Signal Migration Adapter Contract

Phase 13.6C adds the offline-only contract for describing how one engine-specific migration plugs into the future shared Signal Migration Core.

The contract is declarative. It records supported native engine versions, the canonical signal definition it targets, required native fields, output mappings, semantic parity rules, compatibility notes, and authority boundaries. It does not execute engines, run migrations, create alignment artifacts, modify native outputs, or affect production decisions.

## Purpose

The Signal Migration Adapter Contract gives CardHawk a permanent way to document engine-specific migration semantics without copying full migration orchestration for every future engine.

An adapter answers:

- which native engine output it understands
- which signal definition it targets
- which native fields are required or optional
- how native evidence, confidence, uncertainty, status, metadata, and normalized output should be wrapped
- how semantic parity should be checked
- which mismatch reason codes a comparison can report
- whether the adapter is compatible with a requested engine and signal version

## Public API

- `createSignalMigrationAdapter(input, options)`
- `validateSignalMigrationAdapter(adapter)`
- `cloneSignalMigrationAdapter(adapter)`
- `buildSignalMigrationAdapterFingerprint(adapter)`
- `determineAdapterCompatibility(adapter, context)`

All helper APIs are offline-only and deterministic.

## Adapter Schema

Each adapter includes:

- `schemaVersion`
- `source`
- `adapterId`
- `adapterVersion`
- `engineName`
- `supportedEngineVersions`
- `signalName`
- `signalVersion`
- `producer`
- `producerVersion`
- `nativeOutputAliases`
- `nativeVersionAliases`
- `requiredNativeFields`
- `optionalNativeFields`
- `evidenceMapping`
- `confidenceMapping`
- `uncertaintyMapping`
- `statusMapping`
- `metadataMapping`
- `normalizedOutputMapping`
- `semanticParityRules`
- `mismatchReasonCodes`
- `compatibilityNotes`
- `deprecationStatus`
- `supersedesAdapterId`
- `supersededByAdapterId`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`
- `adapterFingerprint`

Explicit unknown values are preserved as `unknown`.

## Declarative Mapping Model

Mappings must either be:

- `declarative`: field-to-field mapping metadata that the migration core can inspect without executing code
- `approved_handler`: a reference to a known local handler using a stable reference such as `validation/listingQualitySignalMigration#mapConfidence`
- `not_applicable`: an explicit statement that the mapping does not apply
- `unknown`: an explicit gap that must not be inferred

Serialized adapter records must never contain mapper functions or executable logic. The contract validates handler references but does not load or execute them.

## Compatibility Model

Compatibility is determined by comparing the adapter against a requested engine version and signal version.

Supported statuses are:

- `compatible`
- `compatible_with_warnings`
- `engine_version_unsupported`
- `signal_version_unsupported`
- `incomplete`
- `blocked`
- `invalid`

Missing mappings or missing supported engine versions do not get filled in. They produce structured validation warnings and usually resolve to `incomplete` compatibility.

## Versioning

Adapters are versioned separately from engines and signal definitions:

- `adapterVersion` tracks the adapter contract record.
- `supportedEngineVersions` tracks compatible native engine outputs.
- `signalVersion` binds the adapter to a canonical signal definition.
- `producerVersion` preserves the signal producer metadata expected by canonical wrappers.

## Deprecation And Supersession

Adapters support `active`, `deprecated`, `superseded`, `retired`, and `unknown` deprecation states.

Supersession must be explicit:

- `supersedesAdapterId` names the adapter this adapter replaces.
- `supersededByAdapterId` names the adapter replacing this adapter.

Self-supersession and direct circular supersession are invalid.

## Authority Boundaries

Adapters never grant production authority.

Every adapter must preserve:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The adapter contract cannot authorize scoring, valuation, Deal Gate, BUY_NOW, notifications, configuration, persistence, or deployment changes.

## Relationship To Signal Migration Core

The Phase 13.6B Signal Migration Core Contract represents the immutable migration lifecycle artifact. The Phase 13.6C Adapter Contract represents the engine-specific mapping configuration that a future migration core may use.

The adapter contract does not replace existing engine-specific migration modules. It prepares a shared, behavior-preserving path for future consolidation.

## Future Consolidation

Future implementation can use adapter contracts to reduce duplicated migration code by moving common orchestration into:

- `signalMigrationCore`
- `signalMigrationAdapter`
- `signalParityCore`
- `signalMigrationValidator`

Engine-specific modules should retain native field semantics, approved handler implementations, parity rules, and engine-specific mismatch language.
