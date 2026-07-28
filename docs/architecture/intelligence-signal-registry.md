# Intelligence Signal Registry

## Purpose

The Intelligence Signal Registry is the permanent offline catalog for CardHawk canonical intelligence signal definitions. It records what a signal is expected to represent before any engine exposes that signal through the wrapper-first Canonical Intelligence Signal Contract.

The registry does not execute engines, generate live signals, modify native engine outputs, or influence production decisions. It is architecture-foundational metadata only.

## Public API

`validation/intelligenceSignalRegistry.js` exports:

- `createSignalDefinition`
- `validateSignalDefinition`
- `createSignalRegistry`
- `validateSignalRegistry`
- `registerSignalDefinition`
- `unregisterSignalDefinition`
- `getSignalDefinition`
- `listSignalDefinitions`
- `filterSignalDefinitions`
- `sortSignalDefinitions`
- `summarizeSignalRegistry`
- `exportSignalRegistry`
- `importSignalRegistry`
- `buildSignalDefinitionFingerprint`
- `buildSignalRegistryFingerprint`

Registration and removal helpers always return new immutable registry objects.

## Signal Definition Schema

Each definition records:

- schema and source metadata
- signal name and version
- producer identity and producer version
- producer category, signal type, decision role, and authority level
- evidence role
- expected input types and output fields
- confidence, uncertainty, and evidence semantics
- allowed statuses
- downstream consumers
- governance requirements and compatibility notes
- deprecation and supersession metadata
- offline authority boundaries
- deterministic definition fingerprint

Unknown facts remain `unknown`. Missing definitions are never inferred.

## Registry Schema

Each registry records:

- schema and source metadata
- registry identity and version
- creation timestamp
- deterministic sorted definitions
- signal count
- producer, category, decision-role, authority, and deprecation summaries
- offline authority boundaries
- deterministic registry fingerprint

## Versioning, Deprecation, and Supersession

Definitions are unique by `signalName` and `signalVersion`. Deprecated definitions remain historical unless explicitly removed through `unregisterSignalDefinition`.

Supersession must be explicit:

- `supersedesSignalName` points to the older definition name.
- `supersededBySignalName` points to the newer definition name.
- Self-supersession and circular supersession are invalid.

## Determinism

Definitions are sorted by signal name and version before registry fingerprinting. Fingerprints exclude their own fingerprint fields, so export and import preserve deterministic identity.

## Authority Boundary

Every definition and registry preserves:

- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`

The registry cannot grant production authority. It only catalogs signal contracts that future adapters may wrap around existing native outputs.

## Future Signal Alignment Engine

The future Signal Alignment Engine can use this registry to verify whether wrapped canonical signals match expected metadata and evidence semantics. That future engine should remain wrapper-first and should not replace existing production outputs without a separate governance path.
