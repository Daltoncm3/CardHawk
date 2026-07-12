'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const registry = require('../utils/signalContractRegistry');

const DISPLAYED_SIGNAL_IDS = [
  'legacy_score',
  'quality_score',
  'quality_bucket',
  'deal_grade',
  'market_confidence',
  'sold_evidence_confidence',
  'intelligence_score',
  'confidence_score',
  'trust_level',
  'roi_recommendation',
  'decision_intelligence',
  'deal_gate'
];

const REQUIRED_FIELDS = [
  'signalId',
  'owner',
  'purpose',
  'signalType',
  'decisionEligibility',
  'requiresTrueSold',
  'allowsActiveEvidence',
  'allowsFallbackEvidence',
  'allowedDisplayLanguage',
  'displayPriority',
  'confidenceMeaning',
  'schemaVersion'
];

test('every displayed signal has canonical metadata', () => {
  for (const signalId of DISPLAYED_SIGNAL_IDS) {
    const contract = registry.getSignalContract(signalId);
    assert.ok(contract, `${signalId} should have a signal contract`);

    for (const field of REQUIRED_FIELDS) {
      assert.ok(contract[field] !== undefined, `${signalId} should declare ${field}`);
    }
  }
});

test('every signal has exactly one owner and stable schema version', () => {
  const contracts = registry.listSignalContracts();
  const ids = new Set();

  for (const contract of contracts) {
    assert.equal(ids.has(contract.signalId), false, `${contract.signalId} should be unique`);
    ids.add(contract.signalId);

    assert.equal(typeof contract.owner, 'string');
    assert.ok(contract.owner.trim(), `${contract.signalId} should have one owner`);
    assert.equal(contract.owner.includes(','), false, `${contract.signalId} should not list multiple owners`);
    assert.equal(contract.schemaVersion, registry.SCHEMA_VERSION);
  }
});

test('every signal declares decision eligibility and evidence policy', () => {
  const validEligibility = new Set(Object.values(registry.DECISION_ELIGIBILITY));
  const validTypes = new Set(Object.values(registry.SIGNAL_TYPES));
  const validDisplayLanguage = new Set(Object.values(registry.DISPLAY_LANGUAGE));

  for (const contract of registry.listSignalContracts()) {
    assert.equal(validEligibility.has(contract.decisionEligibility), true, `${contract.signalId} has invalid decisionEligibility`);
    assert.equal(validTypes.has(contract.signalType), true, `${contract.signalId} has invalid signalType`);
    assert.equal(validDisplayLanguage.has(contract.allowedDisplayLanguage), true, `${contract.signalId} has invalid allowedDisplayLanguage`);
    assert.equal(typeof contract.requiresTrueSold, 'boolean');
    assert.equal(typeof contract.allowsActiveEvidence, 'boolean');
    assert.equal(typeof contract.allowsFallbackEvidence, 'boolean');
    assert.equal(Number.isInteger(contract.displayPriority), true);
  }
});

test('buy-like language is prohibited for evidence-only signals', () => {
  const evidenceOnlySignals = registry.listSignalContracts().filter((contract) => (
    contract.decisionEligibility === registry.DECISION_ELIGIBILITY.evidenceOnly ||
    contract.signalType === registry.SIGNAL_TYPES.evidence
  ));

  assert.ok(evidenceOnlySignals.length >= 2);

  for (const contract of evidenceOnlySignals) {
    assert.notEqual(contract.allowedDisplayLanguage, registry.DISPLAY_LANGUAGE.productionDecision);
    assert.notEqual(contract.allowedDisplayLanguage, registry.DISPLAY_LANGUAGE.financialOnly);
    assert.match(contract.allowedDisplayLanguage, /evidence_only/);
    assert.equal(/\bbuy\b|buy_now|strong_buy/i.test(contract.purpose), false, `${contract.signalId} purpose should not use buy-like language`);
  }
});

test('Deal Gate remains the only production decision signal', () => {
  const productionSignals = registry.getProductionDecisionSignals();

  assert.deepEqual(productionSignals.map((contract) => contract.signalId), ['deal_gate']);

  const dealGate = registry.getSignalContract('deal_gate');
  assert.equal(dealGate.owner, 'server.dealGate');
  assert.equal(dealGate.signalType, registry.SIGNAL_TYPES.productionDecision);
  assert.equal(dealGate.decisionEligibility, registry.DECISION_ELIGIBILITY.productionDecision);
  assert.equal(dealGate.requiresTrueSold, true);
});

test('registry query helpers return defensive copies', () => {
  const contract = registry.getSignalContract('market_confidence');
  contract.owner = 'mutated';

  assert.equal(registry.getSignalContract('market_confidence').owner, 'server.scoreListing');
  assert.equal(registry.hasSignalContract('market_confidence'), true);
  assert.equal(registry.hasSignalContract('missing_signal'), false);
});
