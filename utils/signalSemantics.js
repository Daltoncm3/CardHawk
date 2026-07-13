'use strict';

const registry = require('./signalContractRegistry');

const BUY_LIKE_PATTERN = /\b(buy|buy_now|strong_review|strong buy candidate|elite)\b/i;

function hasBuyLikeWording(value) {
  return BUY_LIKE_PATTERN.test(String(value || ''));
}

function normalizeLabel(value) {
  return String(value || '').trim();
}

function neutralizeRecommendationLabel(label, fallback) {
  const normalized = normalizeLabel(label);
  if (!normalized) return '';

  const lower = normalized.toLowerCase();
  if (lower === 'elite') return 'Premium desirability context';
  if (lower === 'strong buy candidate') return 'Strong desirability context';
  if (lower === 'good flip candidate') return 'Good desirability context';
  if (lower === 'review carefully') return 'Mixed desirability context';
  if (lower === 'low priority') return 'Low desirability context';
  if (lower === 'avoid') return 'Poor desirability context';
  if (lower === 'buy_now' || lower === 'buy now' || lower === 'buy') return fallback;
  if (lower === 'strong_review') return fallback;
  if (lower.includes('buy')) return normalized.replace(/buy/ig, 'desirability');
  if (lower.includes('elite')) return normalized.replace(/elite/ig, 'premium context');
  return normalized;
}

function getFallbackLabel(contract = {}) {
  if (contract.signalType === registry.SIGNAL_TYPES.financial) return 'Financial ROI context';
  if (contract.signalType === registry.SIGNAL_TYPES.legacy) return 'Legacy context';
  if (contract.signalType === registry.SIGNAL_TYPES.evidence) return 'Evidence context';
  if (contract.signalType === registry.SIGNAL_TYPES.context) return 'Context signal';
  return 'Signal context';
}

function getAllowedSignalLabel(signalId, rawLabel) {
  const contract = registry.getSignalContract(signalId);
  const label = normalizeLabel(rawLabel);
  if (!contract || !label) return label;

  if (contract.signalType === registry.SIGNAL_TYPES.productionDecision) {
    return label;
  }

  if (signalId === 'deal_grade') {
    const lower = label.toLowerCase();
    if (['buy_now', 'buy now', 'buy', 'strong_review', 'review', 'watch', 'low_priority', 'low priority', 'pass'].includes(lower)) {
      return 'Legacy grade context';
    }
  }

  const fallback = getFallbackLabel(contract);
  const neutralLabel = neutralizeRecommendationLabel(label, fallback);
  const safeLabel = hasBuyLikeWording(neutralLabel) ? fallback : neutralLabel;

  if (signalId === 'deal_grade') {
    return /context/i.test(safeLabel) ? safeLabel : `${safeLabel} legacy context`;
  }

  if (signalId === 'roi_recommendation') {
    return /financial|context/i.test(safeLabel) ? safeLabel : `${safeLabel} financial context`;
  }

  return safeLabel;
}

function describeSignalAuthority(signalId) {
  const contract = registry.getSignalContract(signalId);
  if (!contract) return 'unknown';
  if (contract.signalType === registry.SIGNAL_TYPES.productionDecision) return 'production_decision';
  if (contract.signalType === registry.SIGNAL_TYPES.financial) return 'financial_context_only';
  if (contract.signalType === registry.SIGNAL_TYPES.evidence) return 'evidence_only_non_authoritative';
  if (contract.signalType === registry.SIGNAL_TYPES.legacy) return 'legacy_context_only';
  return 'context_only_non_authoritative';
}

module.exports = {
  hasBuyLikeWording,
  getAllowedSignalLabel,
  describeSignalAuthority
};
