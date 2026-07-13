'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const registry = require('../utils/signalContractRegistry');
const signalSemantics = require('../utils/signalSemantics');

test('quality and context signals cannot emit buy-like wording', () => {
  assert.equal(
    signalSemantics.getAllowedSignalLabel('quality_bucket', 'Strong Buy Candidate'),
    'Strong desirability context'
  );
  assert.equal(
    signalSemantics.getAllowedSignalLabel('quality_bucket', 'Elite'),
    'Premium desirability context'
  );

  const label = signalSemantics.getAllowedSignalLabel('trust_level', 'Elite');
  assert.equal(/buy|buy_now|elite/i.test(label), false);
});

test('ROI recommendation labels use neutral financial language', () => {
  assert.equal(
    signalSemantics.getAllowedSignalLabel('roi_recommendation', 'BUY_NOW'),
    'Financial ROI context'
  );
  assert.equal(
    signalSemantics.getAllowedSignalLabel('roi_recommendation', 'Strong ROI'),
    'Strong ROI financial context'
  );
});

test('legacy grade actions are labeled as legacy context', () => {
  assert.equal(
    signalSemantics.getAllowedSignalLabel('deal_grade', 'BUY_NOW'),
    'Legacy grade context'
  );
  assert.equal(
    signalSemantics.getAllowedSignalLabel('deal_grade', 'REVIEW'),
    'Legacy grade context'
  );
});

test('evidence-only signals remain non-authoritative', () => {
  assert.equal(
    signalSemantics.describeSignalAuthority('sold_evidence_confidence'),
    'evidence_only_non_authoritative'
  );
  assert.equal(
    signalSemantics.describeSignalAuthority('decision_intelligence'),
    'evidence_only_non_authoritative'
  );

  const evidenceSignals = registry.listSignalContracts().filter((contract) => (
    contract.signalType === registry.SIGNAL_TYPES.evidence
  ));

  for (const contract of evidenceSignals) {
    assert.notEqual(contract.decisionEligibility, registry.DECISION_ELIGIBILITY.productionDecision);
  }
});

test('Deal Gate remains the only production-decision signal allowed to keep decision language', () => {
  assert.equal(signalSemantics.getAllowedSignalLabel('deal_gate', 'BUY_NOW'), 'BUY_NOW');
  assert.equal(signalSemantics.describeSignalAuthority('deal_gate'), 'production_decision');
  assert.deepEqual(registry.getProductionDecisionSignals().map((contract) => contract.signalId), ['deal_gate']);
});
