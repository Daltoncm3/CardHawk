# Production Memory Stress Validation

Phase 11.6 completes the Phase 11 Production Memory initiative with an offline validation framework for long-running structural memory behavior.

This phase does not change production behavior. It does not inspect live heap usage, alter scanner scheduling, change persistence semantics, modify marketplace behavior, or affect production decisions.

## Purpose

The production memory audit identified that long-running CardHawk processes must keep active structures bounded as scan cycles repeat. Phase 11.6 verifies that the architectural controls introduced in Phases 11.1 through 11.5 continue to work together:

- memory contracts remain valid,
- bounded learning-store shapes stay within configured limits,
- retained listings remain compact,
- listing-store residency and archive eligibility remain deterministic,
- persistence batching terminates cleanly,
- repeated scan cycles do not create unbounded structural growth.

## Methodology

`validation/productionMemoryStressValidation.js` runs synthetic production-like scan cycles entirely offline.

Each simulated scan cycle:

1. creates representative marketplace listings with raw payloads and scan-only metadata,
2. compacts them through `utils/listingCompaction.js`,
3. records bounded prediction, decision, and learning structures,
4. marks state dirty through `utils/persistenceCoordinator.js`,
5. flushes once at the scan synchronization point,
6. evaluates retained listings against `validation/listingStoreArchitecture.js`,
7. checks memory contracts from `validation/productionMemoryContracts.js`.

The validator records structural metrics only. It does not estimate actual Node.js heap usage.

## Why Structural Metrics

Synthetic heap measurements are noisy and environment-dependent. They can change with Node.js versions, garbage-collection timing, object layout, and test runner behavior.

Structural metrics are deterministic and better aligned with CardHawk's Phase 11 architecture:

- retained listing count,
- prediction count,
- decision count,
- learning record count,
- persistence flush count,
- dirty update count,
- compaction count,
- archive eligibility count,
- average retained listing serialized size.

These measurements prove whether the architecture is bounded without pretending to predict exact runtime heap size.

## Workload Profiles

The canonical profiles are:

- `small_production_workload`
- `medium_production_workload`
- `large_production_workload`
- `long_running_repeated_scan_workload`

Profiles vary scan cycles, listings per scan, retained-listing limits, and bounded learning-store limits.

Custom profiles can be supplied for targeted regression tests.

## Pass/Fail Criteria

A profile passes when:

- retained listing count never exceeds its configured limit,
- prediction, decision, and learning record counts never exceed their configured limits,
- every retained listing validates as compact,
- no transient raw marketplace or scan-only fields remain in compact retained listings,
- persistence flush count matches expected scan-cycle synchronization points,
- persistence batches are not left active,
- dirty state is not left pending after flush,
- lifecycle counts match retained listings,
- archive eligibility is deterministic,
- listing-store architecture is valid,
- memory contracts contain no invalid contract records.

Known partial or non-compliant memory contracts remain visible in the report, but they are not treated as validation failures unless the contract itself is invalid. Phase 11 still has future implementation work beyond this validation layer.

## Public API

The module exports:

- `runProductionMemoryStressValidation`
- `buildStressValidationReport`
- `summarizeStressValidation`
- `compareStressProfiles`
- `buildStressValidationFingerprint`
- `STRESS_PROFILES`

All APIs are offline and deterministic.

## Relationship To Phase 11

Phase 11.1 created memory contracts.

Phase 11.2 bounded learning stores.

Phase 11.3 modeled listing-store separation.

Phase 11.4 compacted retained listings.

Phase 11.5 batched repeated scan persistence.

Phase 11.6 validates that these pieces remain aligned under repeated synthetic scan workloads.

## Future Production Monitoring

Future runtime monitoring should track production-safe operational counters such as:

- retained listing count,
- compacted listing count,
- active batch depth,
- dirty-state age,
- persistence flush count,
- learning-store active record count,
- archive-eligible listing count.

Those counters should remain diagnostics only until separately approved for production authority.
