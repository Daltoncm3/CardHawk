'use strict';

const evidenceSufficiencyEngine = require('../engines/evidenceSufficiencyEngine');
const comparableQualityEngine = require('../engines/comparableQualityEngine');
const soldEvidenceService = require('../services/soldEvidenceService');

const {
  asArray,
  asObject,
  unique
} = require('./canonicalValidationCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');
const {
  clone,
  collectBlockingReasons,
  firstDefined
} = require('./phase8GovernanceCore');

const EVIDENCE_READINESS_DIAGNOSTIC_SCHEMA_VERSION = '1.0.0';
const EVIDENCE_READINESS_DIAGNOSTIC_SOURCE = 'evidence_readiness_diagnostics';
const UNKNOWN_VALUE = 'unknown';
const MIN_TRUE_SOLD_FOR_READY = 3;
const DEFAULT_STALE_DAYS = 180;

const READINESS_STATUS = Object.freeze({
  READY: 'ready',
  CONDITIONALLY_READY: 'conditionally_ready',
  THIN: 'thin',
  INSUFFICIENT: 'insufficient',
  BLOCKED: 'blocked',
  UNAVAILABLE: 'unavailable'
});

const READINESS_LEVEL = Object.freeze({
  STRONG: 'strong',
  ADEQUATE: 'adequate',
  LIMITED: 'limited',
  INSUFFICIENT: 'insufficient',
  BLOCKED: 'blocked',
  UNAVAILABLE: 'unavailable'
});

const REVIEW_ACTION = Object.freeze({
  NONE: 'evidence_ready_for_diagnostic_review',
  REVIEW_CONDITIONS: 'review_evidence_conditions_before_valuation_reliance',
  COLLECT_MORE_SOLD_EVIDENCE: 'collect_more_true_sold_evidence',
  RESOLVE_BLOCKERS: 'resolve_evidence_blockers_before_valuation_reliance',
  PROVIDE_EVIDENCE: 'provide_evidence_before_readiness_review'
});

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function known(value) {
  return value !== undefined && value !== null && value !== '' && value !== UNKNOWN_VALUE;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getEvidenceInput(input = {}) {
  const evidenceSummary = asObject(input.evidenceSummary);
  const compData = asObject(input.compData);
  return asArray(firstDefined(
    input.evidenceRecords,
    input.records,
    input.evidence,
    input.comps,
    input.comparables,
    input.soldComps,
    evidenceSummary.normalizedEvidence,
    compData.selectedComps,
    compData.comps,
    []
  ));
}

function getEvidenceId(record = {}, index = 0) {
  return firstDefined(
    record.id,
    record.evidenceId,
    record.marketplaceSaleId,
    record.ebayItemId,
    record.itemId,
    record.sourceRecordId,
    `evidence-${index + 1}`
  );
}

function getSource(record = {}) {
  return firstDefined(record.source, record.marketplace, record.platform, record.site, UNKNOWN_VALUE);
}

function getPrice(record = {}) {
  return toNumber(firstDefined(record.totalPaid, record.soldPrice, record.salePrice, record.price, record.totalPrice, record.value), 0);
}

function getEvidenceType(record = {}) {
  const explicit = normalize(record.evidenceType);
  if (explicit === 'true_sold' || explicit === 'active' || explicit === 'fallback_unknown' || explicit === 'aggregate_market_price') {
    return explicit;
  }

  const text = [
    record.status,
    record.listingStatus,
    record.type,
    record.source,
    record.recordType,
    record.marketState,
    record.saleStatus
  ].map(normalize).join(' ');

  if (
    record.sold === true ||
    record.isSold === true ||
    record.completed === true ||
    record.isCompleted === true ||
    record.soldAt ||
    record.dateSold ||
    /\b(sold|completed)\b/.test(text)
  ) {
    return 'true_sold';
  }

  if (
    record.active === true ||
    record.isActive === true ||
    Array.isArray(record.buyingOptions) ||
    /\b(active|live|listed|available|current|open)\b/.test(text)
  ) {
    return 'active';
  }

  return 'fallback_unknown';
}

function getAgeDays(record = {}, asOf = null) {
  const explicit = toNumber(firstDefined(record.ageDays, record.daysOld, record.daysSinceSale, record.soldDaysAgo), NaN);
  if (Number.isFinite(explicit)) return Math.max(0, explicit);
  if (!asOf) return null;

  const dateValue = firstDefined(record.soldAt, record.dateSold, record.soldDate, record.saleDate, record.endedAt, record.endDate);
  if (!dateValue) return null;
  const soldAt = new Date(dateValue);
  const asOfDate = new Date(asOf);
  if (!Number.isFinite(soldAt.getTime()) || !Number.isFinite(asOfDate.getTime())) return null;
  return Math.max(0, Math.floor((asOfDate.getTime() - soldAt.getTime()) / 86400000));
}

function isDuplicate(record = {}, seenKeys) {
  const keys = [
    record.marketplaceSaleId,
    record.sourceRecordId,
    record.id,
    record.evidenceId,
    record.ebayItemId,
    record.itemId,
    record.fingerprint,
    record.recordFingerprint
  ].filter(known).map(String);

  if (!keys.length) return false;
  const duplicate = keys.some((key) => seenKeys.has(key));
  keys.forEach((key) => seenKeys.add(key));
  return duplicate;
}

function isTransactionIneligible(record = {}, evidenceType) {
  if (evidenceType !== 'true_sold') return false;
  if (record.transactionEligible === false) return true;
  if (record.status && record.status !== 'active_evidence' && record.status !== 'sold' && record.status !== 'completed') return true;
  if (record.bestOfferAccepted === true && record.priceDisclosure === 'undisclosed') return true;
  if (getPrice(record) <= 0) return true;
  if (!known(firstDefined(record.soldAt, record.dateSold, record.soldDate, record.saleDate, record.endedAt))) return true;
  return false;
}

function isExactComparable(record = {}) {
  if (record.exactComparable === true || record.exactMatch === true || record.matchType === 'exact') return true;
  if (record.comparisonStatus === 'exact_match' || record.bucket === 'accepted_exact_match') return true;
  return toNumber(firstDefined(record.identityScore, record.similarity, record.similarityScore, record.matchScore), 0) >= 85 &&
    !record.rejectedByIdentityGate &&
    asArray(record.fatalMismatches).length === 0;
}

function isRejectedComparable(record = {}) {
  return Boolean(
    record.rejectedByIdentityGate === true ||
    record.qualityBand === 'reject' ||
    record.comparisonStatus === 'rejected' ||
    record.rejected === true ||
    asArray(record.fatalMismatches).length > 0
  );
}

function compactEvidence(record = {}, index = 0, extra = {}) {
  return {
    id: getEvidenceId(record, index),
    evidenceType: getEvidenceType(record),
    source: getSource(record),
    price: getPrice(record),
    ageDays: extra.ageDays ?? record.ageDays ?? UNKNOWN_VALUE,
    exactComparable: extra.exactComparable ?? isExactComparable(record),
    qualityBand: record.qualityBand || UNKNOWN_VALUE,
    exclusionReasons: asArray(extra.exclusionReasons)
  };
}

function classifyEvidence(records = [], options = {}) {
  const asOf = options.asOf || null;
  const staleDays = toNumber(options.staleDays, DEFAULT_STALE_DAYS);
  const seenKeys = new Set();
  const used = [];
  const excluded = [];

  records.forEach((record, index) => {
    const evidenceType = getEvidenceType(record);
    const ageDays = getAgeDays(record, asOf);
    const exactComparable = isExactComparable(record);
    const rejected = isRejectedComparable(record);
    const duplicate = isDuplicate(record, seenKeys);
    const transactionIneligible = isTransactionIneligible(record, evidenceType);
    const stale = evidenceType === 'true_sold' && Number.isFinite(ageDays) && ageDays > staleDays;
    const reasons = [];

    if (evidenceType === 'active') reasons.push('active_listing_context_only');
    if (evidenceType === 'fallback_unknown' || evidenceType === 'aggregate_market_price') reasons.push('fallback_or_unknown_evidence');
    if (rejected) reasons.push('rejected_comparable');
    if (duplicate) reasons.push('duplicate_evidence');
    if (transactionIneligible) reasons.push('transaction_ineligible');
    if (stale) reasons.push('stale_evidence');
    if (evidenceType === 'true_sold' && !exactComparable) reasons.push('contextual_comparable_only');

    const compact = compactEvidence(record, index, { ageDays: ageDays ?? UNKNOWN_VALUE, exactComparable, exclusionReasons: reasons });
    if (evidenceType === 'true_sold' && exactComparable && reasons.length === 0) used.push(compact);
    else excluded.push(compact);
  });

  return { used, excluded };
}

function getExcludedCount(excluded = [], reason) {
  return excluded.filter((item) => item.exclusionReasons.includes(reason)).length;
}

function getSourceConcentration(used = []) {
  const counts = {};
  for (const item of used) {
    const source = item.source || UNKNOWN_VALUE;
    counts[source] = (counts[source] || 0) + 1;
  }
  const total = used.length;
  const top = Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] || [UNKNOWN_VALUE, 0];
  return {
    sourceCount: Object.keys(counts).length,
    sourceDistribution: counts,
    dominantSource: top[0],
    dominantSourceShare: total ? Number((top[1] / total).toFixed(3)) : 0,
    concentrated: total >= MIN_TRUE_SOLD_FOR_READY && top[1] / total >= 0.8
  };
}

function getComparableQuality(input = {}, records = []) {
  if (input.comparableQuality) return clone(input.comparableQuality);
  return comparableQualityEngine.evaluateComparableQuality({
    comps: records,
    listing: input.listing,
    marketContext: input.marketContext
  });
}

function getIdentityExactness(input = {}) {
  const identityDiagnostic = asObject(firstDefined(input.identityDiagnosticResult, input.identityDiagnostics, input.identityParserDiagnostics, {}));
  if (identityDiagnostic.identityEligibility) {
    return {
      exact: identityDiagnostic.identityEligibility.valuationEligible === true || identityDiagnostic.identityEligibility.exactCompEligible === true,
      source: 'identity_parser_diagnostics',
      status: identityDiagnostic.diagnosticStatus || UNKNOWN_VALUE
    };
  }

  const canonicalIdentity = asObject(input.canonicalIdentity);
  if (canonicalIdentity.eligibility) {
    return {
      exact: canonicalIdentity.eligibility.valuationEligible === true || canonicalIdentity.eligibility.exactCompEligible === true,
      source: 'canonical_identity',
      status: canonicalIdentity.eligibility.valuationEligible === true ? 'valuation_eligible' : 'context_only'
    };
  }

  return {
    exact: UNKNOWN_VALUE,
    source: UNKNOWN_VALUE,
    status: UNKNOWN_VALUE
  };
}

function getReadinessStatus({ used, excluded, quality, identityExactness, sourceConcentration }) {
  const exactCount = used.length;
  const rejectedCount = getExcludedCount(excluded, 'rejected_comparable');
  const transactionIneligibleCount = getExcludedCount(excluded, 'transaction_ineligible');
  const duplicateCount = getExcludedCount(excluded, 'duplicate_evidence');
  const activeCount = getExcludedCount(excluded, 'active_listing_context_only');
  const fallbackCount = getExcludedCount(excluded, 'fallback_or_unknown_evidence');
  const qualityScore = toNumber(quality.averageComparableQualityScore, 0);
  const blockers = [];
  const warnings = [];

  if (!used.length && !excluded.length) return { status: READINESS_STATUS.UNAVAILABLE, blockers, warnings };
  if (identityExactness.exact === false) blockers.push('identity_not_exact_for_valuation');
  if (transactionIneligibleCount > 0) blockers.push('transaction_ineligible_evidence_present');
  if (rejectedCount > 0 && exactCount < MIN_TRUE_SOLD_FOR_READY) blockers.push('rejected_comparables_leave_insufficient_exact_evidence');
  if (duplicateCount > 0 && exactCount < MIN_TRUE_SOLD_FOR_READY) blockers.push('duplicates_leave_insufficient_exact_evidence');
  if (activeCount > 0 && exactCount === 0) blockers.push('active_only_evidence_cannot_satisfy_true_sold_minimum');
  if (fallbackCount > 0 && exactCount === 0) blockers.push('fallback_evidence_cannot_satisfy_true_sold_minimum');
  if (blockers.length) return { status: READINESS_STATUS.BLOCKED, blockers, warnings };

  if (exactCount === 0) return { status: READINESS_STATUS.INSUFFICIENT, blockers: ['no_true_sold_exact_evidence'], warnings };
  if (exactCount < MIN_TRUE_SOLD_FOR_READY) return { status: READINESS_STATUS.THIN, blockers, warnings };

  if (qualityScore > 0 && qualityScore < 55) warnings.push('comparable_quality_below_usable_threshold');
  if (sourceConcentration.concentrated) warnings.push('source_concentration_high');
  if (getExcludedCount(excluded, 'stale_evidence') > 0) warnings.push('stale_evidence_excluded');
  if (getExcludedCount(excluded, 'contextual_comparable_only') > 0) warnings.push('contextual_comparables_excluded');

  if (warnings.length) return { status: READINESS_STATUS.CONDITIONALLY_READY, blockers, warnings };
  return { status: READINESS_STATUS.READY, blockers, warnings };
}

function getReadinessLevel(status, used = []) {
  if (status === READINESS_STATUS.UNAVAILABLE) return READINESS_LEVEL.UNAVAILABLE;
  if (status === READINESS_STATUS.BLOCKED) return READINESS_LEVEL.BLOCKED;
  if (status === READINESS_STATUS.INSUFFICIENT) return READINESS_LEVEL.INSUFFICIENT;
  if (status === READINESS_STATUS.THIN) return READINESS_LEVEL.LIMITED;
  if (used.length >= 5 && status === READINESS_STATUS.READY) return READINESS_LEVEL.STRONG;
  return READINESS_LEVEL.ADEQUATE;
}

function getConfidenceCapRecommendation(status, used = []) {
  if (status === READINESS_STATUS.READY) return { recommendedCap: 100, reason: 'minimum_true_sold_exact_evidence_satisfied' };
  if (status === READINESS_STATUS.CONDITIONALLY_READY) return { recommendedCap: 75, reason: 'ready_with_evidence_warnings' };
  if (status === READINESS_STATUS.THIN) return { recommendedCap: 44, reason: 'fewer_than_three_true_sold_exact_records' };
  if (status === READINESS_STATUS.INSUFFICIENT) return { recommendedCap: 20, reason: 'no_true_sold_exact_records' };
  if (status === READINESS_STATUS.UNAVAILABLE) return { recommendedCap: 0, reason: 'evidence_unavailable' };
  return { recommendedCap: Math.min(18, used.length ? 44 : 18), reason: 'evidence_blocked_or_context_only' };
}

function getReviewAction(status) {
  if (status === READINESS_STATUS.READY) return REVIEW_ACTION.NONE;
  if (status === READINESS_STATUS.CONDITIONALLY_READY) return REVIEW_ACTION.REVIEW_CONDITIONS;
  if (status === READINESS_STATUS.THIN || status === READINESS_STATUS.INSUFFICIENT) return REVIEW_ACTION.COLLECT_MORE_SOLD_EVIDENCE;
  if (status === READINESS_STATUS.UNAVAILABLE) return REVIEW_ACTION.PROVIDE_EVIDENCE;
  return REVIEW_ACTION.RESOLVE_BLOCKERS;
}

function buildEvidenceSummary(records = [], used = [], excluded = [], sourceConcentration = {}) {
  return {
    trueSoldEvidenceCount: used.length + excluded.filter((item) => item.evidenceType === 'true_sold').length,
    activeListingCount: getExcludedCount(excluded, 'active_listing_context_only'),
    fallbackEvidenceCount: getExcludedCount(excluded, 'fallback_or_unknown_evidence'),
    exactComparableCount: used.length,
    contextualComparableCount: getExcludedCount(excluded, 'contextual_comparable_only'),
    rejectedComparableCount: getExcludedCount(excluded, 'rejected_comparable'),
    staleEvidenceCount: getExcludedCount(excluded, 'stale_evidence'),
    duplicateEvidenceCount: getExcludedCount(excluded, 'duplicate_evidence'),
    transactionIneligibleEvidenceCount: getExcludedCount(excluded, 'transaction_ineligible'),
    totalInputEvidenceCount: records.length,
    sourceConcentration
  };
}

function buildEvidenceReadinessFingerprint(result = {}) {
  const projection = clone(result);
  delete projection.stableFingerprint;
  return buildFingerprintFromProjection(projection);
}

function evaluateEvidenceReadiness(input = {}) {
  const records = getEvidenceInput(input);
  const quality = getComparableQuality(input, records);
  const { used, excluded } = classifyEvidence(records, input);
  const sourceConcentration = getSourceConcentration(used);
  const identityExactness = getIdentityExactness(input);
  const statusResult = getReadinessStatus({ used, excluded, quality, identityExactness, sourceConcentration });
  const readinessStatus = statusResult.status;
  const readinessLevel = getReadinessLevel(readinessStatus, used);
  const evidenceSummary = buildEvidenceSummary(records, used, excluded, sourceConcentration);
  const sufficiency = evidenceSufficiencyEngine.evaluateEvidenceSufficiency({
    evidenceSummary: {
      trueSoldCount: used.length,
      activeOnlyFlag: evidenceSummary.activeListingCount > 0 && used.length === 0,
      fallbackOnlyFlag: evidenceSummary.fallbackEvidenceCount > 0 && used.length === 0,
      normalizedEvidence: used.map((item) => ({
        evidenceType: 'true_sold',
        ageDays: item.ageDays === UNKNOWN_VALUE ? null : item.ageDays
      }))
    },
    comparableQuality: quality
  });
  const blockingReasons = collectBlockingReasons(statusResult.blockers.map((reason) => ({ when: true, reason })));
  const warnings = unique([
    ...statusResult.warnings,
    ...asArray(quality.warnings),
    ...asArray(sufficiency.warnings)
  ]);
  const valuationReady = [READINESS_STATUS.READY, READINESS_STATUS.CONDITIONALLY_READY].includes(readinessStatus);

  const result = {
    source: EVIDENCE_READINESS_DIAGNOSTIC_SOURCE,
    schemaVersion: EVIDENCE_READINESS_DIAGNOSTIC_SCHEMA_VERSION,
    productionImpact: 'none',
    decisionImpact: 'none',
    readinessStatus,
    readinessLevel,
    eligibleEvidenceSummary: {
      minimumTrueSoldRequired: MIN_TRUE_SOLD_FOR_READY,
      trueSoldEvidenceCount: used.length,
      exactComparableCount: used.length,
      freshEvidenceCount: used.filter((item) => item.ageDays !== UNKNOWN_VALUE && item.ageDays <= 90).length,
      sourceConcentration
    },
    excludedEvidenceSummary: {
      activeListingCount: evidenceSummary.activeListingCount,
      fallbackEvidenceCount: evidenceSummary.fallbackEvidenceCount,
      contextualComparableCount: evidenceSummary.contextualComparableCount,
      rejectedComparableCount: evidenceSummary.rejectedComparableCount,
      staleEvidenceCount: evidenceSummary.staleEvidenceCount,
      duplicateEvidenceCount: evidenceSummary.duplicateEvidenceCount,
      transactionIneligibleEvidenceCount: evidenceSummary.transactionIneligibleEvidenceCount
    },
    blockingReasons,
    warnings,
    evidenceUsed: used,
    evidenceExcluded: excluded,
    valuationReadiness: {
      diagnosticallyReady: valuationReady,
      shouldWithholdValuationDiagnostically: !valuationReady,
      reason: valuationReady ? 'minimum_evidence_readiness_satisfied' : 'minimum_evidence_readiness_not_satisfied',
      evidenceSufficiency: sufficiency
    },
    comparableQuality: quality,
    identityExactness,
    confidenceCapRecommendation: getConfidenceCapRecommendation(readinessStatus, used),
    recommendedReviewAction: getReviewAction(readinessStatus),
    stableFingerprint: ''
  };

  result.stableFingerprint = buildEvidenceReadinessFingerprint(result);
  return Object.freeze(result);
}

function summarizeEvidenceReadiness(result = {}) {
  const status = result.readinessStatus || READINESS_STATUS.UNAVAILABLE;
  if (status === READINESS_STATUS.READY) return 'Evidence readiness is ready for diagnostic valuation review.';
  if (status === READINESS_STATUS.CONDITIONALLY_READY) return 'Evidence readiness is conditionally ready with warnings requiring review.';
  if (status === READINESS_STATUS.THIN) return 'Evidence readiness is thin because true sold exact evidence is below the minimum.';
  if (status === READINESS_STATUS.INSUFFICIENT) return 'Evidence readiness is insufficient because true sold exact evidence is unavailable.';
  if (status === READINESS_STATUS.BLOCKED) return 'Evidence readiness is blocked by evidence quality, identity, transaction, active-only, or fallback-only concerns.';
  return 'Evidence readiness is unavailable because no evidence was supplied.';
}

module.exports = {
  DEFAULT_STALE_DAYS,
  EVIDENCE_READINESS_DIAGNOSTIC_SCHEMA_VERSION,
  EVIDENCE_READINESS_DIAGNOSTIC_SOURCE,
  MIN_TRUE_SOLD_FOR_READY,
  READINESS_LEVEL,
  READINESS_STATUS,
  REVIEW_ACTION,
  UNKNOWN_VALUE,
  buildEvidenceReadinessFingerprint,
  evaluateEvidenceReadiness,
  summarizeEvidenceReadiness
};
