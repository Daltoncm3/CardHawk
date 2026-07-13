// engines/gradingEngine.js
// CardHawk Deal Grading Engine v1
// Purpose: turn CardHawk's numeric signals into a clear buy/review/pass grade.

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function percent(value) {
  return Math.round(toNumber(value) * 100);
}

function makeContribution(category, id, label, value) {
  return {
    category,
    id,
    label,
    value: toNumber(value, 0)
  };
}

function getSellerTrust(listing = {}) {
  const feedbackPercent = toNumber(listing.sellerFeedbackPercentage);
  const feedbackScore = toNumber(listing.sellerFeedbackScore);

  let score = 0;
  const reasons = [];
  const concerns = [];

  if (feedbackPercent >= 99.5 && feedbackScore >= 500) {
    score += 14;
    reasons.push("elite seller profile");
  } else if (feedbackPercent >= 99 && feedbackScore >= 100) {
    score += 10;
    reasons.push("trusted seller");
  } else if (feedbackPercent >= 98 && feedbackScore >= 50) {
    score += 6;
    reasons.push("acceptable seller history");
  } else if (feedbackScore > 0) {
    score += 2;
    concerns.push("limited seller trust");
  } else {
    concerns.push("unknown seller trust");
  }

  if (feedbackPercent > 0 && feedbackPercent < 97) {
    score -= 8;
    concerns.push("seller feedback below preferred range");
  }

  return { score, reasons, concerns };
}

function getListingQuality(listing = {}) {
  const title = String(listing.title || "");
  const parsed = listing.parsed || {};
  const flags = parsed.flags || {};
  const reasons = [];
  const concerns = [];
  const contributions = [];
  let score = 0;

  const apply = (category, id, label, value, target = reasons) => {
    score += value;
    contributions.push(makeContribution(category, id, label, value));
    if (label) target.push(label);
  };

  if (title.length >= 35 && title.length <= 120) {
    apply("listing_quality", "clear_title_length", "clear title length", 5);
  } else if (title.length < 25) {
    apply("listing_quality", "thin_title", "thin title", -4, concerns);
  }

  if (listing.image) {
    apply("listing_quality", "has_image", "listing has image", 3);
  } else {
    apply("listing_quality", "missing_image", "missing image", -6, concerns);
  }

  if (flags.graded) apply("card_traits", "graded", "graded card trait", 4);
  if (flags.autograph) apply("card_traits", "autograph", "autograph card trait", 4);
  if (flags.rookie) apply("card_traits", "rookie", "rookie card trait", 3);
  if (flags.numbered) apply("card_traits", "numbered", "numbered card trait", 3);
  if (flags.firstBowman) apply("card_traits", "first_bowman", "first Bowman card trait", 4);

  if (flags.lot) {
    apply("listing_risk_penalties", "lot_repack_risk", "lot/repack risk", -14, concerns);
  }
  if (flags.reprint || flags.custom || flags.digital || flags.sealed) {
    apply("listing_risk_penalties", "avoid_flag_detected", "avoid flag detected", -30, concerns);
  }

  return { score, reasons, concerns, contributions };
}

function gradeFromScore(score) {
  if (score >= 95) return "A+";
  if (score >= 88) return "A";
  if (score >= 80) return "B+";
  if (score >= 70) return "B";
  if (score >= 60) return "C+";
  if (score >= 50) return "C";
  if (score >= 40) return "D";
  return "F";
}

function actionFromGrade(grade) {
  if (grade === "A+") return "BUY_NOW";
  if (grade === "A") return "STRONG_REVIEW";
  if (grade === "B+") return "REVIEW";
  if (grade === "B") return "WATCH";
  if (grade === "C+" || grade === "C") return "LOW_PRIORITY";
  return "PASS";
}

function gradeDeal(listing = {}) {
  const profit = toNumber(listing.estimatedProfit);
  const roi = toNumber(listing.roi);
  const score = toNumber(listing.score);
  const confidence = toNumber(listing.marketConfidence);
  const compCount = toNumber(listing.compCount);
  const compSource = String(listing.compSource || "fallback");
  const parsed = listing.parsed || {};
  const qualityTier = parsed.qualityTier || "generic";

  const reasons = [];
  const concerns = [];
  const contributions = [];
  let gradeScore = 0;

  if (profit >= 200) {
    gradeScore += 24;
    contributions.push(makeContribution("profit", "profit_200", "elite profit upside", 24));
    reasons.push("elite profit upside");
  } else if (profit >= 100) {
    gradeScore += 20;
    contributions.push(makeContribution("profit", "profit_100", "strong profit upside", 20));
    reasons.push("strong profit upside");
  } else if (profit >= 75) {
    gradeScore += 16;
    contributions.push(makeContribution("profit", "profit_75", "meets high-profit target", 16));
    reasons.push("meets high-profit target");
  } else if (profit >= 50) {
    gradeScore += 12;
    contributions.push(makeContribution("profit", "profit_50", "solid profit target", 12));
    reasons.push("solid profit target");
  } else if (profit >= 25) {
    gradeScore += 6;
    contributions.push(makeContribution("profit", "profit_25", "modest profit", 6));
    reasons.push("modest profit");
  } else {
    gradeScore -= 8;
    contributions.push(makeContribution("profit", "profit_too_thin", "profit too thin", -8));
    concerns.push("profit too thin");
  }

  if (roi >= 0.8) {
    gradeScore += 18;
    contributions.push(makeContribution("roi", "roi_80", `excellent ROI (${percent(roi)}%)`, 18));
    reasons.push(`excellent ROI (${percent(roi)}%)`);
  } else if (roi >= 0.5) {
    gradeScore += 14;
    contributions.push(makeContribution("roi", "roi_50", `strong ROI (${percent(roi)}%)`, 14));
    reasons.push(`strong ROI (${percent(roi)}%)`);
  } else if (roi >= 0.35) {
    gradeScore += 10;
    contributions.push(makeContribution("roi", "roi_35", `meets ROI target (${percent(roi)}%)`, 10));
    reasons.push(`meets ROI target (${percent(roi)}%)`);
  } else if (roi >= 0.2) {
    gradeScore += 4;
    contributions.push(makeContribution("roi", "roi_20", `acceptable ROI (${percent(roi)}%)`, 4));
    reasons.push(`acceptable ROI (${percent(roi)}%)`);
  } else {
    gradeScore -= 8;
    contributions.push(makeContribution("roi", "roi_below_target", `ROI below target (${percent(roi)}%)`, -8));
    concerns.push(`ROI below target (${percent(roi)}%)`);
  }

  if (confidence >= 90) {
    gradeScore += 20;
    contributions.push(makeContribution("confidence", "confidence_90", "elite market confidence", 20));
    reasons.push("elite market confidence");
  } else if (confidence >= 75) {
    gradeScore += 16;
    contributions.push(makeContribution("confidence", "confidence_75", "strong market confidence", 16));
    reasons.push("strong market confidence");
  } else if (confidence >= 60) {
    gradeScore += 10;
    contributions.push(makeContribution("confidence", "confidence_60", "good market confidence", 10));
    reasons.push("good market confidence");
  } else if (confidence >= 40) {
    gradeScore += 4;
    contributions.push(makeContribution("confidence", "confidence_40", "market confidence still developing", 4));
    concerns.push("market confidence still developing");
  } else {
    gradeScore -= 10;
    contributions.push(makeContribution("confidence", "confidence_low", "low market confidence", -10));
    concerns.push("low market confidence");
  }

  if (score >= 95) {
    gradeScore += 16;
    contributions.push(makeContribution("legacy_context_score", "score_95", "elite CardHawk score", 16));
    reasons.push("elite CardHawk score");
  } else if (score >= 90) {
    gradeScore += 13;
    contributions.push(makeContribution("legacy_context_score", "score_90", "strong CardHawk score", 13));
    reasons.push("strong CardHawk score");
  } else if (score >= 80) {
    gradeScore += 8;
    contributions.push(makeContribution("legacy_context_score", "score_80", "good CardHawk score", 8));
    reasons.push("good CardHawk score");
  } else if (score >= 65) {
    gradeScore += 3;
    contributions.push(makeContribution("legacy_context_score", "score_65", "CardHawk score >= 65", 3));
  } else {
    gradeScore -= 8;
    contributions.push(makeContribution("legacy_context_score", "score_low", "CardHawk score below preferred range", -8));
    concerns.push("CardHawk score below preferred range");
  }

  if (compSource === "active_market") {
    gradeScore += 8;
    contributions.push(makeContribution("comp_source", "active_market", "supported by active-market comps", 8));
    reasons.push("supported by active-market comps");
  } else if (compSource === "heuristic_fallback") {
    gradeScore -= 6;
    contributions.push(makeContribution("comp_source", "heuristic_fallback", "using fallback estimate", -6));
    concerns.push("using fallback estimate");
  } else {
    contributions.push(makeContribution("comp_source", compSource || "unknown", "no comp source adjustment", 0));
  }

  if (compCount >= 8) {
    gradeScore += 8;
    contributions.push(makeContribution("comp_count", "comp_count_8", `${compCount} comparable listings`, 8));
    reasons.push(`${compCount} comparable listings`);
  } else if (compCount >= 4) {
    gradeScore += 5;
    contributions.push(makeContribution("comp_count", "comp_count_4", `${compCount} comps available`, 5));
    reasons.push(`${compCount} comps available`);
  } else if (compCount >= 1) {
    gradeScore += 2;
    contributions.push(makeContribution("comp_count", "comp_count_1", "limited comp count", 2));
    concerns.push("limited comp count");
  } else {
    gradeScore -= 8;
    contributions.push(makeContribution("comp_count", "comp_count_0", "no comps found", -8));
    concerns.push("no comps found");
  }

  if (qualityTier === "premium") {
    gradeScore += 10;
    contributions.push(makeContribution("parsed_card_tier", "premium", "premium card profile", 10));
    reasons.push("premium card profile");
  } else if (qualityTier === "strong") {
    gradeScore += 7;
    contributions.push(makeContribution("parsed_card_tier", "strong", "strong card profile", 7));
    reasons.push("strong card profile");
  } else if (qualityTier === "watch") {
    gradeScore += 3;
    contributions.push(makeContribution("parsed_card_tier", "watch", "watch card profile", 3));
  } else if (qualityTier === "low-confidence") {
    gradeScore -= 12;
    contributions.push(makeContribution("parsed_card_tier", "low_confidence", "low-confidence listing type", -12));
    concerns.push("low-confidence listing type");
  } else if (qualityTier === "avoid") {
    gradeScore -= 50;
    contributions.push(makeContribution("parsed_card_tier", "avoid", "avoid-tier listing", -50));
    concerns.push("avoid-tier listing");
  } else {
    contributions.push(makeContribution("parsed_card_tier", qualityTier || "generic", "no parsed card tier adjustment", 0));
  }

  const seller = getSellerTrust(listing);
  const listingQuality = getListingQuality(listing);

  gradeScore += seller.score;
  gradeScore += listingQuality.score;
  contributions.push(makeContribution("seller_trust", "seller_trust_total", "seller trust adjustment", seller.score));
  contributions.push(...(listingQuality.contributions || []));
  reasons.push(...seller.reasons, ...listingQuality.reasons);
  concerns.push(...seller.concerns, ...listingQuality.concerns);

  if (toNumber(listing.totalCost) > 750 && profit < 150) {
    gradeScore -= 12;
    contributions.push(makeContribution("capital_exposure", "high_capital_limited_upside", "high capital required for limited upside", -12));
    concerns.push("high capital required for limited upside");
  } else {
    contributions.push(makeContribution("capital_exposure", "no_capital_exposure_penalty", "no capital exposure penalty", 0));
  }

  const preClampTotal = gradeScore;
  const finalScore = Math.round(clamp(gradeScore, 0, 100));
  const grade = gradeFromScore(finalScore);
  const action = actionFromGrade(grade);
  const sumCategory = (category) => contributions
    .filter((entry) => entry.category === category)
    .reduce((sum, entry) => sum + entry.value, 0);
  const dealGradeBreakdown = {
    source: "deal_grade_breakdown",
    version: "1.0.0",
    decisionImpact: "none",
    profit: { contribution: sumCategory("profit"), contributions: contributions.filter((entry) => entry.category === "profit") },
    roi: { contribution: sumCategory("roi"), contributions: contributions.filter((entry) => entry.category === "roi") },
    confidence: { contribution: sumCategory("confidence"), contributions: contributions.filter((entry) => entry.category === "confidence") },
    legacyContextScore: { contribution: sumCategory("legacy_context_score"), contributions: contributions.filter((entry) => entry.category === "legacy_context_score") },
    compSource: { source: compSource, contribution: sumCategory("comp_source"), contributions: contributions.filter((entry) => entry.category === "comp_source") },
    compCount: { compCount, contribution: sumCategory("comp_count"), contributions: contributions.filter((entry) => entry.category === "comp_count") },
    parsedCardTier: { tier: qualityTier, contribution: sumCategory("parsed_card_tier"), contributions: contributions.filter((entry) => entry.category === "parsed_card_tier") },
    sellerTrust: { contribution: sumCategory("seller_trust"), contributions: contributions.filter((entry) => entry.category === "seller_trust") },
    listingQuality: { contribution: sumCategory("listing_quality"), contributions: contributions.filter((entry) => entry.category === "listing_quality") },
    cardTraits: { contribution: sumCategory("card_traits"), contributions: contributions.filter((entry) => entry.category === "card_traits") },
    listingRiskPenalties: { contribution: sumCategory("listing_risk_penalties"), contributions: contributions.filter((entry) => entry.category === "listing_risk_penalties") },
    capitalExposure: { contribution: sumCategory("capital_exposure"), contributions: contributions.filter((entry) => entry.category === "capital_exposure") },
    contributions,
    preClampTotal,
    finalGradeScore: finalScore,
    finalLetterGrade: grade,
    rawAction: action
  };

  return {
    grade,
    gradeScore: finalScore,
    action,
    dealGradeBreakdown,
    reasons: reasons.slice(0, 8),
    concerns: concerns.slice(0, 8),
    summary: buildSummary(grade, finalScore, profit, roi, confidence),
    createdAt: new Date().toISOString()
  };
}

function buildSummary(grade, gradeScore, profit, roi, confidence) {
  return `${grade} (${gradeScore}/100) | Profit $${toNumber(profit).toFixed(2)} | ROI ${percent(roi)}% | Confidence ${Math.round(toNumber(confidence))}%`;
}

function shouldPrioritize(dealGrade = {}) {
  return ["A+", "A", "B+"].includes(dealGrade.grade);
}

function shouldNotify(dealGrade = {}) {
  return ["A+", "A"].includes(dealGrade.grade);
}

module.exports = {
  gradeDeal,
  shouldPrioritize,
  shouldNotify,
  gradeFromScore,
  actionFromGrade
};
