'use strict';

const canonicalIdentityEngine = require('./canonicalIdentityEngine');
const serializationInstrumentation = require('../utils/serializationInstrumentation');

const UNKNOWN = 'unknown';
const ADAPTER_VERSION = 'legacy-identity-adapter-v1';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return serializationInstrumentation.instrumentJsonClone(value ?? null, {
    sourceFile: 'engines/legacyIdentityAdapter.js',
    functionName: 'clone',
    serializationType: 'json_clone_stringify',
    group: 'LegacyIdentityAdapter'
  });
}

function normalizeComparableValue(value) {
  if (value === undefined || value === null || value === '') return UNKNOWN;
  if (typeof value === 'boolean') return value;
  return String(value)
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[^a-z0-9\s/.'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || UNKNOWN;
}

function hasKnown(value) {
  return value !== undefined && value !== null && value !== '' && value !== UNKNOWN;
}

function getPath(source = {}, path = '') {
  return String(path).split('.').reduce((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[part];
  }, source);
}

function pickFirst(sources = [], paths = []) {
  for (const source of sources) {
    for (const path of paths) {
      const value = getPath(source, path);
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  return undefined;
}

function getLegacyParsed(listing = {}) {
  return asObject(listing.parsed || listing.parsedCard || listing.card || {});
}

function buildListingMetadata(listing = {}) {
  return {
    ebayItemId: listing.ebayItemId || listing.itemId || listing.id || '',
    marketplaceItemId: listing.marketplaceItemId || listing.ebayItemId || listing.itemId || listing.id || '',
    title: listing.title || listing.rawTitle || '',
    rawTitle: listing.rawTitle || listing.title || '',
    url: listing.url || listing.itemWebUrl || '',
    lane: listing.lane || '',
    price: listing.price ?? null,
    shipping: listing.shipping ?? null,
    totalCost: listing.totalCost ?? null
  };
}

function buildMarketplaceMetadata(listing = {}, overrides = {}) {
  return {
    marketplace: overrides.marketplace || listing.marketplace || listing.sourceMarketplace || 'ebay',
    source: overrides.source || listing.source || listing.marketplaceSource || 'legacy_listing_runtime',
    adapterVersion: ADAPTER_VERSION
  };
}

function buildCanonicalIdentityInput(listing = {}, options = {}) {
  return {
    legacyParsed: clone(options.legacyParsed || getLegacyParsed(listing)),
    listing: buildListingMetadata(listing),
    marketplace: buildMarketplaceMetadata(listing, options.marketplace || {}),
    canonicalSoldEvidenceIdentity: clone(
      options.canonicalSoldEvidenceIdentity ||
      listing.canonicalIdentity ||
      listing.canonicalSoldEvidenceIdentity ||
      listing.canonicalSoldEvidence?.identity ||
      null
    ),
    parserVersion: options.parserVersion || listing.parserVersion || listing.parsed?.parserVersion || 'legacy_runtime_parser',
    rawSource: options.rawSource || 'legacy_identity_adapter'
  };
}

const FIELD_MAPPINGS = [
  { field: 'sport', legacyPaths: ['sport', 'category'], canonicalPath: 'normalized.sport' },
  { field: 'league', legacyPaths: ['league'], canonicalPath: 'normalized.league' },
  { field: 'team', legacyPaths: ['team'], canonicalPath: 'normalized.team' },
  { field: 'subject', legacyPaths: ['player', 'subject', 'playerName', 'character', 'name'], canonicalPath: 'normalized.subject.name' },
  { field: 'year', legacyPaths: ['year', 'season'], canonicalPath: 'normalized.year' },
  { field: 'manufacturer', legacyPaths: ['manufacturer', 'brand'], canonicalPath: 'normalized.manufacturer' },
  { field: 'brand', legacyPaths: ['brand', 'manufacturer'], canonicalPath: 'normalized.brand' },
  { field: 'product', legacyPaths: ['product', 'setName', 'set'], canonicalPath: 'normalized.product' },
  { field: 'setName', legacyPaths: ['setName', 'set', 'cardSet', 'series', 'product'], canonicalPath: 'normalized.setName' },
  { field: 'cardNumber', legacyPaths: ['cardNumber', 'cardNo', 'number', 'collectorNumber'], canonicalPath: 'normalized.cardNumber' },
  { field: 'parallel', legacyPaths: ['parallel', 'color'], canonicalPath: 'normalized.parallel' },
  { field: 'variation', legacyPaths: ['variation'], canonicalPath: 'normalized.variation' },
  { field: 'rookieDesignation', legacyPaths: ['rookieDesignation', 'rookie', 'isRookie', 'flags.rookie'], canonicalPath: 'normalized.rookieDesignation' },
  { field: 'autograph', legacyPaths: ['autograph', 'auto', 'isAutograph', 'flags.autograph'], canonicalPath: 'normalized.autograph.state' },
  { field: 'memorabilia', legacyPaths: ['memorabilia', 'relic', 'patch', 'isRelic'], canonicalPath: 'normalized.memorabilia.state' },
  { field: 'serialNumbered', legacyPaths: ['serialNumbered', 'numbered', 'isNumbered', 'flags.numbered'], canonicalPath: 'normalized.serialNumbered' },
  { field: 'printRun', legacyPaths: ['printRun', 'numberedTo'], canonicalPath: 'normalized.printRun' },
  { field: 'rawOrGraded', legacyPaths: ['rawOrGraded', 'conditionState'], canonicalPath: 'normalized.rawOrGraded' },
  { field: 'rawCondition', legacyPaths: ['rawCondition', 'condition'], canonicalPath: 'normalized.rawCondition' },
  { field: 'gradingCompany', legacyPaths: ['gradeCompany', 'grader', 'gradingCompany'], canonicalPath: 'normalized.grading.company' },
  { field: 'grade', legacyPaths: ['grade', 'conditionGrade'], canonicalPath: 'normalized.grading.grade' },
  { field: 'certificationNumber', legacyPaths: ['certificationNumber', 'certNumber', 'cert'], canonicalPath: 'normalized.grading.certificationNumber' },
  { field: 'game', legacyPaths: ['game', 'tcg', 'franchise'], canonicalPath: 'normalized.game' },
  { field: 'cardName', legacyPaths: ['cardName', 'name', 'character'], canonicalPath: 'normalized.cardName' },
  { field: 'collectorNumber', legacyPaths: ['collectorNumber', 'cardNumber', 'number'], canonicalPath: 'normalized.collectorNumber' },
  { field: 'rarity', legacyPaths: ['rarity'], canonicalPath: 'normalized.rarity' },
  { field: 'finishTreatment', legacyPaths: ['finishTreatment', 'parallel', 'foilState'], canonicalPath: 'normalized.finishTreatment' },
  { field: 'language', legacyPaths: ['language'], canonicalPath: 'normalized.language' }
];

function compareLegacyToCanonical(legacyParsed = {}, canonicalIdentity = {}) {
  const legacy = asObject(legacyParsed);
  const canonical = asObject(canonicalIdentity);
  const matchingFields = [];
  const conflictingFields = [];
  const fieldsOnlyPresentInLegacyIdentity = [];
  const fieldsOnlyPresentInCanonicalIdentity = [];
  const confidenceDifferences = [];

  for (const mapping of FIELD_MAPPINGS) {
    const legacyRawValue = pickFirst([legacy], mapping.legacyPaths);
    const canonicalRawValue = getPath(canonical, mapping.canonicalPath);
    const legacyValue = normalizeComparableValue(legacyRawValue);
    const canonicalValue = normalizeComparableValue(canonicalRawValue);
    const legacyKnown = hasKnown(legacyValue);
    const canonicalKnown = hasKnown(canonicalValue);
    const canonicalConfidence = Number(canonical.fieldConfidence?.[mapping.canonicalPath] ?? 0);

    const record = {
      field: mapping.field,
      legacyValue: legacyKnown ? legacyRawValue : UNKNOWN,
      canonicalValue: canonicalKnown ? canonicalRawValue : UNKNOWN,
      canonicalPath: mapping.canonicalPath
    };

    if (legacyKnown && canonicalKnown && legacyValue === canonicalValue) {
      matchingFields.push(record);
    } else if (legacyKnown && canonicalKnown && legacyValue !== canonicalValue) {
      conflictingFields.push(record);
    } else if (legacyKnown && !canonicalKnown) {
      fieldsOnlyPresentInLegacyIdentity.push(record);
    } else if (!legacyKnown && canonicalKnown) {
      fieldsOnlyPresentInCanonicalIdentity.push(record);
    }

    if (legacyKnown || canonicalKnown || canonicalConfidence > 0) {
      confidenceDifferences.push({
        field: mapping.field,
        legacyConfidence: null,
        canonicalConfidence: Number.isFinite(canonicalConfidence) ? canonicalConfidence : 0,
        difference: null,
        status: 'legacy_unscored'
      });
    }
  }

  const legacyMappedFields = new Set(FIELD_MAPPINGS.flatMap((mapping) => mapping.legacyPaths.map((path) => path.split('.')[0])));
  const unmappedLegacyFields = Object.keys(legacy)
    .filter((key) => !legacyMappedFields.has(key))
    .map((key) => ({
      field: key,
      legacyValue: legacy[key],
      canonicalValue: UNKNOWN,
      canonicalPath: null
    }));

  return {
    source: 'legacy_identity_adapter',
    version: ADAPTER_VERSION,
    matchingFields,
    conflictingFields,
    fieldsOnlyPresentInLegacyIdentity: [
      ...fieldsOnlyPresentInLegacyIdentity,
      ...unmappedLegacyFields
    ],
    fieldsOnlyPresentInCanonicalIdentity,
    confidenceDifferences
  };
}

function buildLegacyIdentityDiagnostics(listing = {}, options = {}) {
  const legacyParsed = clone(options.legacyParsed || getLegacyParsed(listing));
  const canonicalIdentity = canonicalIdentityEngine.buildCanonicalIdentity(
    buildCanonicalIdentityInput(listing, { ...options, legacyParsed })
  );
  const canonicalIdentitySummary = canonicalIdentityEngine.summarizeCanonicalIdentity(canonicalIdentity);
  const legacyIdentityComparison = compareLegacyToCanonical(legacyParsed, canonicalIdentity);

  return {
    source: 'legacy_identity_adapter',
    version: ADAPTER_VERSION,
    productionImpact: 'none',
    decisionImpact: 'none',
    canonicalIdentity,
    canonicalIdentitySummary,
    exactCompEligible: canonicalIdentity.eligibility?.exactCompEligible === true,
    valuationEligible: canonicalIdentity.eligibility?.valuationEligible === true,
    manualReviewRequired: canonicalIdentity.eligibility?.manualReviewRequired !== false,
    contextOnly: canonicalIdentity.eligibility?.contextOnly !== false,
    overallIdentityConfidence: canonicalIdentity.overallIdentityConfidence || 0,
    unknownFields: asArray(canonicalIdentity.unknownFields),
    normalizationWarnings: asArray(canonicalIdentity.normalizationWarnings),
    legacyIdentityComparison
  };
}

module.exports = {
  ADAPTER_VERSION,
  buildCanonicalIdentityInput,
  buildLegacyIdentityDiagnostics,
  compareLegacyToCanonical
};
