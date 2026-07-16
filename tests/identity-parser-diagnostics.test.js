'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DIAGNOSTIC_STATUS,
  IDENTITY_PARSER_DIAGNOSTIC_SOURCE,
  REVIEW_ACTION,
  buildIdentityParserDiagnosticFingerprint,
  evaluateIdentityParserDiagnostics,
  summarizeIdentityParserDiagnostics
} = require('../validation/identityParserDiagnostics');
const {
  createProductionIntelligenceTrace
} = require('../validation/productionIntelligenceTrace');

function strongListing(overrides = {}) {
  return {
    title: '2020 Panini Prizm Anthony Edwards Silver Rookie PSA 10 #258',
    ebayItemId: 'identity-1001',
    parsed: {
      sport: 'basketball',
      player: 'Anthony Edwards',
      year: '2020',
      brand: 'Panini',
      product: 'Prizm',
      setName: 'Prizm',
      cardNumber: '258',
      parallel: 'Silver',
      rookie: true,
      autograph: false,
      memorabilia: false,
      serialNumbered: false,
      rawOrGraded: 'graded',
      gradeCompany: 'PSA',
      grade: '10',
      flags: {
        rookie: true,
        autograph: false,
        graded: true,
        numbered: false,
        lot: false,
        reprint: false,
        custom: false,
        digital: false
      }
    },
    ...overrides
  };
}

function canonicalIdentity(overrides = {}) {
  return {
    schemaVersion: '1.0.0',
    identityType: 'sports_card',
    category: 'sports_card',
    marketSegment: 'sports',
    canonicalIdentityKey: 'ci:v1:sports:basketball:2020:panini:prizm:anthony-edwards:258:silver:non-auto:non-mem:unnumbered:graded:psa-10',
    raw: {
      title: '2020 Panini Prizm Anthony Edwards Silver Rookie PSA 10 #258',
      source: 'canonical_test_fixture'
    },
    normalizedTitle: '2020 panini prizm anthony edwards silver rookie psa 10 258',
    parserVersion: 'canonical-fixture',
    normalized: {
      sport: 'basketball',
      subject: { name: 'anthony edwards', aliases: [] },
      year: '2020',
      manufacturer: 'panini',
      brand: 'panini',
      product: 'prizm',
      setName: 'prizm',
      cardNumber: '258',
      parallel: 'silver',
      autograph: { state: false, type: null },
      memorabilia: { state: false, type: null },
      serialNumbered: false,
      printRun: null,
      rawOrGraded: 'graded',
      grading: {
        company: 'psa',
        grade: '10',
        certificationNumber: null
      }
    },
    rawExtractedValues: {},
    sourceFields: {},
    fieldConfidence: {},
    overallIdentityConfidence: 0.92,
    unknownFields: [],
    normalizationWarnings: [],
    eligibility: {
      exactCompEligible: true,
      valuationEligible: true,
      manualReviewRequired: false,
      contextOnly: false
    },
    ...overrides
  };
}

test('identity parser diagnostics exports a stable diagnostic-only public API', () => {
  const result = evaluateIdentityParserDiagnostics({
    listing: strongListing(),
    canonicalIdentity: canonicalIdentity()
  });

  assert.equal(result.source, IDENTITY_PARSER_DIAGNOSTIC_SOURCE);
  assert.equal(result.productionImpact, 'none');
  assert.equal(result.decisionImpact, 'none');
  assert.equal(result.diagnosticStatus, DIAGNOSTIC_STATUS.EXACT);
  assert.equal(result.ambiguityLevel, 'none');
  assert.equal(result.identityEligibility.valuationEligible, true);
  assert.equal(result.blockingIssues.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.recommendedReviewAction, REVIEW_ACTION.NONE);
  assert.equal(result.stableFingerprint, buildIdentityParserDiagnosticFingerprint(result));
  assert.match(summarizeIdentityParserDiagnostics(result), /exact identity support/);
});

test('identity parser diagnostics preserve unknowns and classify partial identities', () => {
  const listing = strongListing({
    title: 'Anthony Edwards Prizm Rookie PSA',
    parsed: {
      player: 'Anthony Edwards',
      setName: 'Prizm',
      flags: {
        graded: true
      }
    }
  });
  const result = evaluateIdentityParserDiagnostics({ listing });

  assert.equal(result.diagnosticStatus, DIAGNOSTIC_STATUS.PARTIAL);
  assert.equal(result.ambiguityLevel, 'medium');
  assert.equal(result.fieldsMissing.includes('parser.year'), true);
  assert.equal(result.fieldsMissing.includes('parser.cardNumber'), true);
  assert.equal(result.warnings.includes('grade_number_ambiguity'), true);
  assert.equal(result.warnings.includes('title_only_inference_risk'), true);
  assert.equal(result.recommendedReviewAction, REVIEW_ACTION.COLLECT_MISSING_FIELDS);
});

test('identity parser diagnostics detect parser-to-canonical conflicts and ambiguity risks', () => {
  const result = evaluateIdentityParserDiagnostics({
    listing: strongListing(),
    canonicalIdentity: canonicalIdentity({
      normalized: {
        ...canonicalIdentity().normalized,
        cardNumber: '259',
        parallel: 'base',
        autograph: { state: true, type: 'auto' }
      }
    })
  });

  assert.equal(result.diagnosticStatus, DIAGNOSTIC_STATUS.BLOCKED);
  assert.equal(result.ambiguityLevel, 'blocking');
  assert.equal(result.blockingIssues.includes('card_number_conflict'), true);
  assert.equal(result.blockingIssues.includes('autograph_conflict'), true);
  assert.equal(result.warnings.includes('base_versus_parallel_conflict'), true);
  assert.equal(result.fieldsConflicting.some((entry) => entry.field === 'cardNumber'), true);
  assert.equal(result.recommendedReviewAction, REVIEW_ACTION.RESOLVE_BLOCKERS);
});

test('identity parser diagnostics block lot and reprint/custom/proxy risks without production penalties', () => {
  const result = evaluateIdentityParserDiagnostics({
    listing: strongListing({
      title: '2020 Panini Prizm Anthony Edwards Rookie Lot Reprint Proxy',
      parsed: {
        ...strongListing().parsed,
        flags: {
          ...strongListing().parsed.flags,
          lot: true,
          reprint: true,
          custom: true
        }
      }
    }),
    canonicalIdentity: canonicalIdentity()
  });

  assert.equal(result.diagnosticStatus, DIAGNOSTIC_STATUS.BLOCKED);
  assert.equal(result.blockingIssues.includes('lot_or_multi_card_identity_risk'), true);
  assert.equal(result.blockingIssues.includes('reprint_custom_proxy_identity_risk'), true);
  assert.equal(result.productionImpact, 'none');
  assert.equal(result.decisionImpact, 'none');
});

test('identity parser diagnostics report unsupported identity fields for schema review', () => {
  const result = evaluateIdentityParserDiagnostics({
    listing: strongListing({
      parsed: {
        alienEra: 'future chrome',
        mysteryFoil: true,
        flags: {}
      }
    }),
    canonicalIdentity: canonicalIdentity({
      identityType: 'unknown',
      category: 'unknown',
      normalized: {},
      unknownFields: ['identityType']
    })
  });

  assert.equal(result.diagnosticStatus, DIAGNOSTIC_STATUS.UNSUPPORTED);
  assert.equal(result.unsupportedIdentityFields.map((entry) => entry.field).includes('alienEra'), true);
  assert.equal(result.recommendedReviewAction, REVIEW_ACTION.SCHEMA_REVIEW);
});

test('identity parser diagnostics are deterministic and do not mutate inputs', () => {
  const input = {
    listing: strongListing(),
    canonicalIdentity: canonicalIdentity()
  };
  const before = JSON.parse(JSON.stringify(input));
  const first = evaluateIdentityParserDiagnostics(input);
  const second = evaluateIdentityParserDiagnostics(input);

  assert.deepEqual(input, before);
  assert.deepEqual(second, first);
  assert.equal(first.stableFingerprint, second.stableFingerprint);
});

test('production intelligence trace records supplied identity diagnostics additively', () => {
  const diagnostic = evaluateIdentityParserDiagnostics({
    listing: strongListing(),
    canonicalIdentity: canonicalIdentity()
  });
  const trace = createProductionIntelligenceTrace({
    traceId: 'trace-with-identity-diagnostics',
    listing: strongListing(),
    canonicalIdentity: canonicalIdentity(),
    identityDiagnosticResult: diagnostic,
    dealGateOutcome: {
      passed: false,
      decision: 'REJECT',
      reasons: ['test rejection']
    }
  });

  assert.equal(trace.identityDiagnosticSummary.available, true);
  assert.equal(trace.identityDiagnosticSummary.diagnosticStatus, DIAGNOSTIC_STATUS.EXACT);
  assert.equal(trace.identityDiagnosticSummary.stableFingerprint, diagnostic.stableFingerprint);
  assert.equal(trace.identityDiagnosticSummary.changesProductionBehavior, false);
  assert.equal(trace.dealGateOutcome.decision, 'REJECT');
  assert.equal(trace.buyNowEligibility.eligible, false);
});
