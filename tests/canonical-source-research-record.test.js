'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createDecisionDossier
} = require('../validation/canonicalSourceDecisionDossier');
const {
  CLAIM_AUTHORITY,
  EVIDENCE_CLASS,
  FACT_KEY,
  PACKET_SOURCE,
  SOURCE,
  buildSourceEvidencePacketFingerprint,
  buildSourceResearchRecordFingerprint,
  createSourceEvidencePacket,
  createSourceResearchRecord,
  identifyContradictions,
  identifyStaleOrUndatedEvidence,
  summarizeEvidencePacketForDossier
} = require('../validation/canonicalSourceResearchRecord');

function officialTermsRecord(overrides = {}) {
  return createSourceResearchRecord({
    recordId: 'provider-alpha-terms-2026-07-16',
    providerId: 'provider_alpha',
    providerName: 'Provider Alpha',
    providerCategory: 'licensed_aggregator',
    evidenceClass: EVIDENCE_CLASS.OFFICIAL_TERMS,
    researchDate: '2026-07-16',
    researcher: 'cardhawk-ops',
    intendedUse: 'Determine whether Provider Alpha can support canonical sold-evidence research.',
    officialWebsite: 'https://example.test/provider-alpha',
    officialTermsOrLicense: {
      label: 'Provider Alpha License',
      url: 'https://example.test/provider-alpha/license'
    },
    transactionLevelEvidenceClaims: 'documented',
    acceptedOfferVisibilityClaims: 'visible',
    commercialUseClaims: 'approved',
    internalUseClaims: 'permitted_with_license',
    licensingStatus: 'documented',
    attributionRequirements: 'Provider attribution required in audit records.',
    redistributionRestrictions: 'No redistribution without written permission.',
    researchConfidence: 'high',
    sourceCitations: [
      {
        label: 'License Section 2',
        url: 'https://example.test/provider-alpha/license#section-2',
        capturedAt: '2026-07-16'
      }
    ],
    ...overrides
  }, {
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  });
}

function apiRecord(overrides = {}) {
  return createSourceResearchRecord({
    recordId: 'provider-alpha-api-2026-07-16',
    providerId: 'provider_alpha',
    providerName: 'Provider Alpha',
    providerCategory: 'licensed_aggregator',
    evidenceClass: EVIDENCE_CLASS.OFFICIAL_API_DOCUMENTATION,
    researchDate: '2026-07-16',
    researcher: 'cardhawk-ops',
    intendedUse: 'Confirm API availability for canonical source research.',
    apiDocumentation: {
      label: 'Provider Alpha API',
      url: 'https://example.test/provider-alpha/api'
    },
    apiAvailability: 'available',
    salesDataClaims: 'available',
    transactionLevelEvidenceClaims: 'documented',
    acceptedOfferVisibilityClaims: 'visible',
    researchConfidence: 'high',
    ...overrides
  }, {
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  });
}

test('source research record captures governed evidence and stable fingerprint', () => {
  const record = officialTermsRecord();

  assert.equal(record.source, SOURCE);
  assert.equal(record.evidenceClass, EVIDENCE_CLASS.OFFICIAL_TERMS);
  assert.equal(record.claimAuthority, CLAIM_AUTHORITY.SUPPORTS_PERMISSION);
  assert.equal(record.providerIdentity.providerName, 'Provider Alpha');
  assert.equal(record.claims.commercialUseClaims.value, 'approved');
  assert.equal(record.references.officialTermsOrLicense.url, 'https://example.test/provider-alpha/license');
  assert.equal(record.stableFingerprint, buildSourceResearchRecordFingerprint(record));
  assert.equal(record.productionApproval, false);
  assert.equal(record.liveIngestionAuthority, false);
  assert.equal(record.marketplaceRequestAuthority, false);
  assert.equal(record.canonicalSoldEvidenceWriteAuthority, false);
});

test('evidence packet groups records and produces dossier-ready summary', () => {
  const packet = createSourceEvidencePacket({
    packetId: 'provider-alpha-evidence',
    records: [officialTermsRecord(), apiRecord()]
  }, {
    evaluationDate: '2026-07-16T00:00:00.000Z',
    evaluator: 'cardhawk-ops',
    now: '2026-07-16T00:00:00.000Z'
  });
  const summary = summarizeEvidencePacketForDossier(packet);
  const dossier = createDecisionDossier(summary, {
    createdAt: '2026-07-16T00:00:00.000Z'
  });

  assert.equal(packet.source, PACKET_SOURCE);
  assert.equal(packet.records.length, 2);
  assert.equal(packet.rawClaims.some((claim) => claim.factKey === FACT_KEY.COMMERCIAL_USE), true);
  assert.equal(summary.providerName, 'Provider Alpha');
  assert.equal(summary.transactionLevelSoldEvidenceAvailability, 'documented');
  assert.equal(summary.acceptedOfferVisibility, 'visible');
  assert.equal(summary.apiAvailability, 'available');
  assert.equal(summary.licensingStatus, 'documented');
  assert.equal(summary.commercialUseStatus, 'approved');
  assert.equal(summary.internalUseStatus, 'permitted_with_license');
  assert.equal(summary.documentationLinks.some((link) => link.type === 'apiDocumentation'), true);
  assert.equal(dossier.providerName, 'Provider Alpha');
  assert.equal(packet.stableFingerprint, buildSourceEvidencePacketFingerprint(packet));
});

test('marketing and third-party claims never establish permission or licensing', () => {
  const marketing = createSourceResearchRecord({
    recordId: 'provider-alpha-marketing',
    providerId: 'provider_alpha',
    providerName: 'Provider Alpha',
    providerCategory: 'licensed_aggregator',
    evidenceClass: EVIDENCE_CLASS.MARKETING_CLAIM,
    researchDate: '2026-07-16',
    commercialUseClaims: 'approved',
    internalUseClaims: 'permitted',
    licensingStatus: 'documented',
    transactionLevelEvidenceClaims: 'documented',
    sourceCitations: ['https://example.test/provider-alpha/marketing']
  });
  const thirdParty = createSourceResearchRecord({
    recordId: 'provider-alpha-third-party',
    providerId: 'provider_alpha',
    providerName: 'Provider Alpha',
    providerCategory: 'licensed_aggregator',
    evidenceClass: EVIDENCE_CLASS.THIRD_PARTY_REFERENCE,
    researchDate: '2026-07-16',
    commercialUseClaims: 'approved',
    licensingStatus: 'documented',
    sourceCitations: ['https://example.test/provider-alpha-review']
  });
  const packet = createSourceEvidencePacket({
    records: [marketing, thirdParty]
  }, {
    now: '2026-07-16T00:00:00.000Z'
  });

  assert.equal(marketing.claimAuthority, CLAIM_AUTHORITY.CONTEXT_ONLY);
  assert.equal(thirdParty.claimAuthority, CLAIM_AUTHORITY.CONTEXT_ONLY);
  assert.equal(packet.dossierSummary.commercialUseStatus, 'unknown');
  assert.equal(packet.dossierSummary.licensingStatus, 'unknown');
  assert.equal(packet.unknownFacts.includes('commercialUseStatus'), true);
  assert.equal(packet.unknownFacts.includes('licensingStatus'), true);
});

test('evidence packet flags contradictions across positive and negative claims', () => {
  const positive = officialTermsRecord();
  const negative = createSourceResearchRecord({
    recordId: 'provider-alpha-response-no-commercial',
    providerId: 'provider_alpha',
    providerName: 'Provider Alpha',
    providerCategory: 'licensed_aggregator',
    evidenceClass: EVIDENCE_CLASS.PROVIDER_CORRESPONDENCE,
    researchDate: '2026-07-17',
    commercialUseClaims: 'prohibited',
    licensingStatus: 'documented',
    providerResponseStatus: 'received',
    providerResponseSummary: 'Provider says commercial use is not allowed under current plan.'
  });
  const contradictions = identifyContradictions([positive, negative]);
  const packet = createSourceEvidencePacket({
    records: [positive, negative]
  }, {
    now: '2026-07-17T00:00:00.000Z'
  });

  assert.equal(contradictions.some((entry) => entry.factKey === FACT_KEY.COMMERCIAL_USE), true);
  assert.equal(packet.contradictions.some((entry) => entry.factKey === FACT_KEY.COMMERCIAL_USE), true);
  assert.equal(packet.dossierSummary.blockingReasons.includes('contradictory_source_evidence'), true);
});

test('stale and undated evidence are flagged without mutating raw claims', () => {
  const stale = officialTermsRecord({
    recordId: 'provider-alpha-old-terms',
    researchDate: '2024-01-01'
  });
  const undated = apiRecord({
    recordId: 'provider-alpha-undated-api',
    researchDate: null
  });
  const findings = identifyStaleOrUndatedEvidence([stale, undated], {
    now: '2026-07-16T00:00:00.000Z',
    staleAfterDays: 365
  });
  const packet = createSourceEvidencePacket({
    records: [stale, undated]
  }, {
    now: '2026-07-16T00:00:00.000Z',
    staleAfterDays: 365
  });

  assert.equal(findings.some((finding) => finding.issue === 'stale_evidence'), true);
  assert.equal(findings.some((finding) => finding.issue === 'undated_evidence'), true);
  assert.equal(packet.staleOrUndatedEvidence.length, 2);
  assert.equal(packet.dossierSummary.blockingReasons.includes('stale_or_undated_source_evidence'), true);
});

test('evidence packet is deterministic for unchanged governed inputs', () => {
  const first = createSourceEvidencePacket({
    packetId: 'provider-alpha-evidence',
    records: [officialTermsRecord(), apiRecord()]
  }, {
    evaluationDate: '2026-07-16T00:00:00.000Z',
    evaluator: 'cardhawk-ops',
    now: '2026-07-16T00:00:00.000Z',
    createdAt: '2026-07-16T00:00:00.000Z'
  });
  const second = createSourceEvidencePacket({
    packetId: 'provider-alpha-evidence',
    records: [officialTermsRecord(), apiRecord()]
  }, {
    evaluationDate: '2026-07-16T00:00:00.000Z',
    evaluator: 'cardhawk-ops',
    now: '2026-07-16T00:00:00.000Z',
    createdAt: '2026-07-17T00:00:00.000Z'
  });

  assert.equal(first.stableFingerprint, second.stableFingerprint);
});
