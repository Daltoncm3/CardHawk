// engines/roiEngine.js
// CardHawk ROI Engine v1
// Purpose: calculate true expected profitability after costs, fees, risk buffer, and break-even math.
// This engine is conservative by design. It is built for buying decisions, not hype.

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getListingCost(listing = {}) {
  const totalCost = toNumber(listing.totalCost, NaN);
  if (Number.isFinite(totalCost) && totalCost > 0) return roundMoney(totalCost);

  const price = toNumber(listing.price, 0);
  const shipping = toNumber(listing.shipping, 0);
  return roundMoney(price + shipping);
}

function getMarketValue(input = {}) {
  const marketValue = toNumber(input.marketValue, NaN);
  if (Number.isFinite(marketValue) && marketValue > 0) return roundMoney(marketValue);

  const estimatedValue = toNumber(input.estimatedValue, NaN);
  if (Number.isFinite(estimatedValue) && estimatedValue > 0) return roundMoney(estimatedValue);

  const marketDataValue = toNumber(input.marketData?.marketValue, NaN);
  if (Number.isFinite(marketDataValue) && marketDataValue > 0) return roundMoney(marketDataValue);

  return 0;
}

function defaultFeeSettings(options = {}) {
  return {
    salesTaxRate: toNumber(options.salesTaxRate, 0.075),
    resaleFeeRate: toNumber(options.resaleFeeRate, 0.1325),
    paymentFeeRate: toNumber(options.paymentFeeRate, 0),
    fixedSellingFee: toNumber(options.fixedSellingFee, 0.3),
    shippingToBuyer: toNumber(options.shippingToBuyer, 5),
    shippingSupplies: toNumber(options.shippingSupplies, 1),
    gradingCost: toNumber(options.gradingCost, 0),
    riskBufferRate: toNumber(options.riskBufferRate, 0.05),
    minimumProfitTarget: toNumber(options.minimumProfitTarget, 20),
    minimumRoiTarget: toNumber(options.minimumRoiTarget, 0.25)
  };
}

function calculateFees(expectedSalePrice, settings) {
  const resaleFees = roundMoney(expectedSalePrice * settings.resaleFeeRate);
  const paymentFees = roundMoney(expectedSalePrice * settings.paymentFeeRate);
  const fixedFees = roundMoney(settings.fixedSellingFee);
  return {
    resaleFees,
    paymentFees,
    fixedFees,
    totalSellerFees: roundMoney(resaleFees + paymentFees + fixedFees)
  };
}

function calculateAcquisitionCosts(listingCost, settings) {
  const salesTax = roundMoney(listingCost * settings.salesTaxRate);
  return {
    purchaseCost: roundMoney(listingCost),
    salesTax,
    gradingCost: roundMoney(settings.gradingCost),
    totalAcquisitionCost: roundMoney(listingCost + salesTax + settings.gradingCost)
  };
}

function calculateOperationalCosts(settings) {
  return {
    shippingToBuyer: roundMoney(settings.shippingToBuyer),
    shippingSupplies: roundMoney(settings.shippingSupplies),
    totalOperationalCost: roundMoney(settings.shippingToBuyer + settings.shippingSupplies)
  };
}

function calculateBreakEvenPrice(totalCostBasis, settings) {
  const variableFeeRate = clamp(settings.resaleFeeRate + settings.paymentFeeRate, 0, 0.5);
  const fixedCosts = settings.fixedSellingFee + settings.shippingToBuyer + settings.shippingSupplies;
  const denominator = 1 - variableFeeRate;

  if (denominator <= 0) return 0;
  return roundMoney((totalCostBasis + fixedCosts) / denominator);
}

function classifyRoi(roi, netProfit, settings) {
  if (netProfit <= 0 || roi <= 0) return "bad";
  if (netProfit >= settings.minimumProfitTarget * 2 && roi >= settings.minimumRoiTarget * 1.5) return "excellent";
  if (netProfit >= settings.minimumProfitTarget && roi >= settings.minimumRoiTarget) return "good";
  if (netProfit >= settings.minimumProfitTarget * 0.6 && roi >= settings.minimumRoiTarget * 0.6) return "thin";
  return "weak";
}

function recommendationFromRoi({ roiTier, marginOfSafetyPercent, riskAdjustedProfit, confidence }) {
  if (roiTier === "excellent" && marginOfSafetyPercent >= 25 && riskAdjustedProfit > 0 && confidence >= 70) {
    return "strong_buy";
  }

  if ((roiTier === "excellent" || roiTier === "good") && marginOfSafetyPercent >= 15 && riskAdjustedProfit > 0 && confidence >= 55) {
    return "buy";
  }

  if ((roiTier === "good" || roiTier === "thin") && marginOfSafetyPercent >= 8 && riskAdjustedProfit > 0) {
    return "watch";
  }

  if (riskAdjustedProfit <= 0) return "pass";
  return "review";
}

function buildReasons(data = {}) {
  const reasons = [];

  if (data.netProfit > 0) reasons.push(`Expected net profit is $${roundMoney(data.netProfit)}.`);
  else reasons.push("Expected net profit is not positive.");

  reasons.push(`ROI is ${Math.round(data.roi * 1000) / 10}%.`);

  if (data.marginOfSafetyPercent > 0) {
    reasons.push(`Margin of safety is ${Math.round(data.marginOfSafetyPercent * 10) / 10}%.`);
  } else {
    reasons.push("No margin of safety versus break-even price.");
  }

  if (data.riskAdjustedProfit > 0) {
    reasons.push(`Risk-adjusted profit remains positive at $${roundMoney(data.riskAdjustedProfit)}.`);
  } else {
    reasons.push("Risk-adjusted profit is not strong enough.");
  }

  if (data.confidence < 40) reasons.push("ROI confidence is low because market confidence is limited.");
  else if (data.confidence >= 70) reasons.push("ROI confidence is supported by stronger market evidence.");

  return reasons;
}

function evaluateROI(input = {}) {
  const listing = input.listing || {};
  const marketData = input.marketData || {};
  const options = input.options || {};
  const settings = defaultFeeSettings({
    ...options,
    minimumProfitTarget: options.minimumProfitTarget ?? input.minimumProfitTarget,
    minimumRoiTarget: options.minimumRoiTarget ?? input.minimumRoiTarget
  });

  const listingCost = getListingCost(listing);
  const expectedSalePrice = getMarketValue({
    marketValue: input.marketValue,
    estimatedValue: input.estimatedValue,
    marketData
  });

  const acquisition = calculateAcquisitionCosts(listingCost, settings);
  const fees = calculateFees(expectedSalePrice, settings);
  const operations = calculateOperationalCosts(settings);

  const grossSpread = roundMoney(expectedSalePrice - listingCost);
  const totalCostBasis = roundMoney(acquisition.totalAcquisitionCost + operations.totalOperationalCost + fees.totalSellerFees);
  const netProfit = roundMoney(expectedSalePrice - totalCostBasis);
  const roi = acquisition.totalAcquisitionCost > 0 ? netProfit / acquisition.totalAcquisitionCost : 0;

  const breakEvenPrice = calculateBreakEvenPrice(acquisition.totalAcquisitionCost, settings);
  const marginOfSafety = roundMoney(expectedSalePrice - breakEvenPrice);
  const marginOfSafetyPercent = expectedSalePrice > 0 ? Math.round((marginOfSafety / expectedSalePrice) * 1000) / 10 : 0;

  const riskBuffer = roundMoney(expectedSalePrice * settings.riskBufferRate);
  const riskAdjustedProfit = roundMoney(netProfit - riskBuffer);
  const riskAdjustedRoi = acquisition.totalAcquisitionCost > 0 ? riskAdjustedProfit / acquisition.totalAcquisitionCost : 0;

  const confidence = clamp(Math.round(toNumber(marketData.confidence, input.marketConfidence || 0)), 0, 100);
  const roiTier = classifyRoi(roi, netProfit, settings);
  const recommendation = recommendationFromRoi({
    roiTier,
    marginOfSafetyPercent,
    riskAdjustedProfit,
    confidence
  });

  const result = {
    source: "roi_engine",
    expectedSalePrice,
    listingCost,
    grossSpread,
    netProfit,
    roi,
    roiPercent: Math.round(roi * 1000) / 10,
    riskAdjustedProfit,
    riskAdjustedRoi,
    riskAdjustedRoiPercent: Math.round(riskAdjustedRoi * 1000) / 10,
    breakEvenPrice,
    marginOfSafety,
    marginOfSafetyPercent,
    roiTier,
    recommendation,
    confidence,
    costs: {
      acquisition,
      fees,
      operations,
      riskBuffer,
      totalCostBasis
    },
    targets: {
      minimumProfitTarget: settings.minimumProfitTarget,
      minimumRoiTarget: settings.minimumRoiTarget
    }
  };

  result.reasons = buildReasons(result);
  return result;
}

function summarizeROI(roiData = {}) {
  return {
    source: roiData.source || "roi_engine",
    expectedSalePrice: roundMoney(roiData.expectedSalePrice || 0),
    listingCost: roundMoney(roiData.listingCost || 0),
    netProfit: roundMoney(roiData.netProfit || 0),
    roi: toNumber(roiData.roi, 0),
    roiPercent: toNumber(roiData.roiPercent, 0),
    riskAdjustedProfit: roundMoney(roiData.riskAdjustedProfit || 0),
    riskAdjustedRoiPercent: toNumber(roiData.riskAdjustedRoiPercent, 0),
    breakEvenPrice: roundMoney(roiData.breakEvenPrice || 0),
    marginOfSafetyPercent: toNumber(roiData.marginOfSafetyPercent, 0),
    roiTier: roiData.roiTier || "unknown",
    recommendation: roiData.recommendation || "review",
    confidence: toNumber(roiData.confidence, 0),
    reasons: roiData.reasons || []
  };
}

module.exports = {
  evaluateROI,
  summarizeROI,
  calculateBreakEvenPrice,
  calculateFees,
  calculateAcquisitionCosts,
  calculateOperationalCosts
};
