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
  let score = 0;

  if (title.length >= 35 && title.length <= 120) {
    score += 5;
    reasons.push("clear title length");
  } else if (title.length < 25) {
    score -= 4;
    concerns.push("thin title");
  }

  if (listing.image) {
    score += 3;
    reasons.push("listing has image");
  } else {
    score -= 6;
    concerns.push("missing image");
  }

  if (flags.graded) score += 4;
  if (flags.autograph) score += 4;
  if (flags.rookie) score += 3;
  if (flags.numbered) score += 3;
  if (flags.firstBowman) score += 4;

  if (flags.lot) {
    score -= 14;
    concerns.push("lot/repack risk");
  }
  if (flags.reprint || flags.custom || flags.digital || flags.sealed) {
    score -= 30;
    concerns.push("avoid flag detected");
  }

  return { score, reasons, concerns };
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
  let gradeScore = 0;

  if (profit >= 200) {
    gradeScore += 24;
    reasons.push("elite profit upside");
  } else if (profit >= 100) {
    gradeScore += 20;
    reasons.push("strong profit upside");
  } else if (profit >= 75) {
    gradeScore += 16;
    reasons.push("meets high-profit target");
  } else if (profit >= 50) {
    gradeScore += 12;
    reasons.push("solid profit target");
  } else if (profit >= 25) {
    gradeScore += 6;
    reasons.push("modest profit");
  } else {
    gradeScore -= 8;
    concerns.push("profit too thin");
  }

  if (roi >= 0.8) {
    gradeScore += 18;
    reasons.push(`excellent ROI (${percent(roi)}%)`);
  } else if (roi >= 0.5) {
    gradeScore += 14;
    reasons.push(`strong ROI (${percent(roi)}%)`);
  } else if (roi >= 0.35) {
    gradeScore += 10;
    reasons.push(`meets ROI target (${percent(roi)}%)`);
  } else if (roi >= 0.2) {
    gradeScore += 4;
    reasons.push(`acceptable ROI (${percent(roi)}%)`);
  } else {
    gradeScore -= 8;
    concerns.push(`ROI below target (${percent(roi)}%)`);
  }

  if (confidence >= 90) {
    gradeScore += 20;
    reasons.push("elite market confidence");
  } else if (confidence >= 75) {
    gradeScore += 16;
    reasons.push("strong market confidence");
  } else if (confidence >= 60) {
    gradeScore += 10;
    reasons.push("good market confidence");
  } else if (confidence >= 40) {
    gradeScore += 4;
    concerns.push("market confidence still developing");
  } else {
    gradeScore -= 10;
    concerns.push("low market confidence");
  }

  if (score >= 95) {
    gradeScore += 16;
    reasons.push("elite CardHawk score");
  } else if (score >= 90) {
    gradeScore += 13;
    reasons.push("strong CardHawk score");
  } else if (score >= 80) {
    gradeScore += 8;
    reasons.push("good CardHawk score");
  } else if (score >= 65) {
    gradeScore += 3;
  } else {
    gradeScore -= 8;
    concerns.push("CardHawk score below preferred range");
  }

  if (compSource === "active_market") {
    gradeScore += 8;
    reasons.push("supported by active-market comps");
  } else if (compSource === "heuristic_fallback") {
    gradeScore -= 6;
    concerns.push("using fallback estimate");
  }

  if (compCount >= 8) {
    gradeScore += 8;
    reasons.push(`${compCount} comparable listings`);
  } else if (compCount >= 4) {
    gradeScore += 5;
    reasons.push(`${compCount} comps available`);
  } else if (compCount >= 1) {
    gradeScore += 2;
    concerns.push("limited comp count");
  } else {
    gradeScore -= 8;
    concerns.push("no comps found");
  }

  if (qualityTier === "premium") {
    gradeScore += 10;
    reasons.push("premium card profile");
  } else if (qualityTier === "strong") {
    gradeScore += 7;
    reasons.push("strong card profile");
  } else if (qualityTier === "watch") {
    gradeScore += 3;
  } else if (qualityTier === "low-confidence") {
    gradeScore -= 12;
    concerns.push("low-confidence listing type");
  } else if (qualityTier === "avoid") {
    gradeScore -= 50;
    concerns.push("avoid-tier listing");
  }

  const seller = getSellerTrust(listing);
  const listingQuality = getListingQuality(listing);

  gradeScore += seller.score;
  gradeScore += listingQuality.score;
  reasons.push(...seller.reasons, ...listingQuality.reasons);
  concerns.push(...seller.concerns, ...listingQuality.concerns);

  if (toNumber(listing.totalCost) > 750 && profit < 150) {
    gradeScore -= 12;
    concerns.push("high capital required for limited upside");
  }

  const finalScore = Math.round(clamp(gradeScore, 0, 100));
  const grade = gradeFromScore(finalScore);

  return {
    grade,
    gradeScore: finalScore,
    action: actionFromGrade(grade),
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
