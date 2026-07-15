# Canonical Certification Artifact Registry

Phase 8.1 adds a persistent registry for Marketplace Adapter Certification artifacts.

The registry is an offline governance layer. It does not connect to live marketplaces, does not write the Canonical Sold Evidence Store, and does not affect production valuation, ROI, Deal Gate, BUY_NOW, notifications, scanning, or marketplace behavior.

## Purpose

The registry answers:

> Which exact certification artifact is approved for this exact source, adapter name, and adapter version?

Before this phase, the Live Ingestion Safety Gate accepted a certification artifact object directly. That path remains supported for backwards compatibility. The registry adds a governed lookup path so future ingestion runs can resolve certification by source and adapter identity instead of relying on informal file selection.

## Persistence

The registry persists to:

```text
data/certification-artifact-registry.json
```

Persistence uses `utils/stateStore.js`, which provides JSON loading, fallback state, corrupt-file backup, and atomic replacement writes.

## Registry Entry

Each entry records:

- source ID,
- marketplace,
- adapter name,
- adapter version,
- interface version,
- certification artifact fingerprint,
- optional artifact path,
- optional artifact snapshot,
- approval status,
- validity window,
- revocation state,
- registration metadata,
- registry-entry integrity fingerprint.

The registry does not modify immutable certification artifacts. It stores derived metadata and, by default, a cloned artifact snapshot.

## Lookup Rules

Registry lookup is exact across:

- `sourceId`,
- `adapterName`,
- `adapterVersion`.

Approval of one adapter version does not approve another version.

## Validation

Registry validation reuses:

- `validation/canonicalValidationCore.js` for stable fingerprints and validation-result shape,
- `validation/canonicalArtifactIntegrity.js` for certification artifact integrity,
- existing Live Ingestion Safety Gate certification compatibility checks.

A registry entry is invalid when:

- required registry fields are missing,
- the adapter identity does not match,
- the artifact fingerprint drifts,
- the artifact is malformed,
- the artifact is not Production Approved,
- the registry entry is revoked,
- the registry entry is expired,
- the registry entry is not yet valid.

## Live Ingestion Safety Gate Integration

The safety gate now supports two certification paths:

1. Direct `certificationArtifact` object, unchanged.
2. Optional registry resolution through a provided registry object or registry path.

If registry resolution fails, certification fails and records are rejected or quarantined through the existing `certification_gate_failed` path.

## Safety Guarantees

- No `server.js` changes.
- No Deal Gate changes.
- No production valuation changes.
- No BUY_NOW changes.
- No notification changes.
- No marketplace behavior changes.
- No production sold-evidence writes.
- No direct artifact compatibility break.
- No fixture certification can become live approval without an exact Production Approved artifact and governed registry entry.

## Public API

The registry module is:

```text
validation/certificationArtifactRegistry.js
```

Primary exports include:

- `createEmptyCertificationArtifactRegistry`
- `createCertificationArtifactRegistryEntry`
- `registerCertificationArtifact`
- `resolveCertificationArtifact`
- `resolveCertificationArtifactFromRegistry`
- `validateRegistryEntry`
- `loadCertificationArtifactRegistry`
- `saveCertificationArtifactRegistry`
- `buildRegistryEntryId`

This module is a governance utility. It is not a production scoring or marketplace adapter.
