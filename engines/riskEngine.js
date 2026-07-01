// engines/riskEngine.js
// CardHawk Risk Engine v1
// Purpose: evaluate purchase risk before CardHawk recommends spending real money.
// This engine is conservative by design and focuses on avoiding bad buys.

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

function getParsed(listing = {}) {
  return listing.parsed || {};
}

function getFlags(listing = {}) {
  return getParsed(listing).flags || {};
}

function getListingCost(listing = {}) {
  const totalCost = toNumber(listing.totalCost, NaN);
  if (Number.isFinite(totalCost) && totalCost > 0) return totalCost;
  return toNumber(listing.price, 0) + toNumber(listing.shipping, 0);
}

function addRisk(risks, points, code, message, severity = "medium") {
  risks.push({
    points: clamp(Math.round(points), 0, 100),
    code,
    message,
    severity
  });
}

function titleRisk(listing = {}, risks = []) {
  const title = normalizeText(listing.title);
  const flags = getFlags(listing);

  if (flags.reprint || /\b(reprint|facsimile|rp|proxy)\b/i.test(title)) {
    addRisk(risks, 100, "reprint_risk", "Listing appears to be a reprint/proxy/facsimile.", "critical");
  }

  if (flags.digital || /\b(digital|nft|online only)\b/i.test(title)) {
    addRisk(risks, 100, "digital_risk", "Listing appears to be digital or non-physical.", "critical");
  }

  if (flags.custom || /\b(custom|art card|homemade)\b/i.test(title)) {
    addRisk(risks, 90, "custom_risk", "Listing appears to be custom/non-standard.", "critical");
  }

  if (flags.lot || /\b(lot|collection|bulk|mystery|repack|break)\b/i.test(title)) {
    addRisk(risks, 55, "lot_risk", "Listing appears to be a lot/repack/break rather than a clean single-card comp.", "high");
  }

  if (flags.sealed || /\b(hobby box|blaster|mega box|sealed|unopened|pack)\b/i.test(title)) {
    addRisk(risks, 70, "sealed_wax_risk", "Listing appears to be sealed wax rather than an individual card.", "high");
  }

  if (/\b(read description|see description|not mint|damaged|creased|poor condition)\b/i.test(title)) {
    addRisk(risks, 45, "condition_disclaimer", "Title includes a condition/disclaimer phrase that needs manual review.", "high");
  }

  if (/\b(no returns|as is)\b/i.test(title)) {
    addRisk(risks, 25, "return_policy_risk", "Title suggests no returns/as-is terms.", "medium");
  }
}

function sellerRisk(listing = {}, risks = []) {
  const feedbackPercent = toNumber(listing.sellerFeedbackPercentage, 0);
  const feedbackScore = toNumber(listing.sellerFeedbackScore, 0);

  if (feedbackPercent > 0 && feedbackPercent < 97) {
    addRisk(risks, 35, "seller_feedback_low", "Seller feedback percentage is below 97%.", "high");
  } else if (feedbackPercent > 0 && feedbackPercent < 99) {
    addRisk(risks, 15, "seller_feedback_moderate", "Seller feedback percentage is below preferred level.", "medium");
  }

  if (feedbackScore > 0 && feedbackScore < 25) {
    addRisk(risks, 25, "seller_history_thin", "Seller has limited feedback history.", "medium");
  }
}

function compRisk({ marketData = {}, soldSales = {}, compData = {} }, risks = []) {
  const marketConfidence = toNumber(marketData.confidence, 0);
  const soldCount = toNumber(marketData.soldCompCount ?? soldSales.saleCount, 0);
  const activeCount = toNumber(marketData.activeCompCount ?? compData.compCount, 0);
  const totalCompCount = toNumber(marketData.compCount ?? compData.compCount, 0);

  if (marketData.source === "fallback") {
    addRisk(risks, 45, "fallback_valuation", "Market value is still relying on fallback valuation.", "high");
  }

  if (marketData.source === "active_market") {
    addRisk(risks, 25, "active_market_only", "Market value is based mainly on active listings instead of sold comps.", "medium");
  }

  if (soldCount === 0) {
    addRisk(risks, 35, "no_sold_comps", "No reliable sold comps are supporting this valuation yet.", "high");
  } else if (soldCount < 3) {
    addRisk(risks, 20, "thin_sold_comps", "Sold comp evidence is thin.", "medium");
  }

  if (totalCompCount < 3 && activeCount < 3) {
    addRisk(risks, 25, "thin_market", "Comparable market appears thin.", "medium");
  }

  if (marketConfidence < 35) {
    addRisk(risks, 35, "low_market_confidence", "Market confidence is low.", "high");
  } else if (marketConfidence < 55) {
    addRisk(risks, 18, "moderate_market_confidence", "Market confidence is only moderate.", "medium");
  }

  if (toNumber(marketData.outliersRemoved, 0) >= 3) {
    addRisk(risks, 15, "many_outliers", "Several comp outliers were removed, suggesting a noisy market.", "medium");
  }
}

function roiRisk({ roiData = {}, listing = {} }, risks = []) {
  const cost = getListingCost(listing);
  const netProfit = toNumber(roiData.netProfit, 0);
  const roi = toNumber(roiData.roi, 0);
  const marginOfSafetyPercent = toNumber(roiData.marginOfSafetyPercent, 0);
  const riskAdjustedProfit = toNumber(roiData.riskAdjustedProfit, 0);

  if (netProfit <= 0) {
    addRisk(risks, 55, "negative_profit", "Expected net profit is not positive.", "critical");
  }

  if (riskAdjustedProfit <= 0) {
    addRisk(risks, 35, "weak_risk_adjusted_profit", "Risk-adjusted profit is not positive.", "high");
  }

  if (roi > 0 && roi < 0.15) {
    addRisk(risks, 25, "thin_roi", "ROI is thin after costs.", "medium");
  }

  if (marginOfSafetyPercent < 8) {
    addRisk(risks, 25, "low_margin_of_safety", "Margin of safety is low.", "medium");
  }

  if (cost >= 500 && netProfit < 125) {
    addRisk(risks, 30, "high_dollar_low_profit", "High-dollar listing does not offer enough expected profit.", "high");
  }

  if (cost >= 1000) {
    addRisk(risks, 20, "large_capital_commitment", "Large capital commitment requires manual review.", "high");
  }
}

function trendRisk({ trendData = {}, soldSales = {} }, risks = []) {
  const trendDirection = normalizeText(trendData.direction || trendData.trend || soldSales.trend?.direction || "");
  const trendPercent = toNumber(soldSales.trend?.percentChange, 0);

  if (trendDirection.includes("down") || trendDirection.includes("falling") || trendDirection.includes("cold")) {
    addRisk(risks, 20, "negative_trend", "Market trend appears negative.", "medium");
  }

  if (trendPercent <= -15) {
    addRisk(risks, 25, "sold_price_downtrend", "Sold-sale trend shows a meaningful price decline.", "high");
  }

  if (trendDirection === "unknown" || (!trendDirection && !trendPercent)) {
    addRisk(risks, 8, "unknown_trend", "Trend evidence is limited or unknown.", "low");
  }
}

function liquidityRisk({ qualityData = {}, soldSales = {} }, risks = []) {
  const liquidityScore = toNumber(qualityData.liquidityScore, NaN);
  const recentSaleCount = toNumber(soldSales.recentSaleCount, 0);

  if (Number.isFinite(liquidityScore) && liquidityScore < 35) {
    addRisk(risks, 25, "low_liquidity", "Liquidity score is low.", "medium");
  }

  if (recentSaleCount === 0) {
    addRisk(risks, 18, "no_recent_sales", "No recent sold sales are visible yet.", "medium");
  }
}

function classifyRisk(totalRiskScore, criticalCount) {
  if (criticalCount > 0 || totalRiskScore >= 80) return "critical";
  if (totalRiskScore >= 60) return "high";
  if (totalRiskScore >= 35) return "medium";
  if (totalRiskScore >= 15) return "low";
  return "minimal";
}

function recommendationFromRisk(riskLevel, totalRiskScore) {
  if (riskLevel === "critical") return "do_not_buy";
  if (riskLevel === "high") return "manual_review_required";
  if (riskLevel === "medium") return "review";
  if (riskLevel === "low") return "acceptable";
  if (totalRiskScore <= 10) return "clean";
  return "acceptable";
}

function evaluateRisk(input = {}) {
  const listing = input.listing || {};
  const marketData = input.marketData || {};
  const soldSales = input.soldSales || {};
  const roiData = input.roiData || {};
  const compData = input.compData || {};
  const trendData = input.trendData || {};
  const qualityData = input.qualityData || {};

  const risks = [];

  titleRisk(listing, risks);
  sellerRisk(listing, risks);
  compRisk({ marketData, soldSales, compData }, risks);
  roiRisk({ roiData, listing }, risks);
  trendRisk({ trendData, soldSales }, risks);
  liquidityRisk({ qualityData, soldSales }, risks);

  const totalRiskScore = clamp(
    risks.reduce((sum, risk) => sum + toNumber(risk.points, 0), 0),
    0,
    100
  );

  const criticalCount = risks.filter(risk => risk.severity === "critical").length;
  const highCount = risks.filter(risk => risk.severity === "high").length;
  const riskLevel = classifyRisk(totalRiskScore, criticalCount);
  const recommendation = recommendationFromRisk(riskLevel, totalRiskScore);

  return {
    source: "risk_engine",
    totalRiskScore,
    riskLevel,
    recommendation,
    criticalCount,
    highCount,
    riskCount: risks.length,
    risks: risks.sort((a, b) => b.points - a.points),
    blockers: risks.filter(risk => risk.severity === "critical"),
    warnings: risks.filter(risk => risk.severity !== "critical"),
    clean: risks.length === 0,
    note: risks.length
      ? "Risk Engine found issues that should affect the buy decision."
      : "Risk Engine found no major issues."
  };
}

function summarizeRisk(riskData = {}) {
  return {
    source: riskData.source || "risk_engine",
    totalRiskScore: toNumber(riskData.totalRiskScore, 0),
    riskLevel: riskData.riskLevel || "unknown",
    recommendation: riskData.recommendation || "review",
    criticalCount: toNumber(riskData.criticalCount, 0),
    highCount: toNumber(riskData.highCount, 0),
    riskCount: toNumber(riskData.riskCount, 0),
    blockers: riskData.blockers || [],
    warnings: riskData.warnings || [],
    note: riskData.note || ""
  };
}

module.exports = {
  evaluateRisk,
  summarizeRisk
};
