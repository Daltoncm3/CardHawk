# Marketplace Adapter Certification Standard

Phase 4.7A defines the certification framework for future marketplace sold-evidence adapters.

This framework is offline only. It does not connect to live APIs, write to the production Canonical Sold Evidence Store, or affect CardHawk runtime decisions.

## Objectives

Every future adapter for eBay, Card Ladder, Fanatics Collect, PWCC, Goldin, COMC, TCGplayer, Alt, Whatnot, or other sources must prove that it can produce safe canonical evidence before it is allowed to participate in ingestion planning.

The certification framework records:

- Adapter capabilities
- Adapter limitations
- Known unsupported behaviors
- Acquisition Adapter Conformance results
- Acquisition-to-Store Pipeline Conformance results
- Identity pass rate
- Provenance pass rate
- Deterministic fixture replay status
- Store eligibility results
- Certification level

## Certification Levels

### Draft

The adapter has a certification report but has not met the minimum candidate bar.

Common causes:

- Broken interface contract
- Missing capability metadata
- Non-deterministic fixture replay
- Identity or provenance failures
- No eligible records

### Candidate

The adapter has passed the interface and acquisition-adapter standards, has deterministic fixture replay, and meets candidate identity and provenance thresholds.

Candidate status does not mean records are store-approved. It means the adapter is ready for deeper review.

### Certified

The adapter has passed:

- Acquisition Adapter Conformance
- Acquisition-to-Store Pipeline Conformance
- Identity threshold
- Provenance threshold
- Deterministic fixture replay
- Transaction-level true sold support
- Minimum store-eligible record count

Certified status means the adapter can produce store-eligible canonical evidence in offline validation.

It does not approve runtime ingestion.

### Production Approved

Production Approved requires Certified status plus explicit human approval metadata:

- `approved: true`
- `approvedBy`
- `approvedAt`
- `approvalTicket`

This level is intentionally impossible to reach by test data alone.

## Mandatory Requirements

The certification standard requires:

- Passing the Canonical Acquisition Interface contract
- Complete capability metadata
- Passing the Acquisition Adapter Conformance Harness
- Passing the Acquisition-to-Store Pipeline Harness
- Identity and provenance thresholds
- Deterministic fixture replay
- Recorded capabilities and limitations
- Recorded unsupported behaviors
- Dry-run only validation

## Thresholds

Default thresholds:

- Candidate identity pass rate: `95%`
- Candidate provenance pass rate: `95%`
- Certified identity pass rate: `100%`
- Certified provenance pass rate: `100%`
- Minimum eligible records: `1`

Thresholds can be overridden for experiments, but production certification should use the default strict standard unless explicitly approved.

## Report Shape

`runMarketplaceAdapterCertification(adapter, options)` returns:

- `certificationLevel`
- `productionApproved`
- `standard`
- `adapter`
- `capabilities`
- `limitations`
- `unsupportedBehaviors`
- `metrics`
- `requirements`
- `harnessReports`
- `summary`

The summary is intentionally compact for CI logs and adapter review dashboards.

## Safety Guarantees

- No live marketplace integrations.
- No API calls.
- No production store writes.
- No `server.js` changes.
- No runtime behavior changes.
- No valuation impact.
- No ROI impact.
- No Deal Gate or `BUY_NOW` impact.
- No grading, scoring, confidence, recommendation, notification, persistence, or scan timing changes.

## Future Adapter Workflow

1. Build adapter against the Canonical Acquisition Interface.
2. Create deterministic fixture records covering valid, invalid, duplicate, malformed, and partial-failure cases.
3. Run Acquisition Adapter Conformance.
4. Run Acquisition-to-Store Pipeline Conformance.
5. Run Marketplace Adapter Certification.
6. Review limitations, unsupported behaviors, and threshold failures.
7. Keep the adapter out of runtime until a separate phase explicitly approves ingestion.

Certification is a governance checkpoint. It is not a runtime integration switch.
