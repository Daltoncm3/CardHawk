'use strict';

const {
  asArray,
  asObject,
  missingFields,
  unique
} = require('./canonicalValidationCore');
const {
  buildFingerprintFromProjection
} = require('./fingerprintProjection');

const LISTING_STORE_ARCHITECTURE_SCHEMA_VERSION = '1.0.0';
const LISTING_STORE_ARCHITECTURE_SOURCE = 'listing_store_architecture';
const UNKNOWN_VALUE = 'unknown';

const LISTING_STORE_CONCEPT = Object.freeze({
  SCAN_WORKING_SET: 'scan_working_set',
  ACTIVE_LISTING_STORE: 'active_listing_store',
  HISTORICAL_LISTING_STORE: 'historical_listing_store',
  ARCHIVED_LISTING_STORE: 'archived_listing_store'
});

const LISTING_LIFECYCLE_STATE = Object.freeze({
  SCAN_WORKING_SET: 'scan_working_set',
  ACTIVE: 'active',
  OBSERVED: 'observed',
  STALE: 'stale',
  DISAPPEARED: 'disappeared',
  ARCHIVED: 'archived',
  UNKNOWN: UNKNOWN_VALUE
});

const MEMORY_RESIDENCY_POLICY = Object.freeze({
  SCAN_LOCAL_ONLY: 'scan_local_only',
  ACTIVE_IN_MEMORY: 'active_in_memory',
  COMPACT_IN_MEMORY: 'compact_in_memory',
  ARCHIVE_ONLY: 'archive_only',
  LAZY_LOAD_ON_DEMAND: 'lazy_load_on_demand',
  NOT_RESIDENT: 'not_resident'
});

const PERSISTENCE_RESPONSIBILITY = Object.freeze({
  NONE: 'none',
  ACTIVE_STATE: 'active_state',
  HISTORICAL_STATE: 'historical_state',
  ARCHIVE_STATE: 'archive_state',
  READ_ONLY_LOOKUP: 'read_only_lookup'
});

const RETRIEVAL_RESPONSIBILITY = Object.freeze({
  SCAN_PIPELINE: 'scan_pipeline',
  ACTIVE_STORE_LOOKUP: 'active_store_lookup',
  HISTORY_LOOKUP: 'history_lookup',
  ARCHIVE_LOOKUP: 'archive_lookup',
  LAZY_LOAD_LOOKUP: 'lazy_load_lookup'
});

const ARCHIVE_ELIGIBILITY = Object.freeze({
  NOT_ELIGIBLE: 'not_eligible',
  ELIGIBLE: 'eligible',
  REQUIRED: 'required',
  ALREADY_ARCHIVED: 'already_archived',
  UNKNOWN: UNKNOWN_VALUE
});

const REQUIRED_MODEL_FIELDS = Object.freeze([
  'modelId',
  'modelName',
  'stores',
  'lifecycleStates',
  'promotionDemotionRules',
  'archiveEligibilityRules',
  'memoryResidencyPolicies',
  'persistenceResponsibilities',
  'retrievalResponsibilities',
  'futureLazyLoadingSupport',
  'productionAuthority',
  'notes'
]);

const REQUIRED_STORE_FIELDS = Object.freeze([
  'storeId',
  'storeName',
  'concept',
  'owner',
  'memoryResidencyPolicy',
  'persistenceResponsibility',
  'retrievalResponsibility',
  'description'
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeText(value, fallback = UNKNOWN_VALUE) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  return fallback;
}

function normalizeList(value) {
  return asArray(value).map((item) => String(item)).filter(Boolean);
}

function normalizeObjectList(value) {
  return asArray(value)
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ ...item }));
}

function buildListingStoreFingerprint(model = {}) {
  const projection = clone(model);
  delete projection.fingerprint;
  delete projection.stableFingerprint;
  return buildFingerprintFromProjection(projection);
}

function defaultStores() {
  return [
    {
      storeId: LISTING_STORE_CONCEPT.SCAN_WORKING_SET,
      storeName: 'Scan Working Set',
      concept: LISTING_STORE_CONCEPT.SCAN_WORKING_SET,
      owner: 'scanner lifecycle',
      memoryResidencyPolicy: MEMORY_RESIDENCY_POLICY.SCAN_LOCAL_ONLY,
      persistenceResponsibility: PERSISTENCE_RESPONSIBILITY.NONE,
      retrievalResponsibility: RETRIEVAL_RESPONSIBILITY.SCAN_PIPELINE,
      description: 'Per-scan candidate data that should be released when the scan completes.'
    },
    {
      storeId: LISTING_STORE_CONCEPT.ACTIVE_LISTING_STORE,
      storeName: 'Active Listing Store',
      concept: LISTING_STORE_CONCEPT.ACTIVE_LISTING_STORE,
      owner: 'current production store.listings compatibility layer',
      memoryResidencyPolicy: MEMORY_RESIDENCY_POLICY.ACTIVE_IN_MEMORY,
      persistenceResponsibility: PERSISTENCE_RESPONSIBILITY.ACTIVE_STATE,
      retrievalResponsibility: RETRIEVAL_RESPONSIBILITY.ACTIVE_STORE_LOOKUP,
      description: 'Current active listings that production reads without lazy loading.'
    },
    {
      storeId: LISTING_STORE_CONCEPT.HISTORICAL_LISTING_STORE,
      storeName: 'Historical Listing Store',
      concept: LISTING_STORE_CONCEPT.HISTORICAL_LISTING_STORE,
      owner: 'future compact listing history repository',
      memoryResidencyPolicy: MEMORY_RESIDENCY_POLICY.COMPACT_IN_MEMORY,
      persistenceResponsibility: PERSISTENCE_RESPONSIBILITY.HISTORICAL_STATE,
      retrievalResponsibility: RETRIEVAL_RESPONSIBILITY.HISTORY_LOOKUP,
      description: 'Compact summaries for recently seen, stale, or disappeared listings.'
    },
    {
      storeId: LISTING_STORE_CONCEPT.ARCHIVED_LISTING_STORE,
      storeName: 'Archived Listing Store',
      concept: LISTING_STORE_CONCEPT.ARCHIVED_LISTING_STORE,
      owner: 'future archive repository',
      memoryResidencyPolicy: MEMORY_RESIDENCY_POLICY.LAZY_LOAD_ON_DEMAND,
      persistenceResponsibility: PERSISTENCE_RESPONSIBILITY.ARCHIVE_STATE,
      retrievalResponsibility: RETRIEVAL_RESPONSIBILITY.LAZY_LOAD_LOOKUP,
      description: 'Durable historical records that should not remain permanently resident in RAM.'
    }
  ];
}

function defaultLifecycleStates() {
  return [
    LISTING_LIFECYCLE_STATE.SCAN_WORKING_SET,
    LISTING_LIFECYCLE_STATE.ACTIVE,
    LISTING_LIFECYCLE_STATE.OBSERVED,
    LISTING_LIFECYCLE_STATE.STALE,
    LISTING_LIFECYCLE_STATE.DISAPPEARED,
    LISTING_LIFECYCLE_STATE.ARCHIVED
  ];
}

function defaultPromotionDemotionRules() {
  return [
    {
      ruleId: 'scan_to_active',
      fromState: LISTING_LIFECYCLE_STATE.SCAN_WORKING_SET,
      toState: LISTING_LIFECYCLE_STATE.ACTIVE,
      condition: 'listing_is_currently_active_and_selected_for_retention',
      productionBehaviorChange: false
    },
    {
      ruleId: 'active_to_historical',
      fromState: LISTING_LIFECYCLE_STATE.ACTIVE,
      toState: LISTING_LIFECYCLE_STATE.OBSERVED,
      condition: 'listing_no_longer_needs_full_active_memory_but_recent_history_remains_useful',
      productionBehaviorChange: false
    },
    {
      ruleId: 'historical_to_archive',
      fromState: LISTING_LIFECYCLE_STATE.OBSERVED,
      toState: LISTING_LIFECYCLE_STATE.ARCHIVED,
      condition: 'listing_exceeds_active_or_historical_retention_policy',
      productionBehaviorChange: false
    },
    {
      ruleId: 'stale_or_disappeared_to_archive',
      fromState: LISTING_LIFECYCLE_STATE.STALE,
      toState: LISTING_LIFECYCLE_STATE.ARCHIVED,
      alternativeFromStates: [LISTING_LIFECYCLE_STATE.DISAPPEARED],
      condition: 'listing_is_no_longer_active_and_is_beyond_recent_history_window',
      productionBehaviorChange: false
    }
  ];
}

function defaultArchiveEligibilityRules() {
  return [
    {
      ruleId: 'scan_local_not_archived',
      states: [LISTING_LIFECYCLE_STATE.SCAN_WORKING_SET],
      eligibility: ARCHIVE_ELIGIBILITY.NOT_ELIGIBLE,
      reason: 'scan_working_set_is_call_local'
    },
    {
      ruleId: 'active_not_archived',
      states: [LISTING_LIFECYCLE_STATE.ACTIVE],
      eligibility: ARCHIVE_ELIGIBILITY.NOT_ELIGIBLE,
      reason: 'active_listing_remains_in_active_store'
    },
    {
      ruleId: 'observed_archive_eligible',
      states: [LISTING_LIFECYCLE_STATE.OBSERVED],
      eligibility: ARCHIVE_ELIGIBILITY.ELIGIBLE,
      reason: 'recent_history_can_be_compacted_or_archived_after_retention_window'
    },
    {
      ruleId: 'stale_or_disappeared_archive_required',
      states: [LISTING_LIFECYCLE_STATE.STALE, LISTING_LIFECYCLE_STATE.DISAPPEARED],
      eligibility: ARCHIVE_ELIGIBILITY.REQUIRED,
      reason: 'inactive_listing_should_not_remain_full_fidelity_in_ram_indefinitely'
    },
    {
      ruleId: 'archived_already_archived',
      states: [LISTING_LIFECYCLE_STATE.ARCHIVED],
      eligibility: ARCHIVE_ELIGIBILITY.ALREADY_ARCHIVED,
      reason: 'listing_is_already_archive_resident'
    }
  ];
}

function defaultMemoryResidencyPolicies() {
  return {
    [LISTING_LIFECYCLE_STATE.SCAN_WORKING_SET]: MEMORY_RESIDENCY_POLICY.SCAN_LOCAL_ONLY,
    [LISTING_LIFECYCLE_STATE.ACTIVE]: MEMORY_RESIDENCY_POLICY.ACTIVE_IN_MEMORY,
    [LISTING_LIFECYCLE_STATE.OBSERVED]: MEMORY_RESIDENCY_POLICY.COMPACT_IN_MEMORY,
    [LISTING_LIFECYCLE_STATE.STALE]: MEMORY_RESIDENCY_POLICY.LAZY_LOAD_ON_DEMAND,
    [LISTING_LIFECYCLE_STATE.DISAPPEARED]: MEMORY_RESIDENCY_POLICY.LAZY_LOAD_ON_DEMAND,
    [LISTING_LIFECYCLE_STATE.ARCHIVED]: MEMORY_RESIDENCY_POLICY.ARCHIVE_ONLY
  };
}

function defaultPersistenceResponsibilities() {
  return {
    [LISTING_LIFECYCLE_STATE.SCAN_WORKING_SET]: PERSISTENCE_RESPONSIBILITY.NONE,
    [LISTING_LIFECYCLE_STATE.ACTIVE]: PERSISTENCE_RESPONSIBILITY.ACTIVE_STATE,
    [LISTING_LIFECYCLE_STATE.OBSERVED]: PERSISTENCE_RESPONSIBILITY.HISTORICAL_STATE,
    [LISTING_LIFECYCLE_STATE.STALE]: PERSISTENCE_RESPONSIBILITY.ARCHIVE_STATE,
    [LISTING_LIFECYCLE_STATE.DISAPPEARED]: PERSISTENCE_RESPONSIBILITY.ARCHIVE_STATE,
    [LISTING_LIFECYCLE_STATE.ARCHIVED]: PERSISTENCE_RESPONSIBILITY.ARCHIVE_STATE
  };
}

function defaultRetrievalResponsibilities() {
  return {
    [LISTING_LIFECYCLE_STATE.SCAN_WORKING_SET]: RETRIEVAL_RESPONSIBILITY.SCAN_PIPELINE,
    [LISTING_LIFECYCLE_STATE.ACTIVE]: RETRIEVAL_RESPONSIBILITY.ACTIVE_STORE_LOOKUP,
    [LISTING_LIFECYCLE_STATE.OBSERVED]: RETRIEVAL_RESPONSIBILITY.HISTORY_LOOKUP,
    [LISTING_LIFECYCLE_STATE.STALE]: RETRIEVAL_RESPONSIBILITY.LAZY_LOAD_LOOKUP,
    [LISTING_LIFECYCLE_STATE.DISAPPEARED]: RETRIEVAL_RESPONSIBILITY.LAZY_LOAD_LOOKUP,
    [LISTING_LIFECYCLE_STATE.ARCHIVED]: RETRIEVAL_RESPONSIBILITY.ARCHIVE_LOOKUP
  };
}

function createListingStoreModel(input = {}) {
  const model = {
    source: LISTING_STORE_ARCHITECTURE_SOURCE,
    schemaVersion: LISTING_STORE_ARCHITECTURE_SCHEMA_VERSION,
    modelId: normalizeText(input.modelId, 'production_listing_store_refactor_phase_11_3'),
    modelName: normalizeText(input.modelName, 'Production Listing Store Refactor Architecture'),
    stores: normalizeObjectList(input.stores).length ? normalizeObjectList(input.stores) : defaultStores(),
    lifecycleStates: normalizeList(input.lifecycleStates).length ? normalizeList(input.lifecycleStates) : defaultLifecycleStates(),
    promotionDemotionRules: normalizeObjectList(input.promotionDemotionRules).length
      ? normalizeObjectList(input.promotionDemotionRules)
      : defaultPromotionDemotionRules(),
    archiveEligibilityRules: normalizeObjectList(input.archiveEligibilityRules).length
      ? normalizeObjectList(input.archiveEligibilityRules)
      : defaultArchiveEligibilityRules(),
    memoryResidencyPolicies: {
      ...defaultMemoryResidencyPolicies(),
      ...asObject(input.memoryResidencyPolicies)
    },
    persistenceResponsibilities: {
      ...defaultPersistenceResponsibilities(),
      ...asObject(input.persistenceResponsibilities)
    },
    retrievalResponsibilities: {
      ...defaultRetrievalResponsibilities(),
      ...asObject(input.retrievalResponsibilities)
    },
    futureLazyLoadingSupport: normalizeBoolean(input.futureLazyLoadingSupport, true),
    productionAuthority: normalizeText(input.productionAuthority, 'architecture_only_no_runtime_authority'),
    notes: normalizeList(input.notes).length
      ? normalizeList(input.notes)
      : [
          'Offline architecture model only.',
          'Does not inspect or modify live listing data.',
          'Does not change server.js, scanner timing, scoring, valuation, Deal Gate, BUY_NOW, marketplace behavior, or persistence.'
        ],
    stableFingerprint: ''
  };

  model.stableFingerprint = buildListingStoreFingerprint(model);
  return Object.freeze(model);
}

function validateListingStoreModel(model = {}) {
  const input = asObject(model);
  const errors = [];
  const warnings = [];
  const requiredMissing = missingFields(input, REQUIRED_MODEL_FIELDS);

  if (requiredMissing.length) {
    errors.push(...requiredMissing.map((field) => `missing_${field}`));
  }

  if (input.source && input.source !== LISTING_STORE_ARCHITECTURE_SOURCE) {
    errors.push('invalid_source');
  }

  if (input.schemaVersion && input.schemaVersion !== LISTING_STORE_ARCHITECTURE_SCHEMA_VERSION) {
    errors.push('invalid_schemaVersion');
  }

  if (input.stableFingerprint && input.stableFingerprint !== buildListingStoreFingerprint(input)) {
    errors.push('fingerprint_mismatch');
  }

  const lifecycleStates = new Set(asArray(input.lifecycleStates));
  const storeConcepts = new Set();
  for (const store of asArray(input.stores)) {
    const missingStoreFields = missingFields(store, REQUIRED_STORE_FIELDS);
    if (missingStoreFields.length) {
      errors.push(...missingStoreFields.map((field) => `store_${store.storeId || UNKNOWN_VALUE}_missing_${field}`));
    }
    if (store.concept) storeConcepts.add(store.concept);
  }

  for (const concept of Object.values(LISTING_STORE_CONCEPT)) {
    if (!storeConcepts.has(concept)) errors.push(`missing_store_concept_${concept}`);
  }

  for (const state of Object.values(LISTING_LIFECYCLE_STATE).filter((value) => value !== UNKNOWN_VALUE)) {
    if (!lifecycleStates.has(state)) errors.push(`missing_lifecycle_state_${state}`);
  }

  for (const rule of asArray(input.promotionDemotionRules)) {
    if (!rule.ruleId) errors.push('promotion_rule_missing_ruleId');
    if (!lifecycleStates.has(rule.fromState)) errors.push(`promotion_rule_${rule.ruleId || UNKNOWN_VALUE}_invalid_fromState`);
    if (!lifecycleStates.has(rule.toState)) errors.push(`promotion_rule_${rule.ruleId || UNKNOWN_VALUE}_invalid_toState`);
    for (const state of asArray(rule.alternativeFromStates)) {
      if (!lifecycleStates.has(state)) errors.push(`promotion_rule_${rule.ruleId || UNKNOWN_VALUE}_invalid_alternativeFromState`);
    }
    if (rule.productionBehaviorChange === true) errors.push(`promotion_rule_${rule.ruleId || UNKNOWN_VALUE}_changes_production_behavior`);
  }

  for (const rule of asArray(input.archiveEligibilityRules)) {
    if (!rule.ruleId) errors.push('archive_rule_missing_ruleId');
    for (const state of asArray(rule.states)) {
      if (!lifecycleStates.has(state)) errors.push(`archive_rule_${rule.ruleId || UNKNOWN_VALUE}_invalid_state`);
    }
    if (!Object.values(ARCHIVE_ELIGIBILITY).includes(rule.eligibility)) {
      errors.push(`archive_rule_${rule.ruleId || UNKNOWN_VALUE}_invalid_eligibility`);
    }
  }

  for (const state of lifecycleStates) {
    if (!input.memoryResidencyPolicies?.[state]) warnings.push(`missing_memory_residency_policy_${state}`);
    if (!input.persistenceResponsibilities?.[state]) warnings.push(`missing_persistence_responsibility_${state}`);
    if (!input.retrievalResponsibilities?.[state]) warnings.push(`missing_retrieval_responsibility_${state}`);
  }

  if (input.productionAuthority !== 'architecture_only_no_runtime_authority') {
    warnings.push('model_should_not_grant_runtime_authority');
  }

  return {
    valid: errors.length === 0,
    errors: unique(errors),
    warnings: unique(warnings),
    missingFields: requiredMissing
  };
}

function getListingState(listing = {}) {
  const input = asObject(listing);
  const explicit = input.lifecycleState || input.state || input.status;

  if (explicit === LISTING_LIFECYCLE_STATE.ARCHIVED || input.archivedAt || input.archived === true) {
    return LISTING_LIFECYCLE_STATE.ARCHIVED;
  }
  if (explicit === LISTING_LIFECYCLE_STATE.SCAN_WORKING_SET || input.inScanWorkingSet === true) {
    return LISTING_LIFECYCLE_STATE.SCAN_WORKING_SET;
  }
  if (explicit === LISTING_LIFECYCLE_STATE.DISAPPEARED || input.disappearedAt) {
    return LISTING_LIFECYCLE_STATE.DISAPPEARED;
  }
  if (explicit === LISTING_LIFECYCLE_STATE.STALE || input.staleAt || input.stale === true) {
    return LISTING_LIFECYCLE_STATE.STALE;
  }
  if (explicit === LISTING_LIFECYCLE_STATE.OBSERVED || input.lastSeenAt) {
    return LISTING_LIFECYCLE_STATE.OBSERVED;
  }
  if (explicit === LISTING_LIFECYCLE_STATE.ACTIVE || input.active === true || input.isActive === true) {
    return LISTING_LIFECYCLE_STATE.ACTIVE;
  }

  return LISTING_LIFECYCLE_STATE.UNKNOWN;
}

function getArchiveEligibility(state, model) {
  for (const rule of asArray(model.archiveEligibilityRules)) {
    if (asArray(rule.states).includes(state)) {
      return {
        eligibility: rule.eligibility,
        reason: rule.reason || rule.ruleId
      };
    }
  }

  return {
    eligibility: ARCHIVE_ELIGIBILITY.UNKNOWN,
    reason: 'no_archive_rule_for_state'
  };
}

function evaluateListingResidency(listing = {}, modelInput = createListingStoreModel()) {
  const model = modelInput.source === LISTING_STORE_ARCHITECTURE_SOURCE
    ? modelInput
    : createListingStoreModel(modelInput);
  const state = getListingState(listing);
  const archive = getArchiveEligibility(state, model);
  const memoryResidency = model.memoryResidencyPolicies?.[state] || MEMORY_RESIDENCY_POLICY.NOT_RESIDENT;
  const persistenceResponsibility = model.persistenceResponsibilities?.[state] || PERSISTENCE_RESPONSIBILITY.NONE;
  const retrievalResponsibility = model.retrievalResponsibilities?.[state] || RETRIEVAL_RESPONSIBILITY.LAZY_LOAD_LOOKUP;
  const residentStores = [];

  if (state === LISTING_LIFECYCLE_STATE.SCAN_WORKING_SET) {
    residentStores.push(LISTING_STORE_CONCEPT.SCAN_WORKING_SET);
  } else if (state === LISTING_LIFECYCLE_STATE.ACTIVE) {
    residentStores.push(LISTING_STORE_CONCEPT.ACTIVE_LISTING_STORE);
  } else if (state === LISTING_LIFECYCLE_STATE.OBSERVED) {
    residentStores.push(LISTING_STORE_CONCEPT.HISTORICAL_LISTING_STORE);
  } else if (state === LISTING_LIFECYCLE_STATE.STALE || state === LISTING_LIFECYCLE_STATE.DISAPPEARED || state === LISTING_LIFECYCLE_STATE.ARCHIVED) {
    residentStores.push(LISTING_STORE_CONCEPT.ARCHIVED_LISTING_STORE);
  }

  return Object.freeze({
    source: LISTING_STORE_ARCHITECTURE_SOURCE,
    schemaVersion: LISTING_STORE_ARCHITECTURE_SCHEMA_VERSION,
    listingId: listing.listingId || listing.ebayItemId || listing.id || null,
    lifecycleState: state,
    memoryResidency,
    persistenceResponsibility,
    retrievalResponsibility,
    residentStores,
    archiveEligibility: archive.eligibility,
    archiveEligible: archive.eligibility === ARCHIVE_ELIGIBILITY.ELIGIBLE || archive.eligibility === ARCHIVE_ELIGIBILITY.REQUIRED,
    archiveRequired: archive.eligibility === ARCHIVE_ELIGIBILITY.REQUIRED,
    reason: archive.reason,
    productionBehaviorChange: false
  });
}

function summarizeListingStoreModel(modelInput = createListingStoreModel()) {
  const model = modelInput.source === LISTING_STORE_ARCHITECTURE_SOURCE
    ? modelInput
    : createListingStoreModel(modelInput);
  const validation = validateListingStoreModel(model);
  const stores = asArray(model.stores).map((store) => store.storeName).sort();
  const archiveStates = asArray(model.archiveEligibilityRules)
    .filter((rule) => rule.eligibility === ARCHIVE_ELIGIBILITY.ELIGIBLE || rule.eligibility === ARCHIVE_ELIGIBILITY.REQUIRED)
    .flatMap((rule) => asArray(rule.states))
    .sort();

  return {
    source: LISTING_STORE_ARCHITECTURE_SOURCE,
    schemaVersion: LISTING_STORE_ARCHITECTURE_SCHEMA_VERSION,
    modelId: model.modelId,
    valid: validation.valid,
    storeCount: stores.length,
    lifecycleStateCount: asArray(model.lifecycleStates).length,
    promotionDemotionRuleCount: asArray(model.promotionDemotionRules).length,
    archiveEligibilityRuleCount: asArray(model.archiveEligibilityRules).length,
    futureLazyLoadingSupport: model.futureLazyLoadingSupport === true,
    productionAuthority: model.productionAuthority,
    stores,
    archiveEligibleStates: unique(archiveStates),
    text: `Listing store model ${model.modelId} defines ${stores.length} store concepts and ${asArray(model.lifecycleStates).length} lifecycle states with ${model.productionAuthority}.`
  };
}

const CANONICAL_LISTING_STORE_MODEL = createListingStoreModel();

module.exports = {
  ARCHIVE_ELIGIBILITY,
  CANONICAL_LISTING_STORE_MODEL,
  LISTING_LIFECYCLE_STATE,
  LISTING_STORE_ARCHITECTURE_SCHEMA_VERSION,
  LISTING_STORE_ARCHITECTURE_SOURCE,
  LISTING_STORE_CONCEPT,
  MEMORY_RESIDENCY_POLICY,
  PERSISTENCE_RESPONSIBILITY,
  REQUIRED_MODEL_FIELDS,
  RETRIEVAL_RESPONSIBILITY,
  buildListingStoreFingerprint,
  createListingStoreModel,
  evaluateListingResidency,
  summarizeListingStoreModel,
  validateListingStoreModel
};
