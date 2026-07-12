# eBay Fixture Library

This directory contains offline eBay-shaped fixture records for future sold-evidence adapter work.

These fixtures are not scraped, fetched, or connected to live eBay services. They are representative test records used to design and validate parsing, validation, duplicate detection, and certification behavior before any live integration exists.

## Files

- `sold-listing-scenarios.json`: Representative sold-listing scenarios and expected outcomes.

## Fixture Shape

Each fixture includes:

- `id`
- `category`
- `description`
- `ebayRecord`
- `expected`
- `tags`

The `ebayRecord` object should look like a plausible eBay listing or sold-result payload, but it must remain offline fixture data.

The `expected` object records:

- whether the fixture is expected to be valid
- expected evidence type
- expected sale type
- expected sold price and sold date when available
- expected parsed identity
- validation expectations
- whether the record should be importable as true sold evidence

## Covered Categories

The library currently covers:

- Standard sold listings
- Auction sales
- Buy It Now sales
- Best Offer accepted
- Multi-variation listings
- Multi-card lots
- PSA, BGS, SGC, and CGC graded cards
- Raw cards
- Autographs
- Relics
- Serial-numbered cards
- Parallel cards
- Missing fields
- Malformed listings
- Duplicate listings
- Edge cases

## Validation

Use `validation/ebayFixtureLibrary.js` to validate the fixture library.

The validator checks:

- metadata
- offline-only declaration
- required category coverage
- fixture schema
- expected parsing outcomes
- validation expectations
- duplicate source records
- true-sold and negative-case coverage

## Safety Rules

- Do not add live API calls.
- Do not scrape eBay.
- Do not include credentials.
- Do not write to the production canonical sold evidence store.
- Do not use fixtures to influence valuation, ROI, Deal Gate, BUY_NOW, grading, scoring, confidence, recommendations, notifications, persistence, or scan timing.

Fixtures are a design and validation asset only.
