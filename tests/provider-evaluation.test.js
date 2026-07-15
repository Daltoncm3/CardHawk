'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BLOCKING_REASON,
  EVALUATION_CRITERIA,
  PROVIDER_EVALUATION_VERSION,
  QUALIFICATION_STATUS,
  RECOMMENDED_ACTION,
  SOURCE,
  buildProviderEvaluationFingerprint,
  evaluateProviderCandidate
} = require('../validation/providerEvaluation');

function qualifiedProvider(overrides = {}) {
  return {
    providerId: 'provider_alpha',
    providerName: 'Provider Alpha',
    providerVersion: '2026.07',
    marketplace: 'provider_alpha_market',
    sourceType: 'partner_feed',
    accessMode: 'partner_api',
    evaluationDate: '2026-07-15T00:00:00.000Z',
    evaluator: 'cardhawk-ops',
    permissionStatus: 'approved',
    licensingStatus: 'documented',
    commercialUsePermitted: true,
    documentation: {
      documentationProvided: true,
      licenseUrl: 'https://example.test/provider-alpha/license',
      termsUrl: 'https://example.test/provider-alpha/terms',
      apiDocsUrl: 'https://example.test/provider-alpha/api',
      sampleDataReviewed: true
    },
    capabilities: {
      accessMode: 'partner_api',
      transactionLevelSoldSupport: true,
      acceptedBestOfferSupport: true,
      shippingSupport: true,
      identityFields: ['category', 'subject', 'year', 'brand', 'setName', 'cardNumber'],
      provenanceFields: ['sourceRecordId', 'acquiredAt', 'url'],
      supportsIncrementalSync: true,
      supportsHistoricalBackfill: true,
      rateLimit: {
        documented: true,
        sustainable: true,
        requestsPerMinute: 60
      },
      commercialUse: {
        permitted: true,
        requiresLicense: true,
        redistributionAllowed: false,
        displayAllowed: false
      }
    },
    evaluation: {
      permissionStatus: 'approved',
      licensingStatus: 'documented',
      commercialUsePermitted: true,
      transactionLevelEvidence: 'strong',
      exactIdentitySupport: 'strong',
      acceptedOfferVisibility: 'visible',
      provenanceQuality: 'strong',
      stableRecordIdentifiers: 'stable',
      historicalCoverage: 'deep',
      recencyCoverage: 'current',
      correctionCancellationBehavior: 'documented',
      rateLimitCharacteristics: {
        documented: true,
        sustainable: true,
        requestsPerMinute: 60
      },
      acquisitionReliability: 'strong',
      schemaStability: 'versioned',
      versionTracking: true,
      longTermOperationalRisk: 'low'
    },
    adapterMetadata: {
      sourceId: 'provider_alpha',
      marketplace: 'provider_alpha_market',
      adapterName: 'provider_alpha_partner_adapter',
      adapterVersion: '0.1.0',
      interfaceVersion: '1.0.0'
    },
    strengths: ['deep_historical_coverage', 'stable_identifiers'],
    weaknesses: ['requires_contract_renewal_monitoring'],
    risks: ['license_terms_must_remain_current'],
    ...overrides
  };
}

function blockingProvider(overrides = {}) {
  return {
    providerId: 'provider_blocked',
    providerName: 'Provider Blocked',
    providerVersion: 'unknown',
    permissionStatus: 'restricted',
    licensingStatus: 'missing',
    commercialUsePermitted: false,
    documentation: {
      documentationProvided: false
    },
    capabilities: {
      transactionLevelSoldSupport: false,
      acceptedBestOfferSupport: false,
      identityFields: [],
      provenanceFields: [],
      commercialUse: {
        permitted: false
      }
    },
    evaluation: {
      transactionLevelEvidence: 'aggregate_only',
      exactIdentitySupport: 'weak',
      acceptedOfferVisibility: 'hidden',
      provenanceQuality: 'weak',
      stableRecordIdentifiers: 'missing',
      historicalCoverage: 'none',
      recencyCoverage: 'stale',
      correctionCancellationBehavior: 'unsupported',
      acquisitionReliability: 'weak',
      schemaStability: 'volatile',
      versionTracking: false,
      longTermOperationalRisk: 'high'
    },
    ...overrides
  };
}

test('provider evaluation approves only offline testing for a fully documented provider', () => {
  const report = evaluateProviderCandidate(qualifiedProvider({ approvedForOfflineTesting: true }));

  assert.equal(report.source, SOURCE);
  assert.equal(report.version, PROVIDER_EVALUATION_VERSION);
  assert.equal(report.providerIdentity.providerId, 'provider_alpha');
  assert.equal(report.providerVersion, '2026.07');
  assert.equal(report.permissionStatus, 'approved');
  assert.equal(report.licensingStatus, 'documented');
  assert.equal(report.qualificationStatus, QUALIFICATION_STATUS.APPROVED_FOR_OFFLINE_TESTING);
  assert.equal(report.recommendedNextAction, RECOMMENDED_ACTION.PREPARE_OFFLINE_TEST_PLAN);
  assert.deepEqual(report.blockingIssues, []);
  assert.equal(report.productionApproval, false);
  assert.equal(report.liveIngestionAuthority, false);
  assert.equal(report.marketplaceRequestAuthority, false);
  assert.equal(report.canonicalSoldEvidenceWriteAuthority, false);
  assert.equal(report.supportedCapabilities.includes('transaction_level_true_sold_evidence'), true);
  assert.equal(report.supportedCapabilities.includes('accepted_offer_visibility'), true);
  assert.equal(report.projectedCertificationRegistryKey, 'provider_alpha:provider_alpha_partner_adapter:0.1.0');
  assert.equal(report.stableFingerprint, buildProviderEvaluationFingerprint(report));
});

test('provider evaluation is deterministic for unchanged governed inputs', () => {
  const first = evaluateProviderCandidate(qualifiedProvider({ approvedForOfflineTesting: true }));
  const second = evaluateProviderCandidate(qualifiedProvider({ approvedForOfflineTesting: true }));

  assert.equal(first.stableFingerprint, second.stableFingerprint);
  assert.deepEqual(first.criteria, second.criteria);
});

test('qualified providers can be cleared for adapter development without offline-test approval', () => {
  const report = evaluateProviderCandidate(qualifiedProvider());

  assert.equal(report.qualificationStatus, QUALIFICATION_STATUS.QUALIFIED_FOR_ADAPTER_DEVELOPMENT);
  assert.equal(report.recommendedNextAction, RECOMMENDED_ACTION.DESIGN_ADAPTER_SPIKE);
  assert.equal(report.blockingIssues.length, 0);
});

test('candidate status captures non-blocking capability gaps without granting approval', () => {
  const report = evaluateProviderCandidate(qualifiedProvider({
    evaluation: {
      ...qualifiedProvider().evaluation,
      acceptedOfferVisibility: 'partial',
      historicalCoverage: 'limited',
      recencyCoverage: 'lagged',
      correctionCancellationBehavior: 'partial',
      acquisitionReliability: 'usable'
    }
  }));

  assert.equal(report.qualificationStatus, QUALIFICATION_STATUS.CANDIDATE);
  assert.equal(report.recommendedNextAction, RECOMMENDED_ACTION.REEVALUATE_PROVIDER);
  assert.equal(report.blockingIssues.length, 0);
  assert.equal(report.unsupportedCapabilities.includes('accepted_offer_visibility'), true);
});

test('blocking issues require permission, licensing, identity, provenance, schema, and risk resolution', () => {
  const report = evaluateProviderCandidate(blockingProvider());
  const codes = report.blockingIssues.map((issue) => issue.code);

  assert.equal(report.qualificationStatus, QUALIFICATION_STATUS.BLOCKED);
  assert.equal(report.recommendedNextAction, RECOMMENDED_ACTION.REQUEST_PERMISSION_DOCUMENTATION);
  assert.equal(codes.includes(BLOCKING_REASON.COMMERCIAL_USE_NOT_APPROVED), true);
  assert.equal(codes.includes(BLOCKING_REASON.LICENSING_DOCUMENTATION_MISSING), true);
  assert.equal(codes.includes(BLOCKING_REASON.TRANSACTION_LEVEL_EVIDENCE_NOT_SUPPORTED), true);
  assert.equal(codes.includes(BLOCKING_REASON.EXACT_IDENTITY_SUPPORT_INSUFFICIENT), true);
  assert.equal(codes.includes(BLOCKING_REASON.PROVENANCE_QUALITY_INSUFFICIENT), true);
  assert.equal(codes.includes(BLOCKING_REASON.STABLE_RECORD_IDENTIFIERS_MISSING), true);
  assert.equal(codes.includes(BLOCKING_REASON.SCHEMA_STABILITY_INSUFFICIENT), true);
  assert.equal(codes.includes(BLOCKING_REASON.VERSION_TRACKING_MISSING), true);
  assert.equal(codes.includes(BLOCKING_REASON.LONG_TERM_OPERATIONAL_RISK_HIGH), true);
  assert.equal(report.supportedCapabilities.includes('commercial_use_documented'), false);
});

test('explicitly rejected providers stay rejected even when fields are otherwise present', () => {
  const report = evaluateProviderCandidate(qualifiedProvider({
    rejected: true,
    approvedForOfflineTesting: true
  }));

  assert.equal(report.qualificationStatus, QUALIFICATION_STATUS.REJECTED);
  assert.equal(report.recommendedNextAction, RECOMMENDED_ACTION.REJECT_PROVIDER);
  assert.equal(report.blockingIssues.some((issue) => issue.code === BLOCKING_REASON.PROVIDER_REJECTED), true);
});

test('criteria report covers every governed Phase 8.6 evaluation category', () => {
  const report = evaluateProviderCandidate(qualifiedProvider());
  const names = report.criteria.map((entry) => entry.name);

  assert.equal(names.includes(EVALUATION_CRITERIA.COMMERCIAL_USE_PERMISSION), true);
  assert.equal(names.includes(EVALUATION_CRITERIA.LICENSING_DOCUMENTATION), true);
  assert.equal(names.includes(EVALUATION_CRITERIA.TRANSACTION_LEVEL_EVIDENCE), true);
  assert.equal(names.includes(EVALUATION_CRITERIA.EXACT_IDENTITY_SUPPORT), true);
  assert.equal(names.includes(EVALUATION_CRITERIA.ACCEPTED_OFFER_VISIBILITY), true);
  assert.equal(names.includes(EVALUATION_CRITERIA.PROVENANCE_QUALITY), true);
  assert.equal(names.includes(EVALUATION_CRITERIA.STABLE_RECORD_IDENTIFIERS), true);
  assert.equal(names.includes(EVALUATION_CRITERIA.HISTORICAL_COVERAGE), true);
  assert.equal(names.includes(EVALUATION_CRITERIA.RECENCY_COVERAGE), true);
  assert.equal(names.includes(EVALUATION_CRITERIA.CORRECTION_CANCELLATION_BEHAVIOR), true);
  assert.equal(names.includes(EVALUATION_CRITERIA.RATE_LIMIT_CHARACTERISTICS), true);
  assert.equal(names.includes(EVALUATION_CRITERIA.ACQUISITION_RELIABILITY), true);
  assert.equal(names.includes(EVALUATION_CRITERIA.SCHEMA_STABILITY), true);
  assert.equal(names.includes(EVALUATION_CRITERIA.VERSION_TRACKING), true);
  assert.equal(names.includes(EVALUATION_CRITERIA.LONG_TERM_OPERATIONAL_RISK), true);
});
