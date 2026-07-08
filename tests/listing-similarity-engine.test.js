'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const listingSimilarityEngine = require('../engines/listingSimilarityEngine');

const targetListing = Object.freeze({
  title: '2024 Topps Chrome John Doe Rookie Gold Refractor Auto /50 PSA 10 #123',
  parsed: Object.freeze({
    player: 'John Doe',
    year: 2024,
    set: 'Topps Chrome',
    cardNumber: '123',
    rookie: true,
    autograph: true,
    parallel: 'Gold Refractor',
    serialNumbered: true,
    printRun: 50,
    gradingCompany: 'PSA',
    grade: '10'
  })
});

test('exact listing match returns explainable strong similarity', () => {
  const result = listingSimilarityEngine.scoreListingSimilarity({
    listing: targetListing,
    comp: {
      title: '2024 Topps Chrome John Doe RC Gold Refractor Auto /50 PSA 10 #123',
      parsed: {
        player: 'John Doe',
        year: 2024,
        set: 'Topps Chrome',
        cardNumber: '123',
        rookie: true,
        autograph: true,
        parallel: 'Gold Refractor',
        serialNumbered: true,
        printRun: 50,
        gradingCompany: 'PSA',
        grade: '10'
      }
    }
  });

  assert.equal(result.source, 'listing_similarity_engine');
  assert.ok(result.similarityScore >= 95);
  assert.equal(result.similarityBand, 'exact');
  assert.equal(result.dimensions.subject.matchStatus, 'match');
  assert.equal(result.dimensions.subject.listingValue, 'john doe');
  assert.equal(result.dimensions.subject.comparableValue, 'john doe');
  assert.equal(result.dimensions.subject.score, 100);
  assert.match(result.dimensions.subject.explanation, /matched/i);
});

test('wrong subject creates fatal reject-level mismatch', () => {
  const result = listingSimilarityEngine.scoreListingSimilarity({
    listing: targetListing,
    comp: {
      title: '2024 Topps Chrome Jane Smith Rookie Gold Refractor Auto /50 PSA 10 #123',
      parsed: {
        player: 'Jane Smith',
        year: 2024,
        set: 'Topps Chrome',
        cardNumber: '123',
        rookie: true,
        autograph: true,
        parallel: 'Gold Refractor',
        serialNumbered: true,
        printRun: 50,
        gradingCompany: 'PSA',
        grade: '10'
      }
    }
  });

  assert.equal(result.dimensions.subject.matchStatus, 'mismatch');
  assert.ok(result.similarityScore <= 35);
  assert.equal(result.similarityBand, 'reject');
  assert.match(result.fatalMismatches.join(' '), /subject mismatch/);
});

test('card number mismatch is high-risk and traceable', () => {
  const result = listingSimilarityEngine.scoreListingSimilarity({
    listing: targetListing,
    comp: {
      title: '2024 Topps Chrome John Doe Rookie Gold Refractor Auto /50 PSA 10 #999',
      parsed: {
        player: 'John Doe',
        year: 2024,
        set: 'Topps Chrome',
        cardNumber: '999',
        rookie: true,
        autograph: true,
        parallel: 'Gold Refractor',
        serialNumbered: true,
        printRun: 50,
        gradingCompany: 'PSA',
        grade: '10'
      }
    }
  });

  assert.equal(result.dimensions.cardNumber.listingValue, '123');
  assert.equal(result.dimensions.cardNumber.comparableValue, '999');
  assert.equal(result.dimensions.cardNumber.matchStatus, 'mismatch');
  assert.match(result.dimensions.cardNumber.explanation, /did not match/);
  assert.ok(result.similarityScore <= 45);
});

test('base versus parallel mismatch is capped and explained', () => {
  const result = listingSimilarityEngine.scoreListingSimilarity({
    listing: targetListing,
    comp: {
      title: '2024 Topps Chrome John Doe Rookie Auto PSA 10 #123',
      parsed: {
        player: 'John Doe',
        year: 2024,
        set: 'Topps Chrome',
        cardNumber: '123',
        rookie: true,
        autograph: true,
        gradingCompany: 'PSA',
        grade: '10'
      }
    }
  });

  assert.equal(result.dimensions.parallel.matchStatus, 'mismatch');
  assert.ok(result.similarityScore <= 62);
  assert.match(result.caps.map((cap) => cap.reason).join(' '), /base\/parallel mismatch/);
});

test('autograph mismatch is fatal high-risk evidence', () => {
  const result = listingSimilarityEngine.scoreListingSimilarity({
    listing: targetListing,
    comp: {
      title: '2024 Topps Chrome John Doe Rookie Gold Refractor /50 PSA 10 #123',
      parsed: {
        player: 'John Doe',
        year: 2024,
        set: 'Topps Chrome',
        cardNumber: '123',
        rookie: true,
        autograph: false,
        parallel: 'Gold Refractor',
        serialNumbered: true,
        printRun: 50,
        gradingCompany: 'PSA',
        grade: '10'
      }
    }
  });

  assert.equal(result.dimensions.autograph.matchStatus, 'mismatch');
  assert.ok(result.similarityScore <= 55);
  assert.match(result.fatalMismatches.join(' '), /autograph mismatch/);
});

test('serial numbered versus unnumbered mismatch is high-risk', () => {
  const result = listingSimilarityEngine.scoreListingSimilarity({
    listing: targetListing,
    comp: {
      title: '2024 Topps Chrome John Doe Rookie Gold Refractor Auto PSA 10 #123',
      parsed: {
        player: 'John Doe',
        year: 2024,
        set: 'Topps Chrome',
        cardNumber: '123',
        rookie: true,
        autograph: true,
        parallel: 'Gold Refractor',
        serialNumbered: false,
        gradingCompany: 'PSA',
        grade: '10'
      }
    }
  });

  assert.equal(result.dimensions.serialNumbering.matchStatus, 'mismatch');
  assert.ok(result.similarityScore <= 55);
  assert.match(result.dimensions.serialNumbering.explanation, /Serial-numbered status did not match/);
});

test('serial print run mismatch is detected', () => {
  const result = listingSimilarityEngine.scoreListingSimilarity({
    listing: targetListing,
    comp: {
      title: '2024 Topps Chrome John Doe Rookie Gold Refractor Auto /250 PSA 10 #123',
      parsed: {
        player: 'John Doe',
        year: 2024,
        set: 'Topps Chrome',
        cardNumber: '123',
        rookie: true,
        autograph: true,
        parallel: 'Gold Refractor',
        serialNumbered: true,
        printRun: 250,
        gradingCompany: 'PSA',
        grade: '10'
      }
    }
  });

  assert.equal(result.dimensions.serialNumbering.matchStatus, 'mismatch');
  assert.equal(result.dimensions.serialNumbering.listingValue, '/50');
  assert.equal(result.dimensions.serialNumbering.comparableValue, '/250');
  assert.match(result.dimensions.serialNumbering.explanation, /print run differed/);
});

test('PSA 10 versus PSA 9 is materially different but explainable', () => {
  const result = listingSimilarityEngine.scoreListingSimilarity({
    listing: targetListing,
    comp: {
      title: '2024 Topps Chrome John Doe Rookie Gold Refractor Auto /50 PSA 9 #123',
      parsed: {
        player: 'John Doe',
        year: 2024,
        set: 'Topps Chrome',
        cardNumber: '123',
        rookie: true,
        autograph: true,
        parallel: 'Gold Refractor',
        serialNumbered: true,
        printRun: 50,
        gradingCompany: 'PSA',
        grade: '9'
      }
    }
  });

  assert.equal(result.dimensions.gradingCompany.matchStatus, 'match');
  assert.equal(result.dimensions.grade.matchStatus, 'mismatch');
  assert.equal(result.dimensions.grade.listingValue, '10');
  assert.equal(result.dimensions.grade.comparableValue, '9');
  assert.match(result.dimensions.grade.explanation, /one point/);
  assert.ok(result.similarityScore < 95);
});

test('raw versus graded mismatch is high-risk', () => {
  const result = listingSimilarityEngine.scoreListingSimilarity({
    listing: targetListing,
    comp: {
      title: '2024 Topps Chrome John Doe Rookie Gold Refractor Auto /50 Raw #123',
      parsed: {
        player: 'John Doe',
        year: 2024,
        set: 'Topps Chrome',
        cardNumber: '123',
        rookie: true,
        autograph: true,
        parallel: 'Gold Refractor',
        serialNumbered: true,
        printRun: 50,
        grade: 'raw'
      }
    }
  });

  assert.equal(result.dimensions.rawVsGraded.matchStatus, 'mismatch');
  assert.ok(result.similarityScore <= 45);
  assert.match(result.fatalMismatches.join(' '), /raw\/graded mismatch/);
});

test('raw condition mismatch is detected', () => {
  const result = listingSimilarityEngine.scoreListingSimilarity({
    listing: {
      title: 'Pokemon Charizard Base Set #4 Raw Near Mint',
      parsed: {
        subject: 'Charizard',
        set: 'Base Set',
        cardNumber: '4',
        grade: 'NM',
        condition: 'Near Mint'
      }
    },
    comp: {
      title: 'Pokemon Charizard Base Set #4 Raw Lightly Played',
      parsed: {
        subject: 'Charizard',
        set: 'Base Set',
        cardNumber: '4',
        grade: 'LP',
        condition: 'Lightly Played'
      }
    }
  });

  assert.equal(result.dimensions.condition.matchStatus, 'mismatch');
  assert.equal(result.dimensions.rawVsGraded.matchStatus, 'match');
  assert.match(result.dimensions.condition.explanation, /did not match/);
});

test('missing fields lower confidence without crashing', () => {
  const result = listingSimilarityEngine.scoreListingSimilarity({
    listing: { title: '2024 Topps Chrome John Doe Rookie #123' },
    comp: { title: '2024 Topps Chrome John Doe Rookie' }
  });

  assert.equal(result.source, 'listing_similarity_engine');
  assert.equal(result.dimensions.cardNumber.matchStatus, 'missing');
  assert.ok(['low', 'medium'].includes(result.matchConfidence));
  assert.equal(typeof result.summary, 'string');
});

test('recency and marketplace are context only', () => {
  const result = listingSimilarityEngine.scoreListingSimilarity({
    listing: {
      title: '2024 Topps Chrome John Doe Rookie #123',
      parsed: { player: 'John Doe', year: 2024, set: 'Topps Chrome', cardNumber: '123' },
      marketplace: 'ebay'
    },
    comp: {
      title: '2024 Topps Chrome John Doe Rookie #123',
      parsed: { player: 'John Doe', year: 2024, set: 'Topps Chrome', cardNumber: '123' },
      marketplace: 'alt',
      ageDays: 400
    }
  });

  assert.equal(result.dimensions.recencyContext.matchStatus, 'context_only');
  assert.equal(result.dimensions.recencyContext.score, null);
  assert.equal(result.dimensions.marketplaceContext.matchStatus, 'context_only');
  assert.equal(result.dimensions.marketplaceContext.score, null);
});

test('image similarity is explicitly not implemented', () => {
  const result = listingSimilarityEngine.scoreListingSimilarity({
    listing: targetListing,
    comp: targetListing
  });

  assert.equal(result.dimensions.imageSimilarity.matchStatus, 'not_available');
  assert.equal(result.dimensions.imageSimilarity.score, null);
  assert.match(result.dimensions.imageSimilarity.explanation, /not implemented yet/);
});

test('batch evaluation returns distribution and scored comps', () => {
  const result = listingSimilarityEngine.evaluateListingSimilarity({
    listing: targetListing,
    comps: [
      targetListing,
      {
        title: '2024 Topps Chrome Jane Smith Rookie Gold Refractor Auto /50 PSA 10 #123',
        parsed: { player: 'Jane Smith', year: 2024, set: 'Topps Chrome', cardNumber: '123' }
      }
    ]
  });

  assert.equal(result.source, 'listing_similarity_engine');
  assert.equal(result.comparableCount, 2);
  assert.equal(result.scoredComps.length, 2);
  assert.equal(result.similarityDistribution.exact, 1);
  assert.equal(result.similarityDistribution.reject, 1);
  assert.ok(result.summary);
});

test('engine does not mutate inputs', () => {
  const listing = Object.freeze({
    title: '2024 Topps Chrome John Doe Rookie #123',
    parsed: Object.freeze({ player: 'John Doe', year: 2024, set: 'Topps Chrome', cardNumber: '123' })
  });
  const comp = Object.freeze({
    title: '2024 Topps Chrome John Doe Rookie #123',
    parsed: Object.freeze({ player: 'John Doe', year: 2024, set: 'Topps Chrome', cardNumber: '123' })
  });
  const before = JSON.stringify({ listing, comp });

  listingSimilarityEngine.scoreListingSimilarity({ listing, comp });

  assert.equal(JSON.stringify({ listing, comp }), before);
});

test('exports public listing similarity functions', () => {
  assert.equal(typeof listingSimilarityEngine.evaluateListingSimilarity, 'function');
  assert.equal(typeof listingSimilarityEngine.scoreListingSimilarity, 'function');
  assert.equal(typeof listingSimilarityEngine.summarizeListingSimilarity, 'function');
  assert.equal(typeof listingSimilarityEngine.normalizeListingProfile, 'function');
});
