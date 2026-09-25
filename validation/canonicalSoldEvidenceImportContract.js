'use strict';

const {
  normalizeSoldEvidenceRecord
} = require('../utils/soldEvidenceStore');
const {
  validateCanonicalRecord
} = require('./soldEvidenceStoreConformance');
const {
  asArray,
  asObject,
  fingerprint,
  unique
} = require('./canonicalValidationCore');

const SOURCE = 'canonical_sold_evidence_import_contract';
const VERSION = '0.1.0';
const SCHEMA_VERSION = '1.0.0';

const SOURCE_CLASSES = Object.freeze([
  'approved_api',
  'owner_supplied_export',
  'owner_manual_verification'
]);

const CONFIRMATION_STATUSES = Object.freeze([
  'confirmed_final_price',
  'owner_verified_final_price',
  'unconfirmed',
  'estimated',
  'asking_price',
  'active_listing',
  'unknown'
]);

const LISTING_TYPES = Object.freeze([
  'auction',
  'buy_it_now',
  'best_offer',
  'fixed_price',
  'unknown'
]);

const PROVENANCE_CATEGORIES = Object.freeze([
  'provider_api',
  'owner_export',
  'manual_verification',
  'platform_transaction_record',
  'source_url',
  'receipt_or_invoice',
  'screenshot_review',
  'unknown'
]);

const RETENTION_STATUSES = Object.freeze([
  'permanent_allowed',
  'internal_retention_allowed',
  'allowed',
  'restricted',
  'prohibited',
  'unknown'
]);

const PERMITTED_RETENTION_STATUSES = Object.freeze([
  'permanent_allowed',
  'internal_retention_allowed',
  'allowed'
]);

const TRUSTED_USE = 'canonical_sold_evidence_import';

const REASON_CODES = Object.freeze([
  'canonical_ready',
  'duplicate_record_detected',
  'estimated_price_not_canonical_ready',
  'exact_identity_required',
  'final_price_required',
  'identity_artifact_record_mismatch',
  'import_record_invalid',
  'manual_verification_artifact_incomplete',
  'manual_verification_record_mismatch',
  'manual_verification_required',
  'malformed_record',
  'missing_acquisition_timestamp',
  'missing_final_sale_price',
  'missing_permission_retention_status',
  'missing_provenance_category',
  'missing_sale_date',
  'missing_source_class',
  'missing_source_name',
  'owner_export_not_provider_confirmed',
  'owner_export_requires_trusted_verification',
  'prohibited_or_unknown_retention',
  'source_class_mismatch',
  'trusted_identity_artifact_missing',
  'trusted_sale_confirmation_missing',
  'trusted_source_policy_mismatch',
  'trusted_source_policy_missing',
  'unsupported_confirmation_status',
  'unsupported_listing_type',
  'unsupported_provenance_category',
  'unsupported_source_class',
  'untrusted_confirmation_claim',
  'untrusted_identity_claim',
  'untrusted_permission_claim',
  'unconfirmed_price_not_canonical_ready',
  'active_or_asking_price_not_canonical_ready'
]);

const PUBLIC_DIAGNOSTIC_FIELDS = Object.freeze([
  'source',
  'version',
  'schemaVersion',
  'totalRecords',
  'canonicalReadyCount',
  'rejectedCount',
  'duplicateCount',
  'sourceClassCounts',
  'reasonCodeCounts',
  'canonicalReadyBySourceClass',
  'recordDiagnostics',
  'batchFingerprint',
  'nonPersistent',
  'writesProductionStore',
  'productionImpact',
  'decisionImpact',
  'executionAuthority'
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_.:-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim();
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100) / 100;
}

function normalizeEnum(value, allowlist, fallback = 'unknown') {
  const normalized = normalizeText(value);
  return allowlist.includes(normalized) ? normalized : fallback;
}

function normalizeRetentionStatus(value) {
  const normalized = normalizeText(value);
  if (['permanent_allowed', 'allowed', 'retain_allowed', 'internal_retention_allowed'].includes(normalized)) {
    return normalized === 'retain_allowed' ? 'permanent_allowed' : normalized;
  }
  if (['restricted', 'retention_restricted', 'limited', 'limited_retention'].includes(normalized)) return 'restricted';
  if (['prohibited', 'not_allowed', 'do_not_retain'].includes(normalized)) return 'prohibited';
  return normalized || 'unknown';
}

function normalizeIdentity(input = {}) {
  const identity = asObject(input.identity || input.parsedIdentity || input.canonicalIdentity);
  return clone(identity);
}

function hasUntrustedIdentityClaim(input = {}) {
  return input.exactIdentityVerified === true ||
    normalizeText(input.identityVerificationStatus) === 'exact' ||
    normalizeText(input.identityStatus) === 'exact';
}

function hasUntrustedConfirmationClaim(input = {}) {
  return ['confirmed_final_price', 'owner_verified_final_price'].includes(
    normalizeEnum(input.confirmationStatus || input.priceConfirmationStatus, CONFIRMATION_STATUSES, 'unknown')
  );
}

function hasUntrustedPermissionClaim(input = {}) {
  const retention = asObject(input.retention || input.permission || input.permissions);
  const status = normalizeRetentionStatus(input.retentionStatus || retention.status);
  return PERMITTED_RETENTION_STATUSES.includes(status) ||
    normalizeText(retention.sourceApprovalStatus || input.sourceApprovalStatus).includes('approved');
}

function normalizeImportCandidate(input = {}, options = {}) {
  const record = asObject(input);
  const sourceClass = normalizeEnum(record.sourceClass, SOURCE_CLASSES, 'unknown');
  const source = asObject(record.source);
  const retention = asObject(record.retention || record.permission || record.permissions);
  const retentionStatus = normalizeRetentionStatus(record.retentionStatus || retention.status);
  const finalSalePrice = money(record.finalSalePrice ?? record.soldPrice ?? record.salePrice ?? record.price);
  const saleDate = normalizeDate(record.saleDate || record.soldAt || record.soldDate || record.dateSold);
  const acquiredAt = normalizeDate(record.acquiredAt || source.acquiredAt || options.acquiredAt);
  const listingType = normalizeEnum(record.listingType || record.saleType, LISTING_TYPES, 'unknown');
  const confirmationStatus = normalizeEnum(record.confirmationStatus || record.priceConfirmationStatus, CONFIRMATION_STATUSES, 'unknown');
  const sourceProviderName = String(record.sourceProviderName || record.providerName || record.sourceName || record.marketplace || '').trim();
  const provenanceCategories = unique(asArray(record.provenanceCategories || record.provenance || record.evidenceProvenance)
    .map((category) => normalizeEnum(category, PROVENANCE_CATEGORIES, 'unknown')))
    .filter((category) => category !== 'unknown')
    .sort();
  const identity = normalizeIdentity(record);

  const normalized = {
    schemaVersion: SCHEMA_VERSION,
    sourceClass,
    sourceProviderName,
    externalTransactionId: record.externalTransactionId || record.marketplaceSaleId || record.saleId || null,
    externalListingId: record.externalListingId || record.marketplaceListingId || record.listingId || null,
    saleDate,
    currency: String(record.currency || 'USD').trim().toUpperCase(),
    finalSalePrice,
    listingType,
    confirmationStatus,
    exactIdentityVerified: false,
    untrustedClaims: {
      identity: hasUntrustedIdentityClaim(record),
      confirmation: hasUntrustedConfirmationClaim(record),
      permission: hasUntrustedPermissionClaim(record)
    },
    identity,
    provenanceCategories,
    acquiredAt,
    retentionStatus,
    permission: {
      retentionStatus,
      sourceTerms: retention.sourceTerms || record.sourceTerms || 'unknown',
      sourceApprovalStatus: retention.sourceApprovalStatus || record.sourceApprovalStatus || 'unknown'
    },
    manualVerification: {
      verified: record.manualVerification?.verified === true || record.ownerVerified === true,
      verifier: record.manualVerification?.verifier || record.verifiedBy || null,
      verifiedAt: normalizeDate(record.manualVerification?.verifiedAt || record.verifiedAt)
    },
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  normalized.importCandidateFingerprint = fingerprint({
    schemaVersion: normalized.schemaVersion,
    sourceClass: normalized.sourceClass,
    sourceProviderName: normalized.sourceProviderName,
    externalTransactionId: normalized.externalTransactionId ? 'present' : null,
    externalListingId: normalized.externalListingId ? 'present' : null,
    saleDate: normalized.saleDate,
    currency: normalized.currency,
    finalSalePrice: normalized.finalSalePrice,
    listingType: normalized.listingType,
    confirmationStatus: normalized.confirmationStatus,
    identity: normalized.identity,
    provenanceCategories: normalized.provenanceCategories,
    acquiredAt: normalized.acquiredAt
  });
  return deepFreeze(normalized);
}

function trustedArrays(context = {}) {
  const trustedContext = asObject(context);
  return {
    sourcePolicies: asArray(trustedContext.sourcePolicies),
    identityArtifacts: asArray(trustedContext.identityArtifacts),
    saleConfirmationArtifacts: asArray(trustedContext.saleConfirmationArtifacts),
    manualVerificationArtifacts: asArray(trustedContext.manualVerificationArtifacts)
  };
}

function policyMatchesCandidate(policy = {}, candidate = {}) {
  const permittedUses = asArray(policy.allowedUses || policy.permittedUses || policy.use);
  const expiresAt = normalizeDate(policy.expiresAt);
  return policy.active !== false &&
    normalizeEnum(policy.sourceClass, SOURCE_CLASSES, 'unknown') === candidate.sourceClass &&
    String(policy.sourceProviderName || policy.providerName || '').trim() === candidate.sourceProviderName &&
    PERMITTED_RETENTION_STATUSES.includes(normalizeRetentionStatus(policy.retentionStatus)) &&
    (permittedUses.includes(TRUSTED_USE) || permittedUses.includes('internal_validation')) &&
    Boolean(policy.policyVersion) &&
    Boolean(policy.policyFingerprint) &&
    (!expiresAt || expiresAt > new Date(0).toISOString());
}

function findTrustedSourcePolicy(candidate = {}, trustedContext = {}) {
  return trustedArrays(trustedContext).sourcePolicies.find((policy) => policyMatchesCandidate(asObject(policy), candidate)) || null;
}

function identityArtifactMatches(artifact = {}, candidate = {}) {
  return artifact.recordFingerprint === candidate.importCandidateFingerprint &&
    artifact.artifactFingerprint &&
    ['EXACT', 'exact'].includes(artifact.identityClassification || artifact.classification || artifact.identityStatus) &&
    ['valid', 'passed'].includes(normalizeText(artifact.integrityStatus || artifact.validationStatus || artifact.status)) &&
    ['consistent', 'valid', 'passed'].includes(normalizeText(artifact.consistencyStatus || artifact.resolutionStatus || artifact.status));
}

function findTrustedIdentityArtifact(candidate = {}, trustedContext = {}) {
  return trustedArrays(trustedContext).identityArtifacts.find((artifact) => identityArtifactMatches(asObject(artifact), candidate)) || null;
}

function confirmationArtifactMatches(artifact = {}, candidate = {}, policy = {}) {
  const sourceClass = normalizeEnum(artifact.sourceClass, SOURCE_CLASSES, 'unknown');
  const confirmationStatus = normalizeEnum(artifact.confirmationStatus, CONFIRMATION_STATUSES, 'unknown');
  return artifact.recordFingerprint === candidate.importCandidateFingerprint &&
    artifact.artifactFingerprint &&
    artifact.approvedAdapter === true &&
    sourceClass === candidate.sourceClass &&
    String(artifact.sourceProviderName || artifact.providerName || '').trim() === candidate.sourceProviderName &&
    artifact.sourcePolicyFingerprint === policy.policyFingerprint &&
    confirmationStatus === 'confirmed_final_price' &&
    artifact.completedTransactionEvidenceFingerprint &&
    artifact.finalPriceEvidenceFingerprint &&
    ['valid', 'passed'].includes(normalizeText(artifact.integrityStatus || artifact.validationStatus || artifact.status));
}

function findTrustedSaleConfirmationArtifact(candidate = {}, trustedContext = {}, policy = {}) {
  return trustedArrays(trustedContext).saleConfirmationArtifacts
    .find((artifact) => confirmationArtifactMatches(asObject(artifact), candidate, policy)) || null;
}

function manualArtifactMatches(artifact = {}, candidate = {}, identityArtifact = {}, policy = {}) {
  return artifact.recordFingerprint === candidate.importCandidateFingerprint &&
    artifact.recordBindingFingerprint === candidate.importCandidateFingerprint &&
    artifact.artifactFingerprint &&
    artifact.sourcePolicyFingerprint === policy.policyFingerprint &&
    artifact.exactIdentityArtifactFingerprint === identityArtifact.artifactFingerprint &&
    artifact.completedTransactionEvidenceFingerprint &&
    artifact.finalPriceEvidenceFingerprint &&
    artifact.verificationMethod &&
    artifact.verifierCategory &&
    normalizeDate(artifact.verifiedAt) &&
    normalizeText(artifact.verificationOutcome) === 'verified' &&
    ['valid', 'passed'].includes(normalizeText(artifact.integrityStatus || artifact.validationStatus || artifact.status));
}

function findTrustedManualVerificationArtifact(candidate = {}, trustedContext = {}, identityArtifact = {}, policy = {}) {
  return trustedArrays(trustedContext).manualVerificationArtifacts
    .find((artifact) => manualArtifactMatches(asObject(artifact), candidate, identityArtifact, policy)) || null;
}

function canonicalProjectionForCandidate(candidate = {}, trustProof = {}) {
  const policy = asObject(trustProof.policy);
  const saleConfirmation = asObject(trustProof.saleConfirmationArtifact);
  const manualVerification = asObject(trustProof.manualVerificationArtifact);
  const sourceArtifact = saleConfirmation.artifactFingerprint ? saleConfirmation : manualVerification;
  const sourceProviderName = String(policy.sourceProviderName || policy.providerName || candidate.sourceProviderName || '').trim();
  const retentionStatus = normalizeRetentionStatus(policy.retentionStatus);

  return normalizeSoldEvidenceRecord({
    marketplace: sourceProviderName || candidate.sourceClass,
    marketplaceLabel: sourceProviderName || candidate.sourceClass,
    marketplaceSaleId: candidate.externalTransactionId,
    marketplaceListingId: candidate.externalListingId,
    rawTitle: 'canonical sold evidence import candidate',
    soldPrice: candidate.finalSalePrice,
    totalPaid: candidate.finalSalePrice,
    currency: candidate.currency,
    soldAt: candidate.saleDate,
    saleType: candidate.listingType,
    url: `canonical-import://${candidate.importCandidateFingerprint}`,
    parsedIdentity: candidate.identity,
    identityConfidence: 1,
    priceConfidence: 1,
    soldDateConfidence: candidate.saleDate ? 1 : 0,
    evidenceQualityScore: 85,
    evidenceQualityLevel: 'strong',
    source: {
      adapter: sourceArtifact.adapter || sourceArtifact.approvedAdapterId || 'trusted_canonical_import_context',
      acquiredAt: candidate.acquiredAt,
      query: '',
      retrievalMethod: sourceArtifact.retrievalMethod || 'trusted_context_import',
      sourceReliability: sourceArtifact.sourceReliability || 'trusted_context_confirmed',
      transformation: 'canonical_sold_evidence_import_trusted_context_validation',
      sourcePolicyFingerprint: policy.policyFingerprint
    },
    retention: {
      status: retentionStatus,
      sourceTerms: policy.sourceTerms || 'trusted_policy',
      sourceApprovalStatus: policy.sourceApprovalStatus || 'trusted_policy_approved',
      policyVersion: policy.policyVersion,
      policyFingerprint: policy.policyFingerprint,
      notes: ['A5.17 canonical import contract validation only']
    },
    status: 'active_evidence'
  }, {
    adapter: sourceArtifact.adapter || sourceArtifact.approvedAdapterId || 'trusted_canonical_import_context',
    retrievalMethod: sourceArtifact.retrievalMethod || 'trusted_context_import',
    sourceReliability: sourceArtifact.sourceReliability || 'trusted_context_confirmed',
    acquiredAt: candidate.acquiredAt,
    retentionStatus,
    sourceTerms: policy.sourceTerms || 'trusted_policy',
    sourceApprovalStatus: policy.sourceApprovalStatus || 'trusted_policy_approved'
  });
}

function duplicateFingerprintForCanonicalRecord(record = {}) {
  return fingerprint({
    duplicateKeys: asArray(record.duplicateKeys).sort(),
    canonicalCardKey: record.canonicalCardKey || 'unknown'
  });
}

function classProvenanceRequired(sourceClass) {
  if (sourceClass === 'approved_api') return 'provider_api';
  if (sourceClass === 'owner_supplied_export') return 'owner_export';
  if (sourceClass === 'owner_manual_verification') return 'manual_verification';
  return 'unknown';
}

function validateSourceClass(candidate = {}, reasons = []) {
  if (!SOURCE_CLASSES.includes(candidate.sourceClass)) reasons.push('unsupported_source_class');
  if (!candidate.sourceProviderName) reasons.push('missing_source_name');
  const requiredProvenance = classProvenanceRequired(candidate.sourceClass);
  if (!candidate.provenanceCategories.length) reasons.push('missing_provenance_category');
  if (requiredProvenance !== 'unknown' && !candidate.provenanceCategories.includes(requiredProvenance)) {
    reasons.push('source_class_mismatch');
  }
  for (const category of candidate.provenanceCategories) {
    if (!PROVENANCE_CATEGORIES.includes(category)) reasons.push('unsupported_provenance_category');
  }
  if (candidate.sourceClass === 'owner_supplied_export' && candidate.provenanceCategories.includes('provider_api')) {
    reasons.push('owner_export_not_provider_confirmed');
  }
}

function validateRowFields(candidate = {}, reasons = []) {
  if (!candidate.finalSalePrice || candidate.finalSalePrice <= 0) reasons.push('missing_final_sale_price');
  if (!candidate.saleDate) reasons.push('missing_sale_date');
  if (!candidate.acquiredAt) reasons.push('missing_acquisition_timestamp');
  if (!candidate.retentionStatus || candidate.retentionStatus === 'unknown') reasons.push('missing_permission_retention_status');
  if (!PERMITTED_RETENTION_STATUSES.includes(candidate.retentionStatus)) reasons.push('prohibited_or_unknown_retention');
  if (!CONFIRMATION_STATUSES.includes(candidate.confirmationStatus)) reasons.push('unsupported_confirmation_status');
  if (!LISTING_TYPES.includes(candidate.listingType)) reasons.push('unsupported_listing_type');
  if (['unconfirmed'].includes(candidate.confirmationStatus)) reasons.push('unconfirmed_price_not_canonical_ready');
  if (['estimated'].includes(candidate.confirmationStatus)) reasons.push('estimated_price_not_canonical_ready');
  if (['asking_price', 'active_listing'].includes(candidate.confirmationStatus)) {
    reasons.push('active_or_asking_price_not_canonical_ready');
  }
  if (!['confirmed_final_price', 'owner_verified_final_price'].includes(candidate.confirmationStatus)) {
    reasons.push('final_price_required');
  }
}

function resolveTrustProof(candidate = {}, trustedContext = {}, reasons = []) {
  const arrays = trustedArrays(trustedContext);
  const policy = findTrustedSourcePolicy(candidate, trustedContext);
  if (!policy) reasons.push('trusted_source_policy_missing');
  if (!policy && arrays.sourcePolicies.length) reasons.push('trusted_source_policy_mismatch');
  if (!policy && candidate.untrustedClaims.permission) reasons.push('untrusted_permission_claim');

  const identityArtifact = findTrustedIdentityArtifact(candidate, trustedContext);
  if (!identityArtifact) reasons.push('trusted_identity_artifact_missing');
  if (!identityArtifact && candidate.untrustedClaims.identity) reasons.push('untrusted_identity_claim');
  if (arrays.identityArtifacts.length &&
    !arrays.identityArtifacts.some((artifact) => artifact.recordFingerprint === candidate.importCandidateFingerprint)) {
    reasons.push('identity_artifact_record_mismatch');
  }

  let saleConfirmationArtifact = null;
  let manualVerificationArtifact = null;
  if (policy) {
    saleConfirmationArtifact = findTrustedSaleConfirmationArtifact(candidate, trustedContext, policy);
    if (identityArtifact) {
      manualVerificationArtifact = findTrustedManualVerificationArtifact(candidate, trustedContext, identityArtifact, policy);
    }
  }

  if (candidate.sourceClass === 'approved_api' && !saleConfirmationArtifact) {
    reasons.push('trusted_sale_confirmation_missing');
  }
  if (!saleConfirmationArtifact && !manualVerificationArtifact && candidate.untrustedClaims.confirmation) {
    reasons.push('untrusted_confirmation_claim');
  }

  if (candidate.sourceClass === 'owner_supplied_export' && !saleConfirmationArtifact && !manualVerificationArtifact) {
    reasons.push('owner_export_requires_trusted_verification');
  }

  if (candidate.sourceClass === 'owner_manual_verification' && !manualVerificationArtifact) {
    reasons.push('manual_verification_artifact_incomplete');
  }

  if (policy && (normalizeEnum(policy.sourceClass, SOURCE_CLASSES, 'unknown') !== candidate.sourceClass ||
    String(policy.sourceProviderName || policy.providerName || '').trim() !== candidate.sourceProviderName)) {
    reasons.push('trusted_source_policy_mismatch');
  }

  if (candidate.sourceClass === 'owner_manual_verification' && arrays.manualVerificationArtifacts.length &&
    !arrays.manualVerificationArtifacts.some((artifact) => artifact.recordFingerprint === candidate.importCandidateFingerprint)) {
    reasons.push('manual_verification_record_mismatch');
  }

  return {
    policy,
    identityArtifact,
    saleConfirmationArtifact,
    manualVerificationArtifact
  };
}

function publicRecordDiagnostic(index, candidate = {}, validation = {}) {
  return deepFreeze({
    index,
    sourceClass: SOURCE_CLASSES.includes(candidate.sourceClass) ? candidate.sourceClass : 'unknown',
    canonicalReady: validation.canonicalReady === true,
    reasonCodes: unique(validation.reasonCodes).sort()
  });
}

function validateCanonicalSoldEvidenceImportCandidate(input = {}, options = {}) {
  const original = clone(input);
  const trustedOriginal = clone(options.trustedContext || {});
  const candidate = normalizeImportCandidate(input, options);
  const reasonCodes = [];
  let canonicalRecord = null;
  let canonicalValidation = null;
  let duplicateFingerprint = null;

  validateSourceClass(candidate, reasonCodes);
  validateRowFields(candidate, reasonCodes);
  const trustProof = resolveTrustProof(candidate, options.trustedContext, reasonCodes);

  try {
    if (trustProof.policy && trustProof.identityArtifact &&
      (trustProof.saleConfirmationArtifact || trustProof.manualVerificationArtifact)) {
      canonicalRecord = canonicalProjectionForCandidate(candidate, trustProof);
      canonicalValidation = validateCanonicalRecord(canonicalRecord);
      duplicateFingerprint = duplicateFingerprintForCanonicalRecord(canonicalRecord);
      if (!canonicalValidation.valid) {
        reasonCodes.push(...asArray(canonicalValidation.reasons).map((reason) => normalizeText(reason)));
      }
    }
  } catch (_) {
    reasonCodes.push('malformed_record');
  }

  const safeReasonCodes = unique(reasonCodes)
    .filter((reason) => REASON_CODES.includes(reason))
    .sort();
  const canonicalReady = safeReasonCodes.length === 0;
  if (canonicalReady) safeReasonCodes.push('canonical_ready');

  const result = {
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    valid: canonicalReady,
    canonicalReady,
    sourceClass: candidate.sourceClass,
    normalizedCandidate: candidate,
    normalizedCanonicalRecord: canonicalReady ? deepFreeze(canonicalRecord) : null,
    reasonCodes: safeReasonCodes,
    duplicateFingerprint,
    publicDiagnostic: null,
    trustContextStatus: {
      sourcePolicyTrusted: Boolean(trustProof.policy),
      identityArtifactTrusted: Boolean(trustProof.identityArtifact),
      saleConfirmationTrusted: Boolean(trustProof.saleConfirmationArtifact),
      manualVerificationTrusted: Boolean(trustProof.manualVerificationArtifact)
    },
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  result.publicDiagnostic = publicRecordDiagnostic(0, candidate, result);
  result.validationFingerprint = fingerprint({
    valid: result.valid,
    canonicalReady: result.canonicalReady,
    sourceClass: result.sourceClass,
    reasonCodes: result.reasonCodes,
    trustContextStatus: result.trustContextStatus,
    duplicatePresent: Boolean(duplicateFingerprint)
  });

  if (JSON.stringify(original) !== JSON.stringify(input || {})) {
    throw new Error('canonical_sold_evidence_import_contract_mutated_input');
  }
  if (JSON.stringify(trustedOriginal) !== JSON.stringify(options.trustedContext || {})) {
    throw new Error('canonical_sold_evidence_import_contract_mutated_trusted_context');
  }

  return deepFreeze(result);
}

function increment(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function sortedCountMap(map = {}, allowlist = null) {
  const allowed = allowlist ? new Set(allowlist) : null;
  return deepFreeze(Object.fromEntries(Object.entries(asObject(map))
    .filter(([key, value]) => (!allowed || allowed.has(key)) && Number(value) > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, Math.max(0, Math.floor(Number(value) || 0))])));
}

function buildInternalDuplicateDiagnostics(results = []) {
  const duplicateCounts = {};
  for (const result of results) {
    if (result.duplicateFingerprint) increment(duplicateCounts, result.duplicateFingerprint);
  }
  const duplicateFingerprints = Object.entries(duplicateCounts)
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort();
  return deepFreeze({
    duplicateCount: duplicateFingerprints.length,
    duplicateFingerprints
  });
}

function buildPublicDiagnostics(results = [], internalDuplicateDiagnostics = {}) {
  const sourceClassCounts = {};
  const reasonCodeCounts = {};
  const canonicalReadyBySourceClass = {};
  const duplicateFingerprints = asArray(internalDuplicateDiagnostics.duplicateFingerprints);
  const duplicateSet = new Set(duplicateFingerprints);

  for (const result of results) {
    increment(sourceClassCounts, result.sourceClass);
    for (const reason of result.reasonCodes) increment(reasonCodeCounts, reason);
    if (result.canonicalReady) increment(canonicalReadyBySourceClass, result.sourceClass);
  }

  const recordDiagnostics = results.map((result, index) => publicRecordDiagnostic(
    index,
    result.normalizedCandidate,
    {
      canonicalReady: result.canonicalReady,
      reasonCodes: duplicateSet.has(result.duplicateFingerprint)
        ? unique([...result.reasonCodes, 'duplicate_record_detected']).sort()
        : result.reasonCodes
    }
  ));

  for (const duplicate of duplicateFingerprints) increment(reasonCodeCounts, 'duplicate_record_detected');

  const diagnostics = {
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    totalRecords: results.length,
    canonicalReadyCount: results.filter((result) => result.canonicalReady).length,
    rejectedCount: results.filter((result) => !result.canonicalReady).length,
    duplicateCount: internalDuplicateDiagnostics.duplicateCount || 0,
    sourceClassCounts: sortedCountMap(sourceClassCounts, SOURCE_CLASSES),
    reasonCodeCounts: sortedCountMap(reasonCodeCounts, REASON_CODES),
    canonicalReadyBySourceClass: sortedCountMap(canonicalReadyBySourceClass, SOURCE_CLASSES),
    recordDiagnostics,
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  diagnostics.batchFingerprint = fingerprint({
    ...diagnostics,
    batchFingerprint: undefined
  });
  return deepFreeze(diagnostics);
}

function validateCanonicalSoldEvidenceImportBatch(input = [], options = {}) {
  const records = Array.isArray(input) ? input : asArray(asObject(input).records);
  const results = records.map((record) => validateCanonicalSoldEvidenceImportCandidate(record, options));
  const internalDuplicateDiagnostics = buildInternalDuplicateDiagnostics(results);
  const publicDiagnostics = buildPublicDiagnostics(results, internalDuplicateDiagnostics);
  const result = {
    source: SOURCE,
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    valid: results.every((entry) => entry.valid) && publicDiagnostics.duplicateCount === 0,
    results,
    internalDuplicateDiagnostics,
    publicDiagnostics,
    nonPersistent: true,
    writesProductionStore: false,
    productionImpact: 'none',
    decisionImpact: 'none',
    executionAuthority: 'none'
  };
  result.batchValidationFingerprint = fingerprint({
    valid: result.valid,
    publicDiagnostics
  });
  return deepFreeze(result);
}

function summarizeCanonicalSoldEvidenceImportValidation(validation = {}) {
  const diagnostics = asObject(validation.publicDiagnostics || validation);
  return deepFreeze(Object.fromEntries(PUBLIC_DIAGNOSTIC_FIELDS
    .filter((field) => diagnostics[field] !== undefined)
    .map((field) => [field, diagnostics[field]])));
}

module.exports = {
  SOURCE,
  VERSION,
  SCHEMA_VERSION,
  SOURCE_CLASSES,
  CONFIRMATION_STATUSES,
  LISTING_TYPES,
  PROVENANCE_CATEGORIES,
  RETENTION_STATUSES,
  PERMITTED_RETENTION_STATUSES,
  TRUSTED_USE,
  REASON_CODES,
  PUBLIC_DIAGNOSTIC_FIELDS,
  normalizeImportCandidate,
  validateCanonicalSoldEvidenceImportCandidate,
  validateCanonicalSoldEvidenceImportBatch,
  summarizeCanonicalSoldEvidenceImportValidation,
  duplicateFingerprintForCanonicalRecord
};
