// engines/decisionEngine.js
// CardHawk Decision Engine v1
// Purpose: convert all engine outputs into one clear buy/watch/pass decision.
// This engine is conservative by design. It should protect money first and chase upside second.

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getRiskLevel(riskData = {}) {
  return normalizeText(riskData.riskLevel || "unknown");
}

function getRecommendation(value = "") {
  return normalizeText(value || "");
}

function addReason(reasons, message, type = "info") {
  reasons.push({ type, message });
}

function hasCriticalRisk(riskData = {}) {
  const recommendation = getRecommendation(riskData.recommendation);
  const riskLevel = getRiskLevel(riskData);

  return (
    riskLevel === "critical" ||
    recommendation === "do_not_buy" ||
    toNumber(riskData.criticalCount, 0) > 0 ||
    (Array.isArray(riskData.blockers) && riskData.blockers.length > 0)
  );
}

function calculateDecisionScore(input = {}) {
  const score = toNumber(input.score, 0);
  const roiData = input.roiData || {};
  const riskData = input.riskData || {};
  const marketData = input.marketData || {};
  const confidenceData = input.confidenceData || {};
  const qualityData = input.qualityData || {};
  const soldSales = input.soldSales || {};
  const trendData = input.trendData || {};

  let decisionScore = 0;

  decisionScore += clamp(score, 0, 100) * 0.25;

  const roiPercent = toNumber(roiData.roiPercent, toNumber(roiData.roi, 0) * 100);
  if (roiPercent >= 60) decisionScore += 18;
  else if (roiPercent >= 40) decisionScore += 14;
  else if (roiPercent >= 25) decisionScore += 10;
  else if (roiPercent >= 15) decisionScore += 5;
  else if (roiPercent <= 0) decisionScore -= 20;

  const netProfit = toNumber(roiData.netProfit, 0);
  if (netProfit >= 100) decisionScore += 14;
  else if (netProfit >= 50) decisionScore += 10;
  else if (netProfit >= 20) decisionScore += 6;
  else if (netProfit <= 0) decisionScore -= 20;

  const riskAdjustedProfit = toNumber(roiData.riskAdjustedProfit, 0);
  if (riskAdjustedProfit >= 50) decisionScore += 8;
  else if (riskAdjustedProfit >= 20) decisionScore += 5;
  else if (riskAdjustedProfit <= 0) decisionScore -= 12;

  const marginOfSafety = toNumber(roiData.marginOfSafetyPercent, 0);
  if (marginOfSafety >= 30) decisionScore += 10;
  else if (marginOfSafety >= 20) decisionScore += 7;
  else if (marginOfSafety >= 10) decisionScore += 4;
  else if (marginOfSafety < 5) decisionScore -= 8;

  const confidence = Math.max(
    toNumber(marketData.confidence, 0),
    toNumber(confidenceData.confidence, 0)
  );

  if (confidence >= 85) decisionScore += 14;
  else if (confidence >= 70) decisionScore += 10;
  else if (confidence >= 55) decisionScore += 6;
  else if (confidence < 35) decisionScore -= 12;

  const soldCount = toNumber(marketData.soldCompCount ?? soldSales.saleCount, 0);
  const recentSales = toNumber(soldSales.recentSaleCount, 0);

  if (soldCount >= 8) decisionScore += 10;
  else if (soldCount >= 5) decisionScore += 7;
  else if (soldCount >= 3) decisionScore += 4;
  else if (soldCount === 0) decisionScore -= 10;

  if (recentSales >= 3) decisionScore += 5;
  else if (recentSales === 0) decisionScore -= 4;

  const marketSource = normalizeText(marketData.source);
  if (marketSource === "sold_market") decisionScore += 10;
  else if (marketSource === "blended_market") decisionScore += 6;
  else if (marketSource === "active_market") decisionScore += 2;
  else if (marketSource === "fallback") decisionScore -= 12;

  const riskScore = toNumber(riskData.totalRiskScore, 0);
  const riskLevel = getRiskLevel(riskData);

  if (riskLevel === "minimal") decisionScore += 8;
  else if (riskLevel === "low") decisionScore += 5;
  else if (riskLevel === "medium") decisionScore -= 5;
  else if (riskLevel === "high") decisionScore -= 18;
  else if (riskLevel === "critical") decisionScore -= 100;

  decisionScore -= clamp(riskScore / 3, 0, 30);

  const qualityBucket = normalizeText(qualityData.bucket || qualityData.investmentQuality);
  if (qualityBucket.includes("elite") || qualityBucket.includes("premium")) decisionScore += 8;
  else if (qualityBucket.includes("strong")) decisionScore += 5;
  else if (qualityBucket.includes("weak") || qualityBucket.includes("avoid")) decisionScore -= 10;

  const trendDirection = normalizeText(trendData.direction || trendData.trend || soldSales.trend?.direction);
  if (trendDirection.includes("up") || trendDirection.includes("rising") || trendDirection.includes("hot")) {
    decisionScore += 5;
  } else if (trendDirection.includes("down") || trendDirection.includes("falling") || trendDirection.includes("cold")) {
    decisionScore -= 7;
  }

  return clamp(Math.round(decisionScore), 0, 100);
}

function classifyDecision(decisionScore, input = {}) {
  const roiData = input.roiData || {};
  const riskData = input.riskData || {};
  const marketData = input.marketData || {};

  if (hasCriticalRisk(riskData)) return "AVOID";

  const riskLevel = getRiskLevel(riskData);
  const roiRecommendation = getRecommendation(roiData.recommendation);
  const riskRecommendation = getRecommendation(riskData.recommendation);
  const confidence = toNumber(marketData.confidence, 0);
  const netProfit = toNumber(roiData.netProfit, 0);
  const riskAdjustedProfit = toNumber(roiData.riskAdjustedProfit, 0);

  if (riskRecommendation === "manual_review_required") return "MANUAL REVIEW";

  if (netProfit <= 0 || riskAdjustedProfit <= 0) return "PASS";

  if (decisionScore >= 85 && confidence >= 70 && riskLevel !== "high") return "STRONG BUY";
  if (decisionScore >= 70 && confidence >= 55 && !["high", "critical"].includes(riskLevel)) return "BUY";
  if (decisionScore >= 50 || roiRecommendation === "watch") return "WATCH";
  if (decisionScore >= 35) return "PASS";

  return "AVOID";
}

function urgencyFromDecision(decision, input = {}) {
  const roiData = input.roiData || {};
  const soldSales = input.soldSales || {};
  const trendData = input.trendData || {};

  if (decision === "AVOID" || decision === "PASS") return "none";
  if (decision === "MANUAL REVIEW") return "medium";

  const roiPercent = toNumber(roiData.roiPercent, 0);
  const recentSales = toNumber(soldSales.recentSaleCount, 0);
  const trendDirection = normalizeText(trendData.direction || soldSales.trend?.direction);

  if (decision === "STRONG BUY" && roiPercent >= 40 && recentSales >= 3) return "high";
  if (decision === "BUY" && (roiPercent >= 30 || trendDirection.includes("up"))) return "medium";
  return "low";
}

function buildDecisionReasons(decision, decisionScore, input = {}) {
  const reasons = [];

  const roiData = input.roiData || {};
  const riskData = input.riskData || {};
  const marketData = input.marketData || {};
  const soldSales = input.soldSales || {};

  addReason(reasons, `Decision score is ${decisionScore}/100.`, "score");

  const netProfit = toNumber(roiData.netProfit, 0);
  const roiPercent = toNumber(roiData.roiPercent, 0);
  const riskAdjustedProfit = toNumber(roiData.riskAdjustedProfit, 0);

  if (netProfit > 0) addReason(reasons, `Expected net profit is $${netProfit.toFixed(2)}.`, "positive");
  else addReason(reasons, "Expected net profit is not positive.", "negative");

  if (roiPercent > 0) addReason(reasons, `Expected ROI is ${roiPercent}%.`, "positive");

  if (riskAdjustedProfit > 0) {
    addReason(reasons, `Risk-adjusted profit remains positive at $${riskAdjustedProfit.toFixed(2)}.`, "positive");
  } else {
    addReason(reasons, "Risk-adjusted profit is not positive.", "negative");
  }

  const riskLevel = riskData.riskLevel || "unknown";
  addReason(reasons, `Risk level is ${riskLevel}.`, riskLevel === "high" || riskLevel === "critical" ? "negative" : "risk");

  const confidence = toNumber(marketData.confidence, 0);
  if (confidence >= 70) addReason(reasons, `Market confidence is strong at ${confidence}%.`, "positive");
  else if (confidence >= 50) addReason(reasons, `Market confidence is moderate at ${confidence}%.`, "neutral");
  else addReason(reasons, `Market confidence is low at ${confidence}%.`, "negative");

  const soldCount = toNumber(marketData.soldCompCount ?? soldSales.saleCount, 0);
  if (soldCount >= 3) addReason(reasons, `${soldCount} sold comps support the valuation.`, "positive");
  else if (soldCount > 0) addReason(reasons, `Only ${soldCount} sold comp supports the valuation.`, "neutral");
  else addReason(reasons, "No reliable sold comps support the valuation yet.", "negative");

  if (decision === "STRONG BUY") addReason(reasons, "All major engines support an aggressive buy recommendation.", "decision");
  if (decision === "BUY") addReason(reasons, "Engines support buying, but not aggressively enough for STRONG BUY.", "decision");
  if (decision === "WATCH") addReason(reasons, "Opportunity is interesting but needs better price, confidence, or risk profile.", "decision");
  if (decision === "PASS") addReason(reasons, "Expected return is not strong enough after risk and costs.", "decision");
  if (decision === "AVOID") addReason(reasons, "Critical risk or poor economics make this a bad buying candidate.", "decision");
  if (decision === "MANUAL REVIEW") addReason(reasons, "Risk profile requires human review before any purchase.", "decision");

  return reasons;
}

function makeDecision(input = {}) {
  const decisionScore = calculateDecisionScore(input);
  const decision = classifyDecision(decisionScore, input);
  const urgency = urgencyFromDecision(decision, input);
  const reasons = buildDecisionReasons(decision, decisionScore, input);

  return {
    source: "decision_engine",
    decision,
    recommendation: decision,
    decisionScore,
    urgency,
    shouldBuy: decision === "BUY" || decision === "STRONG BUY",
    shouldNotify: decision === "BUY" || decision === "STRONG BUY" || decision === "MANUAL REVIEW",
    requiresReview: decision === "MANUAL REVIEW" || decision === "WATCH",
    reasons,
    summary: `${decision} — ${decisionScore}/100 confidence-adjusted decision score.`
  };
}

function summarizeDecision(decisionData = {}) {
  return {
    source: decisionData.source || "decision_engine",
    decision: decisionData.decision || decisionData.recommendation || "UNKNOWN",
    decisionScore: toNumber(decisionData.decisionScore, 0),
    urgency: decisionData.urgency || "none",
    shouldBuy: Boolean(decisionData.shouldBuy),
    shouldNotify: Boolean(decisionData.shouldNotify),
    requiresReview: Boolean(decisionData.requiresReview),
    summary: decisionData.summary || "",
    reasons: decisionData.reasons || []
  };
}

module.exports = {
  makeDecision,
  summarizeDecision,
  calculateDecisionScore,
  classifyDecision
};
