# Review Workspace Export

CardHawk can export a read-only Review Workspace batch from listings already stored by the app.

This is a validation and review workflow only. It does not trigger scans, write files, modify stored listings, or change Deal Gate, BUY_NOW, valuation, ROI, scoring, grading, recommendations, notifications, persistence behavior, or scan timing.

## Endpoint

```text
GET /api/admin/review-workspaces/export
```

The endpoint uses the existing CardHawk admin login. It does not introduce a second authentication system.

## Query Parameters

- `mode=learning_priority | all_listings`
  - Default: `learning_priority`
- `count=<number>`
  - Default: `25`
  - Used for `learning_priority` mode.
- `includeReviewed=true | false`
  - Default: `false`

## First 25-Listing Review Batch

1. Start CardHawk normally.
2. Log in with the existing CardHawk admin credentials.
3. Open:

```text
/api/admin/review-workspaces/export
```

This returns the default learning-priority batch of 25 listings.

To request a specific count:

```text
/api/admin/review-workspaces/export?mode=learning_priority&count=25
```

To export every stored listing:

```text
/api/admin/review-workspaces/export?mode=all_listings
```

The browser response is JSON and can be saved for offline validation.

## Response Shape

The response includes:

- `batchId`
- `createdAt`
- `source: "runtime_listing_store"`
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

Missing shadow or investment artifacts are reported inside each Review Workspace. The exporter does not fabricate missing outputs.
