'use strict';

const signalContracts = require('./signalContractRegistry');

function buildEvidencePolicy(contract = {}) {
  return {
    requiresTrueSold: Boolean(contract.requiresTrueSold),
    allowsActiveEvidence: Boolean(contract.allowsActiveEvidence),
    allowsFallbackEvidence: Boolean(contract.allowsFallbackEvidence)
  };
}

function annotateSignal(signalId, rawValue) {
  const contract = signalContracts.getSignalContract(signalId);
  if (!contract) {
    return null;
  }

  return {
    signalId: contract.signalId,
    owner: contract.owner,
    signalType: contract.signalType,
    decisionEligibility: contract.decisionEligibility,
    evidencePolicy: buildEvidencePolicy(contract),
    allowedDisplayLanguage: contract.allowedDisplayLanguage,
    confidenceMeaning: contract.confidenceMeaning,
    displayPriority: contract.displayPriority,
    rawValue
  };
}

function annotateSignals(rawSignals = {}) {
  return Object.fromEntries(
    Object.entries(rawSignals)
      .map(([signalId, rawValue]) => [signalId, annotateSignal(signalId, rawValue)])
      .filter(([, annotation]) => annotation)
      .sort(([, a], [, b]) => a.displayPriority - b.displayPriority)
  );
}

function getProductionDecisionAnnotations(annotations = {}) {
  return Object.values(annotations).filter((annotation) => (
    annotation.signalType === signalContracts.SIGNAL_TYPES.productionDecision ||
    annotation.decisionEligibility === signalContracts.DECISION_ELIGIBILITY.productionDecision
  ));
}

module.exports = {
  annotateSignal,
  annotateSignals,
  getProductionDecisionAnnotations
};
