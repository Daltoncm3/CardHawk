'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ARCHIVE_ELIGIBILITY,
  CANONICAL_LISTING_STORE_MODEL,
  LISTING_LIFECYCLE_STATE,
  LISTING_STORE_CONCEPT,
  MEMORY_RESIDENCY_POLICY,
  PERSISTENCE_RESPONSIBILITY,
  RETRIEVAL_RESPONSIBILITY,
  buildListingStoreFingerprint,
  createListingStoreModel,
  evaluateListingResidency,
  summarizeListingStoreModel,
  validateListingStoreModel
} = require('../validation/listingStoreArchitecture');

test('canonical listing store model validates required offline architecture schema', () => {
  const validation = validateListingStoreModel(CANONICAL_LISTING_STORE_MODEL);

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
  assert.equal(CANONICAL_LISTING_STORE_MODEL.stores.length, 4);
  assert.equal(CANONICAL_LISTING_STORE_MODEL.lifecycleStates.includes(LISTING_LIFECYCLE_STATE.ACTIVE), true);
  assert.equal(CANONICAL_LISTING_STORE_MODEL.futureLazyLoadingSupport, true);
  assert.equal(CANONICAL_LISTING_STORE_MODEL.productionAuthority, 'architecture_only_no_runtime_authority');
});

test('listing store fingerprint is stable and excludes the fingerprint field itself', () => {
  const first = createListingStoreModel();
  const second = createListingStoreModel();

  assert.equal(first.stableFingerprint, second.stableFingerprint);
  assert.equal(first.stableFingerprint, buildListingStoreFingerprint(first));

  const withDifferentFingerprint = {
    ...first,
    stableFingerprint: 'not-the-real-fingerprint'
  };
  assert.equal(buildListingStoreFingerprint(withDifferentFingerprint), first.stableFingerprint);
});

test('schema validation detects missing stores and invalid fingerprints', () => {
  const invalid = {
    ...CANONICAL_LISTING_STORE_MODEL,
    stores: [],
    stableFingerprint: 'tampered'
  };
  const validation = validateListingStoreModel(invalid);

  assert.equal(validation.valid, false);
  assert.equal(validation.errors.includes('fingerprint_mismatch'), true);
  assert.equal(validation.errors.includes(`missing_store_concept_${LISTING_STORE_CONCEPT.ACTIVE_LISTING_STORE}`), true);
  assert.equal(validation.errors.includes(`missing_store_concept_${LISTING_STORE_CONCEPT.ARCHIVED_LISTING_STORE}`), true);
});

test('lifecycle validation detects invalid transitions and production-changing rules', () => {
  const invalid = createListingStoreModel({
    promotionDemotionRules: [
      {
        ruleId: 'bad_rule',
        fromState: 'not_a_state',
        toState: LISTING_LIFECYCLE_STATE.ACTIVE,
        productionBehaviorChange: true
      }
    ]
  });
  const validation = validateListingStoreModel(invalid);

  assert.equal(validation.valid, false);
  assert.equal(validation.errors.includes('promotion_rule_bad_rule_invalid_fromState'), true);
  assert.equal(validation.errors.includes('promotion_rule_bad_rule_changes_production_behavior'), true);
});

test('residency evaluation maps scan and active listings to memory-resident stores', () => {
  const scan = evaluateListingResidency({
    ebayItemId: 'scan-1',
    inScanWorkingSet: true
  });
  const active = evaluateListingResidency({
    ebayItemId: 'active-1',
    active: true
  });

  assert.equal(scan.lifecycleState, LISTING_LIFECYCLE_STATE.SCAN_WORKING_SET);
  assert.equal(scan.memoryResidency, MEMORY_RESIDENCY_POLICY.SCAN_LOCAL_ONLY);
  assert.deepEqual(scan.residentStores, [LISTING_STORE_CONCEPT.SCAN_WORKING_SET]);
  assert.equal(scan.persistenceResponsibility, PERSISTENCE_RESPONSIBILITY.NONE);
  assert.equal(scan.archiveEligible, false);

  assert.equal(active.lifecycleState, LISTING_LIFECYCLE_STATE.ACTIVE);
  assert.equal(active.memoryResidency, MEMORY_RESIDENCY_POLICY.ACTIVE_IN_MEMORY);
  assert.deepEqual(active.residentStores, [LISTING_STORE_CONCEPT.ACTIVE_LISTING_STORE]);
  assert.equal(active.retrievalResponsibility, RETRIEVAL_RESPONSIBILITY.ACTIVE_STORE_LOOKUP);
  assert.equal(active.productionBehaviorChange, false);
});

test('archive eligibility separates historical, stale, disappeared, and archived listings', () => {
  const observed = evaluateListingResidency({
    ebayItemId: 'observed-1',
    lifecycleState: LISTING_LIFECYCLE_STATE.OBSERVED
  });
  const stale = evaluateListingResidency({
    ebayItemId: 'stale-1',
    staleAt: '2026-07-01T00:00:00.000Z'
  });
  const disappeared = evaluateListingResidency({
    ebayItemId: 'gone-1',
    disappearedAt: '2026-07-01T00:00:00.000Z'
  });
  const archived = evaluateListingResidency({
    ebayItemId: 'archived-1',
    archivedAt: '2026-07-01T00:00:00.000Z'
  });

  assert.equal(observed.archiveEligibility, ARCHIVE_ELIGIBILITY.ELIGIBLE);
  assert.equal(observed.archiveEligible, true);
  assert.equal(observed.archiveRequired, false);
  assert.equal(observed.memoryResidency, MEMORY_RESIDENCY_POLICY.COMPACT_IN_MEMORY);

  assert.equal(stale.archiveEligibility, ARCHIVE_ELIGIBILITY.REQUIRED);
  assert.equal(stale.archiveRequired, true);
  assert.equal(stale.memoryResidency, MEMORY_RESIDENCY_POLICY.LAZY_LOAD_ON_DEMAND);

  assert.equal(disappeared.archiveEligibility, ARCHIVE_ELIGIBILITY.REQUIRED);
  assert.equal(disappeared.persistenceResponsibility, PERSISTENCE_RESPONSIBILITY.ARCHIVE_STATE);

  assert.equal(archived.archiveEligibility, ARCHIVE_ELIGIBILITY.ALREADY_ARCHIVED);
  assert.equal(archived.archiveEligible, false);
  assert.equal(archived.memoryResidency, MEMORY_RESIDENCY_POLICY.ARCHIVE_ONLY);
});

test('summary is deterministic and names architecture-only authority', () => {
  const first = summarizeListingStoreModel(CANONICAL_LISTING_STORE_MODEL);
  const second = summarizeListingStoreModel(CANONICAL_LISTING_STORE_MODEL);

  assert.deepEqual(first, second);
  assert.equal(first.valid, true);
  assert.equal(first.storeCount, 4);
  assert.equal(first.lifecycleStateCount, 6);
  assert.equal(first.archiveEligibleStates.includes(LISTING_LIFECYCLE_STATE.STALE), true);
  assert.match(first.text, /architecture_only_no_runtime_authority/);
});

test('custom model can override residency policies without changing runtime authority', () => {
  const model = createListingStoreModel({
    memoryResidencyPolicies: {
      [LISTING_LIFECYCLE_STATE.OBSERVED]: MEMORY_RESIDENCY_POLICY.LAZY_LOAD_ON_DEMAND
    }
  });
  const result = evaluateListingResidency({
    ebayItemId: 'observed-custom',
    lifecycleState: LISTING_LIFECYCLE_STATE.OBSERVED
  }, model);

  assert.equal(validateListingStoreModel(model).valid, true);
  assert.equal(result.memoryResidency, MEMORY_RESIDENCY_POLICY.LAZY_LOAD_ON_DEMAND);
  assert.equal(result.archiveEligibility, ARCHIVE_ELIGIBILITY.ELIGIBLE);
  assert.equal(model.productionAuthority, 'architecture_only_no_runtime_authority');
});
