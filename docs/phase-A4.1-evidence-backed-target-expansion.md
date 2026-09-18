# Phase A4.1 - Evidence-Backed Target Expansion

## Purpose

Phase A4.1 adds the smallest practical owner-operated path for expanding CardHawk's pool of exact card identities backed by legitimate true-sold evidence.

The workflow exists because Phase A4 proved bounded multi-target discovery mechanics, but repository inspection showed that the limiting factor for additional Deal #1 targets is verified reusable transaction-level sold evidence, not lane execution.

This phase does not add automatic sold-data acquisition, scraping, runtime lane activation, valuation changes, Deal Gate changes, BUY_NOW changes, notification changes, or marketplace execution.

## Existing Evidence-Acquisition Mechanisms

| Mechanism | Source Type | Automatic | Status | Provenance | Retention Rights | Canonicalization | Validation | Storage | Runtime Valuation Reach | Practical Target Expansion Today |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `utils/soldEvidenceStore.js` | Canonical sold evidence store | No | Production/supporting | Record `source` fields | Record `retention` fields | `normalizeSoldEvidenceRecord` | `soldEvidenceStoreConformance` | `data/sold-evidence.json` when used by runtime | Yes, through `services/soldEvidenceService.js` and runtime canonical lookup | Yes, if valid records are inserted |
| `validation/importSoldEvidence.js` | Generic manual JSON import | No | Offline/manual helper | Basic source metadata with defaults | Preserved when supplied | Canonical store normalization | Minimal price/date/active guard | Configured store path | Yes if written to runtime store | Partially, but too permissive for A4.1 owner workflow |
| `validation/manualSoldEvidenceImportHelper.js` | Manual verified import | No | Offline/manual helper | Requires source adapter/retrieval/reliability/acquiredAt and URL | Preserved when supplied | Canonical store normalization | Canonical record validation | Configured store path | Yes if written to runtime store | Yes, with stronger wrapping/reporting |
| `marketplaces/manualAcquisitionAdapter.js` | Manual acquisition interface adapter | No | Offline adapter | Batch validation metadata | Represented through records and capabilities | Canonical acquisition interface | Dataset pilot validation | Does not write production store itself | Indirect only | Useful for conformance, not owner one-command store intake |
| `validation/manualVerifiedAcquisitionWorkflow.js` | Operator-governed manual workflow | No | Offline governance workflow | Operator approval, source permission, certification registry | Represented in workflow controls | Manual adapter and pipeline conformance | Multi-stage workflow validation | Dry-run by default; no automatic store writes | No direct store write | Excellent governance model, heavier than needed for repeated owner batch intake |
| `marketplaces/ebayAcquisitionAdapter.js` | eBay sold-evidence adapter skeleton | No live acquisition | Skeleton/fixture-only | Fixture or skeleton metadata | Commercial use not approved | Fixture translator only | Fixture/conformance tests | No production store writes | No | No, until approved sold-data source is implemented |
| `tests/fixtures/sold-evidence/*` and fixture library | Test fixtures | No | Fixture/test-only | Fixture metadata | Not production evidence | Fixture translators/builders | Tests only | Test stores only | No production authority | No, fixtures must not become production evidence |
| Certification/readiness framework | Governance/certification artifacts | No | Offline governance | Artifact provenance | Artifact-level permissions | N/A | Certification validators | Artifact stores | No direct valuation | Supports future provider approval, not current acquisition |

## Current Automatic True-Sold Source Status

The repository does not currently contain an approved automatic source capable of obtaining real transaction-level true-sold sports-card data without scraping.

The current external blocker is not only credentials. The missing pieces are:

- approved provider/API access for transaction-level sold evidence,
- commercial or internal-use data rights for retained historical market data,
- a live implemented adapter that emits canonical `true_sold` records,
- production approval/certification for that adapter.

eBay Browse active inventory must not be treated as sold evidence. The eBay acquisition adapter is intentionally a skeleton or fixture-backed adapter and documents that no live sold-evidence acquisition is implemented.

## Owner Batch Intake Workflow

Phase A4.1 introduces `validation/ownerSoldEvidenceBatchIntake.js`.

The workflow accepts owner-supplied JSON records, validates them, normalizes accepted records through the existing Canonical Sold Evidence store path, deduplicates using existing duplicate keys, and reports target-readiness against the unchanged valuation minimum of 3 qualifying true-sold comps.

It is suitable for repeated use while CardHawk lacks an approved automatic sold-data provider.

## Input Schema

The input file may be a JSON array or an object containing any existing manual import key:

- `ownerSoldRecords`
- `manualSoldRecords`
- `verifiedSoldRecords`
- `soldEvidence`
- `soldRecords`
- `records`

Each record should supply, when known:

- `parsedIdentity.category`
- `parsedIdentity.sport`
- `parsedIdentity.player`
- `parsedIdentity.year`
- `parsedIdentity.brand`
- `parsedIdentity.product`
- `parsedIdentity.setName`
- `parsedIdentity.cardNumber`
- `parsedIdentity.parallel`
- `parsedIdentity.rookie`
- `parsedIdentity.autograph`
- `parsedIdentity.memorabilia`
- `parsedIdentity.serialNumbered`
- `marketplace`
- `marketplaceSaleId`
- `marketplaceListingId`
- `rawTitle`
- `soldPrice`
- `shipping`
- `totalPaid`
- `currency`
- `soldAt`
- `saleType`
- `url`
- `condition`
- `gradeCompany`
- `grade`
- `acquisitionMethod`
- `verificationStatus`
- `source.adapter`
- `source.retrievalMethod`
- `source.sourceReliability`
- `source.acquiredAt`
- `retention.status`
- `retention.sourceTerms`
- `retention.notes`
- `retention.reviewedBy`
- `retention.reviewedAt`
- `retention.sourceApprovalStatus`
- `review.status`
- `review.reviewer`
- `review.reviewedAt`

Unknown values should be omitted or explicitly set to `unknown`; they are not inferred. Required evidence fields that remain unknown are quarantined.

Example:

```json
{
  "ownerSoldRecords": [
    {
      "marketplace": "eBay",
      "marketplaceSaleId": "example-sale-001",
      "marketplaceListingId": "example-listing-001",
      "rawTitle": "2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC",
      "soldPrice": 8.5,
      "shipping": 1.5,
      "totalPaid": 10,
      "currency": "USD",
      "soldAt": "2026-07-01T12:00:00.000Z",
      "saleType": "buy_it_now",
      "url": "https://example.test/sold/example-sale-001",
      "condition": "raw",
      "gradeCompany": "raw",
      "grade": "unknown",
      "parsedIdentity": {
        "category": "sports_card",
        "sport": "mma",
        "player": "Anthony Hernandez",
        "year": "2023",
        "brand": "Panini",
        "product": "Prizm UFC",
        "setName": "Prizm UFC",
        "cardNumber": "181",
        "parallel": "Silver Prizm",
        "rookie": true,
        "autograph": false,
        "memorabilia": false,
        "serialNumbered": false
      },
      "acquisitionMethod": "owner_observed_manual_batch",
      "verificationStatus": "owner_verified",
      "source": {
        "adapter": "owner_verified_batch",
        "retrievalMethod": "owner_observed_manual_batch",
        "sourceReliability": "verified_manual",
        "acquiredAt": "2026-07-15T00:00:00.000Z"
      },
      "retention": {
        "status": "permanent_allowed",
        "sourceTerms": "owner supplied transaction observation for internal CardHawk market history",
        "notes": ["owner verified source page before import"],
        "reviewedBy": "Dalton",
        "reviewedAt": "2026-07-15T00:05:00.000Z",
        "sourceApprovalStatus": "approved"
      },
      "review": {
        "status": "owner_verified",
        "reviewer": "Dalton",
        "reviewedAt": "2026-07-15T00:04:00.000Z"
      }
    }
  ]
}
```

## Validation And Quarantine

Records are accepted only when they satisfy:

- existing manual verified import requirements,
- existing canonical sold-evidence record validation,
- positive sold price,
- valid sold timestamp,
- identity metadata,
- source URL,
- source adapter,
- source retrieval method,
- source reliability,
- source acquisition timestamp,
- owner/human/source/dealer verification status,
- retainable retention status of `permanent_allowed` or `restricted`,
- non-fixture and non-test provenance.

Invalid records are quarantined in the report with deterministic reason codes. Active listings, aggregate context, fixture records, test records, mock records, synthetic records, missing retention rights, unknown retention rights, prohibited retention, missing verification, missing price, and missing sold dates are rejected.

## Deduplication

Accepted records are inserted through `addSoldEvidenceRecord`, so existing canonical duplicate keys apply:

- marketplace sale ID,
- marketplace listing ID plus sold date,
- source URL,
- fallback transaction fingerprint.

Duplicates are reported and do not increase store record count or true-sold comp count.

## CardHawk Market History Behavior

Accepted records are normalized into the existing Canonical Sold Evidence store. When the configured store path is the runtime `data/sold-evidence.json`, accepted records become part of CardHawk's retained historical market dataset subject to their retained `retention` metadata.

The workflow does not create a competing sold-history database.

## Target-Readiness Report

The import result includes `targetReadiness`.

The report identifies exact canonical card identities with at least 3 qualifying active `true_sold` records, matching the existing valuation minimum. It reports:

- ready identities,
- below-minimum identities,
- true-sold count,
- minimum true-sold comp requirement,
- median sold,
- weighted sold average,
- newest sold date,
- source mix,
- evidence record IDs,
- `discoveryLaneActivated: false`.

The report never creates, enables, or activates targeted discovery lanes.

## Owner Usage

Dry-run first:

```bash
node validation/ownerSoldEvidenceBatchIntake.js \
  --input validation/sold-evidence-dataset/batches/owner-batch.json \
  --store data/sold-evidence.json \
  --dry-run \
  --out validation/reports/owner-batch-dry-run.json
```

Write accepted records to the configured canonical store after reviewing quarantine and duplicate output:

```bash
node validation/ownerSoldEvidenceBatchIntake.js \
  --input validation/sold-evidence-dataset/batches/owner-batch.json \
  --store data/sold-evidence.json \
  --out validation/reports/owner-batch-import-report.json
```

## Safety And Authority Boundaries

The workflow:

- makes no live marketplace requests,
- performs no scraping,
- does not treat active listings as sold evidence,
- does not convert fixtures into production evidence,
- does not lower sold-comp minimums,
- does not weaken provenance or retention requirements,
- does not weaken canonical identity validation,
- does not change valuation formulas,
- does not change Deal Gate,
- does not change BUY_NOW,
- does not send notifications,
- does not purchase, bid, or offer,
- does not activate targeted discovery lanes.

Human purchasing authority remains absolute.

## Limitations

Owner-entered data quality still depends on the owner's review discipline and source rights. This workflow cannot prove that a provider grants rights beyond the supplied retention/provenance metadata. It also does not solve automatic sold-data acquisition, image verification, provider certification, or marketplace licensing.

## Recommended Next Phase

Phase A4.2 should use this workflow with a small owner-supplied batch for 2-3 prospective target identities, dry-run first, then import only accepted records after quarantine review. The phase should measure how many additional exact identities cross the existing 3 true-sold-comp readiness threshold without activating discovery lanes automatically.
