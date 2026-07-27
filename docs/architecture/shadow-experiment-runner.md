# Shadow Experiment Runner

Phase 12.4C adds the offline-only, observation-only Shadow Experiment Runner.

## Purpose

The runner consumes immutable Shadow Experiment Contract specifications, immutable offline Calibration Experiment Runner results, and explicit production reference data. It produces immutable Shadow Result artifacts for later review.

The runner does not execute production code, start scanner work, change scoring, change valuation, alter Deal Gate or BUY_NOW behavior, send notifications, persist production state, change thresholds, or grant authority to shadow experiments or results.

## Public API

The module is `validation/shadowExperimentRunner.js`.

Primary helpers:

- `runShadowExperiment(input, options)`
- `validateShadowExperimentInputs(input)`
- `buildProductionBaselineComparison(productionReferenceData, options)`
- `buildShadowComparison(productionBaselineMetrics, shadowMetrics, options)`
- `evaluateShadowSuccess(criteria, shadowMetrics)`
- `evaluateShadowFailure(criteria, shadowMetrics)`
- `evaluateShadowRegression(criteria, comparisonMetrics)`
- `buildShadowResult(input)`
- `summarizeShadowResults(results)`
- `exportShadowResults(results, outputPath)`
- `importShadowResults(input)`
- `buildShadowResultFingerprint(result)`

## Execution Flow

1. Accept an already-created shadow experiment specification.
2. Validate it through `shadowExperimentContract`.
3. Validate supplied source calibration experiment artifacts when present.
4. Validate supplied offline experiment result artifacts through their existing result fingerprint contract.
5. Load explicit production baseline metrics from supplied reference data.
6. Use explicit shadow metrics when supplied, or a single offline result's proposed metrics when available.
7. Preserve unknown or missing metrics as `unknown`.
8. Compare production baseline metrics to shadow metrics.
9. Evaluate success, failure, and regression criteria.
10. Produce an immutable result artifact with `productionImpact: "none"` and `decisionImpact: "none"`.

The runner never calls production engines to recompute outcomes.

## Result Schema

Shadow result artifacts include:

- schema and source metadata
- shadow result ID
- shadow experiment ID
- creation timestamp
- source experiment IDs and fingerprints
- source offline result fingerprints
- production baseline metrics
- shadow metrics
- comparison metrics
- improvements
- regressions
- statistical summary
- success evaluation
- failure evaluation
- regression evaluation
- recommendation
- limitations
- observation summary
- `productionImpact: "none"`
- `decisionImpact: "none"`
- deterministic shadow result fingerprint

## Observation Model

The runner represents observation evidence only. Production baseline data must be supplied as immutable reference metrics. Shadow metrics must be supplied explicitly or inherited from one immutable offline result artifact. Multiple offline result artifacts require explicit shadow metrics so the runner does not infer a blended result.

## Regression Handling

Regression criteria evaluate metric deltas from production baseline to shadow metrics. Metric delta keys use:

```text
metricName.delta
```

Failure criteria are treated as triggers. If a failure rule passes, the failure condition was observed.

## Evidence-Only Boundary

The runner must not:

- modify `server.js`
- integrate with scanner runtime
- change scoring, valuation, Deal Gate, BUY_NOW, notifications, persistence, thresholds, weights, confidence, recommendations, or configuration
- infer missing evidence
- grant production authority
- grant authority to shadow experiments or shadow result artifacts
- mutate shadow experiments, production reference data, offline results, or generated results

Shadow result artifacts are evidence only until future production proposal governance explicitly approves a separate change.

## Future Production Proposal Integration

Future production proposal contracts may consume shadow result artifacts by fingerprint. A proposal must preserve the full artifact chain from review package to calibration dataset, recommendation, offline experiment, shadow experiment, and shadow result. Passing shadow metrics can only support proposal review; it cannot change runtime behavior.
