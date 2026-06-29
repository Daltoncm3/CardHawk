// engines/pricingEngine.js
// CardHawk Pricing Engine
// Scores raw marketplace listings and estimates whether a card is worth buying.

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function getTotalCost(listing) {
  const price = toNumber(listing.price);
  const shipping = toNumber(listing.shipping);
  return roundMoney(price + shipping);
}

function estimateFees(salePrice, options = {}) {
  const feeRate = toNumber(options.feeRate, 0.1325); // rough eBay-style fee assumption
  const fixedFee = toNumber(options.fixedFee, 0.40);
  return roundMoney(salePrice * feeRate + fixedFee);
}

function getMarketValue(listing) {
  const comps = Array.isArray(listing.comps) ? listing.comps : [];
  const validComps = comps
    .map((comp) => toNumber(comp.soldPrice ?? comp.price))
    .filter((price) => price > 0);

  if (validComps.length > 0) {
    validComps.sort((a, b) => a - b);
    const middle = Math.floor(validComps.length / 2);

    if (validComps.length % 2 === 0) {
      return roundMoney((validComps[middle - 1] + validComps[middle]) / 2);
    }

    return roundMoney(validComps[middle]);
  }

  return roundMoney(listing.estimatedMarketValue ?? listing.marketValue ?? listing.price ?? 0);
}

function scoreRisk(listing) {
  let risk = 0;
  const title = String(listing.title || '').toLowerCase();
  const condition = String(listing.condition || '').toLowerCase();

  if (title.includes('reprint') || title.includes('rp')) risk += 40;
  if (title.includes('custom') || title.includes('novelty')) risk += 35;
  if (title.includes('digital')) risk += 50;
  if (title.includes('damaged') || condition.includes('poor')) risk += 25;
  if (title.includes('read') || title.includes('see description')) risk += 10;
  if (toNumber(listing.sellerFeedbackPercent, 100) < 98) risk += 15;
  if (toNumber(listing.sellerFeedbackCount, 9999) < 50) risk += 10;

  return Math.min(100, risk);
}

function scoreOpportunity({ totalCost, marketValue, netProfit, roiPercent, riskScore }) {
  let score = 0;

  if (marketValue <= 0 || totalCost <= 0) return 0;

  if (roiPercent >= 50) score += 35;
  else if (roiPercent >= 35) score += 28;
  else if (roiPercent >= 25) score += 20;
  else if (roiPercent >= 15) score += 10;

  if (netProfit >= 50) score += 30;
  else if (netProfit >= 25) score += 22;
  else if (netProfit >= 10) score += 14;
  else if (netProfit >= 5) score += 7;

  if (totalCost <= marketValue * 0.6) score += 20;
  else if (totalCost <= marketValue * 0.75) score += 14;
  else if (totalCost <= marketValue * 0.85) score += 7;

  score -= Math.round(riskScore * 0.6);

  return Math.max(0, Math.min(100, score));
}

function getRecommendation({ netProfit, roiPercent, riskScore, opportunityScore }) {
  if (riskScore >= 60) return 'PASS_HIGH_RISK';
  if (netProfit >= 20 && roiPercent >= 30 && opportunityScore >= 70) return 'BUY_STRONG';
  if (netProfit >= 10 && roiPercent >= 20 && opportunityScore >= 50) return 'BUY';
  if (netProfit >= 5 && roiPercent >= 12) return 'WATCH';
  return 'PASS';
}

function priceListing(listing, options = {}) {
  const totalCost = getTotalCost(listing);
  const marketValue = getMarketValue(listing);
  const fees = estimateFees(marketValue, options);
  const netSale = roundMoney(marketValue - fees);
  const netProfit = roundMoney(netSale - totalCost);
  const roiPercent = totalCost > 0 ? roundMoney((netProfit / totalCost) * 100) : 0;
  const riskScore = scoreRisk(listing);
  const opportunityScore = scoreOpportunity({
    totalCost,
    marketValue,
    netProfit,
    roiPercent,
    riskScore,
  });
  const recommendation = getRecommendation({
    netProfit,
    roiPercent,
    riskScore,
    opportunityScore,
  });

  return {
    id: listing.id ?? null,
    title: listing.title ?? '',
    price: roundMoney(listing.price),
    shipping: roundMoney(listing.shipping),
    totalCost,
    marketValue,
    estimatedFees: fees,
    estimatedNetSale: netSale,
    estimatedProfit: netProfit,
    roiPercent,
    riskScore,
    opportunityScore,
    recommendation,
  };
}

function priceListings(listings, options = {}) {
  if (!Array.isArray(listings)) {
    throw new TypeError('priceListings expected an array of listings');
  }

  return listings
    .map((listing) => priceListing(listing, options))
    .sort((a, b) => b.opportunityScore - a.opportunityScore);
}

module.exports = {
  priceListing,
  priceListings,
  getTotalCost,
  getMarketValue,
  estimateFees,
};
