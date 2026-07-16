'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createDecisionDossier,
  createEmptyDecisionDossierStore,
  addDecisionDossier
} = require('../validation/canonicalSourceDecisionDossier');
const {
  QUALIFICATION_STATUS: PROVIDER_QUALIFICATION_STATUS
} = require('../validation/providerEvaluation');
const {
  BLOCKING_REASON,
  RECOMMENDED_ACTION,
  SOURCE,
  WORKFLOW_STATE,
  buildQualificationPackageFingerprint,
  createProviderQualificationPackage,
  mapDossierToProviderEvaluationInput,
  validateDossierFacts
} = require('../validation/canonicalProviderQualificationWorkflow');

function completeDossier(overrides = {}) {
  return createDecisionDossier({
    providerName: 'Provider Alpha',
    providerCategory: 'licensed_aggregator',
    intendedPurpose: 'Evaluate Provider Alpha for canonical sold-evidence adapter planning.',
    transactionLevelSoldEvidenceAvailability: 'documented',
    acceptedOfferVisibility: 'visible',
    apiAvailability: 'available',
    licensingStatus: 'documented',
    commercialUseStatus: 'approved',
    internalUseStatus: 'permitted_with_license',
    attributionRequirements: 'Internal audit attribution required.',
    redistributionRestrictions: 'No redistribution without written permission.',
    technicalReadiness: 'documentation_ready',
    providerMaturity: 'established',
    pricingModel: 'subscription',
    documentationLinks: [
      {
        label: 'License',
        type: 'license',
        url: 'https://example.test/provider-alpha/license'
      },
      {
        label: 'Terms',
        type: 'terms',
        url: 'https://example.test/provider-alpha/terms'
      },
      {
        label: 'API',
        type: 'api',
        url: 'https://example.test/provider-alpha/api'
      }
    ],
    evaluationDate: '2026-07-16T00:00:00.000Z',
    evaluator: 'cardhawk-ops',
    blockingReasons: [],
    recommendedNextAction: 'send_to_provider_evaluation',
    ...overrides
  }, {
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z'
  });
}

function providerEvaluationOptions(overrides = {}) {
  return {
    exactIdentitySupport: 'strong',
    provenanceQuality: 'strong',
    stableRecordIdentifiers: 'stable',
    historicalCoverage: 'deep',
    recencyCoverage: 'current',
    correctionCancellationBehavior: 'documented',
    schemaStability: 'versioned',
    versionTracking: true,
    longTermOperationalRisk: 'low',
    identityFields: ['category', 'subject', 'year', 'brand', 'setName', 'cardNumber'],
    provenanceFields: ['sourceRecordId', 'acquiredAt', 'url'],
    adapterMetadata: {
      sourceId: 'provider_alpha',
      marketplace: 'provider_alpha_market',
      adapterName: 'provider_alpha_partner_adapter',
      adapterVersion: '0.1.0',
      interfaceVersion: '1.0.0'
    },
    ...overrides
  };
}

test('provider qualification package evaluates a complete dossier through existing provider evaluation', () => {
  const dossier = completeDossier();
  const pkg = createProviderQualificationPackage({ dossier }, {
    workflowId: 'provider_qualification_alpha',
    providerEvaluation: providerEvaluationOptions()
  });

  assert.equal(pkg.source, SOURCE);
  assert.equal(pkg.workflowId, 'provider_qualification_alpha');
  assert.equal(pkg.workflowState, WORKFLOW_STATE.QUALIFIED_FOR_ADAPTER_PLANNING);
  assert.equal(pkg.dossierId, dossier.dossierId);
  assert.equal(pkg.dossierFingerprint, dossier.stableFingerprint);
  assert.equal(pkg.providerEvaluationResult.qualificationStatus, PROVIDER_QUALIFICATION_STATUS.QUALIFIED_FOR_ADAPTER_DEVELOPMENT);
  assert.equal(pkg.providerEvaluationFingerprint, pkg.providerEvaluationResult.stableFingerprint);
  assert.equal(pkg.stableFingerprint, buildQualificationPackageFingerprint(pkg));
  assert.deepEqual(pkg.blockingReasons, []);
  assert.equal(pkg.recommendedNextAction, RECOMMENDED_ACTION.PLAN_ADAPTER);
});

test('workflow can load a dossier from a provided dossier store by exact ID', () => {
  const dossier = completeDossier();
  const store = addDecisionDossier(createEmptyDecisionDossierStore(), dossier).store;
  const pkg = createProviderQualificationPackage({
    dossierStore: store,
    dossierId: dossier.dossierId
  }, {
    providerEvaluation: providerEvaluationOptions()
  });

  assert.equal(pkg.dossierId, dossier.dossierId);
  assert.equal(pkg.dossierFingerprint, dossier.stableFingerprint);
  assert.equal(pkg.providerIdentity.providerName, 'Provider Alpha');
});

test('unknown permission, licensing, and transaction facts block provider evaluation', () => {
  const dossier = completeDossier({
    transactionLevelSoldEvidenceAvailability: 'unknown',
    acceptedOfferVisibility: 'unknown',
    apiAvailability: 'unknown',
    licensingStatus: 'unknown',
    commercialUseStatus: 'unknown',
    internalUseStatus: 'unknown'
  });
  const pkg = createProviderQualificationPackage({ dossier }, {
    providerEvaluation: providerEvaluationOptions()
  });

  assert.equal(pkg.workflowState, WORKFLOW_STATE.BLOCKED);
  assert.equal(pkg.providerEvaluationResult, null);
  assert.equal(pkg.providerEvaluationFingerprint, null);
  assert.equal(pkg.blockingReasons.includes(BLOCKING_REASON.TRANSACTION_LEVEL_EVIDENCE_UNKNOWN), true);
  assert.equal(pkg.blockingReasons.includes(BLOCKING_REASON.LICENSING_STATUS_UNKNOWN), true);
  assert.equal(pkg.blockingReasons.includes(BLOCKING_REASON.COMMERCIAL_USE_STATUS_UNKNOWN), true);
  assert.equal(pkg.requiredDaltonDecisions.length >= 3, true);
  assert.equal(pkg.recommendedNextAction, RECOMMENDED_ACTION.REQUEST_PERMISSION_DOCUMENTATION);
});

test('undocumented facts remain undocumented and do not become permission by inference', () => {
  const dossier = completeDossier({
    transactionLevelSoldEvidenceAvailability: 'marketing_page_claim',
    licensingStatus: 'consumer_subscription',
    commercialUseStatus: 'popular_provider',
    internalUseStatus: 'privacy_policy_mentions_analytics'
  });
  const validation = validateDossierFacts(dossier);
  const pkg = createProviderQualificationPackage({ dossier }, {
    providerEvaluation: providerEvaluationOptions()
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.reasons.includes(BLOCKING_REASON.TRANSACTION_LEVEL_EVIDENCE_UNDOCUMENTED), true);
  assert.equal(validation.reasons.includes(BLOCKING_REASON.LICENSING_STATUS_UNDOCUMENTED), true);
  assert.equal(validation.reasons.includes(BLOCKING_REASON.COMMERCIAL_USE_STATUS_UNDOCUMENTED), true);
  assert.equal(pkg.providerEvaluationResult, null);
  assert.equal(pkg.permissionStatus, 'popular_provider');
  assert.equal(pkg.licensingStatus, 'consumer_subscription');
});

test('workflow package is deterministic and preserves offline authority boundaries', () => {
  const dossier = completeDossier();
  const first = createProviderQualificationPackage({ dossier }, {
    workflowId: 'provider_qualification_alpha',
    providerEvaluation: providerEvaluationOptions()
  });
  const second = createProviderQualificationPackage({ dossier }, {
    workflowId: 'provider_qualification_alpha',
    providerEvaluation: providerEvaluationOptions()
  });

  assert.equal(first.stableFingerprint, second.stableFingerprint);
  assert.equal(first.productionApproval, false);
  assert.equal(first.liveIngestionAuthority, false);
  assert.equal(first.marketplaceRequestAuthority, false);
  assert.equal(first.automaticStoreWriteAuthority, false);
  assert.equal(first.canonicalSoldEvidenceWriteAuthority, false);
});

test('dossier facts map to provider evaluation input without automatic provider communication', () => {
  const dossier = completeDossier();
  const providerInput = mapDossierToProviderEvaluationInput(dossier, providerEvaluationOptions());

  assert.equal(providerInput.providerName, 'Provider Alpha');
  assert.equal(providerInput.permissionStatus, 'approved');
  assert.equal(providerInput.licensingStatus, 'documented');
  assert.equal(providerInput.commercialUsePermitted, true);
  assert.equal(providerInput.capabilities.transactionLevelSoldSupport, true);
  assert.equal(providerInput.capabilities.acceptedBestOfferSupport, true);
  assert.equal(providerInput.capabilities.accessMode, 'partner_api');
  assert.equal(providerInput.documentation.licenseUrl, 'https://example.test/provider-alpha/license');
  assert.equal(providerInput.documentation.apiDocsUrl, 'https://example.test/provider-alpha/api');
});
