'use strict';

const {
  asArray,
  asObject,
  fingerprint,
  missingFields,
  unique
} = require('./canonicalValidationCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');
const {
  buildOfflineAuthorityFlags,
  clone,
  firstDefined
} = require('./phase8GovernanceCore');

const REAL_LISTING_DECISION_REVIEW_SCHEMA_VERSION = '1.0.0';
const REAL_LISTING_DECISION_REVIEW_SOURCE = 'real_listing_decision_review_contract';
const UNKNOWN_VALUE = 'unknown';

const REVIEW_STATUSES = Object.freeze({
  UNREVIEWED: 'unreviewed',
  REVIEWED: 'reviewed',
  INCOMPLETE: 'incomplete',
  INVALID: 'invalid'
});

const IDENTITY_CORRECT_VALUES = Object.freeze(['yes', 'no', 'partial', 'unknown']);
const EVIDENCE_SUFFICIENT_VALUES = Object.freeze(['yes', 'no', 'partial', 'unknown']);
const VALUATION_REASONABLE_VALUES = Object.freeze(['yes', 'no', 'partial', 'unknown']);
const CONFIDENCE_APPROPRIATE_VALUES = Object.freeze(['yes', 'no', 'overconfident', 'underconfident', 'unknown']);
const WOULD_BUY_VALUES = Object.freeze(['yes', 'no', 'negotiate', 'monitor', 'uncertain']);
const WOULD_NOTIFY_VALUES = Object.freeze(['yes', 'no', 'uncertain']);
const PRODUCTION_CORRECT_VALUES = Object.freeze(['yes', 'no', 'partial', 'unknown']);
const SHADOW_BETTER_VALUES = Object.freeze(['yes', 'no', 'partial', 'unknown']);
const BUY_NOW_QUALITY_VALUES = Object.freeze([
  'correct',
  'false_positive',
  'missed_opportunity',
  'too_aggressive',
  'too_conservative',
  'unknown'
]);
const DEAL_GATE_QUALITY_VALUES = Object.freeze(['correct', 'too_strict', 'too_loose', 'wrong_reason', 'unknown']);

const REVIEW_REASON_CATEGORIES = Object.freeze([
  'identity_error',
  'weak_evidence',
  'active_only_evidence',
  'valuation_too_high',
  'valuation_too_low',
  'confidence_too_high',
  'confidence_too_low',
  'grading_risk',
  'listing_quality_risk',
  'seller_or_listing_risk',
  'price_suspicious',
  'deal_gate_too_strict',
  'deal_gate_too_loose',
  'buy_now_false_positive',
  'missed_opportunity',
  'notification_should_have_sent',
  'notification_should_not_have_sent',
  'explanation_issue',
  'unknown_or_insufficient_context'
]);

const DISAGREEMENT_CATEGORIES = Object.freeze([
  'production_vs_shadow_decision',
  'valuation_disagreement',
  'identity_disagreement',
  'evidence_sufficiency_disagreement',
  'confidence_disagreement',
  'grading_or_quality_disagreement',
  'false_positive_risk',
  'notification_disagreement',
  'deal_gate_disagreement',
  'buy_now_disagreement'
]);

const REQUIRED_REVIEW_PACKAGE_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'packageId',
  'reviewBatchId',
  'listingId',
  'marketplace',
  'createdAt',
  'capturedAt',
  'reviewStatus',
  'productionImpact',
  'decisionImpact',
  'listingSnapshot',
  'identitySnapshot',
  'productionSnapshot',
  'shadowSnapshot',
  'disagreementSnapshot',
  'auditMetadata',
  'snapshotFingerprint',
  'packageFingerprint'
]);

const REQUIRED_REVIEW_RECORD_FIELDS = Object.freeze([
  'schemaVersion',
  'source',
  'reviewer',
  'reviewedAt',
  'identityCorrect',
  'evidenceSufficient',
  'valuationReasonable',
  'confidenceAppropriate',
  'wouldBuy',
  'wouldNotify',
  'productionCorrect',
  'shadowBetter',
  'buyNowQuality',
  'dealGateQuality',
  'reasonCategories',
  'disagreementCategories',
  'reviewConfidence',
  'notes',
  'reviewFingerprint'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function known(value) {
  return value !== undefined && value !== null && value !== '';
}

function preserve(value, fallback = UNKNOWN_VALUE) {
  return known(value) ? clone(value) : fallback;
}

function preserveArray(value) {
  return asArray(value).map((item) => clone(item));
}

function pick(sources = [], keys = [], fallback = UNKNOWN_VALUE) {
  for (const source of sources) {
    const object = asObject(source);
    for (const key of keys) {
      if (known(object[key])) return clone(object[key]);
    }
  }
  return fallback;
}

function normalizeEnum(value, allowedValues, fallback = UNKNOWN_VALUE) {
  const normalized = String(value || fallback).trim().toLowerCase();
  return allowedValues.includes(normalized) ? normalized : normalized;
}

function normalizeDate(value, fallback = UNKNOWN_VALUE) {
  if (!known(value)) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function toNumberOrUnknown(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : UNKNOWN_VALUE;
}

function getListing(input = {}) {
  return asObject(firstDefined(input.listingSnapshot, input.listing, input.productionListing, input.item, {}));
}

function getListingId(input = {}, listing = getListing(input)) {
  return String(firstDefined(
    input.listingId,
    listing.ebayItemId,
    listing.marketplaceItemId,
    listing.itemId,
    listing.listingId,
    listing.id,
    UNKNOWN_VALUE
  ));
}

function summarizeListing(input = {}) {
  const listing = getListing(input);
  const seller = asObject(firstDefined(input.sellerSummary, listing.sellerSummary, listing.seller, {}));
  const images = firstDefined(input.imageSummary, listing.imageSummary, listing.images, listing.imageUrls, []);
  const provenance = asObject(firstDefined(input.provenance, listing.provenance, listing.marketplaceProvenance, {}));

  return {
    title: pick([listing, input], ['title', 'rawTitle', 'name']),
    url: pick([listing, input], ['url', 'itemWebUrl', 'listingUrl']),
    marketplaceItemId: pick([listing, input], ['marketplaceItemId', 'ebayItemId', 'itemId', 'listingId', 'id']),
    askingPrice: pick([listing, input], ['askingPrice', 'price', 'currentPrice']),
    shipping: pick([listing, input], ['shipping', 'shippingCost']),
    totalCost: pick([listing, input], ['totalCost', 'allInCost', 'price']),
    sellerSummary: clone(seller),
    listingState: pick([listing, input], ['listingState', 'state', 'status']),
    imageSummary: Array.isArray(images) ? { imageCount: images.length, images: preserveArray(images) } : clone(asObject(images)),
    provenance: clone(provenance)
  };
}

function summarizeIdentity(input = {}) {
  const listing = getListing(input);
  const parsed = asObject(firstDefined(input.legacyParsedIdentity, input.parsedIdentity, input.parsed, listing.parsed, {}));
  const canonical = asObject(firstDefined(input.canonicalIdentitySummary, input.canonicalIdentity, listing.canonicalIdentity, {}));
  const diagnostics = asObject(firstDefined(input.identityDiagnostics, input.identityDiagnosticResult, input.identityParserDiagnostics, {}));
  const eligibility = asObject(firstDefined(input.identityEligibility, canonical.eligibility, diagnostics.identityEligibility, {}));
  const fields = asObject(firstDefined(diagnostics.parserCanonicalComparison, diagnostics.fieldSummary, {}));
  const identityProjection = {
    legacyParsedIdentity: parsed,
    canonicalIdentitySummary: canonical,
    identityEligibility: eligibility,
    diagnosticStatus: pick([diagnostics], ['diagnosticStatus']),
    ambiguity: pick([diagnostics], ['ambiguityLevel', 'ambiguity']),
    fieldsConfirmed: preserveArray(firstDefined(diagnostics.fieldsConfirmed, fields.fieldsConfirmed)),
    fieldsMissing: preserveArray(firstDefined(diagnostics.fieldsMissing, fields.fieldsMissing)),
    fieldsConflicting: preserveArray(firstDefined(diagnostics.fieldsConflicting, fields.fieldsConflicting)),
    fieldsInferred: preserveArray(firstDefined(diagnostics.fieldsInferred, fields.fieldsInferred)),
    warnings: preserveArray(diagnostics.warnings),
    blockingIssues: preserveArray(firstDefined(diagnostics.blockingIssues, diagnostics.blockingReasons))
  };

  return {
    ...identityProjection,
    identityFingerprint: buildFingerprintFromProjection(identityProjection)
  };
}

function summarizeProduction(input = {}) {
  const listing = getListing(input);
  const production = asObject(firstDefined(input.productionSnapshot, input.productionOutputs, {}));
  const valuation = asObject(firstDefined(input.productionValuation, production.valuation, production.productionValuation, listing.marketData, {}));
  const roi = asObject(firstDefined(input.roiSummary, input.roiData, production.roi, listing.roiData, {}));
  const confidence = asObject(firstDefined(input.productionConfidence, input.confidenceSummary, input.confidenceBreakdown, production.confidence, {}));
  const dealGate = asObject(firstDefined(input.dealGateOutcome, input.dealGate, production.dealGateOutcome, production.dealGate, listing.dealGate, {}));
  const trace = asObject(firstDefined(input.productionTrace, input.productionIntelligenceTrace, production.productionTrace, {}));

  return {
    valuation: clone(valuation),
    estimatedValue: pick([input, valuation, listing], ['estimatedValue', 'marketValue']),
    roi: pick([input, roi, listing], ['roi', 'roiPercent']),
    estimatedProfit: pick([input, valuation, roi, listing], ['estimatedProfit', 'netProfit', 'expectedNetProfit']),
    confidence: clone(confidence),
    evidenceSummary: clone(asObject(firstDefined(input.evidenceSummary, production.evidenceSummary, listing.evidenceSummary, {}))),
    comparableSummary: clone(asObject(firstDefined(input.comparableSummary, input.compData, production.comparableSummary, listing.compData, {}))),
    gradingSummary: clone(asObject(firstDefined(input.gradingSummary, input.gradingData, production.gradingSummary, listing.gradingData, {}))),
    riskSummary: clone(asObject(firstDefined(input.riskSummary, input.riskData, production.riskSummary, listing.riskData, {}))),
    qualitySummary: clone(asObject(firstDefined(input.qualitySummary, input.qualityData, production.qualitySummary, listing.qualityData, {}))),
    dealGateInputs: clone(asObject(firstDefined(input.dealGateInputs, production.dealGateInputs, {}))),
    dealGateOutcome: clone(dealGate),
    buyNowEligibility: clone(asObject(firstDefined(input.buyNowEligibility, production.buyNowEligibility, {
      eligible: known(dealGate.buyNowAllowed) ? dealGate.buyNowAllowed === true : known(dealGate.passed) ? dealGate.passed === true : UNKNOWN_VALUE,
      source: Object.keys(dealGate).length ? 'deal_gate' : UNKNOWN_VALUE
    }))),
    notificationEligibility: clone(asObject(firstDefined(input.notificationEligibility, production.notificationEligibility, {}))),
    explanationChain: clone(firstDefined(input.explanationChain, production.explanationChain, production.productionDecisionExplanation, listing.productionDecisionExplanation, {})),
    productionTraceFingerprint: pick([input, production, trace], ['productionTraceFingerprint', 'traceFingerprint', 'stableFingerprint'])
  };
}

function summarizeShadow(input = {}) {
  const shadow = asObject(firstDefined(input.shadowSnapshot, input.shadowOutputs, {}));
  const shadowProjection = {
    shadowSoldComparison: clone(firstDefined(input.shadowSoldComparison, shadow.shadowSoldComparison, {})),
    shadowValuation: clone(firstDefined(input.shadowValuation, shadow.shadowValuation, {})),
    evidenceReadiness: clone(firstDefined(input.evidenceReadiness, input.evidenceReadinessDiagnostics, shadow.evidenceReadiness, {})),
    rangeFirstValuation: clone(firstDefined(input.rangeFirstValuation, input.rangeFirstValuationDiagnostics, shadow.rangeFirstValuation, {})),
    confidenceCalibration: clone(firstDefined(input.confidenceCalibration, input.confidenceCalibrationDiagnostics, shadow.confidenceCalibration, {})),
    listingQualityAndGradingDiagnostics: clone(firstDefined(input.listingQualityAndGradingDiagnostics, input.listingQualityGradingDiagnostics, shadow.listingQualityAndGradingDiagnostics, {})),
    falsePositiveDiagnostics: clone(firstDefined(input.falsePositiveDiagnostics, input.opportunityFalsePositiveDiagnostics, shadow.falsePositiveDiagnostics, {})),
    shadowConfidence: preserve(firstDefined(input.shadowConfidence, shadow.shadowConfidence)),
    shadowRecommendationPosture: preserve(firstDefined(input.shadowRecommendationPosture, shadow.shadowRecommendationPosture, shadow.recommendationPosture)),
    shadowFingerprints: clone(asObject(firstDefined(input.shadowFingerprints, shadow.shadowFingerprints, {})))
  };

  return shadowProjection;
}

function summarizeDisagreement(input = {}, productionSnapshot = {}, shadowSnapshot = {}, identitySnapshot = {}) {
  const supplied = asObject(firstDefined(input.disagreementSnapshot, input.disagreementSummary, {}));
  const productionDecision = pick([productionSnapshot.dealGateOutcome], ['decision', 'recommendation']);
  const shadowPosture = pick([shadowSnapshot], ['shadowRecommendationPosture']);
  const productionValue = toNumberOrUnknown(productionSnapshot.estimatedValue);
  const shadowValue = toNumberOrUnknown(shadowSnapshot.shadowValuation?.recommendedMarketValue ?? shadowSnapshot.shadowValuation?.fairMarketRange?.expectedValue);

  return {
    productionVersusShadowDecisionDisagreement: firstDefined(
      supplied.productionVersusShadowDecisionDisagreement,
      known(productionDecision) && known(shadowPosture) ? productionDecision !== shadowPosture : UNKNOWN_VALUE
    ),
    valuationDisagreement: firstDefined(
      supplied.valuationDisagreement,
      Number.isFinite(Number(productionValue)) && Number.isFinite(Number(shadowValue)) ? Number(productionValue) !== Number(shadowValue) : UNKNOWN_VALUE
    ),
    identityDisagreement: firstDefined(supplied.identityDisagreement, identitySnapshot.fieldsConflicting.length > 0 ? true : UNKNOWN_VALUE),
    evidenceSufficiencyDisagreement: firstDefined(supplied.evidenceSufficiencyDisagreement, UNKNOWN_VALUE),
    confidenceDisagreement: firstDefined(supplied.confidenceDisagreement, UNKNOWN_VALUE),
    gradingOrQualityDisagreement: firstDefined(supplied.gradingOrQualityDisagreement, UNKNOWN_VALUE),
    falsePositiveRiskSignals: preserveArray(firstDefined(supplied.falsePositiveRiskSignals, shadowSnapshot.falsePositiveDiagnostics?.materialWarnings)),
    suggestedValidationFocus: preserveArray(firstDefined(supplied.suggestedValidationFocus, input.validationCandidate?.suggestedValidationFocus))
  };
}

function buildSnapshotProjection(packageInput = {}) {
  const listingSnapshot = summarizeListing(packageInput);
  const identitySnapshot = summarizeIdentity(packageInput);
  const productionSnapshot = summarizeProduction(packageInput);
  const shadowSnapshot = summarizeShadow(packageInput);
  const disagreementSnapshot = summarizeDisagreement(packageInput, productionSnapshot, shadowSnapshot, identitySnapshot);

  return {
    listingSnapshot,
    identitySnapshot,
    productionSnapshot,
    shadowSnapshot,
    disagreementSnapshot
  };
}

function buildRealListingDecisionReviewSnapshotFingerprint(packageInput = {}) {
  return buildFingerprintFromProjection(buildSnapshotProjection(packageInput));
}

function buildRealListingDecisionReviewPackageFingerprint(reviewPackage = {}) {
  const projection = clone(reviewPackage);
  delete projection.packageFingerprint;
  return buildFingerprintFromProjection(projection);
}

function buildHumanReviewFingerprint(reviewRecord = {}) {
  const projection = clone(reviewRecord);
  delete projection.reviewFingerprint;
  return buildFingerprintFromProjection(projection);
}

function determineReviewStatus(reviewPackageOrRecord = {}) {
  const object = asObject(reviewPackageOrRecord);
  if (object.reviewRecord) return determineReviewStatus(object.reviewRecord);
  if (object.reviewStatus && Object.values(REVIEW_STATUSES).includes(object.reviewStatus)) return object.reviewStatus;
  if (!Object.keys(object).length) return REVIEW_STATUSES.INCOMPLETE;
  if (object.reviewFingerprint && object.reviewedAt && object.reviewer) return REVIEW_STATUSES.REVIEWED;
  return REVIEW_STATUSES.UNREVIEWED;
}

function createRealListingDecisionReviewPackage(input = {}, options = {}) {
  const listing = getListing(input);
  const listingId = getListingId(input, listing);
  const snapshots = buildSnapshotProjection(input);
  const snapshotFingerprint = buildFingerprintFromProjection(snapshots);
  const basePackage = {
    schemaVersion: REAL_LISTING_DECISION_REVIEW_SCHEMA_VERSION,
    source: REAL_LISTING_DECISION_REVIEW_SOURCE,
    packageId: options.packageId || input.packageId || `${listingId}:real-listing-review`,
    reviewBatchId: options.reviewBatchId || input.reviewBatchId || 'unassigned_review_batch',
    listingId,
    marketplace: String(firstDefined(input.marketplace, listing.marketplace, listing.platform, listing.source, UNKNOWN_VALUE)),
    createdAt: normalizeDate(options.createdAt || input.createdAt || UNKNOWN_VALUE),
    capturedAt: normalizeDate(input.capturedAt || listing.capturedAt || options.capturedAt || UNKNOWN_VALUE),
    reviewStatus: REVIEW_STATUSES.UNREVIEWED,
    productionImpact: 'none',
    decisionImpact: 'none',
    immutableSnapshot: true,
    evidenceOnly: true,
    authorityFlags: buildOfflineAuthorityFlags(),
    ...snapshots,
    auditMetadata: {
      generatedBy: REAL_LISTING_DECISION_REVIEW_SOURCE,
      offlineOnly: true,
      evidenceOnly: true,
      createsNewIntelligence: false,
      recomputesProductionEngines: false,
      acceptsSuppliedProductionOutputsOnly: true,
      acceptsSuppliedShadowOutputsOnly: true,
      missingSections: [],
      snapshotFingerprint
    },
    snapshotFingerprint
  };

  const packageWithMetadata = {
    ...basePackage,
    auditMetadata: {
      ...basePackage.auditMetadata,
      missingSections: getMissingPackageSections(basePackage)
    }
  };

  const reviewPackage = {
    ...packageWithMetadata,
    packageFingerprint: buildRealListingDecisionReviewPackageFingerprint(packageWithMetadata)
  };

  return deepFreeze(reviewPackage);
}

function normalizeStringArray(values = []) {
  return unique(asArray(values).map((value) => String(value || '').trim()).filter(Boolean)).sort();
}

function createHumanReviewRecord(input = {}, options = {}) {
  const record = {
    schemaVersion: REAL_LISTING_DECISION_REVIEW_SCHEMA_VERSION,
    source: `${REAL_LISTING_DECISION_REVIEW_SOURCE}:human_review`,
    reviewer: String(firstDefined(input.reviewer, options.reviewer, 'Dalton')),
    reviewedAt: normalizeDate(firstDefined(input.reviewedAt, options.reviewedAt, UNKNOWN_VALUE)),
    identityCorrect: normalizeEnum(input.identityCorrect, IDENTITY_CORRECT_VALUES),
    evidenceSufficient: normalizeEnum(input.evidenceSufficient, EVIDENCE_SUFFICIENT_VALUES),
    valuationReasonable: normalizeEnum(input.valuationReasonable, VALUATION_REASONABLE_VALUES),
    confidenceAppropriate: normalizeEnum(input.confidenceAppropriate, CONFIDENCE_APPROPRIATE_VALUES),
    wouldBuy: normalizeEnum(input.wouldBuy, WOULD_BUY_VALUES, 'uncertain'),
    wouldNotify: normalizeEnum(input.wouldNotify, WOULD_NOTIFY_VALUES, 'uncertain'),
    productionCorrect: normalizeEnum(input.productionCorrect, PRODUCTION_CORRECT_VALUES),
    shadowBetter: normalizeEnum(input.shadowBetter, SHADOW_BETTER_VALUES),
    buyNowQuality: normalizeEnum(input.buyNowQuality, BUY_NOW_QUALITY_VALUES),
    dealGateQuality: normalizeEnum(input.dealGateQuality, DEAL_GATE_QUALITY_VALUES),
    reasonCategories: normalizeStringArray(input.reasonCategories),
    disagreementCategories: normalizeStringArray(input.disagreementCategories),
    reviewConfidence: known(input.reviewConfidence) ? Number(input.reviewConfidence) : UNKNOWN_VALUE,
    notes: String(input.notes || '')
  };

  return deepFreeze({
    ...record,
    reviewFingerprint: buildHumanReviewFingerprint(record)
  });
}

function buildValidationFailure(code, message, path = '') {
  return { code, message, path };
}

function validateEnumField(record, field, allowedValues, failures) {
  if (!allowedValues.includes(record[field])) {
    failures.push(buildValidationFailure('invalid_enum_value', `${field} must be one of: ${allowedValues.join(', ')}`, field));
  }
}

function validateCategoryArray(record, field, allowedValues, failures) {
  for (const value of asArray(record[field])) {
    if (!allowedValues.includes(value)) {
      failures.push(buildValidationFailure('invalid_category_value', `${field} contains unsupported value: ${value}`, field));
    }
  }
}

function validateHumanReviewRecord(record = {}) {
  const failures = [];
  for (const field of missingFields(record, REQUIRED_REVIEW_RECORD_FIELDS)) {
    failures.push(buildValidationFailure('missing_required_field', `${field} is required.`, field));
  }

  if (record.schemaVersion !== REAL_LISTING_DECISION_REVIEW_SCHEMA_VERSION) {
    failures.push(buildValidationFailure('invalid_schema_version', 'schemaVersion must match the Real Listing Decision Review schema.', 'schemaVersion'));
  }
  if (record.source !== `${REAL_LISTING_DECISION_REVIEW_SOURCE}:human_review`) {
    failures.push(buildValidationFailure('invalid_source', 'source must identify a Real Listing Decision Review human review.', 'source'));
  }

  validateEnumField(record, 'identityCorrect', IDENTITY_CORRECT_VALUES, failures);
  validateEnumField(record, 'evidenceSufficient', EVIDENCE_SUFFICIENT_VALUES, failures);
  validateEnumField(record, 'valuationReasonable', VALUATION_REASONABLE_VALUES, failures);
  validateEnumField(record, 'confidenceAppropriate', CONFIDENCE_APPROPRIATE_VALUES, failures);
  validateEnumField(record, 'wouldBuy', WOULD_BUY_VALUES, failures);
  validateEnumField(record, 'wouldNotify', WOULD_NOTIFY_VALUES, failures);
  validateEnumField(record, 'productionCorrect', PRODUCTION_CORRECT_VALUES, failures);
  validateEnumField(record, 'shadowBetter', SHADOW_BETTER_VALUES, failures);
  validateEnumField(record, 'buyNowQuality', BUY_NOW_QUALITY_VALUES, failures);
  validateEnumField(record, 'dealGateQuality', DEAL_GATE_QUALITY_VALUES, failures);
  validateCategoryArray(record, 'reasonCategories', REVIEW_REASON_CATEGORIES, failures);
  validateCategoryArray(record, 'disagreementCategories', DISAGREEMENT_CATEGORIES, failures);

  if (record.reviewConfidence !== UNKNOWN_VALUE) {
    const confidence = Number(record.reviewConfidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
      failures.push(buildValidationFailure('invalid_review_confidence', 'reviewConfidence must be 0-100 or unknown.', 'reviewConfidence'));
    }
  }

  if (record.reviewFingerprint && buildHumanReviewFingerprint(record) !== record.reviewFingerprint) {
    failures.push(buildValidationFailure('fingerprint_mismatch', 'reviewFingerprint does not match review record contents.', 'reviewFingerprint'));
  }

  return {
    valid: failures.length === 0,
    failures
  };
}

function isEffectivelyMissing(value) {
  if (value === undefined || value === null || value === '' || value === UNKNOWN_VALUE) return true;
  if (Array.isArray(value)) return value.length === 0 || value.every(isEffectivelyMissing);
  if (typeof value === 'object') return Object.keys(value).length === 0 || Object.values(value).every(isEffectivelyMissing);
  return false;
}

function getMissingPackageSections(reviewPackage = {}) {
  return [
    ['listingSnapshot', reviewPackage.listingSnapshot],
    ['identitySnapshot', reviewPackage.identitySnapshot],
    ['productionSnapshot', reviewPackage.productionSnapshot],
    ['shadowSnapshot', reviewPackage.shadowSnapshot],
    ['disagreementSnapshot', reviewPackage.disagreementSnapshot]
  ].filter(([, value]) => isEffectivelyMissing(value)).map(([key]) => key);
}

function validateRealListingDecisionReviewPackage(reviewPackage = {}) {
  const failures = [];
  for (const field of missingFields(reviewPackage, REQUIRED_REVIEW_PACKAGE_FIELDS)) {
    failures.push(buildValidationFailure('missing_required_field', `${field} is required.`, field));
  }

  if (reviewPackage.schemaVersion !== REAL_LISTING_DECISION_REVIEW_SCHEMA_VERSION) {
    failures.push(buildValidationFailure('invalid_schema_version', 'schemaVersion must match the Real Listing Decision Review schema.', 'schemaVersion'));
  }
  if (reviewPackage.source !== REAL_LISTING_DECISION_REVIEW_SOURCE) {
    failures.push(buildValidationFailure('invalid_source', 'source must be real_listing_decision_review_contract.', 'source'));
  }
  if (reviewPackage.productionImpact !== 'none') {
    failures.push(buildValidationFailure('invalid_production_impact', 'productionImpact must remain none.', 'productionImpact'));
  }
  if (reviewPackage.decisionImpact !== 'none') {
    failures.push(buildValidationFailure('invalid_decision_impact', 'decisionImpact must remain none.', 'decisionImpact'));
  }
  if (!Object.values(REVIEW_STATUSES).includes(reviewPackage.reviewStatus)) {
    failures.push(buildValidationFailure('invalid_review_status', 'reviewStatus is not supported.', 'reviewStatus'));
  }

  if (reviewPackage.snapshotFingerprint) {
    const snapshots = {
      listingSnapshot: reviewPackage.listingSnapshot,
      identitySnapshot: reviewPackage.identitySnapshot,
      productionSnapshot: reviewPackage.productionSnapshot,
      shadowSnapshot: reviewPackage.shadowSnapshot,
      disagreementSnapshot: reviewPackage.disagreementSnapshot
    };
    if (buildFingerprintFromProjection(snapshots) !== reviewPackage.snapshotFingerprint) {
      failures.push(buildValidationFailure('snapshot_fingerprint_mismatch', 'snapshotFingerprint does not match immutable snapshots.', 'snapshotFingerprint'));
    }
  }

  if (reviewPackage.packageFingerprint && buildRealListingDecisionReviewPackageFingerprint(reviewPackage) !== reviewPackage.packageFingerprint) {
    failures.push(buildValidationFailure('package_fingerprint_mismatch', 'packageFingerprint does not match package contents.', 'packageFingerprint'));
  }

  if (reviewPackage.reviewRecord) {
    const reviewValidation = validateHumanReviewRecord(reviewPackage.reviewRecord);
    for (const failure of reviewValidation.failures) {
      failures.push({ ...failure, path: `reviewRecord.${failure.path}` });
    }
  }

  return {
    valid: failures.length === 0,
    failures
  };
}

function attachHumanReviewRecord(reviewPackage = {}, reviewRecord = {}) {
  const packageClone = clone(reviewPackage);
  const recordClone = clone(reviewRecord);
  const reviewedPackage = {
    ...packageClone,
    reviewStatus: determineReviewStatus(recordClone),
    reviewRecord: recordClone,
    packageFingerprint: undefined
  };
  delete reviewedPackage.packageFingerprint;

  return deepFreeze({
    ...reviewedPackage,
    packageFingerprint: buildRealListingDecisionReviewPackageFingerprint(reviewedPackage)
  });
}

function cloneRealListingDecisionReviewPackage(reviewPackage = {}) {
  return clone(reviewPackage);
}

module.exports = {
  BUY_NOW_QUALITY_VALUES,
  CONFIDENCE_APPROPRIATE_VALUES,
  DEAL_GATE_QUALITY_VALUES,
  DISAGREEMENT_CATEGORIES,
  EVIDENCE_SUFFICIENT_VALUES,
  IDENTITY_CORRECT_VALUES,
  PRODUCTION_CORRECT_VALUES,
  REAL_LISTING_DECISION_REVIEW_SCHEMA_VERSION,
  REAL_LISTING_DECISION_REVIEW_SOURCE,
  REQUIRED_REVIEW_PACKAGE_FIELDS,
  REQUIRED_REVIEW_RECORD_FIELDS,
  REVIEW_REASON_CATEGORIES,
  REVIEW_STATUSES,
  SHADOW_BETTER_VALUES,
  UNKNOWN_VALUE,
  VALUATION_REASONABLE_VALUES,
  WOULD_BUY_VALUES,
  WOULD_NOTIFY_VALUES,
  attachHumanReviewRecord,
  buildHumanReviewFingerprint,
  buildRealListingDecisionReviewPackageFingerprint,
  buildRealListingDecisionReviewSnapshotFingerprint,
  cloneRealListingDecisionReviewPackage,
  createHumanReviewRecord,
  createRealListingDecisionReviewPackage,
  determineReviewStatus,
  validateHumanReviewRecord,
  validateRealListingDecisionReviewPackage
};
