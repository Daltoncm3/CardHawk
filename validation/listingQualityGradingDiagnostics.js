'use strict';

const qualityEngine = require('../engines/qualityEngine');
const riskEngine = require('../engines/riskEngine');
const gradingEngine = require('../engines/gradingEngine');
const gradePremiumEngine = require('../engines/gradePremiumEngine');
const historyEngine = require('../engines/historyEngine');
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

const LISTING_QUALITY_GRADING_DIAGNOSTIC_SCHEMA_VERSION = '1.0.0';
const LISTING_QUALITY_GRADING_DIAGNOSTIC_SOURCE = 'listing_quality_grading_diagnostics';
const UNKNOWN_VALUE = 'unknown';

const LISTING_QUALITY_STATUS = Object.freeze({
  STRONG: 'strong',
  ACCEPTABLE: 'acceptable',
  CAUTION: 'caution',
  HIGH_RISK: 'high_risk',
  BLOCKED: 'blocked',
  UNAVAILABLE: 'unavailable'
});

const GRADING_DIAGNOSTIC_STATUS = Object.freeze({
  CONFIRMED: 'confirmed',
  LIKELY: 'likely',
  AMBIGUOUS: 'ambiguous',
  UNSUPPORTED: 'unsupported',
  HIGH_RISK: 'high_risk',
  UNAVAILABLE: 'unavailable'
});

const RISK_LEVEL = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
  UNKNOWN: 'unknown'
});

const REVIEW_ACTION = Object.freeze({
  NONE: 'none',
  REVIEW_LISTING_QUALITY: 'review_listing_quality_before_reliance',
  REVIEW_GRADING_EVIDENCE: 'review_grading_evidence_before_reliance',
  MANUAL_AUTHENTICITY_REVIEW: 'manual_authenticity_and_listing_review_required',
  PROVIDE_LISTING_EVIDENCE: 'provide_listing_quality_and_grading_evidence'
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

function known(value) {
  return value !== undefined && value !== null && value !== '' && value !== UNKNOWN_VALUE;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function toNumber(value, fallback = UNKNOWN_VALUE) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isKnownNumber(value) {
  return Number.isFinite(Number(value));
}

function pick(sources = [], keys = [], fallback = UNKNOWN_VALUE) {
  for (const source of sources) {
    const object = asObject(source);
    for (const key of keys) {
      if (known(object[key])) {
        return typeof object[key] === 'object' ? clone(object[key]) : object[key];
      }
    }
  }
  return fallback;
}

function getListing(input = {}) {
  return asObject(firstDefined(input.listing, input.productionListing, input.item, input.record, {}));
}

function getParsed(input = {}, listing = getListing(input)) {
  return asObject(firstDefined(input.parserOutput, input.parsed, listing.parsed, listing.card, listing.parsedCard, {}));
}

function getTitle(listing = {}) {
  const value = firstDefined(listing.title, listing.rawTitle, listing.listingTitle);
  return known(value) ? String(value) : '';
}

function getImageCount(listing = {}) {
  if (Array.isArray(listing.images)) return listing.images.filter(Boolean).length;
  if (Array.isArray(listing.imageUrls)) return listing.imageUrls.filter(Boolean).length;
  if (listing.image || listing.imageUrl || listing.thumbnailUrl) return 1;
  return 0;
}

function matchTerms(text = '', checks = []) {
  return checks
    .filter((check) => check.regex.test(text))
    .map((check) => check.code);
}

function getTitleSignals(title = '') {
  const text = normalize(title);
  return {
    vagueTitleRisk: title.trim().length > 0 && title.trim().length < 28,
    lotRisk: /\b(lot|collection|bulk|mystery|repack|break)\b/.test(text),
    reprintProxyRisk: /\b(reprint|rp|proxy|custom|facsimile|replica|novelty|art card|not original)\b/.test(text),
    conditionAmbiguity: /\b(raw|ungraded|as[- ]?is|see photos|condition varies|unknown condition)\b/.test(text),
    damageRisk: /\b(damaged|damage|crease|creased|bent|corner wear|surface issue|scratch|scratched|poor|stain|stained)\b/.test(text),
    alteredRisk: /\b(altered|trimmed|evidence of trimming|authentic only|authentic alter|qualified|miscut)\b/.test(text),
    slabRisk: /\b(crossover|cross over|mislabeled|wrong label|label error|cert|certification|slab)\b/.test(text),
    rawTerm: /\b(raw|ungraded)\b/.test(text),
    gradedTerm: /\b(psa|bgs|beckett|sgc|cgc|csg)\s*(10|9\.5|9|8\.5|8|7|6|5|4|3|2|1)?\b/.test(text)
  };
}

function getSellerContext(listing = {}) {
  const seller = asObject(listing.seller);
  const feedbackPercentage = toNumber(pick([listing, seller], [
    'sellerFeedbackPercentage',
    'sellerPositivePercent',
    'positiveFeedbackPercent',
    'feedbackPercent'
  ]));
  const feedbackScore = toNumber(pick([listing, seller], [
    'sellerFeedbackScore',
    'sellerFeedback',
    'feedbackScore',
    'feedbackCount'
  ]));

  return {
    sellerUsername: pick([listing, seller], ['sellerUsername', 'username', 'sellerName']),
    feedbackPercentage,
    feedbackScore,
    lowFeedbackRisk: (isKnownNumber(feedbackScore) && Number(feedbackScore) > 0 && Number(feedbackScore) < 20) ||
      (isKnownNumber(feedbackPercentage) && Number(feedbackPercentage) > 0 && Number(feedbackPercentage) < 97)
  };
}

function getPriceContext(input = {}, listing = getListing(input)) {
  const marketData = asObject(firstDefined(input.marketData, input.valuationSummary, input.valuation, {}));
  const listingPrice = toNumber(pick([listing], ['totalCost', 'price', 'currentPrice', 'askingPrice']));
  const marketValue = toNumber(pick([marketData, input], ['marketValue', 'expectedValue', 'estimatedValue']));
  const priceToMarketRatio = isKnownNumber(listingPrice) && isKnownNumber(marketValue) && Number(marketValue) > 0
    ? Math.round((Number(listingPrice) / Number(marketValue)) * 1000) / 1000
    : UNKNOWN_VALUE;

  return {
    listingPrice,
    marketValue,
    priceToMarketRatio,
    suspiciouslyLowPrice: isKnownNumber(priceToMarketRatio) && Number(priceToMarketRatio) < 0.2
  };
}

function getHistoryContext(input = {}, listing = getListing(input)) {
  const supplied = asObject(firstDefined(input.listingHistoryContext, input.historyContext, input.historyRecord, listing.history, {}));
  const priceHistory = asArray(firstDefined(supplied.priceHistory, listing.priceHistory, []));
  const priceDrops = asArray(firstDefined(supplied.priceDrops, listing.priceDrops, []));
  const historyShapeAvailable = typeof historyEngine.summarizeHistory === 'function';
  return {
    available: Object.keys(supplied).length > 0 || priceHistory.length > 0 || priceDrops.length > 0,
    status: pick([supplied], ['status']),
    seenCount: toNumber(pick([supplied, listing], ['seenCount', 'scansSurvived'])),
    disappearedAt: pick([supplied], ['disappearedAt']),
    likelySoldOrEnded: pick([supplied], ['likelySoldOrEnded']),
    priceHistoryCount: priceHistory.length,
    priceDropCount: priceDrops.length,
    lastPriceDrop: clone(priceDrops[0] || null),
    historyHelperAvailable: historyShapeAvailable,
    priceChangeRisk: priceDrops.length > 0 || supplied.status === 'disappeared' || supplied.likelySoldOrEnded === true
  };
}

function getQualityData(input = {}, listing = getListing(input)) {
  const supplied = firstDefined(input.qualityData, input.qualitySummary);
  if (supplied && typeof supplied === 'object') return clone(supplied);
  return qualityEngine.evaluateQuality(listing);
}

function getRiskData(input = {}, listing = getListing(input)) {
  const supplied = firstDefined(input.riskData, input.riskSummary);
  if (supplied && typeof supplied === 'object') return clone(supplied);
  return riskEngine.evaluateRisk({
    ...input,
    listing
  });
}

function getGradeData(input = {}, listing = getListing(input)) {
  const supplied = firstDefined(input.gradingSummary, input.dealGrade, input.gradeData);
  if (supplied && typeof supplied === 'object') return clone(supplied);
  const result = gradingEngine.gradeDeal({
    ...listing,
    marketConfidence: pick([input.confidenceSummary, input.marketData, listing], ['confidence', 'marketConfidence'], listing.marketConfidence),
    compCount: pick([input.evidenceSummary, input.marketData, listing], ['compCount', 'soldCompCount'], listing.compCount),
    compSource: pick([input.evidenceSummary, input.marketData, listing], ['source', 'compSource'], listing.compSource)
  });
  delete result.createdAt;
  return result;
}

function getGradePremiumData(input = {}, listing = getListing(input)) {
  const supplied = firstDefined(input.gradePremiumDiagnostic, input.gradePremiumData, input.gradePremiumSummary);
  if (supplied && typeof supplied === 'object') return clone(supplied);
  return gradePremiumEngine.evaluateGradePremium({
    ...input,
    listing
  });
}

function getIdentityConsistency(input = {}, parsed = {}) {
  const identityDiagnostic = asObject(firstDefined(input.identityDiagnosticResult, input.identityDiagnostics, input.identityParserDiagnostics, {}));
  const eligibility = asObject(identityDiagnostic.identityEligibility);
  return {
    diagnosticStatus: pick([identityDiagnostic], ['diagnosticStatus']),
    ambiguityLevel: pick([identityDiagnostic], ['ambiguityLevel']),
    valuationEligible: pick([eligibility], ['valuationEligible']),
    exactCompEligible: pick([eligibility], ['exactCompEligible']),
    parsedRawOrGraded: pick([parsed], ['rawOrGraded']),
    stableFingerprint: pick([identityDiagnostic], ['stableFingerprint'])
  };
}

function getGradeProfile(listing = {}, parsed = {}, titleSignals = {}) {
  const flags = asObject(parsed.flags);
  const title = normalize(getTitle(listing));
  const gradingCompany = normalize(pick([parsed, listing], ['gradeCompany', 'grader', 'gradingCompany']));
  const grade = pick([parsed, listing], ['grade', 'conditionGrade', 'numericGrade']);
  const rawOrGraded = normalize(pick([parsed, listing], ['rawOrGraded', 'rawGradedState']));
  const titleGradeCompany = /\bpsa\b/.test(title) ? 'psa'
    : /\bbgs\b|\bbeckett\b/.test(title) ? 'bgs'
      : /\bsgc\b/.test(title) ? 'sgc'
        : /\bcgc\b|\bcsg\b/.test(title) ? 'cgc'
          : UNKNOWN_VALUE;
  const titleGrade = title.match(/\b(?:psa|bgs|sgc|cgc|csg)\s*(10|9\.5|9|8\.5|8|7|6|5|4|3|2|1)\b/)?.[1] || UNKNOWN_VALUE;
  const gradedFlag = flags.graded === true || rawOrGraded === 'graded' || known(gradingCompany) || known(titleGradeCompany);
  const rawFlag = flags.graded === false || rawOrGraded === 'raw' || titleSignals.rawTerm;

  return {
    rawOrGraded: gradedFlag ? 'graded' : rawFlag ? 'raw' : UNKNOWN_VALUE,
    gradingCompany: known(gradingCompany) ? gradingCompany : titleGradeCompany,
    grade: known(grade) ? grade : titleGrade,
    gradedFlag,
    rawFlag,
    rawGradedConflict: gradedFlag && rawFlag,
    slabCertificationAmbiguity: titleSignals.slabRisk && (!known(grade) || !known(gradingCompany)),
    highRiskLanguage: titleSignals.alteredRisk,
    titleGradeCompany,
    titleGrade
  };
}

function getListingQualityStatus({ listing, titleSignals, sellerContext, priceContext, historyContext, qualityData, riskData, imageCount }) {
  if (Object.keys(asObject(listing)).length === 0 || !getTitle(listing)) return LISTING_QUALITY_STATUS.UNAVAILABLE;
  if (titleSignals.reprintProxyRisk || titleSignals.alteredRisk) return LISTING_QUALITY_STATUS.BLOCKED;
  if (titleSignals.lotRisk || titleSignals.damageRisk || sellerContext.lowFeedbackRisk || priceContext.suspiciouslyLowPrice) {
    return LISTING_QUALITY_STATUS.HIGH_RISK;
  }
  if (imageCount <= 0 || titleSignals.vagueTitleRisk || titleSignals.conditionAmbiguity || historyContext.priceChangeRisk) {
    return LISTING_QUALITY_STATUS.CAUTION;
  }
  const qualityScore = Number(qualityData.investmentQuality);
  const riskLevel = normalize(riskData.riskLevel);
  if (Number.isFinite(qualityScore) && qualityScore >= 80 && ['low', 'medium', 'unknown', ''].includes(riskLevel)) {
    return LISTING_QUALITY_STATUS.STRONG;
  }
  return LISTING_QUALITY_STATUS.ACCEPTABLE;
}

function getGradingDiagnosticStatus({ gradeProfile, gradePremiumData, titleSignals }) {
  if (gradeProfile.highRiskLanguage) return GRADING_DIAGNOSTIC_STATUS.HIGH_RISK;
  if (gradeProfile.rawGradedConflict || gradeProfile.slabCertificationAmbiguity || titleSignals.slabRisk) {
    return GRADING_DIAGNOSTIC_STATUS.AMBIGUOUS;
  }
  if (gradeProfile.rawOrGraded === 'raw') return GRADING_DIAGNOSTIC_STATUS.UNSUPPORTED;
  if (!known(gradeProfile.rawOrGraded)) return GRADING_DIAGNOSTIC_STATUS.UNAVAILABLE;
  const hasCompany = known(gradeProfile.gradingCompany);
  const hasGrade = known(gradeProfile.grade);
  const premiumRisk = normalize(gradePremiumData.premiumRiskLevel);
  const premiumJustification = normalize(gradePremiumData.premiumJustification);
  if (hasCompany && hasGrade && !['high'].includes(premiumRisk) && !['unproven', 'unknown', 'overextended'].includes(premiumJustification)) {
    return GRADING_DIAGNOSTIC_STATUS.CONFIRMED;
  }
  if (hasCompany && hasGrade) return GRADING_DIAGNOSTIC_STATUS.LIKELY;
  return GRADING_DIAGNOSTIC_STATUS.AMBIGUOUS;
}

function getRiskLevel({ listingStatus, gradingStatus, riskData }) {
  if (listingStatus === LISTING_QUALITY_STATUS.BLOCKED || gradingStatus === GRADING_DIAGNOSTIC_STATUS.HIGH_RISK) return RISK_LEVEL.CRITICAL;
  if (listingStatus === LISTING_QUALITY_STATUS.HIGH_RISK || gradingStatus === GRADING_DIAGNOSTIC_STATUS.AMBIGUOUS) return RISK_LEVEL.HIGH;
  if (listingStatus === LISTING_QUALITY_STATUS.STRONG && gradingStatus === GRADING_DIAGNOSTIC_STATUS.CONFIRMED) return RISK_LEVEL.LOW;
  const engineRisk = normalize(riskData.riskLevel);
  if (['critical', 'high', 'medium', 'low'].includes(engineRisk)) return engineRisk;
  if (listingStatus === LISTING_QUALITY_STATUS.CAUTION || gradingStatus === GRADING_DIAGNOSTIC_STATUS.UNSUPPORTED) return RISK_LEVEL.MEDIUM;
  if (listingStatus === LISTING_QUALITY_STATUS.UNAVAILABLE || gradingStatus === GRADING_DIAGNOSTIC_STATUS.UNAVAILABLE) return RISK_LEVEL.UNKNOWN;
  return RISK_LEVEL.LOW;
}

function buildAttributes({ imageCount, titleSignals, gradeProfile, sellerContext }) {
  const confirmedAttributes = unique([
    imageCount > 0 ? 'image_present' : null,
    imageCount > 1 ? 'multiple_images_present' : null,
    known(gradeProfile.gradingCompany) ? `grading_company:${gradeProfile.gradingCompany}` : null,
    known(gradeProfile.grade) ? `grade:${gradeProfile.grade}` : null,
    sellerContext.lowFeedbackRisk === false && known(sellerContext.feedbackScore) ? 'seller_history_present' : null
  ].filter(Boolean));

  const ambiguousAttributes = unique([
    titleSignals.vagueTitleRisk ? 'vague_or_incomplete_title' : null,
    titleSignals.conditionAmbiguity ? 'condition_ambiguity' : null,
    gradeProfile.rawGradedConflict ? 'raw_vs_graded_conflict' : null,
    gradeProfile.slabCertificationAmbiguity ? 'slab_certification_ambiguity' : null,
    titleSignals.slabRisk ? 'slab_or_crossover_language' : null
  ].filter(Boolean));

  const unsupportedAttributes = unique([
    imageCount <= 0 ? 'image_evidence_missing' : null,
    !known(gradeProfile.gradingCompany) && gradeProfile.rawOrGraded === 'graded' ? 'grading_company_missing' : null,
    !known(gradeProfile.grade) && gradeProfile.rawOrGraded === 'graded' ? 'grade_number_missing' : null,
    !known(sellerContext.feedbackScore) ? 'seller_history_unknown' : null
  ].filter(Boolean));

  return {
    confirmedAttributes,
    ambiguousAttributes,
    unsupportedAttributes
  };
}

function getBlockingIssues({ titleSignals, priceContext, imageCount, gradeProfile }) {
  return collectBlockingReasons([
    { when: titleSignals.reprintProxyRisk, reason: 'reprint_custom_proxy_replica_language_present' },
    { when: titleSignals.alteredRisk, reason: 'altered_authentic_only_qualified_or_trimming_language_present' },
    { when: titleSignals.lotRisk, reason: 'lot_or_multi_card_risk_present' },
    { when: priceContext.suspiciouslyLowPrice, reason: 'suspiciously_low_price_context' },
    { when: imageCount <= 0, reason: 'image_evidence_missing' },
    { when: gradeProfile.rawGradedConflict, reason: 'raw_vs_graded_status_conflict' }
  ]);
}

function getWarnings({ titleSignals, sellerContext, historyContext, gradePremiumData, riskData, qualityData }) {
  return unique([
    ...asArray(qualityData.warnings).map(String),
    ...asArray(riskData.warnings).map(String),
    ...asArray(gradePremiumData.warnings).map(String),
    titleSignals.vagueTitleRisk ? 'vague_or_incomplete_title_risk' : null,
    titleSignals.conditionAmbiguity ? 'condition_ambiguity' : null,
    titleSignals.damageRisk ? 'damage_or_defect_language_present' : null,
    titleSignals.slabRisk ? 'slab_certification_crossover_or_mislabeled_language_present' : null,
    sellerContext.lowFeedbackRisk ? 'seller_feedback_or_history_risk' : null,
    historyContext.priceChangeRisk ? 'listing_history_price_change_or_disappearance_context' : null,
    normalize(gradePremiumData.premiumRiskLevel) === 'high' ? 'grade_premium_support_high_risk' : null
  ].filter(Boolean));
}

function getReviewAction(listingStatus, gradingStatus) {
  if (listingStatus === LISTING_QUALITY_STATUS.UNAVAILABLE) return REVIEW_ACTION.PROVIDE_LISTING_EVIDENCE;
  if (listingStatus === LISTING_QUALITY_STATUS.BLOCKED || gradingStatus === GRADING_DIAGNOSTIC_STATUS.HIGH_RISK) {
    return REVIEW_ACTION.MANUAL_AUTHENTICITY_REVIEW;
  }
  if ([GRADING_DIAGNOSTIC_STATUS.AMBIGUOUS, GRADING_DIAGNOSTIC_STATUS.UNSUPPORTED].includes(gradingStatus)) {
    return REVIEW_ACTION.REVIEW_GRADING_EVIDENCE;
  }
  if ([LISTING_QUALITY_STATUS.CAUTION, LISTING_QUALITY_STATUS.HIGH_RISK].includes(listingStatus)) {
    return REVIEW_ACTION.REVIEW_LISTING_QUALITY;
  }
  return REVIEW_ACTION.NONE;
}

function buildListingQualityGradingFingerprint(result = {}) {
  const projection = clone(result);
  delete projection.stableFingerprint;
  return buildFingerprintFromProjection(projection);
}

function evaluateListingQualityGrading(input = {}) {
  const listing = getListing(input);
  const parsed = getParsed(input, listing);
  const title = getTitle(listing);
  const titleSignals = getTitleSignals(title);
  const imageCount = getImageCount(listing);
  const sellerContext = getSellerContext(listing);
  const priceContext = getPriceContext(input, listing);
  const historyContext = getHistoryContext(input, listing);
  const qualityData = getQualityData(input, listing);
  const riskData = getRiskData(input, listing);
  const gradeData = getGradeData(input, listing);
  const gradePremiumData = getGradePremiumData(input, listing);
  const identityConsistency = getIdentityConsistency(input, parsed);
  const gradeProfile = getGradeProfile(listing, parsed, titleSignals);
  const listingQualityStatus = getListingQualityStatus({
    listing,
    titleSignals,
    sellerContext,
    priceContext,
    historyContext,
    qualityData,
    riskData,
    imageCount
  });
  const gradingDiagnosticStatus = getGradingDiagnosticStatus({
    gradeProfile,
    gradePremiumData,
    titleSignals
  });
  const riskLevel = getRiskLevel({
    listingStatus: listingQualityStatus,
    gradingStatus: gradingDiagnosticStatus,
    riskData
  });
  const attributes = buildAttributes({
    imageCount,
    titleSignals,
    gradeProfile,
    sellerContext
  });
  const blockingIssues = getBlockingIssues({
    titleSignals,
    priceContext,
    imageCount,
    gradeProfile
  });
  const warnings = getWarnings({
    titleSignals,
    sellerContext,
    historyContext,
    gradePremiumData,
    riskData,
    qualityData
  });

  const result = {
    source: LISTING_QUALITY_GRADING_DIAGNOSTIC_SOURCE,
    schemaVersion: LISTING_QUALITY_GRADING_DIAGNOSTIC_SCHEMA_VERSION,
    productionImpact: 'none',
    decisionImpact: 'none',
    listingQualityStatus,
    gradingDiagnosticStatus,
    riskLevel,
    blockingIssues,
    warnings,
    confirmedAttributes: attributes.confirmedAttributes,
    ambiguousAttributes: attributes.ambiguousAttributes,
    unsupportedAttributes: attributes.unsupportedAttributes,
    listingQualitySummary: {
      title: title || UNKNOWN_VALUE,
      imageCount,
      imageQuality: imageCount >= 3 ? 'strong' : imageCount > 0 ? 'limited' : 'missing',
      titleSignals,
      sellerContext,
      priceContext,
      qualityEngineSummary: qualityEngine.summarizeQuality(qualityData),
      riskEngineSummary: riskEngine.summarizeRisk(riskData)
    },
    gradingSupportSummary: {
      gradeProfile,
      gradePremiumScore: pick([gradePremiumData], ['gradePremiumScore']),
      premiumJustification: pick([gradePremiumData], ['premiumJustification']),
      premiumRiskLevel: pick([gradePremiumData], ['premiumRiskLevel']),
      soldSupport: clone(asObject(gradePremiumData.soldSupport)),
      gradingEngineSummary: {
        grade: pick([gradeData], ['grade']),
        gradeScore: pick([gradeData], ['gradeScore']),
        concerns: asArray(gradeData.concerns).map(String)
      },
      identityToGradeConsistency: identityConsistency
    },
    listingHistoryContext: historyContext,
    recommendedReviewAction: getReviewAction(listingQualityStatus, gradingDiagnosticStatus),
    stableFingerprint: ''
  };

  result.stableFingerprint = buildListingQualityGradingFingerprint(result);
  return deepFreeze(result);
}

function summarizeListingQualityGrading(result = {}) {
  const listingStatus = result.listingQualityStatus || LISTING_QUALITY_STATUS.UNAVAILABLE;
  const gradingStatus = result.gradingDiagnosticStatus || GRADING_DIAGNOSTIC_STATUS.UNAVAILABLE;
  return `Listing quality is ${listingStatus}; grading diagnostic is ${gradingStatus}.`;
}

module.exports = {
  GRADING_DIAGNOSTIC_STATUS,
  LISTING_QUALITY_GRADING_DIAGNOSTIC_SCHEMA_VERSION,
  LISTING_QUALITY_GRADING_DIAGNOSTIC_SOURCE,
  LISTING_QUALITY_STATUS,
  REVIEW_ACTION,
  RISK_LEVEL,
  UNKNOWN_VALUE,
  buildListingQualityGradingFingerprint,
  evaluateListingQualityGrading,
  summarizeListingQualityGrading
};
