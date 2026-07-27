# Calibration Experiment Runner

Phase 12.3C adds the offline-only Calibration Experiment Runner.

## Purpose

The runner executes immutable Calibration Experiment Contract specifications against immutable Calibration Dataset Builder outputs. It produces immutable experiment result artifacts that can support later review.

The runner is evidence-only. It does not modify production behavior, execute scanner logic, change valuation, change Deal Gate or BUY_NOW behavior, alter thresholds, or grant authority to experiments or results.

## Public API

The module is `validation/calibrationExperimentRunner.js`.

Primary helpers:

- `runCalibrationExperiment(input, options)`
- `validateExperimentInputs(input)`
- `buildExperimentBaseline(datasets, options)`
- `buildExperimentComparison(baselineMetrics, proposedMetrics, options)`
- `evaluateSuccessCriteria(criteria, proposedMetrics)`
- `evaluateFailureCriteria(criteria, proposedMetrics)`
- `evaluateRegressionCriteria(criteria, comparisonMetrics)`
- `buildExperimentResult(input)`
- `summarizeExperimentResults(results)`
- `exportExperimentResults(results, outputPath)`
- `importExperimentResults(input)`
- `buildExperimentResultFingerprint(result)`

## Execution Flow

1. Accept an already-created calibration experiment.
2. Validate the experiment through `calibrationExperimentContract`.
3. Validate calibration datasets through `calibrationDatasetBuilder`.
4. Validate supplied recommendations through `calibrationRecommendationContract`.
5. Build baseline metrics from immutable reviewed records.
6. Use explicitly supplied proposed metrics when available.
7. Preserve unknown proposed evidence as unknown.
8. Evaluate success, failure, and regression criteria.
9. Produce an immutable result artifact with `productionImpact: "none"` and `decisionImpact: "none"`.

The runner never calls production engines to recompute scoring or valuation.

## Result Schema

Result artifacts include:

- schema and source metadata
- result ID
- experiment ID
- creation timestamp
- source dataset IDs and fingerprints
- source recommendation IDs and fingerprints
- baseline metrics
- proposed metrics
- comparison metrics
- regressions
- improvements
- statistical summary
- success evaluation
- failure evaluation
- regression evaluation
- recommendation
- limitations
- `productionImpact: "none"`
- `decisionImpact: "none"`
- deterministic result fingerprint

## Success And Failure Evaluation

Criteria are explicit metric rules. Supported rule fields are:

- `min`
- `max`
- `equals`
- `notEquals`

Missing metrics do not pass by assumption. Missing metrics are reported as `metric_unknown`.

Failure criteria are treated as triggers. A failure rule that passes means the failure condition was observed.

## Regression Handling

Regression criteria evaluate metric deltas from comparison output. Metric delta keys use the form:

```text
metricName.delta
```

For example, `productionCorrectRate.delta` can require a minimum allowed change. Unknown deltas remain unknown.

## Evidence-Only Boundary

The runner must not:

- modify `server.js`
- integrate with scanner runtime
- change scoring, valuation, Deal Gate, BUY_NOW, notifications, persistence, thresholds, weights, confidence, recommendations, or configuration
- infer proposed evidence
- grant authority to experiments or results
- mutate experiments, datasets, recommendations, or results

Experiment results are review evidence only until future governance explicitly approves a separate authority change.

## Future Shadow Experiment Integration

Future shadow experiment runners may provide proposed metrics to this contract. Those future systems should emit separate immutable result evidence and should not mutate experiment specifications or calibration datasets.
