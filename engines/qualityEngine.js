// engines/qualityEngine.js
// CardHawk Quality Engine v1
// Scores card desirability, liquidity, and risk separately from profit math.

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(toNumber(value))));
}

function titleOf(listing = {}) {
  return String(listing.title || "");
}

function lowerTitle(listing = {}) {
  return titleOf(listing).toLowerCase();
}

function getParsed(listing = {}) {
  return listing.parsed || { flags: {}, qualityTier: "generic" };
}

function recordContribution(state, contribution = {}) {
  if (!Array.isArray(state.contributions)) return;
  const value = toNumber(contribution.value, 0);
  state.contributions.push({
    category: contribution.category || "uncategorized",
    id: contribution.id || contribution.reason || "quality_adjustment",
    label: contribution.reason || "",
    value
  });
}

function add(points, reason, state, contribution = {}) {
  state.score += points;
  recordContribution(state, { ...contribution, reason, value: points });
  if (reason) state.reasons.push(reason);
}

function warn(points, reason, state, contribution = {}) {
  state.score -= points;
  recordContribution(state, { ...contribution, reason, value: -points });
  if (reason) state.warnings.push(reason);
}

function detectSerialStrength(parsed = {}, title = "") {
  const numberedTo = toNumber(parsed.numberedTo, 0);
  const lower = String(title).toLowerCase();

  if (numberedTo > 0 && numberedTo <= 5) return { points: 18, label: `Ultra-low serial /${numberedTo}` };
  if (numberedTo > 0 && numberedTo <= 10) return { points: 15, label: `Very low serial /${numberedTo}` };
  if (numberedTo > 0 && numberedTo <= 25) return { points: 12, label: `Low serial /${numberedTo}` };
  if (numberedTo > 0 && numberedTo <= 99) return { points: 8, label: `Numbered /${numberedTo}` };
  if (numberedTo > 0) return { points: 4, label: `Serial numbered /${numberedTo}` };

  if (/\b(1\/1|one of one|superfractor|black finite|logoman|shield)\b/i.test(lower)) {
    return { points: 22, label: "Ultra-scarce chase card" };
  }

  return { points: 0, label: null };
}

function detectPremiumTerms(title = "") {
  const lower = String(title).toLowerCase();
  const hits = [];

  const checks = [
    [/\b(gold|gold wave|gold shimmer|gold refractor)\b/i, "Gold parallel"],
    [/\b(black|black refractor|black velocity)\b/i, "Black parallel"],
    [/\b(sapphire|mojo|wave|cracked ice|silver|refractor|x-fractor)\b/i, "Desirable parallel"],
    [/\b(color match|jersey number|jersey numbered)\b/i, "Collector bonus"],
    [/\b(downtown|kaboom|color blast|zebra|tiger|genesis|stained glass)\b/i, "Case-hit style card"],
    [/\b(national treasures|flawless|immaculate|definitive|transcendent)\b/i, "High-end product"],
    [/\b(1st bowman|first bowman)\b/i, "1st Bowman demand"],
    [/\b(on card auto|on-card auto)\b/i, "On-card autograph"],
    [/\b(ssp|super short print|short print|sp)\b/i, "Short print"],
  ];

  for (const [regex, label] of checks) {
    if (regex.test(lower)) hits.push(label);
  }

  return [...new Set(hits)];
}

function detectRiskTerms(title = "") {
  const lower = String(title).toLowerCase();
  const risks = [];

  const checks = [
    [/\b(reprint|rp|facsimile)\b/i, "Reprint/facsimile risk"],
    [/\b(custom|art card|novelty)\b/i, "Custom card risk"],
    [/\b(digital|nft)\b/i, "Digital/NFT item"],
    [/\b(lot|collection|bulk|mystery|repack|break)\b/i, "Lot/repack lowers certainty"],
    [/\b(raw|ungraded)\b/i, "Raw/ungraded risk"],
    [/\b(sticker auto|sticker autograph)\b/i, "Sticker autograph"],
    [/\b(damaged|crease|creased|poor|altered|trimmed|miscut)\b/i, "Condition red flag"],
  ];

  for (const [regex, label] of checks) {
    if (regex.test(lower)) risks.push(label);
  }

  return [...new Set(risks)];
}

function calculateLiquidity(listing = {}) {
  const parsed = getParsed(listing);
  const flags = parsed.flags || {};
  const title = titleOf(listing);
  const lower = title.toLowerCase();
  let score = 40;
  const reasons = [];

  if (flags.graded) { score += 12; reasons.push("Graded cards are easier to compare and resell"); }
  if (parsed.grade === 10) { score += 14; reasons.push("PSA/SGC/BGS 10 demand"); }
  if (flags.rookie) { score += 10; reasons.push("Rookie demand"); }
  if (flags.autograph) { score += 8; reasons.push("Autograph demand"); }
  if (flags.firstBowman) { score += 14; reasons.push("1st Bowman liquidity"); }
  if (flags.refractor) { score += 7; reasons.push("Parallel/refractor demand"); }
  if (flags.numbered) { score += 6; reasons.push("Scarcity helps liquidity"); }
  if (/\b(bowman chrome|topps chrome|prizm|optic|select|national treasures)\b/i.test(lower)) {
    score += 8;
    reasons.push("Recognized product line");
  }

  const compCount = toNumber(listing.compCount || listing.compData?.compCount, 0);
  if (compCount >= 10) { score += 12; reasons.push(`${compCount} comps available`); }
  else if (compCount >= 5) { score += 8; reasons.push(`${compCount} comps available`); }
  else if (compCount >= 2) { score += 4; reasons.push(`${compCount} comps available`); }
  else { score -= 8; reasons.push("Thin comp pool"); }

  if (flags.lot || flags.sealed) score -= 22;
  if (flags.reprint || flags.custom || flags.digital) score -= 45;

  return { score: clamp(score), reasons };
}

function calculateRisk(listing = {}) {
  const parsed = getParsed(listing);
  const flags = parsed.flags || {};
  const title = titleOf(listing);
  let risk = 35;
  const reasons = [];

  if (flags.graded) { risk -= 10; reasons.push("Graded item lowers condition risk"); }
  else { risk += 12; reasons.push("Raw/ungraded item adds condition risk"); }

  if (parsed.grade === 10) { risk -= 8; reasons.push("Top grade improves resale clarity"); }
  if (flags.reprint) { risk += 35; reasons.push("Reprint risk"); }
  if (flags.custom) { risk += 30; reasons.push("Custom card risk"); }
  if (flags.digital) { risk += 35; reasons.push("Digital/NFT risk"); }
  if (flags.lot) { risk += 18; reasons.push("Lot/repack certainty risk"); }
  if (flags.sealed) { risk += 22; reasons.push("Wax/sealed product risk"); }

  for (const item of detectRiskTerms(title)) {
    risk += 6;
    reasons.push(item);
  }

  const confidence = toNumber(listing.marketConfidence || listing.confidence || listing.confidenceData?.confidence, 0);
  if (confidence >= 80) { risk -= 12; reasons.push("High market confidence"); }
  else if (confidence >= 60) { risk -= 6; reasons.push("Solid market confidence"); }
  else if (confidence < 40) { risk += 12; reasons.push("Low market confidence"); }

  const price = toNumber(listing.totalCost || listing.price, 0);
  const profit = toNumber(listing.estimatedProfit, 0);
  if (price >= 750 && profit < 200) { risk += 12; reasons.push("High capital required for limited profit cushion"); }
  if (price >= 1500) { risk += 10; reasons.push("Large bankroll exposure"); }

  const clampedRisk = clamp(risk);
  let level = "moderate";
  if (clampedRisk <= 25) level = "low";
  else if (clampedRisk >= 65) level = "high";

  return { score: clampedRisk, level, reasons };
}

function evaluateQuality(listing = {}) {
  const parsed = getParsed(listing);
  const flags = parsed.flags || {};
  const title = titleOf(listing);
  const baseScore = 45;
  const state = { score: baseScore, reasons: [], warnings: [], traits: [], contributions: [] };

  const confidence = toNumber(listing.marketConfidence || listing.confidence || listing.confidenceData?.confidence, 0);
  const profit = toNumber(listing.estimatedProfit, 0);
  const roi = toNumber(listing.roi, 0);
  const compCount = toNumber(listing.compCount || listing.compData?.compCount, 0);
  const sellerPct = toNumber(listing.sellerFeedbackPercentage, 0);
  const sellerScore = toNumber(listing.sellerFeedbackScore, 0);

  if (parsed.qualityTier === "premium") add(14, "Premium card profile", state, { category: "parsed_tier", id: "premium" });
  if (parsed.qualityTier === "strong") add(9, "Strong collector profile", state, { category: "parsed_tier", id: "strong" });
  if (parsed.qualityTier === "watch") add(4, "Watchable card profile", state, { category: "parsed_tier", id: "watch" });
  if (parsed.qualityTier === "low-confidence") warn(18, "Low-confidence category", state, { category: "parsed_tier", id: "low_confidence" });
  if (parsed.qualityTier === "avoid") warn(50, "Avoid category", state, { category: "parsed_tier", id: "avoid" });

  if (flags.graded) add(7, "Graded card", state, { category: "grade_profile", id: "graded" }); else warn(5, "Raw/ungraded card", state, { category: "grade_profile", id: "raw_ungraded" });
  if (parsed.grade === 10) add(12, "Gem Mint 10", state, { category: "grade_profile", id: "grade_10" });
  else if (parsed.grade === 9.5) add(8, "Gem Mint 9.5", state, { category: "grade_profile", id: "grade_9_5" });
  else if (parsed.grade && parsed.grade < 9) warn(8, `Lower grade ${parsed.grade}`, state, { category: "grade_profile", id: "lower_grade" });

  if (flags.rookie) add(8, "Rookie/RC demand", state, { category: "card_traits", id: "rookie" });
  if (flags.autograph) add(8, "Autograph demand", state, { category: "card_traits", id: "autograph" });
  if (flags.firstBowman) add(12, "1st Bowman upside", state, { category: "card_traits", id: "first_bowman" });
  if (flags.refractor) add(6, "Refractor/parallel demand", state, { category: "card_traits", id: "refractor_parallel" });
  if (flags.pokemon && parsed.grade === 10) add(8, "PSA 10 Pokémon demand", state, { category: "card_traits", id: "pokemon_grade_10" });

  const serial = detectSerialStrength(parsed, title);
  if (serial.points) add(serial.points, serial.label, state, { category: "card_traits", id: "serial_strength" });

  for (const trait of detectPremiumTerms(title)) {
    state.traits.push(trait);
    add(4, trait, state, { category: "card_traits", id: `premium_term_${trait.toLowerCase().replace(/[^a-z0-9]+/g, "_")}` });
  }

  for (const risk of detectRiskTerms(title)) {
    warn(8, risk, state, { category: "risk_title_penalties", id: `risk_term_${risk.toLowerCase().replace(/[^a-z0-9]+/g, "_")}` });
  }

  if (profit >= 300) add(13, "Large profit spread", state, { category: "profit", id: "profit_300" });
  else if (profit >= 150) add(10, "Strong profit spread", state, { category: "profit", id: "profit_150" });
  else if (profit >= 75) add(7, "Profitable enough for alerts", state, { category: "profit", id: "profit_75" });
  else if (profit > 0) add(3, "Positive expected profit", state, { category: "profit", id: "profit_positive" });
  else warn(20, "No expected profit", state, { category: "profit", id: "profit_none" });

  if (roi >= 1) add(12, "Excellent ROI", state, { category: "roi", id: "roi_100" });
  else if (roi >= 0.6) add(9, "Strong ROI", state, { category: "roi", id: "roi_60" });
  else if (roi >= 0.35) add(6, "Good ROI", state, { category: "roi", id: "roi_35" });
  else if (roi > 0) add(2, "Thin ROI", state, { category: "roi", id: "roi_positive" });
  else warn(15, "Negative ROI", state, { category: "roi", id: "roi_negative" });

  if (confidence >= 85) add(12, "High market confidence", state, { category: "confidence", id: "confidence_85" });
  else if (confidence >= 70) add(9, "Alert-level confidence", state, { category: "confidence", id: "confidence_70" });
  else if (confidence >= 50) add(4, "Moderate confidence", state, { category: "confidence", id: "confidence_50" });
  else warn(12, "Low market confidence", state, { category: "confidence", id: "confidence_low" });

  if (compCount >= 10) add(8, "Deep comp pool", state, { category: "comp_count", id: "comp_count_10" });
  else if (compCount >= 5) add(6, "Healthy comp pool", state, { category: "comp_count", id: "comp_count_5" });
  else if (compCount >= 2) add(3, "Some comp support", state, { category: "comp_count", id: "comp_count_2" });
  else warn(10, "No/weak comp support", state, { category: "comp_count", id: "comp_count_weak" });

  if (sellerPct >= 99 && sellerScore >= 100) add(6, "Trusted seller profile", state, { category: "seller", id: "trusted_seller" });
  else if (sellerPct >= 98) add(3, "Acceptable seller profile", state, { category: "seller", id: "acceptable_seller" });
  else if (sellerPct > 0 && sellerPct < 97) warn(8, "Seller feedback risk", state, { category: "seller", id: "seller_feedback_risk" });

  const liquidity = calculateLiquidity(listing);
  const risk = calculateRisk(listing);

  const liquidityAdjustment = Math.round((liquidity.score - 50) * 0.25);
  const riskAdjustment = -Math.round((risk.score - 35) * 0.25);
  state.score += liquidityAdjustment;
  recordContribution(state, {
    category: "liquidity_adjustment",
    id: "liquidity_score_adjustment",
    reason: "Liquidity score adjustment",
    value: liquidityAdjustment
  });
  state.score += riskAdjustment;
  recordContribution(state, {
    category: "risk_adjustment",
    id: "risk_score_adjustment",
    reason: "Risk score adjustment",
    value: riskAdjustment
  });

  const preClampTotal = state.score;
  const investmentQuality = clamp(state.score);
  let bucket = "Speculative";
  if (investmentQuality >= 90) bucket = "Elite";
  else if (investmentQuality >= 80) bucket = "Strong Buy Candidate";
  else if (investmentQuality >= 70) bucket = "Good Flip Candidate";
  else if (investmentQuality >= 55) bucket = "Review Carefully";
  else if (investmentQuality >= 40) bucket = "Low Priority";
  else bucket = "Avoid";

  const positives = [...new Set(state.reasons)].slice(0, 12);
  const warnings = [...new Set(state.warnings)].slice(0, 12);
  const traits = [...new Set(state.traits)].slice(0, 12);
  const sumCategory = (category) => state.contributions
    .filter((entry) => entry.category === category)
    .reduce((sum, entry) => sum + entry.value, 0);
  const qualityBreakdown = {
    source: "quality_breakdown",
    version: "1.0.0",
    decisionImpact: "none",
    baseScore,
    parsedTier: {
      tier: parsed.qualityTier || "generic",
      contribution: sumCategory("parsed_tier"),
      contributions: state.contributions.filter((entry) => entry.category === "parsed_tier")
    },
    gradeProfile: {
      grade: parsed.grade || null,
      graded: Boolean(flags.graded),
      contribution: sumCategory("grade_profile"),
      contributions: state.contributions.filter((entry) => entry.category === "grade_profile")
    },
    cardTraits: {
      contribution: sumCategory("card_traits"),
      contributions: state.contributions.filter((entry) => entry.category === "card_traits")
    },
    riskTitlePenalties: {
      contribution: sumCategory("risk_title_penalties"),
      contributions: state.contributions.filter((entry) => entry.category === "risk_title_penalties")
    },
    profit: {
      estimatedProfit: profit,
      contribution: sumCategory("profit"),
      contributions: state.contributions.filter((entry) => entry.category === "profit")
    },
    roi: {
      roi,
      roiPercent: Math.round(roi * 1000) / 10,
      contribution: sumCategory("roi"),
      contributions: state.contributions.filter((entry) => entry.category === "roi")
    },
    confidence: {
      confidence,
      contribution: sumCategory("confidence"),
      contributions: state.contributions.filter((entry) => entry.category === "confidence")
    },
    compCount: {
      compCount,
      contribution: sumCategory("comp_count"),
      contributions: state.contributions.filter((entry) => entry.category === "comp_count")
    },
    seller: {
      sellerFeedbackPercentage: sellerPct,
      sellerFeedbackScore: sellerScore,
      contribution: sumCategory("seller"),
      contributions: state.contributions.filter((entry) => entry.category === "seller")
    },
    liquidityAdjustment: {
      liquidityScore: liquidity.score,
      contribution: sumCategory("liquidity_adjustment"),
      contributions: state.contributions.filter((entry) => entry.category === "liquidity_adjustment")
    },
    riskAdjustment: {
      riskScore: risk.score,
      riskLevel: risk.level,
      contribution: sumCategory("risk_adjustment"),
      contributions: state.contributions.filter((entry) => entry.category === "risk_adjustment")
    },
    contributions: state.contributions.slice(),
    preClampTotal,
    finalQualityScore: investmentQuality,
    rawBucket: bucket
  };

  return {
    investmentQuality,
    bucket,
    qualityBreakdown,
    liquidityScore: liquidity.score,
    liquidityReasons: liquidity.reasons.slice(0, 8),
    riskScore: risk.score,
    riskLevel: risk.level,
    riskReasons: risk.reasons.slice(0, 8),
    positives,
    warnings,
    traits,
    summary: `${bucket} — quality ${investmentQuality}/100, liquidity ${liquidity.score}/100, risk ${risk.level}`
  };
}

function summarizeQuality(qualityData = {}) {
  return {
    investmentQuality: toNumber(qualityData.investmentQuality, 0),
    bucket: qualityData.bucket || "Unknown",
    liquidityScore: toNumber(qualityData.liquidityScore, 0),
    riskLevel: qualityData.riskLevel || "unknown",
    summary: qualityData.summary || ""
  };
}

module.exports = {
  evaluateQuality,
  summarizeQuality,
  detectPremiumTerms,
  detectRiskTerms,
  calculateLiquidity,
  calculateRisk
};
