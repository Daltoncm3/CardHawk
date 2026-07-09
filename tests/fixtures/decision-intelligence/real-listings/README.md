# Decision Intelligence Real-Listing Fixtures

This directory stores offline validation fixtures for comparing Decision Intelligence explanations against reviewer judgment from real eBay listing examples.

These fixtures are test-only. They must not change runtime recommendations, BUY_NOW, Deal Gate, scoring, persistence, alerts, or scan timing.

## Fixture Format

Each fixture is a JSON file with this shape:

```json
{
  "id": "short-stable-id",
  "description": "Plain-English case summary.",
  "category": "strong_evidence | thin_evidence | active_only | fatal_identity_mismatch | high_supply_pressure",
  "listing": {
    "title": "Listing title captured for review",
    "price": 0,
    "marketplace": "ebay",
    "listingUrl": "optional",
    "capturedAt": "YYYY-MM-DD",
    "reviewerLabel": "optional dealer label"
  },
  "evidenceSummary": {},
  "listingSimilarity": {},
  "comparableQuality": {},
  "evidenceSufficiency": {},
  "valuationRange": {},
  "supplyPressure": {},
  "decisionIntelligence": {
    "overallReadiness": "expected posture",
    "evidencePosture": "expected posture",
    "compPosture": "expected posture",
    "valuationPosture": "expected posture",
    "resalePressurePosture": "expected posture",
    "recommendationImpact": "none"
  },
  "expected": {
    "validationOutcome": "pass",
    "minimumSupportingSignals": 0,
    "supportingSignalSources": [],
    "cautionSignalSources": [],
    "blockerSources": [],
    "conflictSources": [],
    "blockerMessageIncludes": [],
    "cautionMessageIncludes": []
  },
  "reviewerNotes": "Dealer-review notes explaining why the expected posture is correct.",
  "explanationScore": 0,
  "falsePositive": false,
  "falseNegative": false
}
```

## Review Workflow

1. Capture the eBay listing metadata and the normalized intelligence evidence used during review.
2. Have a reviewer assign the expected Decision Intelligence posture before changing code.
3. Add the fixture JSON to this directory.
4. Run the full test suite.
5. If the fixture fails, decide whether the fixture expectation is wrong or the explanation logic needs future design work.

## Scoring Rubric

Use `explanationScore` to rate how well Decision Intelligence matched expert dealer judgment:

- `5`: Explanation matches dealer judgment and names the important reason.
- `4`: Explanation is directionally right but misses one useful nuance.
- `3`: Explanation is mixed but not dangerous.
- `2`: Explanation misses a material caution or support signal.
- `1`: Explanation is materially misleading.

## Pass/Fail Criteria

A fixture passes when:

- The expected postures match exactly.
- Expected blocker, conflict, supporting, and caution source coverage is present.
- Required blocker or caution message snippets are present.
- `recommendationImpact` remains `"none"`.

A fixture fails when:

- Decision Intelligence produces a different posture than the reviewer expected.
- A required blocker or caution source is missing.
- The explanation creates a false positive or false negative against reviewer judgment.

## Adding Listings

Add one JSON file per reviewed listing. Keep IDs stable and descriptive. Prefer expanding this dataset with real reviewed listings rather than changing existing expectations unless reviewer judgment was recorded incorrectly.
