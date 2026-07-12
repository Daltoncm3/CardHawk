'use strict';

const {
  runAcquisitionToStorePipelineConformance,
  summarizePipelineConformance
} = require('./acquisitionToStorePipelineConformance');
const {
  CERTIFICATION_ARTIFACT_SCHEMA,
  CERTIFICATION_ARTIFACT_SCHEMA_VERSION,
  asArray,
  asObject
} = require('./canonicalValidationCore');

const CERTIFICATION_STANDARD_VERSION = CERTIFICATION_ARTIFACT_SCHEMA_VERSION;
const SOURCE = 'marketplace_adapter_certification';

const CERTIFICATION_LEVELS = {
  DRAFT: 'Draft',
  CANDIDATE: 'Candidate',
  CERTIFIED: 'Certified',
  PRODUCTION_APPROVED: 'Production Approved'
};

const DEFAULT_THRESHOLDS = {
  candidateIdentityPassRate: 0.95,
  candidateProvenancePassRate: 0.95,
  certifiedIdentityPassRate: 1,
  certifiedProvenancePassRate: 1,
  minimumEligibleRecords: 1
};

function roundRate(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function createRequirement(name, pass, details = {}, severity = 'mandatory') {
  return {
    name,
    pass: Boolean(pass),
    severity,
    details
  };
}

function findCheck(report = {}, name) {
  return asArray(report.checks).find((check) => check.name === name) || null;
}

async function safeGetCapabilities(adapter = {}) {
  if (typeof adapter.getCapabilities !== 'function') {
    return {
      sourceId: adapter.sourceId || null,
      adapterName: adapter.adapterName || null,
      adapterVersion: adapter.adapterVersion || null,
      capabilities: {}
    };
  }

  try {
    return await adapter.getCapabilities();
  } catch (error) {
    return {
      sourceId: adapter.sourceId || null,
      adapterName: adapter.adapterName || null,
      adapterVersion: adapter.adapterVersion || null,
      capabilities: {},
      error: {
        name: error.name,
        message: error.message
      }
    };
  }
}

function inferUnsupportedBehaviors(capabilities = {}, explicit = []) {
  const unsupported = new Set(asArray(explicit));

  if (!capabilities.transactionLevelSoldSupport) unsupported.add('transaction_level_true_sold');
  if (!capabilities.aggregateMarketPriceSupport) unsupported.add('aggregate_market_price_context');
  if (!capabilities.activeContextSupport) unsupported.add('active_listing_context');
  if (!capabilities.acceptedBestOfferSupport) unsupported.add('accepted_best_offer_prices');
  if (!capabilities.shippingSupport) unsupported.add('shipping_costs');
  if (!capabilities.certificationSupport) unsupported.add('certification_details');
  if (!capabilities.supportsIncrementalSync) unsupported.add('incremental_sync');
  if (!capabilities.supportsHistoricalBackfill) unsupported.add('historical_backfill');

  return [...unsupported].sort();
}

function buildLimitations(capabilities = {}, explicit = []) {
  const limitations = [...asArray(explicit)];
  const commercialUse = asObject(capabilities.commercialUse);

  if (commercialUse.requiresLicense) limitations.push('commercial_use_requires_license');
  if (!commercialUse.redistributionAllowed) limitations.push('redistribution_not_confirmed');
  if (!commercialUse.displayAllowed) limitations.push('display_rights_not_confirmed');
  if (capabilities.rateLimit) limitations.push(`rate_limit:${JSON.stringify(capabilities.rateLimit)}`);
  if (capabilities.maxBatchSize) limitations.push(`max_batch_size:${capabilities.maxBatchSize}`);

  return [...new Set(limitations)].sort();
}

function calculateQualityMetrics(pipelineReport = {}) {
  const summary = asObject(pipelineReport.summary);
  const stageSummary = asObject(pipelineReport.pipeline?.stageSummary);
  const emittedRecords = Number(summary.emittedRecords || 0);
  const manualRejectedRecords = Number(summary.manualRejectedRecords || 0);
  const totalEvaluatedRecords = emittedRecords + manualRejectedRecords;
  const identityFailures = Number(stageSummary.identity || 0);
  const provenanceFailures = Number(stageSummary.provenance || 0);
  const evidenceClassificationFailures = Number(stageSummary.evidence_classification || 0);
  const duplicateFailures = Number(stageSummary.duplicate_handling || 0);
  const storeCompatibilityFailures = Number(stageSummary.store_compatibility || 0);
  const denominator = totalEvaluatedRecords || 1;

  return {
    emittedRecords,
    eligibleRecords: Number(summary.eligibleRecords || 0),
    rejectedRecords: Number(summary.rejectedRecords || 0),
    manualRejectedRecords,
    totalEvaluatedRecords,
    identityFailures,
    provenanceFailures,
    evidenceClassificationFailures,
    duplicateFailures,
    storeCompatibilityFailures,
    identityPassRate: totalEvaluatedRecords ? roundRate((denominator - identityFailures) / denominator) : 0,
    provenancePassRate: totalEvaluatedRecords ? roundRate((denominator - provenanceFailures) / denominator) : 0,
    partialFailures: Number(summary.partialFailures || 0),
    deterministicReplay: Boolean(pipelineReport.pipeline?.deterministicReplay?.pass),
    dryRun: pipelineReport.dryRun !== false
  };
}

function evaluateCertificationRequirements(pipelineReport = {}, capabilities = {}, thresholds = DEFAULT_THRESHOLDS, options = {}) {
  const adapterConformance = asObject(pipelineReport.acquisition?.conformance);
  const adapterContract = findCheck(pipelineReport, 'adapter_contract');
  const capabilityMetadata = findCheck(pipelineReport, 'capability_metadata');
  const deterministic = findCheck(pipelineReport, 'deterministic_fixture_replay');
  const dryRun = findCheck(pipelineReport, 'dry_run_only');
  const metrics = calculateQualityMetrics(pipelineReport);
  const productionApproval = asObject(options.productionApproval);
  const hasProductionApproval = Boolean(
    productionApproval.approved
    && productionApproval.approvedBy
    && productionApproval.approvedAt
    && productionApproval.approvalTicket
  );

  return [
    createRequirement('adapter_contract_passed', Boolean(adapterContract?.pass), adapterContract?.details || {}),
    createRequirement('capability_metadata_passed', Boolean(capabilityMetadata?.pass), capabilityMetadata?.details || {}),
    createRequirement('acquisition_adapter_conformance_passed', Boolean(adapterConformance.passed), {
      failures: asArray(adapterConformance.failures)
    }),
    createRequirement('acquisition_to_store_pipeline_passed', Boolean(pipelineReport.passed), {
      failures: asArray(pipelineReport.failures)
    }),
    createRequirement('identity_threshold_met', metrics.identityPassRate >= thresholds.certifiedIdentityPassRate, {
      actual: metrics.identityPassRate,
      required: thresholds.certifiedIdentityPassRate,
      failures: metrics.identityFailures
    }),
    createRequirement('provenance_threshold_met', metrics.provenancePassRate >= thresholds.certifiedProvenancePassRate, {
      actual: metrics.provenancePassRate,
      required: thresholds.certifiedProvenancePassRate,
      failures: metrics.provenanceFailures
    }),
    createRequirement('candidate_identity_threshold_met', metrics.identityPassRate >= thresholds.candidateIdentityPassRate, {
      actual: metrics.identityPassRate,
      required: thresholds.candidateIdentityPassRate
    }, 'candidate'),
    createRequirement('candidate_provenance_threshold_met', metrics.provenancePassRate >= thresholds.candidateProvenancePassRate, {
      actual: metrics.provenancePassRate,
      required: thresholds.candidateProvenancePassRate
    }, 'candidate'),
    createRequirement('deterministic_fixture_replay_passed', Boolean(deterministic?.pass && metrics.deterministicReplay), {
      pipelineReplay: metrics.deterministicReplay,
      details: deterministic?.details || {}
    }),
    createRequirement('transaction_level_true_sold_supported', Boolean(capabilities.transactionLevelSoldSupport), {
      transactionLevelSoldSupport: Boolean(capabilities.transactionLevelSoldSupport)
    }),
    createRequirement('minimum_store_eligible_records_met', metrics.eligibleRecords >= thresholds.minimumEligibleRecords, {
      actual: metrics.eligibleRecords,
      required: thresholds.minimumEligibleRecords
    }),
    createRequirement('capabilities_recorded', Object.keys(capabilities).length > 0, {
      capabilityFields: Object.keys(capabilities)
    }),
    createRequirement('limitations_recorded', true, {
      informational: true
    }),
    createRequirement('unsupported_behaviors_recorded', true, {
      informational: true
    }),
    createRequirement('dry_run_only', Boolean(dryRun?.pass && metrics.dryRun), {
      dryRun: metrics.dryRun,
      writesProductionStore: false
    }),
    createRequirement('production_approval_recorded', hasProductionApproval, {
      requiredFor: CERTIFICATION_LEVELS.PRODUCTION_APPROVED,
      approvalTicket: productionApproval.approvalTicket || null,
      approvedBy: productionApproval.approvedBy || null,
      approvedAt: productionApproval.approvedAt || null
    }, 'production')
  ];
}

function requirementPassed(requirements = [], name) {
  return Boolean(asArray(requirements).find((requirement) => requirement.name === name)?.pass);
}

function determineCertificationLevel(requirements = []) {
  const candidate = [
    'adapter_contract_passed',
    'capability_metadata_passed',
    'acquisition_adapter_conformance_passed',
    'candidate_identity_threshold_met',
    'candidate_provenance_threshold_met',
    'deterministic_fixture_replay_passed',
    'capabilities_recorded',
    'dry_run_only'
  ].every((name) => requirementPassed(requirements, name));

  const certified = candidate && [
    'acquisition_to_store_pipeline_passed',
    'identity_threshold_met',
    'provenance_threshold_met',
    'transaction_level_true_sold_supported',
    'minimum_store_eligible_records_met'
  ].every((name) => requirementPassed(requirements, name));

  const productionApproved = certified && requirementPassed(requirements, 'production_approval_recorded');

  if (productionApproved) return CERTIFICATION_LEVELS.PRODUCTION_APPROVED;
  if (certified) return CERTIFICATION_LEVELS.CERTIFIED;
  if (candidate) return CERTIFICATION_LEVELS.CANDIDATE;
  return CERTIFICATION_LEVELS.DRAFT;
}

function buildCertificationSummary(report = {}) {
  return {
    source: report.source || SOURCE,
    adapterName: report.adapter?.adapterName || null,
    sourceId: report.adapter?.sourceId || null,
    marketplace: report.adapter?.marketplace || null,
    level: report.certificationLevel || CERTIFICATION_LEVELS.DRAFT,
    approvedForProduction: report.certificationLevel === CERTIFICATION_LEVELS.PRODUCTION_APPROVED,
    passed: report.passed === true,
    identityPassRate: report.metrics?.identityPassRate || 0,
    provenancePassRate: report.metrics?.provenancePassRate || 0,
    eligibleRecords: report.metrics?.eligibleRecords || 0,
    rejectedRecords: report.metrics?.rejectedRecords || 0,
    failedRequirements: asArray(report.requirements)
      .filter((requirement) => requirement.severity === 'mandatory' && !requirement.pass)
      .map((requirement) => requirement.name),
    unsupportedBehaviors: asArray(report.unsupportedBehaviors),
    limitations: asArray(report.limitations)
  };
}

async function runMarketplaceAdapterCertification(adapter = {}, options = {}) {
  const thresholds = {
    ...DEFAULT_THRESHOLDS,
    ...asObject(options.thresholds)
  };
  const capabilitiesResult = await safeGetCapabilities(adapter);
  const capabilities = asObject(capabilitiesResult.capabilities);
  const pipelineReport = await runAcquisitionToStorePipelineConformance(adapter, options.pipelineOptions || {});
  const metrics = calculateQualityMetrics(pipelineReport);
  const limitations = buildLimitations(capabilities, options.limitations);
  const unsupportedBehaviors = inferUnsupportedBehaviors(capabilities, options.knownUnsupportedBehaviors);
  const requirements = evaluateCertificationRequirements(pipelineReport, capabilities, thresholds, options);
  const certificationLevel = determineCertificationLevel(requirements);

  const report = {
    schemaVersion: CERTIFICATION_ARTIFACT_SCHEMA.schemaVersion,
    source: SOURCE,
    version: CERTIFICATION_STANDARD_VERSION,
    generatedAt: options.generatedAt || new Date().toISOString(),
    certificationLevel,
    passed: certificationLevel === CERTIFICATION_LEVELS.CERTIFIED
      || certificationLevel === CERTIFICATION_LEVELS.PRODUCTION_APPROVED,
    productionApproved: certificationLevel === CERTIFICATION_LEVELS.PRODUCTION_APPROVED,
    dryRun: true,
    standard: {
      version: CERTIFICATION_STANDARD_VERSION,
      artifactSchema: CERTIFICATION_ARTIFACT_SCHEMA,
      levels: Object.values(CERTIFICATION_LEVELS),
      thresholds,
      mandatoryHarnesses: [
        'acquisition_adapter_conformance',
        'acquisition_to_store_pipeline_conformance'
      ]
    },
    adapter: {
      sourceId: capabilitiesResult.sourceId || adapter.sourceId || null,
      marketplace: capabilitiesResult.marketplace || adapter.marketplace || null,
      adapterName: capabilitiesResult.adapterName || adapter.adapterName || null,
      adapterVersion: capabilitiesResult.adapterVersion || adapter.adapterVersion || null,
      interfaceVersion: adapter.interfaceVersion || null
    },
    capabilities,
    limitations,
    unsupportedBehaviors,
    knownUnsupportedBehaviors: unsupportedBehaviors,
    metrics,
    requirements,
    harnessReports: {
      acquisitionAdapterConformance: pipelineReport.acquisition?.conformance || null,
      acquisitionToStorePipeline: pipelineReport
    },
    summary: null
  };

  report.summary = buildCertificationSummary(report);
  return report;
}

module.exports = {
  CERTIFICATION_LEVELS,
  CERTIFICATION_STANDARD_VERSION,
  DEFAULT_THRESHOLDS,
  SOURCE,
  buildCertificationSummary,
  calculateQualityMetrics,
  determineCertificationLevel,
  evaluateCertificationRequirements,
  inferUnsupportedBehaviors,
  runMarketplaceAdapterCertification
};
