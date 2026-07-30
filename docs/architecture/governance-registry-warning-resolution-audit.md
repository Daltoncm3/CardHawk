# Governance Registry Warning Resolution Audit

Phase 17.0A audits the `registry_not_supplied` warning currently preserved by the Phase 16 Governance Pipeline Stability Baseline.

## Executive Summary

The `registry_not_supplied` warning originates in `validation/governanceArtifactLifecycleConformance.js` when the Lifecycle conformance validator reaches its `registry_integration` stage without an explicit Registry object.

The warning is expected for standalone Lifecycle conformance because the Lifecycle Manager can validate its own immutable state, transitions, determinism, offline boundary, and authority boundary without requiring a Registry. Registry integration is an optional conformance dimension for that standalone validator.

The full end-to-end governance pipeline does supply the Registry for integrated lifecycle integrity checks. `validation/governancePipelineEndToEndValidation.js` calls `validateLifecycleIntegrity(lifecycle, { registry })` when a Registry is present, so the complete artifact chain is actually checked against Registry state.

The warning preserved by `validation/governancePipelineStabilityBaseline.js` does not indicate missing production evidence, missing governance artifacts, broken Registry integration, or incomplete pipeline dependency injection. It indicates that the Stability Baseline delegates one Lifecycle conformance call in standalone mode:

```js
validateLifecycleConformance(pipelineContext.lifecycle)
```

That standalone call intentionally emits `registry_not_supplied`.

Current `certified_with_warnings` behavior is defensible because the baseline faithfully preserves all delegated validation warnings. However, the warning is not a permanent architecture risk. A later implementation phase may supply explicit Registry context to the delegated Lifecycle conformance call, provided it preserves standalone Lifecycle conformance semantics and does not suppress the warning globally.

## Warning Origin

The warning is produced in:

- `validation/governanceArtifactLifecycleConformance.js`
- function: `validateRegistryIntegration(lifecycle, registry)`
- reason code: `registry_not_supplied`
- stage: `registry_integration`

The exact condition is:

```js
if (!registry) {
  warnings.push(validationIssue(
    'registry_not_supplied',
    'Registry integration conformance was not exercised.',
    'registry'
  ));
}
```

This stage returns `valid: true` with a warning. It is not an error.

## Reproduction Path

The direct standalone reproduction path is:

```js
validateLifecycleConformance(lifecycle)
```

Since no `options.registry` is supplied, the conformance stages include:

- `lifecycle_state_model`: passed
- `transition_integrity`: passed
- `supersession_consistency`: passed
- `lifecycle_determinism`: passed
- `registry_integration`: passed with warning `registry_not_supplied`
- `offline_boundary`: passed
- `authority_boundary`: passed

The Phase 16 Stability Baseline reproduces the same warning through:

- `validation/governancePipelineStabilityBaseline.js`
- function: `collectValidationResults`
- call:

```js
validateLifecycleConformance(pipelineContext.lifecycle)
```

The resulting Lifecycle conformance artifact is valid but carries:

- `warnings.length: 1`
- `reasonCodes: ["registry_not_supplied"]`

The baseline aggregates that warning into `statusSummary.warningCount`, which causes certification status to become `certified_with_warnings`.

## Dependency and Invocation Analysis

### Registry Conformance

`validation/governanceArtifactRegistryConformance.js` validates the Registry independently. In the Phase 16 baseline fixture, Registry conformance passes without warnings.

### Lifecycle Conformance

`validation/governanceArtifactLifecycleConformance.js` supports both standalone and integrated operation.

Standalone:

```js
validateLifecycleConformance(lifecycle)
```

Integrated:

```js
validateLifecycleConformance(lifecycle, { registry })
```

The standalone mode is intentionally permissive and warning-producing for Registry integration. The integrated mode attempts Registry conformance and Registry-bound Lifecycle integrity validation.

### End-to-End Pipeline Validation

`validation/governancePipelineEndToEndValidation.js` supplies Registry context for Lifecycle integrity:

```js
validateLifecycleIntegrity(lifecycle, registry ? { registry } : {})
```

It also validates artifact flow from Registry through Review Session into Workspace. The focused Phase 16.4A tests pass, demonstrating that the integrated pipeline has Registry context for the cross-component checks that require it.

### Stability Baseline

`validation/governancePipelineStabilityBaseline.js` currently collects Lifecycle conformance with the standalone call:

```js
pipelineContext.lifecycle ? validateLifecycleConformance(pipelineContext.lifecycle) : null
```

This is the only reason the baseline records `registry_not_supplied` when the rest of the pipeline context includes a Registry.

## Standalone Versus Integrated Behavior

### Standalone Behavior

Standalone Lifecycle conformance is expected to emit `registry_not_supplied`.

This behavior is useful because a Lifecycle artifact can be validated as a self-contained immutable object even when a Registry artifact is not available. The warning communicates that one optional integration dimension was not exercised.

The warning is correct and should not be suppressed at the Lifecycle conformance layer.

### Integrated Behavior

The integrated governance pipeline does supply Registry context for:

- artifact flow validation
- lifecycle integrity validation
- Review Session coordination
- Workspace assembly
- cross-component integrity

Therefore, the pipeline itself is not missing Registry evidence.

The warning reflects delegated validator context, not a broken integrated pipeline.

## Certification Impact

The Phase 16 Stability Baseline aggregates all validation warnings into:

- `statusSummary.warningCount`
- `statusSummary.reasonCodes`
- certification status calculation

Because `registry_not_supplied` remains visible, the baseline certification becomes:

```text
certified_with_warnings
```

This is conservative and truthful. It avoids concealing a delegated validation context gap. It also avoids incorrectly failing certification, since all required validations are present and pass.

The warning does not justify `not_certified` because:

- Lifecycle conformance returns `valid: true`
- Registry conformance passes
- end-to-end validation passes
- lifecycle integrity with Registry context passes
- no authority boundary is violated
- no production behavior is affected

## Architectural Options

### Option 1: Preserve Current Behavior

Keep the baseline certification at `certified_with_warnings`.

Benefits:

- zero implementation change
- preserves all warnings
- keeps standalone Lifecycle conformance semantics intact
- avoids accidental warning suppression

Costs:

- baseline remains noisier than necessary
- certification appears less clean despite the integrated pipeline supplying Registry context elsewhere

### Option 2: Pass Registry Context from Stability Baseline to Lifecycle Conformance

Change the baseline collection call to:

```js
validateLifecycleConformance(pipelineContext.lifecycle, { registry: pipelineContext.registry })
```

Benefits:

- exercises Lifecycle conformance in integrated mode when Registry is available
- removes `registry_not_supplied` from the normal complete-pipeline baseline
- can allow `certified_offline` when no other warnings exist

Risks:

- Lifecycle conformance's internal transition fixture currently uses fixed fixture artifact IDs. When a real Registry is supplied, those fixture transitions may fail unless the registry contains those fixture artifacts or the conformance fixture is adjusted. This was why Phase 16.4A end-to-end validation deliberately used Registry-bound integrity but standalone Lifecycle conformance.
- changing this directly may create false failures unrelated to the actual pipeline artifacts

### Option 3: Add Explicit Integrated Lifecycle Conformance Fixture Support

Update Lifecycle conformance so its transition fixture can run with an internally constructed compatible Registry or avoid applying the supplied production Registry to synthetic fixture artifact IDs.

Benefits:

- preserves standalone warning semantics
- enables clean integrated conformance with Registry context
- reduces false warnings in the Stability Baseline

Risks:

- requires a careful implementation phase
- changes conformance behavior and tests
- must avoid suppressing legitimate `registry_not_supplied` warnings for standalone callers

### Option 4: Suppress or Waive the Warning in Stability Baseline

Do not do this.

Suppressing or remapping `registry_not_supplied` would hide real validation context and weaken the baseline's audit value.

## Recommended Disposition

Recommended disposition: preserve the warning for now.

`certified_with_warnings` is the correct current result because the Stability Baseline is faithfully reporting that one delegated Lifecycle conformance call ran without Registry context.

This is not a production blocker and not a governance integrity failure. It is a conformance-context warning.

## Are Implementation Changes Justified?

Implementation changes are not required immediately.

A future implementation phase is justified only if Dalton wants the Phase 16 baseline to reach `certified_offline` when a complete Registry-backed pipeline is supplied and no other warnings exist.

That future phase should not suppress the warning. It should instead make integrated Lifecycle conformance explicitly registry-aware while preserving standalone behavior.

## Proposed Next Phase

If changes are desired, the safest next phase is:

**Phase 17.0B - Integrated Lifecycle Conformance Context**

Scope:

- audit and adjust only Lifecycle conformance fixture behavior
- preserve `registry_not_supplied` for standalone Lifecycle conformance
- allow Stability Baseline to pass Registry context safely
- update focused tests to prove both standalone and integrated behavior
- do not change production runtime
- do not change governance authority boundaries

If no change is desired, no Phase 17.0B is necessary and `certified_with_warnings` should remain the expected baseline status.

## Final Position

The warning is real, correctly propagated, and non-blocking.

It means:

```text
Standalone Lifecycle conformance did not exercise Registry integration.
```

It does not mean:

```text
The full Governance pipeline lacks Registry evidence.
```

No warning should be suppressed. No tests should normalize it away. Any future cleanup should provide explicit Registry context through public APIs while preserving standalone warning semantics.
