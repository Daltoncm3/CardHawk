# Phase A2.3 - Targeted Discovery Observation Artifact

## Purpose

Phase A2.3 adds a bounded, durable, non-authoritative observation artifact for every unique raw result processed by the Targeted Discovery Lane.

The artifact fixes the A2.2 observability gap where cheap-rejected targeted results could disappear after the run with only compact rejection counts and IDs in the scan report. It allows later analysis of query quality, freshness, cheap triage behavior, and whether CardHawk saw a specific targeted listing.

## Scope

The observation artifact is discovery history only.

It does not:

- create sold evidence
- enter Canonical Sold Evidence
- become a valuation comparable
- change estimated value, ROI, scoring, Deal Gate, BUY_NOW, alerts, notifications, bids, offers, or purchases
- bypass cheap triage
- bypass `saveScoutedListing`
- make targeted discovery continuously active
- add marketplace API calls

Accepted candidates still follow the existing enrichment, scoring, persistence, Deal Gate, alert, rejection, and history path.

## Store Location

Observations are stored in:

```text
store.targetedDiscoveryObservations
```

The store section is an array of compact observation artifacts. It is normalized by `utils/appStore.js` on load/save and bounded by `utils/targetedDiscoveryObservationStore.js`.

## Retention

Default retention:

```text
500 observations
```

The limit can be configured with:

```text
CARDHAWK_TARGETED_DISCOVERY_OBSERVATION_LIMIT
```

Retention is deterministic. Observations are ordered by `lastObservedAt` descending and then `observationId` ascending. The newest records within the limit are retained.

## Deduplication

Observations are deduplicated by:

```text
laneId + listingId
```

Repeated observations of the same marketplace listing in the same targeted lane update the existing artifact instead of appending unbounded duplicates.

The artifact preserves:

- `firstObservedAt`
- `lastObservedAt`
- `observationCount`

Latest observable values such as price, title, URL, triage result, and freshness fields reflect the latest targeted observation.

## Observation Schema

Each observation includes:

- `schemaVersion`
- `artifactType`
- `observationId`
- `marketplace`
- `listingId`
- `ebayItemId`
- `marketplaceListingId`
- `title`
- `price`
- `totalCost`
- `currency`
- `url`
- `listingType`
- `buyingOptions`
- `laneId`
- `laneName`
- `query`
- `page`
- `offset`
- `marketplaceStartTimestamp`
- `observedAt`
- `firstObservedAt`
- `lastObservedAt`
- `freshnessAvailable`
- `ageAtObservationMs`
- `ageAtFirstObservationMs`
- `duplicateClassification`
- `observationStatus`
- `candidatePreserved`
- `cheapTriage`
- `observationCount`
- `lastRunId`
- `productionImpact: "none"`
- `decisionImpact: "none"`
- `executionAuthority: "none"`
- `soldEvidenceImpact: "none"`
- `valuationImpact: "none"`
- `dealGateImpact: "none"`
- `buyNowImpact: "none"`
- `alertImpact: "none"`
- `purchaseAuthority: "none"`
- `bidAuthority: "none"`
- `offerAuthority: "none"`
- `canonicalSoldEvidenceEligible: false`
- `valuationComparableEligible: false`
- `notificationEligible: false`
- `buyNowEligible: false`

Unavailable marketplace fields remain explicit as `null` or empty arrays. No unavailable field is inferred.

## Execution Path

For each unique raw targeted result:

1. eBay Browse returns a normalized active listing.
2. The Targeted Discovery Lane deduplicates by listing ID within the run.
3. History/store state is checked for new-vs-previously-observed context.
4. Freshness is calculated only when marketplace timestamps are available.
5. Cheap triage runs.
6. A non-authoritative observation artifact is recorded before cheap-rejected results can disappear.
7. Cheap-rejected results stop there.
8. Accepted candidates continue to `saveScoutedListing` unchanged.

## Report Metrics

The targeted discovery report now includes:

- `observationsRecorded`
- `rawNewListings`
- `rawPreviouslyObservedListings`

Existing candidate-oriented metrics remain:

- `newListings`
- `previouslyObservedListings`
- `cheaplyRejectedListings`
- `candidatesPreserved`

This separates raw discovery observability from candidate persistence.

## Read-Only Retrieval

Use:

```js
listTargetedDiscoveryObservations(store, { laneId, listingId, limit })
getTargetedDiscoveryObservation(store, { laneId, listingId })
```

These helpers return clones of stored artifacts and do not modify store state.

## Safety

Observation artifacts are explicitly non-authoritative. They are not inputs to sold evidence, valuation, Deal Gate, BUY_NOW, alerts, notifications, purchases, bids, or offers.

The artifact exists only to answer discovery-analysis questions after a controlled or scheduled targeted run.
