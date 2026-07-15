'use strict';

const {
  createEmptyCertificationArtifactRegistry,
  registerCertificationArtifact
} = require('../../validation/certificationArtifactRegistry');
const {
  CERTIFICATION_LEVELS,
  CERTIFICATION_STANDARD_VERSION,
  SOURCE: CERTIFICATION_SOURCE
} = require('../../validation/marketplaceAdapterCertification');

const adapterMetadata = Object.freeze({
  sourceId: 'manual_dataset',
  marketplace: 'manual_dataset',
  adapterName: 'manual_dataset_acquisition_adapter',
  adapterVersion: '1.0.0',
  interfaceVersion: '1.0.0'
});

const providerAdapterMetadata = Object.freeze({
  sourceId: 'provider_alpha',
  marketplace: 'provider_alpha_market',
  adapterName: 'provider_alpha_partner_adapter',
  adapterVersion: '0.1.0',
  interfaceVersion: '1.0.0'
});

const identity = Object.freeze({
  category: 'sports_card',
  sport: 'mma',
  player: 'Anthony Hernandez',
  year: '2023',
  brand: 'Panini',
  setName: 'Prizm UFC',
  cardNumber: '181',
  parallel: 'Silver Prizm',
  rookie: true,
  autograph: false,
  memorabilia: false,
  serialNumbered: false
});

function productionCertification(overrides = {}) {
  const adapter = overrides.adapter || adapterMetadata;
  return {
    source: CERTIFICATION_SOURCE,
    version: CERTIFICATION_STANDARD_VERSION,
    generatedAt: '2026-07-11T00:00:00.000Z',
    certificationLevel: CERTIFICATION_LEVELS.PRODUCTION_APPROVED,
    productionApproved: true,
    passed: true,
    dryRun: true,
    standard: {
      version: CERTIFICATION_STANDARD_VERSION
    },
    adapter: {
      ...adapter
    },
    requirements: [
      {
        name: 'production_approval_recorded',
        pass: true,
        severity: 'production'
      }
    ],
    summary: {
      level: CERTIFICATION_LEVELS.PRODUCTION_APPROVED,
      approvedForProduction: true,
      passed: true,
      identityPassRate: 1,
      provenancePassRate: 1,
      eligibleRecords: 1,
      rejectedRecords: 0,
      failedRequirements: [],
      unsupportedBehaviors: [],
      limitations: []
    },
    ...overrides,
    adapter: {
      ...adapter,
      ...(overrides.adapter || {})
    }
  };
}

function sourcePermission(overrides = {}) {
  return {
    status: 'approved',
    approvedBy: 'CardHawk Legal',
    approvedAt: '2026-07-11T00:00:00.000Z',
    license: {
      id: 'manual-license-001',
      commercialUsePermitted: true,
      evidenceUse: 'internal_canonical_sold_evidence',
      displayAllowed: false,
      redistributionAllowed: false
    },
    ...overrides,
    license: {
      id: 'manual-license-001',
      commercialUsePermitted: true,
      evidenceUse: 'internal_canonical_sold_evidence',
      displayAllowed: false,
      redistributionAllowed: false,
      ...(overrides.license || {})
    }
  };
}

function soldRecord(overrides = {}) {
  return {
    marketplace: 'manual_dataset',
    marketplaceSaleId: 'manual-sale-001',
    marketplaceListingId: 'manual-listing-001',
    sourceRecordId: 'manual-row-001',
    evidenceType: 'true_sold',
    status: 'active_evidence',
    rawTitle: '2023 Panini Prizm UFC Anthony Hernandez #181 Silver Prizm RC',
    soldPrice: 8.5,
    shipping: 1.5,
    currency: 'USD',
    soldAt: '2026-07-01T12:00:00.000Z',
    url: 'https://example.test/sold/manual-sale-001',
    condition: 'raw',
    gradeCompany: 'raw',
    grade: 'unknown',
    parsedIdentity: identity,
    source: {
      adapter: 'manual_dataset_entry',
      retrievalMethod: 'manual_review',
      sourceReliability: 'verified_manual',
      acquiredAt: '2026-07-11T00:00:00.000Z'
    },
    review: {
      status: 'human_verified',
      reviewer: 'dealer-a',
      reviewedAt: '2026-07-11T13:00:00.000Z'
    },
    ...overrides
  };
}

function certificationRegistry(options = {}) {
  return registerCertificationArtifact(
    createEmptyCertificationArtifactRegistry({ createdAt: options.createdAt }),
    productionCertification(options.certificationOverrides || {}),
    {
      registeredAt: options.registeredAt || '2026-07-12T00:00:00.000Z',
      updatedAt: options.updatedAt,
      now: options.now
    }
  ).registry;
}

module.exports = {
  adapterMetadata,
  certificationRegistry,
  identity,
  productionCertification,
  providerAdapterMetadata,
  soldRecord,
  sourcePermission
};
