'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CANONICAL_MEMORY_CONTRACTS,
  COMPLIANCE_STATUS,
  EXPECTED_GROWTH,
  MEMORY_CATEGORY,
  MEMORY_LIFETIME,
  PERSISTENCE_MODEL,
  PRODUCTION_AUTHORITY,
  PRODUCTION_MEMORY_CONTRACT_SOURCE,
  REQUIRED_MEMORY_CONTRACT_FIELDS,
  buildMemoryContractFingerprint,
  createMemoryContract,
  evaluateMemoryContractCompliance,
  summarizeMemoryContracts,
  validateMemoryContract
} = require('../validation/productionMemoryContracts');

function validContract(overrides = {}) {
  return createMemoryContract({
    componentId: 'test.component',
    componentName: 'Test Component',
    owner: 'tests',
    category: MEMORY_CATEGORY.CACHE,
    lifetime: MEMORY_LIFETIME.PROCESS_LIFETIME,
    persistenceModel: PERSISTENCE_MODEL.IN_MEMORY_ONLY,
    expectedGrowth: EXPECTED_GROWTH.BOUNDED,
    maximumRetentionPolicy: '10 records',
    archivePolicy: 'none',
    inMemoryPolicy: 'bounded_test_window',
    lazyLoadEligible: false,
    streamEligible: false,
    compactEligible: false,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.COMPLIANT,
    futurePhase: 'none',
    productionAuthority: PRODUCTION_AUTHORITY.NONE,
    notes: ['Used by deterministic unit tests.'],
    ...overrides
  });
}

test('canonical memory contracts expose required offline governance records', () => {
  assert.ok(CANONICAL_MEMORY_CONTRACTS.length >= 20);

  const ids = CANONICAL_MEMORY_CONTRACTS.map((contract) => contract.componentId);
  for (const expectedId of [
    'store',
    'store.listings',
    'predictionAccuracyEngine',
    'decisionValidationEngine',
    'learningEngine',
    'historyEngine',
    'stateStore',
    'scannerLifecycle',
    'marketplaceAdapterOutput',
    'scoringObjects',
    'valuationObjects',
    'confidenceObjects'
  ]) {
    assert.ok(ids.includes(expectedId), `missing canonical contract ${expectedId}`);
  }

  for (const contract of CANONICAL_MEMORY_CONTRACTS) {
    assert.equal(contract.source, PRODUCTION_MEMORY_CONTRACT_SOURCE);
    assert.equal(validateMemoryContract(contract).valid, true, contract.componentId);
  }
});

test('createMemoryContract normalizes required fields and produces stable fingerprints', () => {
  const first = validContract();
  const second = validContract();

  assert.equal(first.componentId, 'test.component');
  assert.equal(first.stableFingerprint, second.stableFingerprint);
  assert.equal(first.stableFingerprint, buildMemoryContractFingerprint(first));
  assert.ok(Object.isFrozen(first));
});

test('fingerprint excludes the stableFingerprint field itself', () => {
  const contract = validContract();
  const mutated = {
    ...contract,
    stableFingerprint: 'different'
  };

  assert.equal(buildMemoryContractFingerprint(contract), buildMemoryContractFingerprint(mutated));
});

test('validateMemoryContract reports missing required fields', () => {
  const invalid = {
    source: PRODUCTION_MEMORY_CONTRACT_SOURCE,
    componentId: 'incomplete'
  };

  const result = validateMemoryContract(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.missingFields.includes('componentName'));
  assert.ok(result.errors.includes('missing_componentName'));
  assert.ok(result.errors.includes('missing_owner'));
});

test('validateMemoryContract detects fingerprint mismatch and impossible compliance', () => {
  const invalid = {
    ...validContract({
      expectedGrowth: EXPECTED_GROWTH.UNBOUNDED_CURRENTLY,
      currentCompliance: COMPLIANCE_STATUS.COMPLIANT
    }),
    stableFingerprint: 'bad-fingerprint'
  };

  const result = validateMemoryContract(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('fingerprint_mismatch'));
  assert.ok(result.errors.includes('compliant_contract_cannot_have_unbounded_growth'));
});

test('evaluateMemoryContractCompliance summarizes status, categories, and required controls', () => {
  const contracts = [
    validContract({ componentId: 'compliant.cache', category: MEMORY_CATEGORY.CACHE }),
    validContract({
      componentId: 'noncompliant.listings',
      category: MEMORY_CATEGORY.LISTING_COLLECTION,
      expectedGrowth: EXPECTED_GROWTH.UNBOUNDED_CURRENTLY,
      currentCompliance: COMPLIANCE_STATUS.NON_COMPLIANT,
      archivePolicy: 'required',
      lazyLoadEligible: true,
      streamEligible: true,
      compactEligible: true,
      futurePhase: '11.3'
    }),
    validContract({
      componentId: 'partial.history',
      category: MEMORY_CATEGORY.HISTORY_STORE,
      expectedGrowth: EXPECTED_GROWTH.PARTIALLY_BOUNDED,
      currentCompliance: COMPLIANCE_STATUS.PARTIAL,
      archivePolicy: 'required',
      lazyLoadEligible: true,
      streamEligible: true,
      compactEligible: true,
      futurePhase: '11.3'
    })
  ];

  const summary = evaluateMemoryContractCompliance(contracts);
  assert.equal(summary.totalContracts, 3);
  assert.equal(summary.nonCompliantCount, 1);
  assert.equal(summary.partialComplianceCount, 1);
  assert.equal(summary.byCategory[MEMORY_CATEGORY.CACHE], 1);
  assert.ok(summary.violations.some((violation) => violation.componentId === 'noncompliant.listings'));
  assert.ok(summary.archiveRequired.includes('noncompliant.listings'));
  assert.ok(summary.lazyLoadEligible.includes('partial.history'));
  assert.equal(summary.invalidContractCount, 0);
});

test('canonical compliance summary captures Phase 11.0A memory risks', () => {
  const summary = evaluateMemoryContractCompliance(CANONICAL_MEMORY_CONTRACTS);

  assert.ok(summary.totalContracts >= REQUIRED_MEMORY_CONTRACT_FIELDS.length);
  assert.ok(summary.nonCompliantCount >= 4);
  assert.ok(summary.partialComplianceCount >= 5);
  assert.ok(summary.boundedRequired.includes('store.listings'));
  assert.ok(summary.archiveRequired.includes('predictionAccuracyEngine'));
  assert.ok(summary.streamEligible.includes('historyEngine'));
  assert.equal(summary.invalidContractCount, 0);
});

test('summarizeMemoryContracts returns deterministic human-readable governance text', () => {
  const text = summarizeMemoryContracts([
    validContract({ componentId: 'one' }),
    validContract({
      componentId: 'two',
      expectedGrowth: EXPECTED_GROWTH.UNBOUNDED_CURRENTLY,
      currentCompliance: COMPLIANCE_STATUS.NON_COMPLIANT,
      futurePhase: '11.2'
    })
  ]);

  assert.equal(
    text,
    'Production memory contracts: 2 total, 1 non-compliant, 0 partially compliant, 2 require explicit bounds.'
  );
});
