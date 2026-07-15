'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  fingerprint
} = require('../validation/canonicalValidationCore');
const {
  buildFingerprintFromProjection
} = require('../validation/fingerprintProjection');
const {
  buildOfflineAuthorityFlags,
  chooseRecommendedAction,
  collectBlockingReasons,
  firstDefined,
  normalizeRequirement
} = require('../validation/phase8GovernanceCore');
const {
  adapterMetadata,
  certificationRegistry,
  productionCertification,
  soldRecord,
  sourcePermission
} = require('./helpers/phase8CanonicalFixtures');

test('fingerprint projection helper preserves canonical fingerprint output exactly', () => {
  const projection = {
    sourceId: 'provider_alpha',
    adapterName: 'provider_alpha_partner_adapter',
    counts: {
      admitted: 8,
      rejected: 2
    },
    reasons: ['manual_review_required']
  };

  assert.equal(buildFingerprintFromProjection(projection), fingerprint(projection));
});

test('governance primitives normalize requirements and collect blocking reasons deterministically', () => {
  assert.equal(firstDefined(null, undefined, '', 'ready'), 'ready');
  assert.deepEqual(normalizeRequirement({ required: true, configured: true, note: 'ok' }), {
    required: true,
    satisfied: true,
    details: {
      required: true,
      configured: true,
      note: 'ok'
    }
  });
  assert.deepEqual(collectBlockingReasons([
    { when: true, reason: ['missing_permission', 'missing_permission'] },
    { when: false, reason: 'ignored' },
    { when: true, reason: () => 'missing_replay' }
  ]), ['missing_permission', 'missing_replay']);
  assert.equal(chooseRecommendedAction([
    { when: false, action: 'ignored' },
    { when: true, action: 'resolve_permission' }
  ], 'fallback'), 'resolve_permission');
});

test('offline authority flags preserve explicit no-production authority defaults', () => {
  assert.deepEqual(buildOfflineAuthorityFlags(), {
    productionApproval: false,
    liveIngestionAuthority: false,
    marketplaceRequestAuthority: false,
    automaticStoreWriteAuthority: false,
    canonicalSoldEvidenceWriteAuthority: false
  });
});

test('shared Phase 8 fixtures produce certification, permission, registry, adapter, and sold-record objects', () => {
  const registry = certificationRegistry();
  const entry = registry.entries[`${adapterMetadata.sourceId}:${adapterMetadata.adapterName}:${adapterMetadata.adapterVersion}`];

  assert.equal(productionCertification().productionApproved, true);
  assert.equal(sourcePermission().license.commercialUsePermitted, true);
  assert.equal(soldRecord().evidenceType, 'true_sold');
  assert.equal(adapterMetadata.adapterName, 'manual_dataset_acquisition_adapter');
  assert.equal(entry.approvalStatus, 'production_approved');
});
