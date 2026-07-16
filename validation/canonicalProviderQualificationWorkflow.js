'use strict';

const {
  asArray,
  asObject,
  unique
} = require('./canonicalValidationCore');
const {
  buildDecisionDossierFingerprint,
  createDecisionDossier,
  getDecisionDossier,
  loadDecisionDossierStore
} = require('./canonicalSourceDecisionDossier');
const {
  QUALIFICATION_STATUS: PROVIDER_QUALIFICATION_STATUS,
  evaluateProviderCandidate
} = require('./providerEvaluation');
const {
  buildOfflineAuthorityFlags,
  chooseRecommendedAction,
  clone,
  collectBlockingReasons,
  firstDefined
} = require('./phase8GovernanceCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');

const SOURCE = 'canonical_provider_qualification_workflow';
const WORKFLOW_VERSION = '1.0.0';

const WORKFLOW_STATE = Object.freeze({
  INCOMPLETE: 'incomplete',
  BLOCKED: 'blocked',
  READY_FOR_EVALUATION: 'ready_for_evaluation',
  EVALUATED: 'evaluated',
  AWAITING_BUSINESS_DECISION: 'awaiting_business_decision',
  QUALIFIED_FOR_ADAPTER_PLANNING: 'qualified_for_adapter_planning',
  REJECTED: 'rejected'
});

const BLOCKING_REASON = Object.freeze({
  DOSSIER_MISSING: 'dossier_missing',
  DOSSIER_FINGERPRINT_MISSING: 'dossier_fingerprint_missing',
  DOSSIER_FINGERPRINT_MISMATCH: 'dossier_fingerprint_mismatch',
  PROVIDER_NAME_MISSING: 'provider_name_missing',
  INTENDED_PURPOSE_MISSING: 'intended_purpose_missing',
  TRANSACTION_LEVEL_EVIDENCE_UNKNOWN: 'transaction_level_sold_evidence_unknown',
  TRANSACTION_LEVEL_EVIDENCE_UNDOCUMENTED: 'transaction_level_sold_evidence_undocumented',
  ACCEPTED_OFFER_VISIBILITY_UNKNOWN: 'accepted_offer_visibility_unknown',
  API_STATUS_UNKNOWN: 'api_status_unknown',
  LICENSING_STATUS_UNKNOWN: 'licensing_status_unknown',
  LICENSING_STATUS_UNDOCUMENTED: 'licensing_status_undocumented',
  COMMERCIAL_USE_STATUS_UNKNOWN: 'commercial_use_status_unknown',
  COMMERCIAL_USE_STATUS_UNDOCUMENTED: 'commercial_use_status_undocumented',
  INTERNAL_USE_STATUS_UNKNOWN: 'internal_use_status_unknown',
  REQUIRED_DALTON_DECISION_PENDING: 'required_dalton_decision_pending',
  PROVIDER_EVALUATION_BLOCKED: 'provider_evaluation_blocked',
  PROVIDER_REJECTED: 'provider_rejected'
});

const RECOMMENDED_ACTION = Object.freeze({
  COMPLETE_DOSSIER: 'complete_source_decision_dossier',
  REQUEST_PERMISSION_DOCUMENTATION: 'request_permission_documentation',
  RESOLVE_BUSINESS_QUESTIONS: 'resolve_business_questions',
  RUN_PROVIDER_EVALUATION: 'run_provider_evaluation',
  REVIEW_PROVIDER_EVALUATION: 'review_provider_evaluation',
  PLAN_ADAPTER: 'plan_adapter_development',
  REJECT_PROVIDER: 'reject_provider'
});

const UNKNOWN_VALUES = new Set(['unknown', 'undocumented', 'missing', 'not_documented', 'not_available', 'unavailable']);
const POSITIVE_PERMISSION_VALUES = new Set(['approved', 'documented', 'licensed', 'permitted', 'permitted_with_license', 'approved_for_internal_review']);
const POSITIVE_TRANSACTION_VALUES = new Set(['documented', 'available', 'verified', 'strong', 'transaction_level', 'full']);
const POSITIVE_API_VALUES = new Set(['available', 'documented', 'partner_api', 'official_api', 'ready']);

function normalizeStatus(value, fallback = 'unknown') {
  return String(value || fallback).trim().toLowerCase().replace(/\s+/g, '_') || fallback;
}

function present(value) {
  return value !== undefined && value !== null && value !== '';
}

function isUnknown(value) {
  return UNKNOWN_VALUES.has(normalizeStatus(value));
}

function isPositive(value, positiveValues) {
  return positiveValues.has(normalizeStatus(value));
}

function normalizeLinks(links = []) {
  return asArray(links).map((link) => {
    if (typeof link === 'string') {
      return {
        label: null,
        url: link,
        type: null,
        notes: null
      };
    }
    const input = asObject(link);
    return {
      label: input.label || input.name || null,
      url: input.url || input.href || null,
      type: input.type || null,
      notes: input.notes || null
    };
  }).filter((link) => link.url || link.label || link.notes);
}

function resolveDossier(input = {}, options = {}) {
  if (input.dossier || input.sourceDecisionDossier) {
    return createDecisionDossier(input.dossier || input.sourceDecisionDossier, options);
  }

  const store = input.dossierStore
    || input.sourceDecisionDossierStore
    || (input.dossierStorePath ? loadDecisionDossierStore(input.dossierStorePath) : null);
  if (store && input.dossierId) {
    const dossier = getDecisionDossier(store, input.dossierId);
    return dossier ? createDecisionDossier(dossier, options) : null;
  }

  return null;
}

function validateDossierFacts(dossier = {}) {
  const input = asObject(dossier);
  const fingerprint = input.stableFingerprint || null;
  const expectedFingerprint = input.dossierId ? buildDecisionDossierFingerprint(input) : null;
  const reasons = collectBlockingReasons([
    { when: !Object.keys(input).length, reason: BLOCKING_REASON.DOSSIER_MISSING },
    { when: Object.keys(input).length > 0 && !fingerprint, reason: BLOCKING_REASON.DOSSIER_FINGERPRINT_MISSING },
    { when: Boolean(fingerprint && expectedFingerprint && fingerprint !== expectedFingerprint), reason: BLOCKING_REASON.DOSSIER_FINGERPRINT_MISMATCH },
    { when: !present(input.providerName), reason: BLOCKING_REASON.PROVIDER_NAME_MISSING },
    { when: !present(input.intendedPurpose), reason: BLOCKING_REASON.INTENDED_PURPOSE_MISSING },
    { when: isUnknown(input.transactionLevelSoldEvidenceAvailability), reason: BLOCKING_REASON.TRANSACTION_LEVEL_EVIDENCE_UNKNOWN },
    {
      when: present(input.transactionLevelSoldEvidenceAvailability) && !isPositive(input.transactionLevelSoldEvidenceAvailability, POSITIVE_TRANSACTION_VALUES),
      reason: BLOCKING_REASON.TRANSACTION_LEVEL_EVIDENCE_UNDOCUMENTED
    },
    { when: isUnknown(input.acceptedOfferVisibility), reason: BLOCKING_REASON.ACCEPTED_OFFER_VISIBILITY_UNKNOWN },
    { when: isUnknown(input.apiAvailability), reason: BLOCKING_REASON.API_STATUS_UNKNOWN },
    { when: isUnknown(input.licensingStatus), reason: BLOCKING_REASON.LICENSING_STATUS_UNKNOWN },
    {
      when: present(input.licensingStatus) && !isPositive(input.licensingStatus, POSITIVE_PERMISSION_VALUES),
      reason: BLOCKING_REASON.LICENSING_STATUS_UNDOCUMENTED
    },
    { when: isUnknown(input.commercialUseStatus), reason: BLOCKING_REASON.COMMERCIAL_USE_STATUS_UNKNOWN },
    {
      when: present(input.commercialUseStatus) && !isPositive(input.commercialUseStatus, POSITIVE_PERMISSION_VALUES),
      reason: BLOCKING_REASON.COMMERCIAL_USE_STATUS_UNDOCUMENTED
    },
    { when: isUnknown(input.internalUseStatus), reason: BLOCKING_REASON.INTERNAL_USE_STATUS_UNKNOWN }
  ]);

  const unresolvedQuestions = [];
  if (reasons.includes(BLOCKING_REASON.TRANSACTION_LEVEL_EVIDENCE_UNKNOWN)) {
    unresolvedQuestions.push('Is transaction-level sold evidence available and documented?');
  }
  if (reasons.includes(BLOCKING_REASON.ACCEPTED_OFFER_VISIBILITY_UNKNOWN)) {
    unresolvedQuestions.push('Are accepted-offer prices visible or otherwise documented?');
  }
  if (reasons.includes(BLOCKING_REASON.API_STATUS_UNKNOWN)) {
    unresolvedQuestions.push('Is an approved API or delivery method available?');
  }
  if (
    reasons.includes(BLOCKING_REASON.LICENSING_STATUS_UNKNOWN)
    || reasons.includes(BLOCKING_REASON.COMMERCIAL_USE_STATUS_UNKNOWN)
    || reasons.includes(BLOCKING_REASON.INTERNAL_USE_STATUS_UNKNOWN)
  ) {
    unresolvedQuestions.push('What exact licensing, commercial-use, and internal-use permissions apply?');
  }

  const requiredDaltonDecisions = [];
  if (
    reasons.includes(BLOCKING_REASON.LICENSING_STATUS_UNKNOWN)
    || reasons.includes(BLOCKING_REASON.LICENSING_STATUS_UNDOCUMENTED)
  ) {
    requiredDaltonDecisions.push('Provide or reject licensing documentation for this source.');
  }
  if (
    reasons.includes(BLOCKING_REASON.COMMERCIAL_USE_STATUS_UNKNOWN)
    || reasons.includes(BLOCKING_REASON.COMMERCIAL_USE_STATUS_UNDOCUMENTED)
  ) {
    requiredDaltonDecisions.push('Approve, reject, or clarify commercial-use permission.');
  }
  if (
    reasons.includes(BLOCKING_REASON.TRANSACTION_LEVEL_EVIDENCE_UNKNOWN)
    || reasons.includes(BLOCKING_REASON.TRANSACTION_LEVEL_EVIDENCE_UNDOCUMENTED)
  ) {
    requiredDaltonDecisions.push('Confirm whether transaction-level sold evidence is actually available.');
  }

  return {
    valid: reasons.length === 0,
    reasons,
    unresolvedQuestions: unique(unresolvedQuestions),
    requiredDaltonDecisions: unique(requiredDaltonDecisions)
  };
}

function mapDossierToProviderEvaluationInput(dossier = {}, options = {}) {
  const input = asObject(dossier);
  const providerId = normalizeStatus(options.providerId || input.providerId || input.dossierId || input.providerName, 'unknown_provider');
  const documentationLinks = normalizeLinks(input.documentationLinks);
  const docsByType = documentationLinks.reduce((memo, link) => {
    const type = normalizeStatus(link.type || link.label || '');
    if (type.includes('license')) memo.licenseUrl = memo.licenseUrl || link.url;
    if (type.includes('terms')) memo.termsUrl = memo.termsUrl || link.url;
    if (type.includes('api')) memo.apiDocsUrl = memo.apiDocsUrl || link.url;
    return memo;
  }, {});
  const commercialUsePermitted = isPositive(input.commercialUseStatus, POSITIVE_PERMISSION_VALUES);
  const transactionSupported = isPositive(input.transactionLevelSoldEvidenceAvailability, POSITIVE_TRANSACTION_VALUES);
  const acceptedOfferSupport = ['visible', 'documented', 'full'].includes(normalizeStatus(input.acceptedOfferVisibility));
  const apiAvailable = isPositive(input.apiAvailability, POSITIVE_API_VALUES);

  return {
    providerId,
    providerName: input.providerName || 'Unknown provider',
    providerVersion: options.providerVersion || input.providerVersion || 'unknown',
    sourceType: input.providerCategory || 'unknown_category',
    accessMode: apiAvailable ? 'partner_api' : 'unknown',
    evaluationDate: options.evaluationDate || input.evaluationDate,
    evaluator: options.evaluator || input.evaluator,
    permissionStatus: commercialUsePermitted ? 'approved' : normalizeStatus(input.commercialUseStatus),
    licensingStatus: isPositive(input.licensingStatus, POSITIVE_PERMISSION_VALUES) ? 'documented' : normalizeStatus(input.licensingStatus),
    commercialUsePermitted,
    documentation: {
      documentationProvided: documentationLinks.length > 0 && isPositive(input.licensingStatus, POSITIVE_PERMISSION_VALUES),
      licenseUrl: docsByType.licenseUrl || null,
      termsUrl: docsByType.termsUrl || null,
      apiDocsUrl: docsByType.apiDocsUrl || null,
      sampleDataReviewed: transactionSupported,
      notes: input.attributionRequirements || null
    },
    capabilities: {
      accessMode: apiAvailable ? 'partner_api' : 'unknown',
      transactionLevelSoldSupport: transactionSupported,
      acceptedBestOfferSupport: acceptedOfferSupport,
      shippingSupport: false,
      identityFields: asArray(options.identityFields),
      provenanceFields: asArray(options.provenanceFields),
      supportsIncrementalSync: false,
      supportsHistoricalBackfill: false,
      commercialUse: {
        permitted: commercialUsePermitted,
        requiresLicense: true,
        redistributionAllowed: normalizeStatus(input.redistributionRestrictions) === 'none',
        displayAllowed: false
      }
    },
    evaluation: {
      permissionStatus: commercialUsePermitted ? 'approved' : normalizeStatus(input.commercialUseStatus),
      licensingStatus: isPositive(input.licensingStatus, POSITIVE_PERMISSION_VALUES) ? 'documented' : normalizeStatus(input.licensingStatus),
      commercialUsePermitted,
      transactionLevelEvidence: transactionSupported ? 'strong' : normalizeStatus(input.transactionLevelSoldEvidenceAvailability),
      exactIdentitySupport: options.exactIdentitySupport || 'unknown',
      acceptedOfferVisibility: acceptedOfferSupport ? 'visible' : normalizeStatus(input.acceptedOfferVisibility),
      provenanceQuality: options.provenanceQuality || 'unknown',
      stableRecordIdentifiers: options.stableRecordIdentifiers || 'missing',
      historicalCoverage: options.historicalCoverage || 'unknown',
      recencyCoverage: options.recencyCoverage || 'unknown',
      correctionCancellationBehavior: options.correctionCancellationBehavior || 'unknown',
      acquisitionReliability: apiAvailable ? 'usable' : 'unknown',
      schemaStability: options.schemaStability || 'unknown',
      versionTracking: options.versionTracking,
      longTermOperationalRisk: options.longTermOperationalRisk || 'unknown'
    },
    strengths: asArray(options.strengths),
    weaknesses: unique([
      ...asArray(options.weaknesses),
      ...asArray(input.blockingReasons)
    ]),
    risks: unique([
      ...asArray(options.risks),
      input.redistributionRestrictions ? `redistribution: ${input.redistributionRestrictions}` : null
    ].filter(Boolean)),
    notes: input.intendedPurpose || null,
    adapterMetadata: asObject(options.adapterMetadata)
  };
}

function buildQualificationPackageFingerprint(pkg = {}) {
  const input = asObject(pkg);
  return buildFingerprintFromProjection({
    source: input.source || SOURCE,
    version: input.version || WORKFLOW_VERSION,
    workflowId: input.workflowId || null,
    workflowState: input.workflowState || null,
    dossierId: input.dossierId || null,
    dossierFingerprint: input.dossierFingerprint || null,
    providerIdentity: input.providerIdentity || {},
    intendedUse: input.intendedUse || null,
    permissionStatus: input.permissionStatus || null,
    licensingStatus: input.licensingStatus || null,
    apiStatus: input.apiStatus || null,
    transactionLevelSoldEvidenceStatus: input.transactionLevelSoldEvidenceStatus || null,
    acceptedOfferVisibility: input.acceptedOfferVisibility || null,
    providerEvaluationFingerprint: input.providerEvaluationFingerprint || null,
    qualificationStatus: input.qualificationStatus || null,
    blockingReasons: input.blockingReasons || [],
    unresolvedQuestions: input.unresolvedQuestions || [],
    requiredDaltonDecisions: input.requiredDaltonDecisions || [],
    recommendedNextAction: input.recommendedNextAction || null,
    authority: {
      productionApproval: input.productionApproval === true,
      liveIngestionAuthority: input.liveIngestionAuthority === true,
      marketplaceRequestAuthority: input.marketplaceRequestAuthority === true,
      automaticStoreWriteAuthority: input.automaticStoreWriteAuthority === true,
      canonicalSoldEvidenceWriteAuthority: input.canonicalSoldEvidenceWriteAuthority === true
    }
  });
}

function determineWorkflowState(validation = {}, evaluation = null, options = {}) {
  if (options.rejected === true || validation.reasons?.includes(BLOCKING_REASON.PROVIDER_REJECTED)) {
    return WORKFLOW_STATE.REJECTED;
  }
  if (!validation.valid) {
    return validation.reasons.length > 0 ? WORKFLOW_STATE.BLOCKED : WORKFLOW_STATE.INCOMPLETE;
  }
  if (!evaluation) return WORKFLOW_STATE.READY_FOR_EVALUATION;
  if (evaluation.qualificationStatus === PROVIDER_QUALIFICATION_STATUS.REJECTED) return WORKFLOW_STATE.REJECTED;
  if (evaluation.qualificationStatus === PROVIDER_QUALIFICATION_STATUS.QUALIFIED_FOR_ADAPTER_DEVELOPMENT) {
    return WORKFLOW_STATE.QUALIFIED_FOR_ADAPTER_PLANNING;
  }
  if (evaluation.qualificationStatus === PROVIDER_QUALIFICATION_STATUS.APPROVED_FOR_OFFLINE_TESTING) {
    return WORKFLOW_STATE.AWAITING_BUSINESS_DECISION;
  }
  if (evaluation.qualificationStatus === PROVIDER_QUALIFICATION_STATUS.BLOCKED) return WORKFLOW_STATE.BLOCKED;
  return WORKFLOW_STATE.EVALUATED;
}

function buildPackage(input = {}, options = {}) {
  const dossier = resolveDossier(input, options);
  const validation = validateDossierFacts(dossier || {});
  const shouldEvaluate = validation.valid && options.skipEvaluation !== true;
  const providerInput = dossier ? mapDossierToProviderEvaluationInput(dossier, options.providerEvaluation || options) : {};
  const evaluation = shouldEvaluate ? evaluateProviderCandidate(providerInput, {
    evaluationDate: options.evaluationDate || dossier.evaluationDate,
    evaluator: options.evaluator || dossier.evaluator
  }) : null;
  const evaluationBlockingReasons = asArray(evaluation?.blockingIssues).map((issue) => issue.code).filter(Boolean);
  const blockingReasons = unique([
    ...validation.reasons,
    ...evaluationBlockingReasons,
    ...(evaluation?.qualificationStatus === PROVIDER_QUALIFICATION_STATUS.BLOCKED ? [BLOCKING_REASON.PROVIDER_EVALUATION_BLOCKED] : [])
  ]).sort();
  const workflowState = determineWorkflowState(validation, evaluation, options);
  const authority = buildOfflineAuthorityFlags();
  const recommendedNextAction = chooseRecommendedAction([
    { when: workflowState === WORKFLOW_STATE.REJECTED, action: RECOMMENDED_ACTION.REJECT_PROVIDER },
    { when: validation.reasons.some((reason) => reason.includes('licensing') || reason.includes('commercial_use')), action: RECOMMENDED_ACTION.REQUEST_PERMISSION_DOCUMENTATION },
    { when: validation.requiredDaltonDecisions.length > 0, action: RECOMMENDED_ACTION.RESOLVE_BUSINESS_QUESTIONS },
    { when: workflowState === WORKFLOW_STATE.READY_FOR_EVALUATION, action: RECOMMENDED_ACTION.RUN_PROVIDER_EVALUATION },
    { when: workflowState === WORKFLOW_STATE.QUALIFIED_FOR_ADAPTER_PLANNING, action: RECOMMENDED_ACTION.PLAN_ADAPTER },
    { when: Boolean(evaluation), action: RECOMMENDED_ACTION.REVIEW_PROVIDER_EVALUATION }
  ], RECOMMENDED_ACTION.COMPLETE_DOSSIER);

  const pkg = {
    source: SOURCE,
    version: WORKFLOW_VERSION,
    workflowId: options.workflowId || `provider_qualification:${dossier?.dossierId || 'unknown_dossier'}`,
    workflowState,
    dossierId: dossier?.dossierId || null,
    dossierFingerprint: dossier?.stableFingerprint || null,
    providerIdentity: evaluation?.providerIdentity || {
      providerId: providerInput.providerId || null,
      providerName: dossier?.providerName || null,
      marketplace: providerInput.marketplace || null,
      sourceType: dossier?.providerCategory || null,
      accessMode: providerInput.accessMode || 'unknown'
    },
    intendedUse: dossier?.intendedPurpose || null,
    permissionStatus: dossier?.commercialUseStatus || 'unknown',
    licensingStatus: dossier?.licensingStatus || 'unknown',
    apiStatus: dossier?.apiAvailability || 'unknown',
    transactionLevelSoldEvidenceStatus: dossier?.transactionLevelSoldEvidenceAvailability || 'unknown',
    acceptedOfferVisibility: dossier?.acceptedOfferVisibility || 'unknown',
    providerEvaluationResult: evaluation ? clone(evaluation) : null,
    providerEvaluationFingerprint: evaluation?.stableFingerprint || null,
    qualificationStatus: evaluation?.qualificationStatus || (validation.valid ? 'ready_for_provider_evaluation' : 'not_qualified'),
    blockingReasons,
    unresolvedQuestions: validation.unresolvedQuestions,
    requiredDaltonDecisions: validation.requiredDaltonDecisions,
    recommendedNextAction,
    ...authority
  };

  pkg.stableFingerprint = buildQualificationPackageFingerprint(pkg);
  return pkg;
}

function createProviderQualificationPackage(input = {}, options = {}) {
  return buildPackage(input, options);
}

module.exports = {
  BLOCKING_REASON,
  RECOMMENDED_ACTION,
  SOURCE,
  WORKFLOW_STATE,
  WORKFLOW_VERSION,
  buildQualificationPackageFingerprint,
  createProviderQualificationPackage,
  mapDossierToProviderEvaluationInput,
  validateDossierFacts
};
