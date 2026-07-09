'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const runner = require('../validation/runDecisionValidation');

function buildEvidence(overrides = {}) {
  return {
    evidenceSufficiency: {
      sufficientForValuation: true,
      sufficiencyLevel: 'adequate',
      evidenceSufficiencyScore: 76,
      blockingConcerns: [],
      summary: 'Evidence sufficiency is adequate.',
      ...(overrides.evidenceSufficiency || {})
    },
    listingSimilarity: {
      similarityBand: 'strong',
      averageSimilarityScore: 92,
      similarityDistribution: { exact: 1, strong: 2, usable: 0, weak: 0, reject: 0 },
      fatalMismatches: [],
      summary: 'Comparable listings show strong similarity to the target listing.',
      ...(overrides.listingSimilarity || {})
    },
    comparableQuality: {
      scoredComparableCount: 3,
      averageComparableQualityScore: 82,
      qualityDistribution: { excellent: 1, good: 2, usable: 0, weak: 0, reject: 0 },
      summary: 'Comparable quality is strong across the available evidence.',
      ...(overrides.comparableQuality || {})
    },
    valuationRange: {
      floorValue: 90,
      expectedValue: 120,
      ceilingValue: 145,
      rangeQuality: 'usable',
      confidence: 72,
      summary: 'Valuation range is usable for explanation.',
      ...(overrides.valuationRange || {})
    },
    supplyPressure: {
      pressureLevel: 'low',
      undercutRiskLevel: 'low',
      resaleBlockerRisk: 'low',
      summary: 'Supply pressure appears low from the available active-market evidence.',
      ...(overrides.supplyPressure || {})
    }
  };
}

test('extractListings supports common exported scan result shapes', () => {
  const arrayListing = [{ id: 'array-listing' }];
  const objectListing = { id: 'object-listing' };

  assert.deepEqual(runner.extractListings(arrayListing), arrayListing);
  assert.deepEqual(runner.extractListings({ listings: arrayListing }), arrayListing);
  assert.deepEqual(runner.extractListings({ records: arrayListing }), arrayListing);
  assert.deepEqual(runner.extractListings({ items: arrayListing }), arrayListing);
  assert.deepEqual(runner.extractListings({ results: arrayListing }), arrayListing);
  assert.deepEqual(runner.extractListings({ scanResults: arrayListing }), arrayListing);
  assert.deepEqual(runner.extractListings({ listings: { one: objectListing } }), [objectListing]);
  assert.deepEqual(runner.extractListings({ data: { listings: arrayListing } }), arrayListing);
  assert.deepEqual(runner.extractListings({ store: { listings: { one: objectListing } } }), [objectListing]);
});

test('evaluateListing runs Decision Intelligence from nested Market Intelligence evidence', () => {
  const listing = {
    ebayItemId: 'abc123',
    title: '2024 Test Rookie PSA 10',
    price: 89.99,
    url: 'https://example.test/item/abc123',
    marketplace: 'ebay',
    marketIntelligenceData: buildEvidence()
  };

  const result = runner.evaluateListing(listing);

  assert.deepEqual(result.listing, {
    index: 0,
    id: 'abc123',
    title: '2024 Test Rookie PSA 10',
    price: 89.99,
    url: 'https://example.test/item/abc123',
    marketplace: 'ebay'
  });
  assert.equal(result.overallReadiness, 'supported_context');
  assert.equal(result.recommendationImpact, 'none');
  assert.ok(Array.isArray(result.supportingSignals));
  assert.ok(Array.isArray(result.cautionSignals));
  assert.ok(Array.isArray(result.blockers));
  assert.ok(Array.isArray(result.conflicts));
  assert.ok(result.summary);
});

test('buildValidationReport produces one report result per listing', () => {
  const scanData = {
    exportedAt: '2026-07-09T00:00:00.000Z',
    listings: [
      {
        id: 'supported',
        title: 'Supported listing',
        marketIntelligenceData: buildEvidence()
      },
      {
        id: 'blocked',
        title: 'Blocked listing',
        scoring: {
          marketIntelligenceData: buildEvidence({
            evidenceSufficiency: {
              sufficientForValuation: false,
              sufficiencyLevel: 'unreliable',
              evidenceSufficiencyScore: 10,
              blockingConcerns: ['No true sold evidence is available.'],
              summary: 'Evidence sufficiency is unreliable from the available evidence.'
            },
            valuationRange: {
              floorValue: 0,
              expectedValue: 0,
              ceilingValue: 0,
              rangeQuality: 'unreliable',
              confidence: 0,
              summary: 'Valuation range is unreliable because true sold support is missing or insufficient.'
            }
          })
        }
      }
    ]
  };

  const report = runner.buildValidationReport(scanData, {
    generatedAt: '2026-07-09T12:00:00.000Z',
    inputFile: '/tmp/cardhawk-scan.json'
  });

  assert.equal(report.source, 'decision_intelligence_live_validation_runner');
  assert.equal(report.mode, 'offline_validation');
  assert.equal(report.generatedAt, '2026-07-09T12:00:00.000Z');
  assert.equal(report.listingCount, 2);
  assert.equal(report.results.length, 2);
  assert.equal(report.results[0].overallReadiness, 'supported_context');
  assert.equal(report.results[1].overallReadiness, 'not_ready');
  assert.ok(report.results[1].blockers.some((item) => item.source === 'evidence_sufficiency'));
});

test('runDecisionValidation reads scan JSON and writes report JSON', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardhawk-decision-validation-'));
  const inputFile = path.join(tempDir, 'scan.json');
  const outputFile = path.join(tempDir, 'report.json');
  const scanData = {
    listings: [
      {
        id: 'scan-one',
        title: 'Scan Listing One',
        marketIntelligenceData: buildEvidence()
      }
    ]
  };

  fs.writeFileSync(inputFile, `${JSON.stringify(scanData, null, 2)}\n`);

  const report = runner.runDecisionValidation(inputFile, outputFile, {
    generatedAt: '2026-07-09T12:00:00.000Z'
  });
  const savedReport = JSON.parse(fs.readFileSync(outputFile, 'utf8'));

  assert.equal(report.listingCount, 1);
  assert.equal(savedReport.listingCount, 1);
  assert.equal(savedReport.results[0].overallReadiness, 'supported_context');
});

test('runner does not mutate scan input objects', () => {
  const scanData = {
    listings: [
      {
        id: 'immutable',
        marketIntelligenceData: buildEvidence()
      }
    ]
  };
  const before = JSON.stringify(scanData);

  runner.buildValidationReport(scanData, {
    generatedAt: '2026-07-09T12:00:00.000Z'
  });

  assert.equal(JSON.stringify(scanData), before);
});
