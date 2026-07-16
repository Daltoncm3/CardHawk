'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_DOSSIER_STORE_PATH,
  QUALIFICATION_STATUS,
  RECOMMENDED_ACTION,
  SOURCE,
  STORE_SOURCE,
  addDecisionDossier,
  buildDecisionDossierFingerprint,
  createDecisionDossier,
  createEmptyDecisionDossierStore,
  getDecisionDossier,
  listDecisionDossiers,
  loadDecisionDossierStore,
  saveDecisionDossierStore,
  updateDecisionDossier
} = require('../validation/canonicalSourceDecisionDossier');

function providerDossier(overrides = {}) {
  return {
    providerName: 'Provider Alpha',
    providerCategory: 'licensed_aggregator',
    intendedPurpose: 'Evaluate whether Provider Alpha can support canonical sold-evidence acquisition.',
    transactionLevelSoldEvidenceAvailability: 'documented',
    acceptedOfferVisibility: 'visible',
    apiAvailability: 'available',
    licensingStatus: 'documented',
    commercialUseStatus: 'requires_contract',
    internalUseStatus: 'permitted_with_license',
    attributionRequirements: 'Provider attribution required in internal audit records.',
    redistributionRestrictions: 'No redistribution without written permission.',
    technicalReadiness: 'documentation_ready',
    providerMaturity: 'established',
    pricingModel: 'subscription',
    documentationLinks: [
      {
        label: 'Terms',
        url: 'https://example.test/provider-alpha/terms',
        type: 'terms'
      },
      'https://example.test/provider-alpha/api'
    ],
    evaluationDate: '2026-07-15',
    evaluator: 'cardhawk-ops',
    qualificationStatus: QUALIFICATION_STATUS.RESEARCH,
    blockingReasons: ['commercial_use_contract_not_signed'],
    recommendedNextAction: RECOMMENDED_ACTION.REQUEST_PERMISSION_DOCUMENTATION,
    ...overrides
  };
}

test('empty canonical source decision dossier store has durable offline shape', () => {
  const store = createEmptyDecisionDossierStore({
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z'
  });

  assert.equal(store.source, STORE_SOURCE);
  assert.equal(store.version, '1.0.0');
  assert.equal(store.schemaVersion, '1.0.0');
  assert.deepEqual(store.dossiers, {});
  assert.deepEqual(store.indexes.byProviderCategory, {});
  assert.equal(store.stats.dossierCount, 0);
  assert.equal(DEFAULT_DOSSIER_STORE_PATH.endsWith(path.join('data', 'canonical-source-decision-dossiers.json')), true);
});

test('decision dossier captures governed source facts without production authority', () => {
  const dossier = createDecisionDossier(providerDossier(), {
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z'
  });

  assert.equal(dossier.source, SOURCE);
  assert.equal(dossier.dossierId, 'licensed_aggregator:provider_alpha');
  assert.equal(dossier.providerName, 'Provider Alpha');
  assert.equal(dossier.transactionLevelSoldEvidenceAvailability, 'documented');
  assert.equal(dossier.acceptedOfferVisibility, 'visible');
  assert.equal(dossier.documentationLinks.length, 2);
  assert.equal(dossier.blockingReasons[0], 'commercial_use_contract_not_signed');
  assert.equal(dossier.stableFingerprint, buildDecisionDossierFingerprint(dossier));
  assert.equal(dossier.productionApproval, false);
  assert.equal(dossier.liveIngestionAuthority, false);
  assert.equal(dossier.marketplaceRequestAuthority, false);
  assert.equal(dossier.automaticStoreWriteAuthority, false);
  assert.equal(dossier.canonicalSoldEvidenceWriteAuthority, false);
});

test('decision dossier fingerprint is deterministic and excludes persistence timestamps', () => {
  const first = createDecisionDossier(providerDossier(), {
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z'
  });
  const second = createDecisionDossier(providerDossier(), {
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  });

  assert.equal(first.stableFingerprint, second.stableFingerprint);
});

test('decision dossier store adds, indexes, gets, and safely lists dossiers', () => {
  const created = createDecisionDossier(providerDossier(), {
    createdAt: '2026-07-15T00:00:00.000Z'
  });
  const result = addDecisionDossier(createEmptyDecisionDossierStore(), created, {
    updatedAt: '2026-07-15T01:00:00.000Z'
  });

  assert.equal(result.added, true);
  assert.equal(result.store.stats.dossierCount, 1);
  assert.deepEqual(result.store.indexes.byProviderCategory.licensed_aggregator, [created.dossierId]);
  assert.deepEqual(result.store.indexes.byQualificationStatus.research, [created.dossierId]);

  const fetched = getDecisionDossier(result.store, created.dossierId);
  fetched.providerName = 'Mutated Locally';
  assert.equal(getDecisionDossier(result.store, created.dossierId).providerName, 'Provider Alpha');

  const listed = listDecisionDossiers(result.store, {
    providerCategory: 'licensed_aggregator',
    commercialUseStatus: 'requires_contract'
  });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].dossierId, created.dossierId);
});

test('decision dossier add rejects duplicates unless replacement is explicit', () => {
  const store = addDecisionDossier(createEmptyDecisionDossierStore(), providerDossier()).store;
  const duplicate = addDecisionDossier(store, providerDossier());
  const replacement = addDecisionDossier(store, providerDossier({
    intendedPurpose: 'Replacement text'
  }), { allowReplace: true });

  assert.equal(duplicate.added, false);
  assert.equal(duplicate.reason, 'decision_dossier_already_exists');
  assert.equal(replacement.added, true);
  assert.equal(getDecisionDossier(replacement.store, 'licensed_aggregator:provider_alpha').intendedPurpose, 'Replacement text');
});

test('decision dossier update preserves identity and recomputes fingerprint', () => {
  const added = addDecisionDossier(createEmptyDecisionDossierStore(), providerDossier(), {
    updatedAt: '2026-07-15T00:00:00.000Z'
  });
  const original = getDecisionDossier(added.store, 'licensed_aggregator:provider_alpha');
  const updated = updateDecisionDossier(added.store, original.dossierId, {
    commercialUseStatus: 'approved_for_internal_review',
    blockingReasons: [],
    recommendedNextAction: RECOMMENDED_ACTION.SEND_TO_PROVIDER_EVALUATION
  }, {
    updatedAt: '2026-07-16T00:00:00.000Z'
  });

  assert.equal(updated.updated, true);
  assert.equal(updated.dossier.dossierId, original.dossierId);
  assert.equal(updated.dossier.commercialUseStatus, 'approved_for_internal_review');
  assert.notEqual(updated.dossier.stableFingerprint, original.stableFingerprint);
  assert.equal(updated.dossier.stableFingerprint, buildDecisionDossierFingerprint(updated.dossier));
});

test('decision dossier persistence uses shared state store without production data writes', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-source-dossier-'));
  const storePath = path.join(tempDir, 'canonical-source-decision-dossiers.json');
  const store = addDecisionDossier(createEmptyDecisionDossierStore(), providerDossier()).store;
  const saveResult = saveDecisionDossierStore(storePath, store);
  const loaded = loadDecisionDossierStore(storePath);

  assert.equal(saveResult.ok, true);
  assert.equal(fs.existsSync(storePath), true);
  assert.equal(loaded.stats.dossierCount, 1);
  assert.equal(getDecisionDossier(loaded, 'licensed_aggregator:provider_alpha').stableFingerprint, getDecisionDossier(store, 'licensed_aggregator:provider_alpha').stableFingerprint);
});
