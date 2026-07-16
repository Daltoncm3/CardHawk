'use strict';

const {
  asArray,
  asObject,
  unique
} = require('./canonicalValidationCore');
const {
  buildOfflineAuthorityFlags,
  clone,
  firstDefined
} = require('./phase8GovernanceCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');

const SOURCE = 'canonical_source_research_record';
const PACKET_SOURCE = 'canonical_source_evidence_packet';
const RESEARCH_RECORD_VERSION = '1.0.0';
const EVIDENCE_PACKET_VERSION = '1.0.0';

const EVIDENCE_CLASS = Object.freeze({
  OFFICIAL_TERMS: 'official_terms',
  OFFICIAL_API_DOCUMENTATION: 'official_api_documentation',
  OFFICIAL_PRICING: 'official_pricing',
  OFFICIAL_PRIVACY_POLICY: 'official_privacy_policy',
  PROVIDER_CORRESPONDENCE: 'provider_correspondence',
  MARKETING_CLAIM: 'marketing_claim',
  OPERATOR_NOTE: 'operator_note',
  THIRD_PARTY_REFERENCE: 'third_party_reference'
});

const FACT_KEY = Object.freeze({
  SALES_DATA: 'salesDataClaims',
  TRANSACTION_LEVEL_EVIDENCE: 'transactionLevelEvidenceClaims',
  ACCEPTED_OFFER_VISIBILITY: 'acceptedOfferVisibilityClaims',
  COMMERCIAL_USE: 'commercialUseClaims',
  INTERNAL_USE: 'internalUseClaims',
  ATTRIBUTION_REQUIREMENTS: 'attributionRequirements',
  REDISTRIBUTION_RESTRICTIONS: 'redistributionRestrictions',
  API_AVAILABILITY: 'apiAvailability',
  LICENSING_STATUS: 'licensingStatus',
  PRICING_MODEL: 'pricingModel'
});

const CLAIM_AUTHORITY = Object.freeze({
  SUPPORTS_PERMISSION: 'supports_permission',
  CONTEXT_ONLY: 'context_only',
  OPERATOR_ONLY: 'operator_only'
});

const PERMISSION_EVIDENCE_CLASSES = new Set([
  EVIDENCE_CLASS.OFFICIAL_TERMS,
  EVIDENCE_CLASS.PROVIDER_CORRESPONDENCE
]);

const DOCUMENTATION_EVIDENCE_CLASSES = new Set([
  EVIDENCE_CLASS.OFFICIAL_TERMS,
  EVIDENCE_CLASS.OFFICIAL_API_DOCUMENTATION,
  EVIDENCE_CLASS.OFFICIAL_PRICING,
  EVIDENCE_CLASS.OFFICIAL_PRIVACY_POLICY,
  EVIDENCE_CLASS.PROVIDER_CORRESPONDENCE
]);

const POSITIVE_VALUES = new Set([
  'approved',
  'available',
  'documented',
  'licensed',
  'permitted',
  'permitted_with_license',
  'visible',
  'yes'
]);

const NEGATIVE_VALUES = new Set([
  'no',
  'not_available',
  'not_documented',
  'prohibited',
  'restricted',
  'unavailable',
  'undocumented'
]);

function normalizeStatus(value, fallback = 'unknown') {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback;
}

function normalizeText(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeEvidenceClass(value) {
  const normalized = normalizeStatus(value, EVIDENCE_CLASS.OPERATOR_NOTE);
  return Object.values(EVIDENCE_CLASS).includes(normalized) ? normalized : EVIDENCE_CLASS.OPERATOR_NOTE;
}

function normalizeReference(value = {}) {
  if (typeof value === 'string') {
    return {
      label: null,
      url: value,
      documentId: null,
      capturedAt: null,
      notes: null
    };
  }
  const input = asObject(value);
  return {
    label: normalizeText(input.label || input.name),
    url: normalizeText(input.url || input.href),
    documentId: normalizeText(input.documentId || input.id),
    capturedAt: normalizeText(input.capturedAt || input.date),
    notes: normalizeText(input.notes)
  };
}

function normalizeReferences(value = []) {
  return asArray(value).map(normalizeReference).filter((reference) => (
    reference.label || reference.url || reference.documentId || reference.notes
  ));
}

function normalizeClaim(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'object') {
    const input = asObject(value);
    return {
      value: normalizeStatus(firstDefined(input.value, input.status, input.claim, 'unknown')),
      summary: normalizeText(input.summary || input.notes),
      confidence: normalizeStatus(input.confidence || 'unknown')
    };
  }
  return {
    value: normalizeStatus(value),
    summary: null,
    confidence: 'unknown'
  };
}

function normalizeClaimValue(value) {
  const claim = normalizeClaim(value);
  return claim ? claim.value : 'unknown';
}

function evidenceAuthorityForClass(evidenceClass) {
  if (PERMISSION_EVIDENCE_CLASSES.has(evidenceClass)) return CLAIM_AUTHORITY.SUPPORTS_PERMISSION;
  if (evidenceClass === EVIDENCE_CLASS.OPERATOR_NOTE) return CLAIM_AUTHORITY.OPERATOR_ONLY;
  return CLAIM_AUTHORITY.CONTEXT_ONLY;
}

function buildSourceResearchRecordFingerprint(record = {}) {
  const input = asObject(record);
  return buildFingerprintFromProjection({
    source: input.source || SOURCE,
    version: input.version || RESEARCH_RECORD_VERSION,
    recordId: input.recordId || null,
    providerIdentity: input.providerIdentity || {},
    evidenceClass: input.evidenceClass || null,
    researchDate: input.researchDate || null,
    researcher: input.researcher || null,
    intendedUse: input.intendedUse || null,
    references: input.references || {},
    claims: input.claims || {},
    contact: input.contact || {},
    unresolvedQuestions: input.unresolvedQuestions || [],
    sourceCitations: input.sourceCitations || [],
    researchConfidence: input.researchConfidence || null,
    operatorConclusions: input.operatorConclusions || {}
  });
}

function createSourceResearchRecord(input = {}, options = {}) {
  const source = asObject(input);
  const evidenceClass = normalizeEvidenceClass(source.evidenceClass || source.class);
  const record = {
    source: SOURCE,
    version: RESEARCH_RECORD_VERSION,
    schemaVersion: RESEARCH_RECORD_VERSION,
    recordId: normalizeText(source.recordId || options.recordId) || [
      normalizeStatus(firstDefined(source.providerId, source.providerName, 'unknown_provider')),
      normalizeStatus(source.researchDate || options.researchDate || 'undated'),
      evidenceClass
    ].join(':'),
    providerIdentity: {
      providerId: normalizeStatus(firstDefined(source.providerId, source.sourceId, source.providerName, 'unknown_provider')),
      providerName: normalizeText(firstDefined(source.providerName, source.name, 'Unknown provider')),
      providerCategory: normalizeStatus(firstDefined(source.providerCategory, source.category, 'unknown_category')),
      marketplace: normalizeText(source.marketplace)
    },
    evidenceClass,
    claimAuthority: evidenceAuthorityForClass(evidenceClass),
    researchDate: normalizeText(source.researchDate || options.researchDate),
    researcher: normalizeText(source.researcher || options.researcher),
    intendedUse: normalizeText(source.intendedUse || source.purpose),
    references: {
      officialWebsite: normalizeReference(source.officialWebsite || source.website),
      officialTermsOrLicense: normalizeReference(source.officialTermsOrLicense || source.terms || source.license),
      privacyPolicy: normalizeReference(source.privacyPolicy || source.privacy),
      apiDocumentation: normalizeReference(source.apiDocumentation || source.apiDocs),
      pricing: normalizeReference(source.pricing || source.pricingReference)
    },
    claims: {
      salesDataClaims: normalizeClaim(source.salesDataClaims),
      transactionLevelEvidenceClaims: normalizeClaim(source.transactionLevelEvidenceClaims),
      acceptedOfferVisibilityClaims: normalizeClaim(source.acceptedOfferVisibilityClaims),
      commercialUseClaims: normalizeClaim(source.commercialUseClaims),
      internalUseClaims: normalizeClaim(source.internalUseClaims),
      apiAvailability: normalizeClaim(source.apiAvailability),
      licensingStatus: normalizeClaim(source.licensingStatus),
      attributionRequirements: normalizeText(source.attributionRequirements),
      redistributionRestrictions: normalizeText(source.redistributionRestrictions),
      pricingModel: normalizeText(source.pricingModel)
    },
    contact: {
      contactEmail: normalizeText(source.contactEmail),
      outreachDate: normalizeText(source.outreachDate),
      providerResponseStatus: normalizeStatus(source.providerResponseStatus || 'unknown'),
      providerResponseSummary: normalizeText(source.providerResponseSummary)
    },
    unresolvedQuestions: unique(asArray(source.unresolvedQuestions).map((question) => normalizeText(question)).filter(Boolean)).sort(),
    sourceCitations: normalizeReferences(source.sourceCitations || source.citations || source.documentReferences),
    researchConfidence: normalizeStatus(source.researchConfidence || 'unknown'),
    operatorConclusions: asObject(source.operatorConclusions),
    createdAt: options.createdAt || source.createdAt || new Date().toISOString(),
    updatedAt: options.updatedAt || source.updatedAt || options.createdAt || source.createdAt || new Date().toISOString(),
    ...buildOfflineAuthorityFlags()
  };

  record.stableFingerprint = buildSourceResearchRecordFingerprint(record);
  return record;
}

function claimEntriesForRecord(record = {}) {
  const input = asObject(record);
  return Object.entries(asObject(input.claims)).flatMap(([factKey, claim]) => {
    if (claim === null || claim === undefined || claim === '') return [];
    if (typeof claim === 'object' && claim.value) {
      return [{
        recordId: input.recordId || null,
        evidenceClass: input.evidenceClass || null,
        claimAuthority: input.claimAuthority || evidenceAuthorityForClass(input.evidenceClass),
        factKey,
        value: normalizeStatus(claim.value),
        summary: claim.summary || null,
        researchDate: input.researchDate || null,
        sourceCitations: input.sourceCitations || []
      }];
    }
    return [{
      recordId: input.recordId || null,
      evidenceClass: input.evidenceClass || null,
      claimAuthority: input.claimAuthority || evidenceAuthorityForClass(input.evidenceClass),
      factKey,
      value: normalizeStatus(claim),
      summary: null,
      researchDate: input.researchDate || null,
      sourceCitations: input.sourceCitations || []
    }];
  });
}

function collectRawClaims(records = []) {
  return asArray(records).flatMap(claimEntriesForRecord).sort((left, right) => (
    `${left.factKey}:${left.value}:${left.recordId}`.localeCompare(`${right.factKey}:${right.value}:${right.recordId}`)
  ));
}

function identifyContradictions(records = []) {
  const claims = collectRawClaims(records);
  const byFact = {};
  for (const claim of claims) {
    if (!byFact[claim.factKey]) byFact[claim.factKey] = [];
    byFact[claim.factKey].push(claim);
  }

  return Object.entries(byFact).flatMap(([factKey, entries]) => {
    const values = unique(entries.map((entry) => entry.value).filter((value) => value !== 'unknown'));
    if (values.length <= 1) return [];

    const hasPositive = values.some((value) => POSITIVE_VALUES.has(value));
    const hasNegative = values.some((value) => NEGATIVE_VALUES.has(value));
    if (!hasPositive || !hasNegative) return [];

    return [{
      factKey,
      values,
      recordIds: unique(entries.map((entry) => entry.recordId).filter(Boolean)).sort(),
      evidenceClasses: unique(entries.map((entry) => entry.evidenceClass).filter(Boolean)).sort()
    }];
  }).sort((left, right) => left.factKey.localeCompare(right.factKey));
}

function evidenceAgeDays(dateValue, nowValue) {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  const now = new Date(nowValue);
  if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) return null;
  return Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
}

function identifyStaleOrUndatedEvidence(records = [], options = {}) {
  const staleAfterDays = Number(options.staleAfterDays || 365);
  const now = options.now || new Date().toISOString();
  return asArray(records).flatMap((record) => {
    if (!record.researchDate) {
      return [{
        recordId: record.recordId || null,
        issue: 'undated_evidence',
        evidenceClass: record.evidenceClass || null
      }];
    }
    const ageDays = evidenceAgeDays(record.researchDate, now);
    if (ageDays !== null && ageDays > staleAfterDays) {
      return [{
        recordId: record.recordId || null,
        issue: 'stale_evidence',
        evidenceClass: record.evidenceClass || null,
        ageDays,
        staleAfterDays
      }];
    }
    return [];
  });
}

function selectAuthoritativeClaim(records = [], factKey, allowedClasses = DOCUMENTATION_EVIDENCE_CLASSES) {
  const claims = collectRawClaims(records).filter((claim) => (
    claim.factKey === factKey
    && allowedClasses.has(claim.evidenceClass)
  ));
  if (!claims.length) return 'unknown';

  const values = unique(claims.map((claim) => claim.value).filter(Boolean));
  if (values.length === 1) return values[0];
  const positive = values.find((value) => POSITIVE_VALUES.has(value));
  return positive || values[0] || 'unknown';
}

function textConclusion(records = [], factKey, allowedClasses = DOCUMENTATION_EVIDENCE_CLASSES) {
  const values = asArray(records).filter((record) => allowedClasses.has(record.evidenceClass)).map((record) => record.claims?.[factKey]).filter(Boolean);
  return values.length ? String(values[values.length - 1]) : null;
}

function identifyUnknownFacts(summary = {}) {
  const factKeys = [
    'transactionLevelSoldEvidenceAvailability',
    'acceptedOfferVisibility',
    'apiAvailability',
    'licensingStatus',
    'commercialUseStatus',
    'internalUseStatus'
  ];
  return factKeys.filter((key) => normalizeStatus(summary[key]) === 'unknown');
}

function buildDossierSummary(records = [], options = {}) {
  const firstRecord = asArray(records)[0] || {};
  const providerIdentity = asObject(firstRecord.providerIdentity);
  const officialDocs = new Set([
    EVIDENCE_CLASS.OFFICIAL_TERMS,
    EVIDENCE_CLASS.OFFICIAL_API_DOCUMENTATION,
    EVIDENCE_CLASS.OFFICIAL_PRICING,
    EVIDENCE_CLASS.OFFICIAL_PRIVACY_POLICY
  ]);
  const documentationLinks = asArray(records).flatMap((record) => {
    const references = asObject(record.references);
    return Object.entries(references).flatMap(([type, reference]) => {
      if (!DOCUMENTATION_EVIDENCE_CLASSES.has(record.evidenceClass)) return [];
      if (!reference || (!reference.url && !reference.label && !reference.documentId)) return [];
      return [{
        label: reference.label || type,
        url: reference.url || null,
        type,
        notes: reference.notes || null
      }];
    });
  });

  const summary = {
    providerName: providerIdentity.providerName || 'Unknown provider',
    providerCategory: providerIdentity.providerCategory || 'unknown_category',
    intendedPurpose: firstDefined(options.intendedPurpose, firstRecord.intendedUse, null),
    officialWebsite: asArray(records).map((record) => record.references?.officialWebsite?.url).find(Boolean) || null,
    documentationLinks,
    transactionLevelSoldEvidenceAvailability: selectAuthoritativeClaim(records, FACT_KEY.TRANSACTION_LEVEL_EVIDENCE),
    acceptedOfferVisibility: selectAuthoritativeClaim(records, FACT_KEY.ACCEPTED_OFFER_VISIBILITY),
    apiAvailability: selectAuthoritativeClaim(records, FACT_KEY.API_AVAILABILITY, new Set([EVIDENCE_CLASS.OFFICIAL_API_DOCUMENTATION, EVIDENCE_CLASS.PROVIDER_CORRESPONDENCE])),
    licensingStatus: selectAuthoritativeClaim(records, FACT_KEY.LICENSING_STATUS, PERMISSION_EVIDENCE_CLASSES),
    commercialUseStatus: selectAuthoritativeClaim(records, FACT_KEY.COMMERCIAL_USE, PERMISSION_EVIDENCE_CLASSES),
    internalUseStatus: selectAuthoritativeClaim(records, FACT_KEY.INTERNAL_USE, PERMISSION_EVIDENCE_CLASSES),
    attributionRequirements: textConclusion(records, FACT_KEY.ATTRIBUTION_REQUIREMENTS, officialDocs),
    redistributionRestrictions: textConclusion(records, FACT_KEY.REDISTRIBUTION_RESTRICTIONS, officialDocs),
    pricingModel: textConclusion(records, FACT_KEY.PRICING_MODEL, new Set([EVIDENCE_CLASS.OFFICIAL_PRICING, EVIDENCE_CLASS.PROVIDER_CORRESPONDENCE])),
    evaluationDate: options.evaluationDate || new Date().toISOString(),
    evaluator: options.evaluator || firstRecord.researcher || null,
    qualificationStatus: 'research',
    blockingReasons: [],
    recommendedNextAction: 'complete_source_decision_dossier'
  };

  summary.unknownFacts = identifyUnknownFacts(summary);
  return summary;
}

function buildSourceEvidencePacketFingerprint(packet = {}) {
  const input = asObject(packet);
  return buildFingerprintFromProjection({
    source: input.source || PACKET_SOURCE,
    version: input.version || EVIDENCE_PACKET_VERSION,
    packetId: input.packetId || null,
    providerIdentity: input.providerIdentity || {},
    records: asArray(input.records).map((record) => record.stableFingerprint || null),
    rawClaims: input.rawClaims || [],
    operatorConclusions: input.operatorConclusions || {},
    contradictions: input.contradictions || [],
    staleOrUndatedEvidence: input.staleOrUndatedEvidence || [],
    unknownFacts: input.unknownFacts || [],
    dossierSummary: input.dossierSummary || {}
  });
}

function createSourceEvidencePacket(input = {}, options = {}) {
  const source = asObject(input);
  const records = asArray(source.records || source.researchRecords).map((record) => (
    record && record.stableFingerprint ? clone(record) : createSourceResearchRecord(record, options)
  ));
  const firstRecord = records[0] || {};
  const providerIdentity = {
    providerId: source.providerId || firstRecord.providerIdentity?.providerId || 'unknown_provider',
    providerName: source.providerName || firstRecord.providerIdentity?.providerName || 'Unknown provider',
    providerCategory: source.providerCategory || firstRecord.providerIdentity?.providerCategory || 'unknown_category',
    marketplace: source.marketplace || firstRecord.providerIdentity?.marketplace || null
  };
  const rawClaims = collectRawClaims(records);
  const contradictions = identifyContradictions(records);
  const staleOrUndatedEvidence = identifyStaleOrUndatedEvidence(records, options);
  const dossierSummary = buildDossierSummary(records, {
    intendedPurpose: source.intendedUse || source.intendedPurpose,
    evaluationDate: options.evaluationDate || source.evaluationDate,
    evaluator: options.evaluator || source.evaluator
  });
  const unknownFacts = unique([
    ...dossierSummary.unknownFacts,
    ...asArray(source.unknownFacts)
  ]).sort();
  const packet = {
    source: PACKET_SOURCE,
    version: EVIDENCE_PACKET_VERSION,
    schemaVersion: EVIDENCE_PACKET_VERSION,
    packetId: source.packetId || `source_evidence:${providerIdentity.providerId}`,
    providerIdentity,
    records,
    rawClaims,
    operatorConclusions: asObject(source.operatorConclusions),
    contradictions,
    staleOrUndatedEvidence,
    unknownFacts,
    dossierSummary: {
      ...dossierSummary,
      blockingReasons: unique([
        ...asArray(dossierSummary.blockingReasons),
        ...unknownFacts.map((fact) => `unknown_${fact}`),
        ...(contradictions.length ? ['contradictory_source_evidence'] : []),
        ...(staleOrUndatedEvidence.length ? ['stale_or_undated_source_evidence'] : [])
      ]).sort()
    },
    createdAt: options.createdAt || source.createdAt || new Date().toISOString(),
    updatedAt: options.updatedAt || source.updatedAt || options.createdAt || source.createdAt || new Date().toISOString(),
    ...buildOfflineAuthorityFlags()
  };

  packet.stableFingerprint = buildSourceEvidencePacketFingerprint(packet);
  return packet;
}

function summarizeEvidencePacketForDossier(packet = {}) {
  return clone(asObject(packet).dossierSummary || {});
}

module.exports = {
  CLAIM_AUTHORITY,
  EVIDENCE_CLASS,
  EVIDENCE_PACKET_VERSION,
  FACT_KEY,
  PACKET_SOURCE,
  RESEARCH_RECORD_VERSION,
  SOURCE,
  buildSourceEvidencePacketFingerprint,
  buildSourceResearchRecordFingerprint,
  createSourceEvidencePacket,
  createSourceResearchRecord,
  identifyContradictions,
  identifyStaleOrUndatedEvidence,
  identifyUnknownFacts,
  summarizeEvidencePacketForDossier
};
