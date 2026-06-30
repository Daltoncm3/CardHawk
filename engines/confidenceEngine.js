// engines/confidenceEngine.js
// CardHawk Confidence Engine v2
// Turns raw comp data into a smarter trust score for alerts.

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function average(values = []) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function hasStrongCardTraits(parsed = {}) {
  const flags = parsed.flags || {};
  return Boolean(
    flags.graded ||
    flags.autograph ||
    flags.rookie ||
    flags.numbered ||
    flags.firstBowman ||
    flags.refractor ||
    flags.pokemon
  );
}

function hasAvoidTraits(parsed = {}) {
  const flags = parsed.flags || {};
  return Boolean(flags.lot || flags.sealed || flags.reprint || flags.digital || flags.custom);
}

function exactTraitMatchBonus(fingerprint = {}) {
  let bonus = 0;

  if (fingerprint.year) bonus += 5;
  if (fingerprint.setName) bonus += 7;
  if (fingerprint.gradeCompany && fingerprint.grade) bonus += 8;
  if (fingerprint.autograph) bonus += 5;
  if (fingerprint.rookie) bonus += 4;
  if (fingerprint.numbered || fingerprint.numberedTo) bonus += 5;
  if (fingerprint.firstBowman) bonus += 5;
  if (fingerprint.refractor) bonus += 4;
  if (fingerprint.pokemon) bonus += 5;

  return bonus;
}

function sellerConfidence(listing = {}) {
  const feedbackPct = toNumber(listing.sellerFeedbackPercentage, 0);
  const feedbackScore = toNumber(listing.sellerFeedbackScore, 0);

  let score = 0;
  if (feedbackPct >= 99.5) score += 8;
  else if (feedbackPct >= 99) score += 6;
  else if (feedbackPct >= 98) score += 3;
  else if (feedbackPct > 0 && feedbackPct < 96) score -= 8;

  if (feedbackScore >= 1000) score += 6;
  else if (feedbackScore >= 250) score += 4;
  else if (feedbackScore >= 100) score += 2;
  else if (feedbackScore > 0 && feedbackScore < 20) score -= 5;

  return score;
}

function historyConfidence(listing = {}) {
  let score = 0;
  const seenCount = toNumber(listing.seenCount, 0);

  if (seenCount >= 2) score += 3;
  if (seenCount >= 4) score += 4;
  if (seenCount >= 8) score += 4;

  if (Array.isArray(listing.priceHistory) && listing.priceHistory.length >= 2) score += 4;
  if (listing.priceDropAmount > 0 || listing.amountDropped > 0) score += 8;

  return score;
}

function compQualityConfidence(compData = {}) {
  const comps = Array.isArray(compData.comps) ? compData.comps : [];
  const compCount = toNumber(compData.compCount, comps.length);
  const source = compData.source || "none";
  const avgSimilarity = average(comps.map(comp => comp.similarity));

  let score = toNumber(compData.confidence, 0);

  if (source === "active_market") {
    if (compCount >= 3) score += 8;
    if (compCount >= 5) score += 8;
    if (compCount >= 8) score += 6;
    if (avgSimilarity >= 70) score += 7;
    if (avgSimilarity >= 82) score += 8;
    if (avgSimilarity >= 90) score += 5;
  }

  if (source === "heuristic_fallback") score = Math.min(score, 28);
  if (source === "none") score = Math.min(score, 12);

  return { score, avgSimilarity, compCount, source };
}

function priceSanityConfidence(listing = {}, compData = {}) {
  const marketValue = toNumber(compData.marketValue, listing.estimatedValue || 0);
  const totalCost = toNumber(listing.totalCost || listing.price, 0);
  if (!marketValue || !totalCost) return 0;

  const ratio = totalCost / marketValue;
  let score = 0;

  if (ratio >= 0.35 && ratio <= 0.85) score += 10;
  else if (ratio > 0.85 && ratio <= 1.05) score += 2;
  else if (ratio < 0.2) score -= 8; // probably bad comp match or suspicious listing
  else if (ratio > 1.25) score -= 8;

  return score;
}

function evaluateConfidence(listing = {}, compData = {}, universe = []) {
  const parsed = listing.parsed || {};
  const fingerprint = compData.fingerprint || {};
  const compQuality = compQualityConfidence(compData);
  const reasons = [];

  let confidence = compQuality.score;

  if (compQuality.source === "active_market") reasons.push(`active comps: ${compQuality.compCount}`);
  if (compQuality.avgSimilarity) reasons.push(`avg similarity: ${Math.round(compQuality.avgSimilarity)}`);

  const traitBonus = exactTraitMatchBonus(fingerprint);
  confidence += traitBonus;
  if (traitBonus) reasons.push(`card trait match bonus: +${traitBonus}`);

  const sellerBonus = sellerConfidence(listing);
  confidence += sellerBonus;
  if (sellerBonus) reasons.push(`seller trust: ${sellerBonus > 0 ? "+" : ""}${sellerBonus}`);

  const historyBonus = historyConfidence(listing);
  confidence += historyBonus;
  if (historyBonus) reasons.push(`history signal: +${historyBonus}`);

  const priceBonus = priceSanityConfidence(listing, compData);
  confidence += priceBonus;
  if (priceBonus) reasons.push(`price sanity: ${priceBonus > 0 ? "+" : ""}${priceBonus}`);

  if (hasStrongCardTraits(parsed)) {
    confidence += 8;
    reasons.push("strong card traits: +8");
  }

  if (parsed.qualityTier === "premium") {
    confidence += 8;
    reasons.push("premium tier: +8");
  } else if (parsed.qualityTier === "strong") {
    confidence += 5;
    reasons.push("strong tier: +5");
  }

  if (hasAvoidTraits(parsed)) {
    confidence -= 55;
    reasons.push("avoid traits penalty: -55");
  }

  // Until true sold comps are connected, cap confidence from active listings.
  // This cap is higher than v1 because the engine now includes exact traits, seller trust, and history.
  let cap = 86;
  if (compQuality.source === "heuristic_fallback") cap = 38;
  if (compQuality.source === "none") cap = 18;
  if (hasAvoidTraits(parsed)) cap = 15;

  const finalConfidence = Math.round(clamp(confidence, 0, cap));

  return {
    confidence: finalConfidence,
    source: compQuality.source,
    cap,
    avgSimilarity: Math.round(compQuality.avgSimilarity || 0),
    compCount: compQuality.compCount,
    reasons
  };
}

module.exports = {
  evaluateConfidence
};
