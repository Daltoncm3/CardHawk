# Canonical Identity Schema

Phase 6.0B defines the versioned Canonical Identity shape that future CardHawk identity engines will produce.

This document is architecture and validation foundation only. It does not change runtime behavior, valuation, ROI, Deal Gate, BUY_NOW, grading, scoring, confidence, recommendations, notifications, persistence, or scan timing.

## Objectives

- Provide one canonical identity contract for sports cards and trading cards.
- Preserve raw extracted values separately from normalized values.
- Track source attribution and per-field confidence.
- Represent unknown values explicitly instead of guessing.
- Define exact-comp and valuation eligibility before any runtime consumer exists.
- Support future marketplace expansion without tying identity to a specific adapter.

## Supported Markets

The schema is designed for:

- sports cards
- Pokemon
- Magic: The Gathering
- Yu-Gi-Oh!
- Disney Lorcana
- One Piece
- Flesh and Blood
- Digimon
- Weiss Schwarz
- Union Arena
- future trading card games

## Canonical Shape

```json
{
  "schemaVersion": "1.0.0",
  "identityType": "sports_card | tcg_card | unknown",
  "category": "sports_card | tcg_card | unknown",
  "marketSegment": "sports | tcg | unknown",
  "canonicalIdentityKey": "stable-normalized-key",
  "raw": {
    "title": "original listing title",
    "source": "listing_title | manual_review | adapter | fixture"
  },
  "normalizedTitle": "normalized listing title",
  "parserVersion": "canonical-identity-fixture-v1",
  "normalized": {},
  "rawExtractedValues": {},
  "sourceFields": {},
  "fieldConfidence": {},
  "overallIdentityConfidence": 0,
  "unknownFields": [],
  "normalizationWarnings": [],
  "eligibility": {
    "exactCompEligible": false,
    "valuationEligible": false,
    "manualReviewRequired": true,
    "contextOnly": true
  }
}
```

## Shared Required Structure

Every canonical identity object must include:

- `schemaVersion`
- `identityType`
- `category`
- `marketSegment`
- `canonicalIdentityKey`
- `raw.title`
- `raw.source`
- `normalizedTitle`
- `parserVersion`
- `normalized`
- `rawExtractedValues`
- `sourceFields`
- `fieldConfidence`
- `overallIdentityConfidence`
- `unknownFields`
- `normalizationWarnings`
- `eligibility`

Required structure does not mean every identity fact is known. Unknown identity facts must be represented as `null`, `"unknown"`, or listed in `unknownFields`.

## Sports-Card Normalized Fields

Sports-card identities should use:

- `sport`
- `league`
- `team`
- `subject.name`
- `subject.aliases`
- `year`
- `manufacturer`
- `brand`
- `product`
- `setName`
- `subset`
- `insertSet`
- `cardNumber`
- `parallel`
- `variation`
- `imageVariation`
- `rookieDesignation`
- `autograph.state`
- `autograph.type`
- `memorabilia.state`
- `memorabilia.type`
- `serialNumbered`
- `serialNumber`
- `printRun`
- `rawOrGraded`
- `rawCondition`
- `grading.company`
- `grading.grade`
- `grading.certificationNumber`

## TCG Normalized Fields

Trading-card-game identities should use:

- `game`
- `cardName`
- `character`
- `franchise`
- `setName`
- `setCode`
- `collectorNumber`
- `rarity`
- `finishTreatment`
- `foilState`
- `alternateArt`
- `artVariant`
- `firstEdition`
- `language`
- `printing`
- `releaseVariant`
- `serialized`
- `serialNumber`
- `printRun`
- `rawOrGraded`
- `condition`
- `grading.company`
- `grading.grade`
- `grading.certificationNumber`

## Confidence Semantics

`overallIdentityConfidence` describes confidence that the canonical identity represents the exact card being evaluated.

`fieldConfidence` must be per-field and must not imply certainty for fields not present. If a value is inferred only from title text, the field confidence should be lower than a value supplied by manual review, a certified adapter, or verified canonical sold evidence.

## Exact Identity Doctrine

- Unknown values must remain explicitly unknown.
- The schema must never invent missing identity fields.
- Near matches and contextual matches must not be labeled exact.
- Only exact identity may later support valuation.
- Contextual identity may later support research only.
- Exact-comp eligibility requires critical fields to be known with adequate confidence.
- Valuation eligibility requires exact-comp eligibility plus valuation-critical card traits.

## Eligibility Rules

Exact-comp eligibility requires:

- known `identityType`
- known `category`
- known subject field:
  - sports: `subject.name`
  - TCG: `cardName`
- known year or release/set identity:
  - sports: `year`
  - TCG: `setName` and `collectorNumber`
- known product/set field
- known card number or collector number
- known base/parallel or finish treatment
- explicit autograph, memorabilia, serial-numbered, and raw/graded states where applicable
- overall identity confidence at or above the future threshold defined by the Canonical Identity Engine
- no blocking normalization warnings

Valuation eligibility requires exact-comp eligibility plus enough identity detail to avoid mixing markets:

- sports: grade/raw state, autograph state, memorabilia state, serial-numbered state, and parallel/base state
- TCG: game, card name, set, collector number, rarity or finish treatment, language, condition or grading state

## Source Attribution

`sourceFields` maps normalized fields to their origin, such as:

- `manual_review`
- `listing_title`
- `marketplace_adapter`
- `canonical_sold_evidence`
- `fixture`
- `unknown`

Fields inferred from seller title text must remain distinguishable from fields verified by manual review.

## Documentation-Only Status

This schema does not replace the current parser, comp engine, valuation engine, sold evidence store, or marketplace adapters. Future phases should build standalone validation and normalization before runtime integration.

