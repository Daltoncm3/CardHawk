'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CANDIDATE_ADMISSION_STATUS,
  CANDIDATE_CONFLICT_STATUSES,
  buildTitleProviderEvidenceCandidates
} = require('../validation/titleProviderEvidenceCandidateLayer');

function diagnostics(overrides = {}) {
  return {
    missingMaterialFieldsAfter: ['subjectName', 'cardNumber', 'parallel', 'autographState', 'serialNumbered'],
    conflictFields: [],
    exactIdentityBlockerFields: ['subjectName', 'cardNumber', 'parallel', 'autographState', 'serialNumbered'],
    ...overrides
  };
}

test('explicit title text creates sanitized candidate-only evidence without admission', () => {
  const result = buildTitleProviderEvidenceCandidates({
    normalizedListingTitle: '2024 Topps Chrome Shohei Ohtani #17 Gold Auto /99 PSA 10',
    providerMetadata: {},
    identityDiagnostics: diagnostics()
  });
  const serializedPublic = JSON.stringify(result.diagnostics);

  assert.equal(result.candidates.some((candidate) => candidate.field === 'subjectName'), true);
  assert.equal(result.candidates.every((candidate) => candidate.admissionStatus === CANDIDATE_ADMISSION_STATUS), true);
  assert.equal(result.candidates.every((candidate) => candidate.productionImpact === 'none'), true);
  assert.equal(result.diagnostics.candidateFields.includes('subjectName'), true);
  assert.equal(result.diagnostics.candidateProvenanceCategoriesByField.subjectName.includes('explicit_title_evidence'), true);
  assert.equal(result.diagnostics.candidateReasonCodesByField.subjectName.includes('candidate_only_not_admitted'), true);
  assert.equal(result.diagnostics.titleOrMetadataCouldMateriallyHelp, true);
  assert.equal(serializedPublic.includes('Shohei'), false);
  assert.equal(serializedPublic.includes('Ohtani'), false);
  assert.equal(serializedPublic.includes('Gold'), false);
  assert.equal(serializedPublic.includes('17'), false);
});

test('allowlisted provider metadata creates candidate-only evidence without admission', () => {
  const result = buildTitleProviderEvidenceCandidates({
    normalizedListingTitle: '',
    providerMetadata: {
      player: 'Anthony Hernandez',
      card_number: '181',
      setName: 'Prizm',
      trackingId: 'provider-secret-id'
    },
    identityDiagnostics: diagnostics({ missingMaterialFieldsAfter: ['subjectName', 'cardNumber', 'setName'] })
  });
  const serializedPublic = JSON.stringify(result.diagnostics);

  assert.equal(result.candidates.some((candidate) => candidate.field === 'subjectName'), true);
  assert.equal(result.candidates.some((candidate) => candidate.field === 'cardNumber'), true);
  assert.equal(result.diagnostics.candidateProvenanceCategoriesByField.subjectName.includes('provider_metadata'), true);
  assert.equal(result.diagnostics.candidateReasonCodesByField.cardNumber.includes('provider_metadata_candidate'), true);
  assert.equal(serializedPublic.includes('Anthony'), false);
  assert.equal(serializedPublic.includes('Hernandez'), false);
  assert.equal(serializedPublic.includes('provider-secret-id'), false);
});

test('absence and nonappearance cannot create negative absence-sensitive candidates', () => {
  const result = buildTitleProviderEvidenceCandidates({
    normalizedListingTitle: '2024 Topps Chrome Shohei Ohtani #17 No Auto No Patch Unnumbered Raw',
    providerMetadata: {
      autographState: false,
      memorabiliaState: false,
      serialNumbered: false,
      rawOrGraded: 'raw'
    },
    identityDiagnostics: diagnostics()
  });

  assert.equal(result.diagnostics.candidateFields.includes('autographState'), false);
  assert.equal(result.diagnostics.candidateFields.includes('memorabiliaState'), false);
  assert.equal(result.diagnostics.candidateFields.includes('serialNumbered'), false);
  assert.equal(result.diagnostics.candidateFields.includes('rawOrGraded'), false);
  assert.equal(result.candidates.some((candidate) => candidate.normalizedCandidateValue === false), false);
});

test('conflicting title and provider metadata candidates remain unresolved and not admitted', () => {
  const result = buildTitleProviderEvidenceCandidates({
    normalizedListingTitle: '2024 Topps Chrome Shohei Ohtani #17 Gold',
    providerMetadata: {
      cardNumber: '99',
      parallel: 'Blue'
    },
    identityDiagnostics: diagnostics({ missingMaterialFieldsAfter: ['cardNumber', 'parallel'] })
  });

  assert.deepEqual(result.diagnostics.candidateConflictFields, ['cardNumber', 'parallel']);
  assert.equal(result.diagnostics.candidateReasonCodesByField.cardNumber.includes('title_provider_metadata_conflict'), true);
  assert.equal(result.candidates
    .filter((candidate) => candidate.field === 'cardNumber')
    .every((candidate) => candidate.conflictStatus === CANDIDATE_CONFLICT_STATUSES.UNRESOLVED), true);
  assert.equal(result.candidates.every((candidate) => candidate.admissionStatus === CANDIDATE_ADMISSION_STATUS), true);
});

test('malformed and non-allowlisted provider metadata fails closed', () => {
  const result = buildTitleProviderEvidenceCandidates({
    normalizedListingTitle: '',
    providerMetadata: {
      transactionId: 'secret-transaction',
      sourceUrl: 'https://example.test/listing',
      imageUrl: 'https://example.test/image.jpg',
      rawProviderPayload: { player: 'Leaked Name' },
      autographState: false,
      year: { value: 2024 }
    },
    identityDiagnostics: diagnostics()
  });
  const serializedPublic = JSON.stringify(result.diagnostics);

  assert.deepEqual(result.diagnostics.candidateFields, []);
  assert.deepEqual(result.candidates, []);
  assert.equal(serializedPublic.includes('secret-transaction'), false);
  assert.equal(serializedPublic.includes('https://'), false);
  assert.equal(serializedPublic.includes('Leaked'), false);
});

test('candidate layer is deterministic, bounded, immutable, and keeps provisional prices non-canonical', () => {
  const input = {
    normalizedListingTitle: '2024 Topps Chrome Shohei Ohtani #17 Gold Auto /99 PSA 10',
    providerMetadata: {
      player: 'Shohei Ohtani',
      cardNumber: '17',
      price_confirmed: 'true'
    },
    identityDiagnostics: diagnostics()
  };
  const first = buildTitleProviderEvidenceCandidates(input);
  const second = buildTitleProviderEvidenceCandidates(input);

  assert.equal(first.candidateLayerFingerprint, second.candidateLayerFingerprint);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(first.candidates.length <= 16, true);
  assert.equal(first.diagnostics.canonicalSoldEvidenceStructurallyReady, false);
  assert.equal(first.diagnostics.candidateCountByField.cardNumber, 2);
  assert.deepEqual([...first.diagnostics.candidateFields], [...first.diagnostics.candidateFields].sort());
});

test('module imports no production runtime, persistence, notification, scanner, purchase, or server code', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'validation', 'titleProviderEvidenceCandidateLayer.js'), 'utf8');
  const forbidden = [
    'server.js',
    'appStore',
    'stateStore',
    'notificationEngine',
    'scoutScannerService',
    'BUY_NOW',
    'purchase',
    'bid',
    'offer',
    'fetch('
  ];

  for (const token of forbidden) {
    assert.equal(source.includes(token), false, `forbidden token present: ${token}`);
  }
});
