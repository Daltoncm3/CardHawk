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

const PRODUCTION_MEMORY_CONTRACT_SCHEMA_VERSION = '1.0.0';
const PRODUCTION_MEMORY_CONTRACT_SOURCE = 'production_memory_contracts';
const UNKNOWN_VALUE = 'unknown';

const REQUIRED_MEMORY_CONTRACT_FIELDS = Object.freeze([
  'componentId',
  'componentName',
  'owner',
  'category',
  'lifetime',
  'persistenceModel',
  'expectedGrowth',
  'maximumRetentionPolicy',
  'archivePolicy',
  'inMemoryPolicy',
  'lazyLoadEligible',
  'streamEligible',
  'compactEligible',
  'boundedRequired',
  'currentCompliance',
  'futurePhase',
  'productionAuthority',
  'notes'
]);

const MEMORY_CATEGORY = Object.freeze({
  PRODUCTION_STORE: 'production_store',
  LISTING_COLLECTION: 'listing_collection',
  OPERATIONAL_WINDOW: 'operational_window',
  LEARNING_STORE: 'learning_store',
  VALIDATION_STORE: 'validation_store',
  HISTORY_STORE: 'history_store',
  PERSISTENCE: 'persistence',
  CACHE: 'cache',
  LOOKUP_MAP: 'lookup_map',
  RETRY_STATE: 'retry_state',
  SCANNER_LIFECYCLE: 'scanner_lifecycle',
  MARKETPLACE_ADAPTER: 'marketplace_adapter',
  PARSER_OUTPUT: 'parser_output',
  SCORING_OBJECT: 'scoring_object',
  VALUATION_OBJECT: 'valuation_object',
  CONFIDENCE_OBJECT: 'confidence_object',
  NOTIFICATION_STATE: 'notification_state',
  HEALTH_STATE: 'health_state',
  SHADOW_STATE: 'shadow_state',
  CANONICAL_EVIDENCE_STORE: 'canonical_evidence_store'
});

const MEMORY_LIFETIME = Object.freeze({
  SCAN_LOCAL: 'scan_local',
  REQUEST_LOCAL: 'request_local',
  PROCESS_LIFETIME: 'process_lifetime',
  PROCESS_AND_RESTART: 'process_and_restart',
  MODULE_LIFETIME: 'module_lifetime',
  PERSISTED: 'persisted'
});

const PERSISTENCE_MODEL = Object.freeze({
  NONE: 'none',
  IN_MEMORY_ONLY: 'in_memory_only',
  WHOLE_FILE_JSON: 'whole_file_json',
  WHOLE_FILE_JSON_BOUNDED: 'whole_file_json_bounded',
  LAZY_WHOLE_FILE_JSON: 'lazy_whole_file_json',
  APPEND_OR_BATCH_REQUIRED: 'append_or_batch_required',
  ARCHIVE_REQUIRED: 'archive_required',
  SEGMENTED_REPOSITORY_REQUIRED: 'segmented_repository_required'
});

const EXPECTED_GROWTH = Object.freeze({
  CONSTANT: 'constant',
  BOUNDED: 'bounded',
  PARTIALLY_BOUNDED: 'partially_bounded',
  UNBOUNDED_CURRENTLY: 'unbounded_currently',
  CONFIGURATION_BOUNDED: 'configuration_bounded',
  UNKNOWN: UNKNOWN_VALUE
});

const COMPLIANCE_STATUS = Object.freeze({
  COMPLIANT: 'compliant',
  PARTIAL: 'partial',
  NON_COMPLIANT: 'non_compliant',
  NEEDS_CONTRACT: 'needs_contract',
  UNKNOWN: UNKNOWN_VALUE
});

const PRODUCTION_AUTHORITY = Object.freeze({
  NONE: 'none',
  PRODUCTION_SUPPORTING: 'production_supporting',
  PRODUCTION_STATE: 'production_state',
  PRODUCTION_DECISION_INPUT: 'production_decision_input',
  PRODUCTION_DECISION_AUTHORITY: 'production_decision_authority'
});

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  return fallback;
}

function normalizeText(value, fallback = UNKNOWN_VALUE) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function normalizeList(value) {
  return asArray(value).map((item) => String(item)).filter(Boolean);
}

function buildMemoryContractFingerprint(contract = {}) {
  const projection = clone(contract);
  delete projection.fingerprint;
  delete projection.stableFingerprint;
  return buildFingerprintFromProjection(projection);
}

function createMemoryContract(input = {}) {
  const contract = {
    source: PRODUCTION_MEMORY_CONTRACT_SOURCE,
    schemaVersion: PRODUCTION_MEMORY_CONTRACT_SCHEMA_VERSION,
    componentId: normalizeText(input.componentId),
    componentName: normalizeText(input.componentName),
    owner: normalizeText(input.owner),
    category: normalizeText(input.category),
    lifetime: normalizeText(input.lifetime),
    persistenceModel: normalizeText(input.persistenceModel),
    expectedGrowth: normalizeText(input.expectedGrowth),
    maximumRetentionPolicy: normalizeText(input.maximumRetentionPolicy),
    archivePolicy: normalizeText(input.archivePolicy),
    inMemoryPolicy: normalizeText(input.inMemoryPolicy),
    lazyLoadEligible: normalizeBoolean(input.lazyLoadEligible),
    streamEligible: normalizeBoolean(input.streamEligible),
    compactEligible: normalizeBoolean(input.compactEligible),
    boundedRequired: normalizeBoolean(input.boundedRequired),
    currentCompliance: normalizeText(input.currentCompliance),
    futurePhase: normalizeText(input.futurePhase),
    productionAuthority: normalizeText(input.productionAuthority, PRODUCTION_AUTHORITY.NONE),
    notes: normalizeList(input.notes),
    stableFingerprint: ''
  };

  contract.stableFingerprint = buildMemoryContractFingerprint(contract);
  return Object.freeze(contract);
}

function validateMemoryContract(contract = {}) {
  const input = asObject(contract);
  const missing = missingFields(input, REQUIRED_MEMORY_CONTRACT_FIELDS);
  const errors = [];
  const warnings = [];

  if (missing.length) {
    errors.push(...missing.map((field) => `missing_${field}`));
  }

  if (input.source && input.source !== PRODUCTION_MEMORY_CONTRACT_SOURCE) {
    errors.push('invalid_source');
  }

  if (input.schemaVersion && input.schemaVersion !== PRODUCTION_MEMORY_CONTRACT_SCHEMA_VERSION) {
    errors.push('invalid_schemaVersion');
  }

  if (input.stableFingerprint && input.stableFingerprint !== buildMemoryContractFingerprint(input)) {
    errors.push('fingerprint_mismatch');
  }

  if (input.boundedRequired === true && input.currentCompliance === COMPLIANCE_STATUS.COMPLIANT && input.expectedGrowth === EXPECTED_GROWTH.UNBOUNDED_CURRENTLY) {
    errors.push('compliant_contract_cannot_have_unbounded_growth');
  }

  if (input.boundedRequired === true && input.maximumRetentionPolicy === UNKNOWN_VALUE) {
    warnings.push('bounded_required_without_known_maximum_retention_policy');
  }

  if (input.currentCompliance === COMPLIANCE_STATUS.NON_COMPLIANT && input.futurePhase === UNKNOWN_VALUE) {
    warnings.push('non_compliant_contract_without_future_phase');
  }

  return {
    valid: errors.length === 0,
    errors: unique(errors),
    warnings: unique(warnings),
    missingFields: missing
  };
}

function evaluateMemoryContractCompliance(contracts = []) {
  const list = asArray(contracts);
  const byStatus = {};
  const byCategory = {};
  const violations = [];
  const boundedRequired = [];
  const archiveRequired = [];
  const lazyLoadEligible = [];
  const streamEligible = [];
  const compactEligible = [];
  const invalidContracts = [];

  for (const contract of list) {
    const status = contract.currentCompliance || COMPLIANCE_STATUS.UNKNOWN;
    const category = contract.category || UNKNOWN_VALUE;
    byStatus[status] = (byStatus[status] || 0) + 1;
    byCategory[category] = (byCategory[category] || 0) + 1;

    const validation = validateMemoryContract(contract);
    if (!validation.valid) {
      invalidContracts.push({
        componentId: contract.componentId || UNKNOWN_VALUE,
        errors: validation.errors
      });
    }

    if (contract.boundedRequired === true) boundedRequired.push(contract.componentId);
    if (String(contract.archivePolicy || '').includes('required')) archiveRequired.push(contract.componentId);
    if (contract.lazyLoadEligible === true) lazyLoadEligible.push(contract.componentId);
    if (contract.streamEligible === true) streamEligible.push(contract.componentId);
    if (contract.compactEligible === true) compactEligible.push(contract.componentId);

    if (contract.currentCompliance === COMPLIANCE_STATUS.NON_COMPLIANT || contract.expectedGrowth === EXPECTED_GROWTH.UNBOUNDED_CURRENTLY) {
      violations.push({
        componentId: contract.componentId,
        componentName: contract.componentName,
        currentCompliance: contract.currentCompliance,
        expectedGrowth: contract.expectedGrowth,
        futurePhase: contract.futurePhase
      });
    }
  }

  return {
    source: PRODUCTION_MEMORY_CONTRACT_SOURCE,
    schemaVersion: PRODUCTION_MEMORY_CONTRACT_SCHEMA_VERSION,
    totalContracts: list.length,
    byStatus,
    byCategory,
    boundedRequiredCount: boundedRequired.length,
    archiveRequiredCount: archiveRequired.length,
    lazyLoadEligibleCount: lazyLoadEligible.length,
    streamEligibleCount: streamEligible.length,
    compactEligibleCount: compactEligible.length,
    nonCompliantCount: byStatus[COMPLIANCE_STATUS.NON_COMPLIANT] || 0,
    partialComplianceCount: byStatus[COMPLIANCE_STATUS.PARTIAL] || 0,
    invalidContractCount: invalidContracts.length,
    boundedRequired: boundedRequired.sort(),
    archiveRequired: archiveRequired.sort(),
    lazyLoadEligible: lazyLoadEligible.sort(),
    streamEligible: streamEligible.sort(),
    compactEligible: compactEligible.sort(),
    violations: violations.sort((a, b) => String(a.componentId).localeCompare(String(b.componentId))),
    invalidContracts
  };
}

function summarizeMemoryContracts(contracts = []) {
  const compliance = evaluateMemoryContractCompliance(contracts);
  return `Production memory contracts: ${compliance.totalContracts} total, ${compliance.nonCompliantCount} non-compliant, ${compliance.partialComplianceCount} partially compliant, ${compliance.boundedRequiredCount} require explicit bounds.`;
}

const CANONICAL_MEMORY_CONTRACTS = Object.freeze([
  createMemoryContract({
    componentId: 'store',
    componentName: 'Production app store',
    owner: 'server.js + utils/appStore.js',
    category: MEMORY_CATEGORY.PRODUCTION_STORE,
    lifetime: MEMORY_LIFETIME.PROCESS_AND_RESTART,
    persistenceModel: PERSISTENCE_MODEL.WHOLE_FILE_JSON,
    expectedGrowth: EXPECTED_GROWTH.PARTIALLY_BOUNDED,
    maximumRetentionPolicy: 'alerts:200; scans:100; rejections:300; listings:unbounded_currently',
    archivePolicy: 'archive_required_for_old_or_inactive_listings',
    inMemoryPolicy: 'active_operational_state_only',
    lazyLoadEligible: true,
    streamEligible: true,
    compactEligible: true,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.PARTIAL,
    futurePhase: '11.3',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_STATE,
    notes: ['Store is mixed bounded and unbounded production state.']
  }),
  createMemoryContract({
    componentId: 'store.listings',
    componentName: 'Production listing collection',
    owner: 'server.js',
    category: MEMORY_CATEGORY.LISTING_COLLECTION,
    lifetime: MEMORY_LIFETIME.PROCESS_AND_RESTART,
    persistenceModel: PERSISTENCE_MODEL.ARCHIVE_REQUIRED,
    expectedGrowth: EXPECTED_GROWTH.UNBOUNDED_CURRENTLY,
    maximumRetentionPolicy: 'must_define_active_recent_listing_cap_and_archive_policy',
    archivePolicy: 'required',
    inMemoryPolicy: 'bounded_active_recent_alerted_operational_listings_only',
    lazyLoadEligible: true,
    streamEligible: true,
    compactEligible: true,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.NON_COMPLIANT,
    futurePhase: '11.3',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_STATE,
    notes: ['Currently retains full saved listing objects indefinitely.']
  }),
  createMemoryContract({
    componentId: 'store.alerts',
    componentName: 'Production alert window',
    owner: 'server.js',
    category: MEMORY_CATEGORY.OPERATIONAL_WINDOW,
    lifetime: MEMORY_LIFETIME.PROCESS_AND_RESTART,
    persistenceModel: PERSISTENCE_MODEL.WHOLE_FILE_JSON_BOUNDED,
    expectedGrowth: EXPECTED_GROWTH.BOUNDED,
    maximumRetentionPolicy: '200 alerts',
    archivePolicy: 'optional',
    inMemoryPolicy: 'bounded_current_alert_window',
    lazyLoadEligible: false,
    streamEligible: false,
    compactEligible: true,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.PARTIAL,
    futurePhase: '11.3',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_STATE,
    notes: ['Bounded, but retained alert payloads should be compacted.']
  }),
  createMemoryContract({
    componentId: 'store.rejections',
    componentName: 'Production rejection window',
    owner: 'server.js',
    category: MEMORY_CATEGORY.OPERATIONAL_WINDOW,
    lifetime: MEMORY_LIFETIME.PROCESS_AND_RESTART,
    persistenceModel: PERSISTENCE_MODEL.WHOLE_FILE_JSON_BOUNDED,
    expectedGrowth: EXPECTED_GROWTH.BOUNDED,
    maximumRetentionPolicy: '300 rejections',
    archivePolicy: 'optional',
    inMemoryPolicy: 'bounded_recent_rejection_window',
    lazyLoadEligible: false,
    streamEligible: false,
    compactEligible: true,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.COMPLIANT,
    futurePhase: '11.3',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_STATE,
    notes: ['Currently bounded; compact projection should be reviewed.']
  }),
  createMemoryContract({
    componentId: 'store.scans',
    componentName: 'Production scan summary window',
    owner: 'services/scoutScannerService.js',
    category: MEMORY_CATEGORY.SCANNER_LIFECYCLE,
    lifetime: MEMORY_LIFETIME.PROCESS_AND_RESTART,
    persistenceModel: PERSISTENCE_MODEL.WHOLE_FILE_JSON_BOUNDED,
    expectedGrowth: EXPECTED_GROWTH.BOUNDED,
    maximumRetentionPolicy: '100 scans',
    archivePolicy: 'optional',
    inMemoryPolicy: 'bounded_scan_summary_window',
    lazyLoadEligible: false,
    streamEligible: false,
    compactEligible: false,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.COMPLIANT,
    futurePhase: '11.5',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_SUPPORTING,
    notes: ['Bounded scan summaries are acceptable.']
  }),
  createMemoryContract({
    componentId: 'predictionAccuracyEngine',
    componentName: 'Prediction Accuracy Engine state',
    owner: 'engines/predictionAccuracyEngine.js',
    category: MEMORY_CATEGORY.LEARNING_STORE,
    lifetime: MEMORY_LIFETIME.PROCESS_AND_RESTART,
    persistenceModel: PERSISTENCE_MODEL.APPEND_OR_BATCH_REQUIRED,
    expectedGrowth: EXPECTED_GROWTH.UNBOUNDED_CURRENTLY,
    maximumRetentionPolicy: 'must_define_recent_prediction_cap_and_archive_segments',
    archivePolicy: 'required',
    inMemoryPolicy: 'bounded_recent_predictions_and_lookup_indexes_only',
    lazyLoadEligible: true,
    streamEligible: true,
    compactEligible: true,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.NON_COMPLIANT,
    futurePhase: '11.2',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_SUPPORTING,
    notes: ['Module-level maps and histories are unbounded and persisted whole-file.']
  }),
  createMemoryContract({
    componentId: 'decisionValidationEngine',
    componentName: 'Decision Validation Engine state',
    owner: 'engines/decisionValidationEngine.js',
    category: MEMORY_CATEGORY.VALIDATION_STORE,
    lifetime: MEMORY_LIFETIME.PROCESS_AND_RESTART,
    persistenceModel: PERSISTENCE_MODEL.APPEND_OR_BATCH_REQUIRED,
    expectedGrowth: EXPECTED_GROWTH.UNBOUNDED_CURRENTLY,
    maximumRetentionPolicy: 'must_define_recent_decision_cap_and_archive_segments',
    archivePolicy: 'required',
    inMemoryPolicy: 'bounded_recent_decisions_and_outcome_candidates_only',
    lazyLoadEligible: true,
    streamEligible: true,
    compactEligible: true,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.NON_COMPLIANT,
    futurePhase: '11.2',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_SUPPORTING,
    notes: ['Decision snapshots and histories grow without a retention cap.']
  }),
  createMemoryContract({
    componentId: 'learningEngine',
    componentName: 'Learning Engine state',
    owner: 'engines/learningEngine.js',
    category: MEMORY_CATEGORY.LEARNING_STORE,
    lifetime: MEMORY_LIFETIME.PROCESS_LIFETIME,
    persistenceModel: PERSISTENCE_MODEL.IN_MEMORY_ONLY,
    expectedGrowth: EXPECTED_GROWTH.PARTIALLY_BOUNDED,
    maximumRetentionPolicy: 'recent_events:1000; records_by_listing:unbounded_currently',
    archivePolicy: 'required_if_long_term_learning_records_are_needed',
    inMemoryPolicy: 'bounded_recent_learning_window_only',
    lazyLoadEligible: true,
    streamEligible: true,
    compactEligible: true,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.PARTIAL,
    futurePhase: '11.2',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_SUPPORTING,
    notes: ['Recent events are capped; recordsByEbayItemId is not.']
  }),
  createMemoryContract({
    componentId: 'historyEngine',
    componentName: 'Listing History Engine state',
    owner: 'engines/historyEngine.js',
    category: MEMORY_CATEGORY.HISTORY_STORE,
    lifetime: MEMORY_LIFETIME.PROCESS_AND_RESTART,
    persistenceModel: PERSISTENCE_MODEL.SEGMENTED_REPOSITORY_REQUIRED,
    expectedGrowth: EXPECTED_GROWTH.PARTIALLY_BOUNDED,
    maximumRetentionPolicy: 'scans:250; price_points_per_listing:100; price_drops_per_listing:50; listings:unbounded_currently',
    archivePolicy: 'required',
    inMemoryPolicy: 'current_scan_comparison_set_and_recent_history_summary_only',
    lazyLoadEligible: true,
    streamEligible: true,
    compactEligible: true,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.PARTIAL,
    futurePhase: '11.3',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_SUPPORTING,
    notes: ['Per-listing arrays are capped but total listing history is not.']
  }),
  createMemoryContract({
    componentId: 'stateStore',
    componentName: 'Whole-file JSON state store',
    owner: 'utils/stateStore.js',
    category: MEMORY_CATEGORY.PERSISTENCE,
    lifetime: MEMORY_LIFETIME.REQUEST_LOCAL,
    persistenceModel: PERSISTENCE_MODEL.WHOLE_FILE_JSON,
    expectedGrowth: EXPECTED_GROWTH.CONFIGURATION_BOUNDED,
    maximumRetentionPolicy: 'small_bounded_state_only',
    archivePolicy: 'not_for_high_volume_archives',
    inMemoryPolicy: 'temporary_parse_and_stringify_only',
    lazyLoadEligible: false,
    streamEligible: false,
    compactEligible: false,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.PARTIAL,
    futurePhase: '11.4',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_SUPPORTING,
    notes: ['Appropriate for small bounded files; unsafe for high-volume growing stores.']
  }),
  createMemoryContract({
    componentId: 'ebayTokenCache',
    componentName: 'eBay OAuth token cache',
    owner: 'marketplaces/ebayMarketplace.js',
    category: MEMORY_CATEGORY.CACHE,
    lifetime: MEMORY_LIFETIME.PROCESS_LIFETIME,
    persistenceModel: PERSISTENCE_MODEL.IN_MEMORY_ONLY,
    expectedGrowth: EXPECTED_GROWTH.CONSTANT,
    maximumRetentionPolicy: 'one_token',
    archivePolicy: 'none',
    inMemoryPolicy: 'single_cached_token_until_expiration',
    lazyLoadEligible: true,
    streamEligible: false,
    compactEligible: false,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.COMPLIANT,
    futurePhase: 'none',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_SUPPORTING,
    notes: ['Constant-size cache.']
  }),
  createMemoryContract({
    componentId: 'trendEngine.cache',
    componentName: 'Trend Engine cache',
    owner: 'engines/trendEngine.js',
    category: MEMORY_CATEGORY.CACHE,
    lifetime: MEMORY_LIFETIME.PROCESS_LIFETIME,
    persistenceModel: PERSISTENCE_MODEL.IN_MEMORY_ONLY,
    expectedGrowth: EXPECTED_GROWTH.UNKNOWN,
    maximumRetentionPolicy: 'must_verify_and_define_cache_cap',
    archivePolicy: 'none',
    inMemoryPolicy: 'bounded_cache_only',
    lazyLoadEligible: false,
    streamEligible: false,
    compactEligible: true,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.NEEDS_CONTRACT,
    futurePhase: '11.1',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_DECISION_INPUT,
    notes: ['Phase 11.0A identified cache ownership but did not verify an enforced cap.']
  }),
  createMemoryContract({
    componentId: 'moduleLookupMaps',
    componentName: 'Long-lived module lookup maps',
    owner: 'learning/prediction/decision validation modules',
    category: MEMORY_CATEGORY.LOOKUP_MAP,
    lifetime: MEMORY_LIFETIME.MODULE_LIFETIME,
    persistenceModel: PERSISTENCE_MODEL.APPEND_OR_BATCH_REQUIRED,
    expectedGrowth: EXPECTED_GROWTH.UNBOUNDED_CURRENTLY,
    maximumRetentionPolicy: 'must_define_per_map_cap_eviction_and_archive_policy',
    archivePolicy: 'required',
    inMemoryPolicy: 'bounded_indexes_only',
    lazyLoadEligible: true,
    streamEligible: true,
    compactEligible: true,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.NON_COMPLIANT,
    futurePhase: '11.2',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_SUPPORTING,
    notes: ['Covers recordsById, recordsByPredictionId, recordsByListingId, and recordsByEbayItemId.']
  }),
  createMemoryContract({
    componentId: 'ebayRetryState',
    componentName: 'eBay query retry state',
    owner: 'marketplaces/ebayMarketplace.js',
    category: MEMORY_CATEGORY.RETRY_STATE,
    lifetime: MEMORY_LIFETIME.SCAN_LOCAL,
    persistenceModel: PERSISTENCE_MODEL.NONE,
    expectedGrowth: EXPECTED_GROWTH.BOUNDED,
    maximumRetentionPolicy: 'bounded_by_EBAY_MAX_RETRIES',
    archivePolicy: 'none',
    inMemoryPolicy: 'query_local_only',
    lazyLoadEligible: false,
    streamEligible: false,
    compactEligible: false,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.COMPLIANT,
    futurePhase: '11.5',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_SUPPORTING,
    notes: ['Retry timers are awaited and local to a query attempt sequence.']
  }),
  createMemoryContract({
    componentId: 'scannerLifecycle',
    componentName: 'Scout scanner lifecycle state',
    owner: 'services/scoutScannerService.js',
    category: MEMORY_CATEGORY.SCANNER_LIFECYCLE,
    lifetime: MEMORY_LIFETIME.PROCESS_LIFETIME,
    persistenceModel: PERSISTENCE_MODEL.WHOLE_FILE_JSON_BOUNDED,
    expectedGrowth: EXPECTED_GROWTH.PARTIALLY_BOUNDED,
    maximumRetentionPolicy: 'scanInProgress:constant; scan_summaries:100; observedListings:scan_local_config_bounded',
    archivePolicy: 'optional_for_operational_analytics',
    inMemoryPolicy: 'scan_local_data_released_at_completion',
    lazyLoadEligible: false,
    streamEligible: true,
    compactEligible: true,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.PARTIAL,
    futurePhase: '11.5',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_SUPPORTING,
    notes: ['Overlap is guarded, but scheduler is fixed interval and observedListings retain full saved listings during a scan.']
  }),
  createMemoryContract({
    componentId: 'marketplaceAdapterOutput',
    componentName: 'Marketplace adapter normalized listing output',
    owner: 'marketplaces/ebayMarketplace.js',
    category: MEMORY_CATEGORY.MARKETPLACE_ADAPTER,
    lifetime: MEMORY_LIFETIME.SCAN_LOCAL,
    persistenceModel: PERSISTENCE_MODEL.ARCHIVE_REQUIRED,
    expectedGrowth: EXPECTED_GROWTH.CONFIGURATION_BOUNDED,
    maximumRetentionPolicy: 'bounded_per_query_by_scanQueryLimit; persisted_records_must_be_compact',
    archivePolicy: 'raw_payload_archive_optional_but_must_be_bounded',
    inMemoryPolicy: 'compact_normalized_listing_only',
    lazyLoadEligible: true,
    streamEligible: false,
    compactEligible: true,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.PARTIAL,
    futurePhase: '11.3',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_DECISION_INPUT,
    notes: ['Normalized eBay listing currently includes raw provider item.']
  }),
  createMemoryContract({
    componentId: 'parserOutput',
    componentName: 'Parser output attached to listings',
    owner: 'server.js parseCardTitle path',
    category: MEMORY_CATEGORY.PARSER_OUTPUT,
    lifetime: MEMORY_LIFETIME.PROCESS_AND_RESTART,
    persistenceModel: PERSISTENCE_MODEL.WHOLE_FILE_JSON,
    expectedGrowth: EXPECTED_GROWTH.PARTIALLY_BOUNDED,
    maximumRetentionPolicy: 'bounded_by_listing_retention_policy',
    archivePolicy: 'archive_with_listing_snapshot',
    inMemoryPolicy: 'active_listing_parser_summary_only',
    lazyLoadEligible: true,
    streamEligible: false,
    compactEligible: true,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.PARTIAL,
    futurePhase: '11.3',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_DECISION_INPUT,
    notes: ['Per-object parser output is compact; aggregate growth follows store.listings.']
  }),
  createMemoryContract({
    componentId: 'scoringObjects',
    componentName: 'Production scoring object graph',
    owner: 'server.js scoreListing + scoring engines',
    category: MEMORY_CATEGORY.SCORING_OBJECT,
    lifetime: MEMORY_LIFETIME.SCAN_LOCAL,
    persistenceModel: PERSISTENCE_MODEL.ARCHIVE_REQUIRED,
    expectedGrowth: EXPECTED_GROWTH.PARTIALLY_BOUNDED,
    maximumRetentionPolicy: 'production_summary_only_in_active_listing; diagnostics_archived_or_bounded',
    archivePolicy: 'required_for_rich_diagnostics',
    inMemoryPolicy: 'call_local_except_compact_display_summary',
    lazyLoadEligible: true,
    streamEligible: true,
    compactEligible: true,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.NON_COMPLIANT,
    futurePhase: '11.3',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_DECISION_INPUT,
    notes: ['Large nested scoring objects are copied into saved listing state.']
  }),
  createMemoryContract({
    componentId: 'valuationObjects',
    componentName: 'Valuation and range object graph',
    owner: 'marketValueEngine + valuationRangeEngine + shadowValuationEngine',
    category: MEMORY_CATEGORY.VALUATION_OBJECT,
    lifetime: MEMORY_LIFETIME.SCAN_LOCAL,
    persistenceModel: PERSISTENCE_MODEL.ARCHIVE_REQUIRED,
    expectedGrowth: EXPECTED_GROWTH.PARTIALLY_BOUNDED,
    maximumRetentionPolicy: 'compact_current_valuation_summary_in_memory; detailed_snapshots_bounded',
    archivePolicy: 'required_for_historical_valuation_diagnostics',
    inMemoryPolicy: 'compact_current_summary_only',
    lazyLoadEligible: true,
    streamEligible: false,
    compactEligible: true,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.PARTIAL,
    futurePhase: '11.3',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_DECISION_INPUT,
    notes: ['Valuation details are retained through marketData, marketIntelligenceData, and shadowValuation.']
  }),
  createMemoryContract({
    componentId: 'confidenceObjects',
    componentName: 'Confidence object graph',
    owner: 'confidenceEngine + marketIntelligenceEngine + display interpretation',
    category: MEMORY_CATEGORY.CONFIDENCE_OBJECT,
    lifetime: MEMORY_LIFETIME.SCAN_LOCAL,
    persistenceModel: PERSISTENCE_MODEL.ARCHIVE_REQUIRED,
    expectedGrowth: EXPECTED_GROWTH.PARTIALLY_BOUNDED,
    maximumRetentionPolicy: 'compact_confidence_summary_in_active_listing; histories_bounded',
    archivePolicy: 'archive_with_listing_or_learning_snapshot',
    inMemoryPolicy: 'compact_confidence_summary_only',
    lazyLoadEligible: true,
    streamEligible: false,
    compactEligible: true,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.PARTIAL,
    futurePhase: '11.3',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_DECISION_INPUT,
    notes: ['Per-object confidence data is compact, but aggregate retention follows unbounded stores.']
  }),
  createMemoryContract({
    componentId: 'notificationState',
    componentName: 'Notification idempotency state',
    owner: 'engines/notificationEngine.js',
    category: MEMORY_CATEGORY.NOTIFICATION_STATE,
    lifetime: MEMORY_LIFETIME.PROCESS_AND_RESTART,
    persistenceModel: PERSISTENCE_MODEL.WHOLE_FILE_JSON_BOUNDED,
    expectedGrowth: EXPECTED_GROWTH.BOUNDED,
    maximumRetentionPolicy: '1000 sent alert keys',
    archivePolicy: 'none',
    inMemoryPolicy: 'bounded_sent_alert_key_window',
    lazyLoadEligible: false,
    streamEligible: false,
    compactEligible: false,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.COMPLIANT,
    futurePhase: 'none',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_SUPPORTING,
    notes: ['Bounded idempotency state.']
  }),
  createMemoryContract({
    componentId: 'systemHealthState',
    componentName: 'System health transient state',
    owner: 'engines/systemHealth.js',
    category: MEMORY_CATEGORY.HEALTH_STATE,
    lifetime: MEMORY_LIFETIME.PROCESS_LIFETIME,
    persistenceModel: PERSISTENCE_MODEL.IN_MEMORY_ONLY,
    expectedGrowth: EXPECTED_GROWTH.BOUNDED,
    maximumRetentionPolicy: '100 events plus current and last scan',
    archivePolicy: 'optional_operational_logs',
    inMemoryPolicy: 'bounded_health_window',
    lazyLoadEligible: false,
    streamEligible: false,
    compactEligible: false,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.COMPLIANT,
    futurePhase: 'none',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_SUPPORTING,
    notes: ['Bounded transient health state.']
  }),
  createMemoryContract({
    componentId: 'shadowModeState',
    componentName: 'Shadow mode log state',
    owner: 'utils/shadowModeLogger.js',
    category: MEMORY_CATEGORY.SHADOW_STATE,
    lifetime: MEMORY_LIFETIME.PROCESS_AND_RESTART,
    persistenceModel: PERSISTENCE_MODEL.WHOLE_FILE_JSON_BOUNDED,
    expectedGrowth: EXPECTED_GROWTH.BOUNDED,
    maximumRetentionPolicy: '1000 shadow records',
    archivePolicy: 'optional',
    inMemoryPolicy: 'bounded_shadow_diagnostic_window',
    lazyLoadEligible: true,
    streamEligible: false,
    compactEligible: true,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.COMPLIANT,
    futurePhase: 'none',
    productionAuthority: PRODUCTION_AUTHORITY.NONE,
    notes: ['Shadow state is bounded and non-authoritative.']
  }),
  createMemoryContract({
    componentId: 'canonicalSoldEvidenceStore',
    componentName: 'Canonical sold evidence store',
    owner: 'utils/soldEvidenceStore.js + services/soldEvidenceService.js',
    category: MEMORY_CATEGORY.CANONICAL_EVIDENCE_STORE,
    lifetime: MEMORY_LIFETIME.PROCESS_AND_RESTART,
    persistenceModel: PERSISTENCE_MODEL.SEGMENTED_REPOSITORY_REQUIRED,
    expectedGrowth: EXPECTED_GROWTH.PARTIALLY_BOUNDED,
    maximumRetentionPolicy: 'current_dataset_small; long_term_identity_index_and_archive_required',
    archivePolicy: 'required_at_large_dataset_scale',
    inMemoryPolicy: 'identity_query_working_set_not_full_store_at_scale',
    lazyLoadEligible: true,
    streamEligible: true,
    compactEligible: true,
    boundedRequired: true,
    currentCompliance: COMPLIANCE_STATUS.PARTIAL,
    futurePhase: 'future_canonical_dataset_scaling',
    productionAuthority: PRODUCTION_AUTHORITY.PRODUCTION_DECISION_INPUT,
    notes: ['Currently lazy loaded but not identity-query lazy at large scale.']
  })
]);

module.exports = {
  CANONICAL_MEMORY_CONTRACTS,
  COMPLIANCE_STATUS,
  EXPECTED_GROWTH,
  MEMORY_CATEGORY,
  MEMORY_LIFETIME,
  PERSISTENCE_MODEL,
  PRODUCTION_AUTHORITY,
  PRODUCTION_MEMORY_CONTRACT_SCHEMA_VERSION,
  PRODUCTION_MEMORY_CONTRACT_SOURCE,
  REQUIRED_MEMORY_CONTRACT_FIELDS,
  UNKNOWN_VALUE,
  buildMemoryContractFingerprint,
  createMemoryContract,
  evaluateMemoryContractCompliance,
  summarizeMemoryContracts,
  validateMemoryContract
};
