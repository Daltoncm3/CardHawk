'use strict';

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function uniqueMessages(messages) {
  const seen = new Set();

  return asArray(messages)
    .filter(Boolean)
    .map((message) => String(message).trim())
    .filter((message) => {
      if (!message || seen.has(message)) return false;
      seen.add(message);
      return true;
    });
}

function pushSignal(list, source, message) {
  if (!message) return;
  list.push({ source, message });
}

function getEvidencePosture(evidenceSufficiency = {}) {
  const level = normalize(evidenceSufficiency.sufficiencyLevel);
  const score = toNumber(evidenceSufficiency.evidenceSufficiencyScore, 0);
  const blockingConcerns = asArray(evidenceSufficiency.blockingConcerns);

  if (
    blockingConcerns.length > 0 ||
    level === 'unreliable' ||
    level === 'insufficient' ||
    evidenceSufficiency.sufficientForValuation === false
  ) {
    return 'unreliable';
  }

  if (level === 'strong') return 'strong';
  if (level === 'adequate') return 'adequate';
  if (level === 'limited') return 'thin';
  if (score >= 85) return 'strong';
  if (score >= 68 || evidenceSufficiency.sufficientForValuation === true) return 'adequate';
  if (score >= 45) return 'thin';
  return 'unknown';
}

function getSimilarityPosture(listingSimilarity = {}) {
  const band = normalize(listingSimilarity.similarityBand);
  const averageScore = toNumber(listingSimilarity.averageSimilarityScore, 0);
  const fatalMismatches = asArray(listingSimilarity.fatalMismatches);
  const distribution = listingSimilarity.similarityDistribution || {};

  if (fatalMismatches.length > 0 || band === 'reject' || toNumber(distribution.reject, 0) > 0) {
    return 'rejected';
  }

  if (band === 'exact' || band === 'strong' || averageScore >= 85) return 'strong_match';
  if (band === 'usable' || averageScore >= 70) return 'usable_match';
  if (band === 'weak' || averageScore > 0) return 'weak_match';
  return 'unknown';
}

function getComparableQualityPosture(comparableQuality = {}) {
  const score = toNumber(comparableQuality.averageComparableQualityScore, 0);
  const distribution = comparableQuality.qualityDistribution || {};
  const rejectCount = toNumber(distribution.reject, 0);
  const weakCount = toNumber(distribution.weak, 0);
  const scoredCount = toNumber(comparableQuality.scoredComparableCount, 0);

  if (rejectCount > 0) return 'rejected';
  if (!scoredCount && !score) return 'unknown';
  if (score >= 80) return 'trusted';
  if (score >= 55 && weakCount <= 1) return 'usable';
  if (score > 0 || weakCount > 0) return 'weak';
  return 'unknown';
}

function getCompPosture(similarityPosture, qualityPosture) {
  if (similarityPosture === 'rejected' || qualityPosture === 'rejected') return 'rejected';
  if (similarityPosture === 'unknown' && qualityPosture === 'unknown') return 'unknown';
  if (similarityPosture === 'weak_match' || qualityPosture === 'weak') return 'weak';
  if (similarityPosture === 'strong_match' && qualityPosture === 'trusted') return 'strong';
  if (
    ['strong_match', 'usable_match'].includes(similarityPosture) &&
    ['trusted', 'usable'].includes(qualityPosture)
  ) {
    return 'usable';
  }
  return 'limited';
}

function getValuationPosture(valuationRange = {}) {
  const quality = normalize(valuationRange.rangeQuality);
  const expectedValue = toNumber(valuationRange.expectedValue, 0);

  if (quality === 'unreliable' || expectedValue <= 0) return 'unreliable_range';
  if (quality === 'strong') return 'strong_range';
  if (quality === 'usable') return 'usable_range';
  if (quality === 'thin') return 'thin_range';
  return 'unknown';
}

function getResalePressurePosture(supplyPressure = {}) {
  const pressure = normalize(supplyPressure.pressureLevel);
  const undercutRisk = normalize(supplyPressure.undercutRiskLevel);
  const blockerRisk = normalize(supplyPressure.resaleBlockerRisk);

  if (['severe'].includes(pressure) || ['severe'].includes(undercutRisk)) return 'severe';
  if (['high'].includes(pressure) || ['high'].includes(undercutRisk) || blockerRisk === 'high') return 'high';
  if (['elevated'].includes(pressure) || ['moderate'].includes(undercutRisk) || blockerRisk === 'moderate') return 'elevated';
  if (pressure === 'low' && ['low', 'unknown', ''].includes(undercutRisk)) return 'low';
  if (pressure === 'normal' || undercutRisk === 'normal') return 'normal';
  return 'unknown';
}

function collectSignals(input, postures) {
  const supportingSignals = [];
  const cautionSignals = [];
  const blockers = [];
  const conflicts = [];

  const evidence = input.evidenceSufficiency || {};
  const similarity = input.listingSimilarity || {};
  const quality = input.comparableQuality || {};
  const valuation = input.valuationRange || {};
  const supply = input.supplyPressure || {};

  if (postures.evidencePosture === 'strong' || postures.evidencePosture === 'adequate') {
    pushSignal(supportingSignals, 'evidence_sufficiency', evidence.summary || 'Evidence sufficiency supports cautious market interpretation.');
  } else if (postures.evidencePosture === 'thin') {
    pushSignal(cautionSignals, 'evidence_sufficiency', evidence.summary || 'Evidence is thin and should remain context only.');
  } else if (postures.evidencePosture === 'unreliable') {
    pushSignal(blockers, 'evidence_sufficiency', evidence.summary || 'Evidence is unreliable for valuation trust.');
  } else {
    pushSignal(cautionSignals, 'evidence_sufficiency', 'Evidence sufficiency is unknown.');
  }

  for (const concern of asArray(evidence.blockingConcerns)) {
    pushSignal(blockers, 'evidence_sufficiency', concern);
  }

  if (postures.similarityPosture === 'strong_match') {
    pushSignal(supportingSignals, 'listing_similarity', similarity.summary || 'Comparable listings appear strongly matched.');
  } else if (postures.similarityPosture === 'usable_match') {
    pushSignal(cautionSignals, 'listing_similarity', similarity.summary || 'Comparable listings are usable but review-worthy.');
  } else if (postures.similarityPosture === 'weak_match') {
    pushSignal(cautionSignals, 'listing_similarity', similarity.summary || 'Comparable listing similarity is weak.');
  } else if (postures.similarityPosture === 'rejected') {
    pushSignal(blockers, 'listing_similarity', similarity.summary || 'Listing similarity is rejected or too weak.');
  }

  for (const mismatch of asArray(similarity.fatalMismatches)) {
    pushSignal(blockers, 'listing_similarity', `Fatal similarity mismatch: ${mismatch}.`);
  }

  if (postures.qualityPosture === 'trusted') {
    pushSignal(supportingSignals, 'comparable_quality', quality.summary || 'Comparable quality appears trustworthy.');
  } else if (postures.qualityPosture === 'usable') {
    pushSignal(supportingSignals, 'comparable_quality', quality.summary || 'Comparable quality is usable.');
  } else if (postures.qualityPosture === 'weak') {
    pushSignal(cautionSignals, 'comparable_quality', quality.summary || 'Comparable quality is weak or incomplete.');
  } else if (postures.qualityPosture === 'rejected') {
    pushSignal(blockers, 'comparable_quality', quality.summary || 'Comparable quality includes rejected comps.');
  }

  if (postures.valuationPosture === 'strong_range' || postures.valuationPosture === 'usable_range') {
    pushSignal(supportingSignals, 'valuation_range', valuation.summary || 'Valuation range is usable for explanation.');
  } else if (postures.valuationPosture === 'thin_range') {
    pushSignal(cautionSignals, 'valuation_range', valuation.summary || 'Valuation range is thin.');
  } else if (postures.valuationPosture === 'unreliable_range') {
    pushSignal(blockers, 'valuation_range', valuation.summary || 'Valuation range is unreliable.');
  }

  if (postures.resalePressurePosture === 'low' || postures.resalePressurePosture === 'normal') {
    pushSignal(supportingSignals, 'supply_pressure', supply.summary || 'Resale pressure appears manageable.');
  } else if (postures.resalePressurePosture === 'elevated') {
    pushSignal(cautionSignals, 'supply_pressure', supply.summary || 'Supply pressure is elevated.');
  } else if (postures.resalePressurePosture === 'high' || postures.resalePressurePosture === 'severe') {
    pushSignal(cautionSignals, 'supply_pressure', supply.summary || 'Supply pressure could block resale or force undercutting.');
  } else {
    pushSignal(cautionSignals, 'supply_pressure', 'Supply pressure is unknown.');
  }

  if (
    ['strong_range', 'usable_range'].includes(postures.valuationPosture) &&
    ['high', 'severe'].includes(postures.resalePressurePosture)
  ) {
    pushSignal(conflicts, 'valuation_vs_supply', 'Valuation range is usable, but active supply pressure could block resale or force undercutting.');
  }

  if (
    ['strong_match', 'usable_match'].includes(postures.similarityPosture) &&
    ['weak', 'rejected'].includes(postures.qualityPosture)
  ) {
    pushSignal(conflicts, 'similarity_vs_quality', 'Comparable listings may match the card, but comp quality is not trustworthy enough.');
  }

  if (
    ['strong_range', 'usable_range'].includes(postures.valuationPosture) &&
    ['unreliable', 'thin'].includes(postures.evidencePosture)
  ) {
    pushSignal(conflicts, 'valuation_vs_evidence', 'Valuation output appears usable, but evidence sufficiency limits trust.');
  }

  if (
    ['low', 'normal'].includes(postures.resalePressurePosture) &&
    postures.valuationPosture === 'unreliable_range'
  ) {
    pushSignal(conflicts, 'supply_vs_valuation', 'Low resale pressure does not fix an unreliable valuation range.');
  }

  return {
    supportingSignals: uniqueBySourceMessage(supportingSignals),
    cautionSignals: uniqueBySourceMessage(cautionSignals),
    blockers: uniqueBySourceMessage(blockers),
    conflicts: uniqueBySourceMessage(conflicts)
  };
}

function uniqueBySourceMessage(items) {
  const seen = new Set();

  return asArray(items).filter((item) => {
    if (!item || !item.message) return false;
    const key = `${item.source}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getOverallReadiness(postures, blockers, conflicts, cautionSignals) {
  if (blockers.length > 0) return 'not_ready';
  if (postures.compPosture === 'rejected' || postures.valuationPosture === 'unreliable_range') return 'not_ready';
  if (conflicts.length > 0 || ['high', 'severe'].includes(postures.resalePressurePosture)) return 'cautious_context';
  if (cautionSignals.length > 0 || postures.evidencePosture === 'thin' || postures.compPosture === 'limited') return 'limited_context';
  if (
    ['strong', 'adequate'].includes(postures.evidencePosture) &&
    ['strong', 'usable'].includes(postures.compPosture) &&
    ['strong_range', 'usable_range'].includes(postures.valuationPosture)
  ) {
    return 'supported_context';
  }
  return 'limited_context';
}

function summarizeDecisionIntelligence(data = {}) {
  const impact = data.recommendationImpact || 'none';

  if (data.blockers && data.blockers.length > 0) {
    return `Decision Intelligence is explanation-only with recommendation impact ${impact}. It cannot form a reliable market read because blockers are present.`;
  }

  if (data.conflicts && data.conflicts.length > 0) {
    return `Decision Intelligence is explanation-only with recommendation impact ${impact}. The evidence has useful support, but conflicts require caution.`;
  }

  if (data.overallReadiness === 'supported_context') {
    return `Decision Intelligence is explanation-only with recommendation impact ${impact}. Evidence, comp trust, valuation range, and resale pressure are aligned enough for supported context.`;
  }

  if (data.overallReadiness === 'cautious_context') {
    return `Decision Intelligence is explanation-only with recommendation impact ${impact}. Market context is useful, but caution signals are material.`;
  }

  return `Decision Intelligence is explanation-only with recommendation impact ${impact}. The market read is limited by incomplete or mixed signals.`;
}

function evaluateDecisionIntelligence(input = {}) {
  const evidenceSufficiency = input.evidenceSufficiency || {};
  const listingSimilarity = input.listingSimilarity || {};
  const comparableQuality = input.comparableQuality || {};
  const valuationRange = input.valuationRange || {};
  const supplyPressure = input.supplyPressure || {};

  const similarityPosture = getSimilarityPosture(listingSimilarity);
  const qualityPosture = getComparableQualityPosture(comparableQuality);
  const postures = {
    evidencePosture: getEvidencePosture(evidenceSufficiency),
    similarityPosture,
    qualityPosture,
    compPosture: getCompPosture(similarityPosture, qualityPosture),
    valuationPosture: getValuationPosture(valuationRange),
    resalePressurePosture: getResalePressurePosture(supplyPressure)
  };
  const signals = collectSignals({
    evidenceSufficiency,
    listingSimilarity,
    comparableQuality,
    valuationRange,
    supplyPressure
  }, postures);
  const result = {
    source: 'decision_intelligence_engine',
    version: '1.4',
    mode: 'explanation_only',
    recommendationImpact: 'none',
    overallReadiness: getOverallReadiness(
      postures,
      signals.blockers,
      signals.conflicts,
      signals.cautionSignals
    ),
    evidencePosture: postures.evidencePosture,
    compPosture: postures.compPosture,
    valuationPosture: postures.valuationPosture,
    resalePressurePosture: postures.resalePressurePosture,
    supportingSignals: signals.supportingSignals,
    cautionSignals: signals.cautionSignals,
    blockers: signals.blockers,
    conflicts: signals.conflicts,
    summary: ''
  };

  result.summary = summarizeDecisionIntelligence(result);
  return result;
}

module.exports = {
  evaluateDecisionIntelligence,
  summarizeDecisionIntelligence
};
