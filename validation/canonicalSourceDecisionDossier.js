'use strict';

const path = require('node:path');

const stateStore = require('../utils/stateStore');
const serializationInstrumentation = require('../utils/serializationInstrumentation');
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

const SOURCE = 'canonical_source_decision_dossier';
const STORE_SOURCE = 'canonical_source_decision_dossier_store';
const DECISION_DOSSIER_VERSION = '1.0.0';
const STORE_VERSION = '1.0.0';
const DEFAULT_DOSSIER_STORE_PATH = path.join(__dirname, '..', 'data', 'canonical-source-decision-dossiers.json');

const QUALIFICATION_STATUS = Object.freeze({
  RESEARCH: 'research',
  CANDIDATE: 'candidate',
  QUALIFIED_FOR_REVIEW: 'qualified_for_review',
  BLOCKED: 'blocked',
  REJECTED: 'rejected',
  APPROVED_FOR_PROVIDER_EVALUATION: 'approved_for_provider_evaluation'
});

const RECOMMENDED_ACTION = Object.freeze({
  COMPLETE_DOSSIER: 'complete_source_decision_dossier',
  REQUEST_PERMISSION_DOCUMENTATION: 'request_permission_documentation',
  CONTINUE_RESEARCH: 'continue_source_research',
  REVIEW_WITH_DALTON: 'review_with_dalton',
  SEND_TO_PROVIDER_EVALUATION: 'send_to_provider_evaluation',
  REJECT_SOURCE: 'reject_source'
});

function normalizeText(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeStatus(value, fallback = 'unknown') {
  return normalizeText(value, fallback).toLowerCase().replace(/\s+/g, '_');
}

function normalizeDocumentationLinks(value = []) {
  return asArray(value).map((entry) => {
    if (typeof entry === 'string') {
      return {
        label: null,
        url: entry,
        type: null,
        notes: null
      };
    }
    const input = asObject(entry);
    return {
      label: normalizeText(input.label || input.name),
      url: normalizeText(input.url || input.href),
      type: normalizeText(input.type),
      notes: normalizeText(input.notes)
    };
  }).filter((entry) => entry.url || entry.label || entry.notes);
}

function buildDecisionDossierId(input = {}) {
  const providerName = normalizeStatus(input.providerName || input.name || 'unknown_provider');
  const providerCategory = normalizeStatus(input.providerCategory || input.category || 'unknown_category');
  return `${providerCategory}:${providerName}`;
}

function buildDecisionDossierFingerprint(dossier = {}) {
  const input = asObject(dossier);
  return buildFingerprintFromProjection({
    schemaVersion: input.schemaVersion || DECISION_DOSSIER_VERSION,
    dossierId: input.dossierId || buildDecisionDossierId(input),
    providerName: input.providerName || null,
    providerCategory: input.providerCategory || null,
    intendedPurpose: input.intendedPurpose || null,
    transactionLevelSoldEvidenceAvailability: input.transactionLevelSoldEvidenceAvailability || null,
    acceptedOfferVisibility: input.acceptedOfferVisibility || null,
    apiAvailability: input.apiAvailability || null,
    licensingStatus: input.licensingStatus || null,
    commercialUseStatus: input.commercialUseStatus || null,
    internalUseStatus: input.internalUseStatus || null,
    attributionRequirements: input.attributionRequirements || null,
    redistributionRestrictions: input.redistributionRestrictions || null,
    technicalReadiness: input.technicalReadiness || null,
    providerMaturity: input.providerMaturity || null,
    pricingModel: input.pricingModel || null,
    documentationLinks: input.documentationLinks || [],
    evaluationDate: input.evaluationDate || null,
    evaluator: input.evaluator || null,
    qualificationStatus: input.qualificationStatus || QUALIFICATION_STATUS.RESEARCH,
    blockingReasons: input.blockingReasons || [],
    recommendedNextAction: input.recommendedNextAction || RECOMMENDED_ACTION.CONTINUE_RESEARCH,
    authority: {
      productionApproval: input.productionApproval === true,
      liveIngestionAuthority: input.liveIngestionAuthority === true,
      marketplaceRequestAuthority: input.marketplaceRequestAuthority === true,
      automaticStoreWriteAuthority: input.automaticStoreWriteAuthority === true,
      canonicalSoldEvidenceWriteAuthority: input.canonicalSoldEvidenceWriteAuthority === true
    }
  });
}

function createEmptyDecisionDossierStore(overrides = {}) {
  const now = overrides.createdAt || new Date().toISOString();
  return {
    source: STORE_SOURCE,
    version: STORE_VERSION,
    schemaVersion: DECISION_DOSSIER_VERSION,
    createdAt: now,
    updatedAt: overrides.updatedAt || now,
    dossiers: {},
    indexes: {
      byProviderCategory: {},
      byQualificationStatus: {},
      byCommercialUseStatus: {}
    },
    stats: {
      dossierCount: 0
    }
  };
}

function addIndexValue(index, key, dossierId) {
  if (!key || !dossierId) return;
  if (!index[key]) index[key] = [];
  if (!index[key].includes(dossierId)) index[key].push(dossierId);
}

function refreshStoreIndexes(store = createEmptyDecisionDossierStore()) {
  store.indexes = {
    byProviderCategory: {},
    byQualificationStatus: {},
    byCommercialUseStatus: {}
  };

  for (const dossier of Object.values(asObject(store.dossiers))) {
    addIndexValue(store.indexes.byProviderCategory, dossier.providerCategory, dossier.dossierId);
    addIndexValue(store.indexes.byQualificationStatus, dossier.qualificationStatus, dossier.dossierId);
    addIndexValue(store.indexes.byCommercialUseStatus, dossier.commercialUseStatus, dossier.dossierId);
  }

  return store;
}

function refreshStoreStats(store = createEmptyDecisionDossierStore()) {
  store.stats = {
    dossierCount: Object.keys(asObject(store.dossiers)).length
  };
  return store;
}

function normalizeDecisionDossierStore(store = {}) {
  const normalized = {
    ...createEmptyDecisionDossierStore(),
    ...asObject(store),
    source: store.source || STORE_SOURCE,
    version: store.version || STORE_VERSION,
    schemaVersion: store.schemaVersion || DECISION_DOSSIER_VERSION,
    dossiers: asObject(store.dossiers)
  };

  refreshStoreIndexes(normalized);
  refreshStoreStats(normalized);
  return normalized;
}

function createDecisionDossier(input = {}, options = {}) {
  const source = asObject(input);
  const authority = buildOfflineAuthorityFlags(source.authority || source.offlineAuthority || {});
  const now = options.createdAt || source.createdAt || new Date().toISOString();
  const dossier = {
    source: SOURCE,
    version: DECISION_DOSSIER_VERSION,
    schemaVersion: DECISION_DOSSIER_VERSION,
    dossierId: normalizeText(source.dossierId) || buildDecisionDossierId(source),
    providerName: normalizeText(firstDefined(source.providerName, source.name, 'Unknown provider')),
    providerCategory: normalizeStatus(firstDefined(source.providerCategory, source.category, 'unknown_category')),
    intendedPurpose: normalizeText(source.intendedPurpose || source.purpose),
    transactionLevelSoldEvidenceAvailability: normalizeStatus(firstDefined(source.transactionLevelSoldEvidenceAvailability, source.transactionLevelSoldEvidence, 'unknown')),
    acceptedOfferVisibility: normalizeStatus(firstDefined(source.acceptedOfferVisibility, source.bestOfferVisibility, 'unknown')),
    apiAvailability: normalizeStatus(firstDefined(source.apiAvailability, source.apiStatus, 'unknown')),
    licensingStatus: normalizeStatus(firstDefined(source.licensingStatus, source.licenseStatus, 'unknown')),
    commercialUseStatus: normalizeStatus(firstDefined(source.commercialUseStatus, source.commercialUse, 'unknown')),
    internalUseStatus: normalizeStatus(firstDefined(source.internalUseStatus, source.internalUse, 'unknown')),
    attributionRequirements: normalizeText(source.attributionRequirements),
    redistributionRestrictions: normalizeText(source.redistributionRestrictions),
    technicalReadiness: normalizeStatus(firstDefined(source.technicalReadiness, 'unknown')),
    providerMaturity: normalizeStatus(firstDefined(source.providerMaturity, 'unknown')),
    pricingModel: normalizeText(source.pricingModel),
    documentationLinks: normalizeDocumentationLinks(source.documentationLinks || source.documentation || source.links),
    evaluationDate: normalizeText(source.evaluationDate || options.evaluationDate),
    evaluator: normalizeText(source.evaluator || options.evaluator),
    qualificationStatus: normalizeStatus(firstDefined(source.qualificationStatus, QUALIFICATION_STATUS.RESEARCH)),
    blockingReasons: unique(asArray(source.blockingReasons).map((reason) => normalizeStatus(reason)).filter(Boolean)).sort(),
    recommendedNextAction: normalizeStatus(firstDefined(source.recommendedNextAction, RECOMMENDED_ACTION.CONTINUE_RESEARCH)),
    productionApproval: authority.productionApproval,
    liveIngestionAuthority: authority.liveIngestionAuthority,
    marketplaceRequestAuthority: authority.marketplaceRequestAuthority,
    automaticStoreWriteAuthority: authority.automaticStoreWriteAuthority,
    canonicalSoldEvidenceWriteAuthority: authority.canonicalSoldEvidenceWriteAuthority,
    createdAt: now,
    updatedAt: options.updatedAt || source.updatedAt || now
  };

  dossier.stableFingerprint = buildDecisionDossierFingerprint(dossier);
  return dossier;
}

function validateDecisionDossier(dossier = {}) {
  const input = asObject(dossier);
  const reasons = [];
  for (const field of ['dossierId', 'providerName', 'providerCategory', 'qualificationStatus']) {
    if (!input[field]) reasons.push(`missing_decision_dossier_${field}`);
  }
  if (!input.stableFingerprint) reasons.push('missing_decision_dossier_fingerprint');
  if (input.stableFingerprint && input.stableFingerprint !== buildDecisionDossierFingerprint(input)) {
    reasons.push('decision_dossier_fingerprint_mismatch');
  }

  return {
    valid: reasons.length === 0,
    reasons,
    dossierId: input.dossierId || null,
    stableFingerprint: input.stableFingerprint || null
  };
}

function addDecisionDossier(store = createEmptyDecisionDossierStore(), dossier = {}, options = {}) {
  const normalized = normalizeDecisionDossierStore(clone(store));
  const record = dossier.stableFingerprint ? clone(dossier) : createDecisionDossier(dossier, options);
  const dossierId = String(record.dossierId || '');

  if (normalized.dossiers[dossierId] && options.allowReplace !== true) {
    return {
      added: false,
      reason: 'decision_dossier_already_exists',
      validation: validateDecisionDossier(normalized.dossiers[dossierId]),
      store: normalized,
      dossier: clone(normalized.dossiers[dossierId])
    };
  }

  const validation = validateDecisionDossier(record);
  if (!validation.valid) {
    return {
      added: false,
      reason: 'invalid_decision_dossier',
      validation,
      store: normalized,
      dossier: record
    };
  }

  normalized.dossiers[dossierId] = clone(record);
  normalized.updatedAt = options.updatedAt || new Date().toISOString();
  refreshStoreIndexes(normalized);
  refreshStoreStats(normalized);

  return {
    added: true,
    reason: null,
    validation,
    store: normalized,
    dossier: clone(normalized.dossiers[dossierId])
  };
}

function updateDecisionDossier(store = createEmptyDecisionDossierStore(), dossierId, updates = {}, options = {}) {
  const normalized = normalizeDecisionDossierStore(clone(store));
  const existing = normalized.dossiers[String(dossierId || '')];
  if (!existing) {
    return {
      updated: false,
      reason: 'decision_dossier_not_found',
      store: normalized,
      dossier: null
    };
  }

  const merged = {
    ...existing,
    ...asObject(updates),
    dossierId: existing.dossierId,
    createdAt: existing.createdAt,
    updatedAt: options.updatedAt || updates.updatedAt || new Date().toISOString()
  };
  const dossier = createDecisionDossier(merged, {
    ...options,
    createdAt: existing.createdAt,
    updatedAt: merged.updatedAt
  });
  const result = addDecisionDossier(normalized, dossier, {
    ...options,
    allowReplace: true,
    updatedAt: dossier.updatedAt
  });

  return {
    updated: result.added,
    reason: result.reason,
    validation: result.validation,
    store: result.store,
    dossier: result.dossier
  };
}

function getDecisionDossier(store = {}, dossierId) {
  const normalized = normalizeDecisionDossierStore(store);
  const dossier = normalized.dossiers[String(dossierId || '')];
  return dossier ? clone(dossier) : null;
}

function listDecisionDossiers(store = {}, filters = {}) {
  const normalized = normalizeDecisionDossierStore(store);
  let dossiers = Object.values(normalized.dossiers);

  if (filters.providerCategory) dossiers = dossiers.filter((dossier) => dossier.providerCategory === filters.providerCategory);
  if (filters.qualificationStatus) dossiers = dossiers.filter((dossier) => dossier.qualificationStatus === filters.qualificationStatus);
  if (filters.commercialUseStatus) dossiers = dossiers.filter((dossier) => dossier.commercialUseStatus === filters.commercialUseStatus);
  if (filters.internalUseStatus) dossiers = dossiers.filter((dossier) => dossier.internalUseStatus === filters.internalUseStatus);
  if (filters.technicalReadiness) dossiers = dossiers.filter((dossier) => dossier.technicalReadiness === filters.technicalReadiness);

  dossiers = dossiers.sort((left, right) => {
    const nameComparison = String(left.providerName || '').localeCompare(String(right.providerName || ''));
    if (nameComparison !== 0) return nameComparison;
    return String(left.dossierId || '').localeCompare(String(right.dossierId || ''));
  });

  if (Number.isFinite(Number(filters.limit)) && Number(filters.limit) >= 0) {
    dossiers = dossiers.slice(0, Number(filters.limit));
  }

  return dossiers.map(clone);
}

function loadDecisionDossierStore(filePath = DEFAULT_DOSSIER_STORE_PATH) {
  return serializationInstrumentation.withSerializationGroup('SourceDecisionDossier', () =>
    normalizeDecisionDossierStore(stateStore.loadJsonState(filePath, createEmptyDecisionDossierStore()))
  );
}

function saveDecisionDossierStore(filePath = DEFAULT_DOSSIER_STORE_PATH, store = createEmptyDecisionDossierStore()) {
  return serializationInstrumentation.withSerializationGroup('SourceDecisionDossier', () =>
    stateStore.saveJsonState(filePath, normalizeDecisionDossierStore(store))
  );
}

module.exports = {
  DEFAULT_DOSSIER_STORE_PATH,
  DECISION_DOSSIER_VERSION,
  QUALIFICATION_STATUS,
  RECOMMENDED_ACTION,
  SOURCE,
  STORE_SOURCE,
  STORE_VERSION,
  addDecisionDossier,
  buildDecisionDossierFingerprint,
  createDecisionDossier,
  createEmptyDecisionDossierStore,
  getDecisionDossier,
  listDecisionDossiers,
  loadDecisionDossierStore,
  saveDecisionDossierStore,
  updateDecisionDossier
};
