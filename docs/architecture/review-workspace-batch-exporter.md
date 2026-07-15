# Review Workspace Batch Exporter

## Purpose

The Review Workspace Batch Exporter is an offline-only Phase 7.2B workflow.

It turns scanned CardHawk listing snapshots into deterministic Review Workspace records so Dalton can review real listings without changing production behavior.

## Scope

The exporter reuses existing offline artifacts and engines:

- Review Workspace Contract
- Validation Candidate Selector
- Investment Decision Engine
- Capital Score Explanation Framework
- Canonical Identity diagnostics
- Shadow Sold Comparison
- Shadow Valuation
- existing production outputs

The exporter does not create production decisions, calculate Capital Score, modify runtime behavior, or write files unless an explicit output path is supplied.

## Input Formats

The exporter accepts:

- a JSON file path
- an array of listing records
- store-shaped objects containing `listings`, `records`, `snapshots`, `items`, or `results`

Each listing may already include Investment Decision, Validation Candidate, Canonical Identity, Shadow Valuation, or Shadow Sold Comparison artifacts. Missing artifacts are diagnosed explicitly.

## Export Modes

### `all_listings`

Exports one Review Workspace per unique listing.

### `learning_priority`

Ranks listings by expected learning value using the Validation Candidate Selector.

Defaults:

- requested count: 25
- duplicate listing IDs removed before selection
- obvious-agreement baseline listings preserved when available

Learning priority is not investment priority. The selector favors disagreement, uncertainty, weak evidence, identity conflict, valuation conflict, and edge cases.

## Batch Output

Each export contains:

- `batchId`
- `createdAt`
- `source`
- `selectionMode`
- `requestedCount`
- `availableListingCount`
- `uniqueListingCount`
- `selectedListingCount`
- `duplicateListingsRemoved`
- `selectionSummary`
- `categoryBreakdown`
- `learningPriorityBreakdown`
- `reviewWorkspaces`
- `batchFingerprint`
- `productionImpact: "none"`

Every Review Workspace preserves:

- listing snapshot
- production outputs
- shadow outputs
- Investment Decision
- Strategy Lane context
- Capital Score explanation
- Canonical Identity
- Shadow Valuation
- Shadow Sold Comparison
- Validation Candidate
- Dalton review placeholder
- outcome placeholder
- audit metadata

## Creating The First 25-Listing Review Batch

1. Export recent CardHawk scanned listings to a JSON file.
2. Confirm the file contains an array or a store-shaped object with `listings`, `records`, `snapshots`, `items`, or `results`.
3. Run the exporter in `learning_priority` mode.
4. Use the default requested count of 25 unless a smaller pilot is desired.
5. Write the output to an explicit offline path.
6. Open the exported Review Workspace batch.
7. Review the highest-priority workspaces first.
8. Fill in each `daltonReview` placeholder.
9. Add actual outcome fields later as listings sell or market outcomes become known.
10. Feed reviewed workspaces into the Investment Decision Validation Harness.

Example command:

```bash
node validation/exportReviewWorkspaceBatch.js --input validation/exports/recent-scan.json --mode learning_priority --count 25 --out validation/review-workspaces/first-25.json
```

## Validation Workflow

The exported batch connects:

- Validation Candidate Selector for review prioritization
- Review Workspace Contract for deterministic single-listing review objects
- Investment Decision Validation Harness for Dalton agreement and outcome tracking

## Safety Guarantees

- Offline only.
- No `server.js` changes.
- No runtime integration.
- No production behavior changes.
- No Deal Gate changes.
- No BUY_NOW changes.
- No valuation, ROI, scoring, grading, Market Intelligence, recommendation, notification, persistence, or scan timing changes.
