'use strict';

function createScoutScanner(dependencies = {}) {
  const {
    activeMarketplace,
    decisionValidationEngine,
    getStore,
    historyEngine,
    lanes,
    learningEngine,
    listingIdentity,
    parseCardTitle,
    predictionAccuracyEngine,
    saveScoutedListing,
    saveStore,
    sleep,
    systemHealth
  } = dependencies;

  let scanInProgress = false;

  async function runScoutScan(source = 'automatic') {
    const store = getStore();

    if (scanInProgress) {
      const skippedScan = {
        id: Date.now().toString(),
        source,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        lanes: [],
        listingsFound: 0,
        newAlerts: 0,
        status: 'skipped',
        error: 'Another scout scan is already running.'
      };

      systemHealth.markScanSkipped(skippedScan, skippedScan.error);
      store.scans.unshift(skippedScan);
      store.scans = store.scans.slice(0, 100);
      saveStore();
      return skippedScan;
    }

    scanInProgress = true;

    const scan = {
      id: Date.now().toString(),
      source,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      lanes: [],
      listingsFound: 0,
      newAlerts: 0,
      status: 'running',
      error: null,
      rateLimited: false,
      queryDelayMs: activeMarketplace.config.searchDelayMs,
      laneDelayMs: activeMarketplace.config.laneDelayMs
    };

    systemHealth.startScan(scan);
    systemHealth.setEngine('scout', 'running', { source, scanId: scan.id });

    const alertsBefore = store.alerts.length;
    const observedListings = [];
    const scanStartedMs = Date.now();

    try {
      for (const [laneKey, lane] of Object.entries(lanes)) {
        if (laneKey === 'all') continue;

        const laneStartedMs = Date.now();
        let laneCount = 0;
        const laneErrors = [];

        for (const query of lane.queries) {
          try {
            const results = await activeMarketplace.searchWithBackoff(query, activeMarketplace.config.scanQueryLimit, { parseCardTitle });
            laneCount += results.length;
            scan.listingsFound += results.length;

            for (const listing of results) {
              const savedListing = saveScoutedListing(listing, query, laneKey);
              observedListings.push(savedListing);
            }

            systemHealth.recordScanEngine('ebay', 'ok', {
              lastQuery: query,
              lane: laneKey,
              results: results.length
            });
          } catch (error) {
            const compactError = activeMarketplace.compactError(error);
            laneErrors.push({ query, error: compactError });

            if (activeMarketplace.isRateLimitError(error)) {
              scan.rateLimited = true;
              scan.error = compactError;
              systemHealth.recordScanEngine('ebay', 'warning', {
                lane: laneKey,
                query,
                error: compactError
              });
              console.warn(`eBay rate limit reached on query "${query}". Ending this scan cleanly.`);
              break;
            }

            systemHealth.recordScanEngine('ebay', 'warning', {
              lane: laneKey,
              query,
              error: compactError
            });
            console.error(`eBay query failed for "${query}":`, compactError);
          }

          await sleep(activeMarketplace.config.searchDelayMs);
        }

        scan.lanes.push({
          lane: laneKey,
          count: laneCount,
          errors: laneErrors,
          durationMs: Date.now() - laneStartedMs
        });

        if (scan.rateLimited) break;
        await sleep(activeMarketplace.config.laneDelayMs);
      }

      scan.newAlerts = store.alerts.length - alertsBefore;
      scan.status = scan.rateLimited ? 'rate_limited' : 'completed';
      systemHealth.setEngine('scout', scan.status === 'completed' ? 'ok' : 'warning', {
        listingsFound: scan.listingsFound,
        newAlerts: scan.newAlerts,
        durationMs: Date.now() - scanStartedMs
      });
    } catch (error) {
      scan.status = 'failed';
      scan.error = activeMarketplace.compactError(error);
      systemHealth.setEngine('scout', 'failed', { error: scan.error });
      console.error('Scout scan failed:', scan.error);
    }

    try {
      const historyResult = historyEngine.recordScan(observedListings, {
        scanId: scan.id,
        source
      });

      scan.history = {
        observedCount: historyResult.observedCount,
        trackedCount: historyResult.trackedCount,
        activeCount: historyResult.activeCount,
        newCount: historyResult.newListings.length,
        priceDropCount: historyResult.priceDrops.length,
        disappearedCount: historyResult.disappeared.length
      };
      const outcomeAt = scan.finishedAt || new Date().toISOString();

      try {
        for (const drop of historyResult.priceDrops || []) {
          const id = listingIdentity.getListingId(drop);
          if (!id) continue;

          learningEngine.recordListingOutcome(id, {
            outcomeType: 'price_dropped',
            finalPrice: drop.currentPrice || drop.newPrice || drop.price || 0,
            outcomeAt,
            notes: 'Listing price dropped during scan history tracking'
          });

          decisionValidationEngine.recordOutcome(id, {
            outcomeType: 'price_dropped',
            finalPrice: drop.currentPrice || drop.newPrice || drop.price || 0,
            outcomeAt,
            notes: 'Listing price dropped during scan history tracking'
          });

          predictionAccuracyEngine.recordOutcome(id, {
            outcomeType: 'price_dropped',
            finalPrice: drop.toPrice || drop.currentPrice || drop.newPrice || drop.price || 0,
            outcomeAt,
            priceDropped: true,
            notes: 'Listing price dropped during scan history tracking'
          });
        }

        for (const gone of historyResult.disappeared || []) {
          const id = listingIdentity.getListingId(gone);
          if (!id) continue;

          learningEngine.recordListingOutcome(id, {
            outcomeType: 'disappeared',
            outcomeAt,
            notes: 'Listing disappeared from observed scan results'
          });
          decisionValidationEngine.recordOutcome(id, {
            outcomeType: 'disappeared',
            disappeared: true,
            outcomeAt,
            notes: 'Listing disappeared from observed scan results'
          });
          predictionAccuracyEngine.recordOutcome(id, {
            outcomeType: 'disappeared',
            disappeared: true,
            outcomeAt,
            notes: 'Listing disappeared from observed scan results'
          });
        }
      } catch (learningOutcomeError) {
        console.warn('Learning/Decision Validation outcome recording failed:', learningOutcomeError.message);
      }

      systemHealth.recordScanEngine('history', 'ok', scan.history);
    } catch (historyError) {
      scan.historyError = historyError.message;
      systemHealth.recordScanEngine('history', 'warning', { error: historyError.message });
      console.error('History Engine failed:', historyError.message);
    } finally {
      scan.finishedAt = new Date().toISOString();
      scan.durationMs = Date.now() - scanStartedMs;
      store.scans.unshift(scan);
      store.scans = store.scans.slice(0, 100);
      store.alerts = store.alerts.slice(0, 200);

      try {
        const learningScanResult = learningEngine.recordScanOutcome(observedListings, {
          observedAt: scan.finishedAt || new Date().toISOString()
        });

        for (const id of learningScanResult.stale || []) {
          learningEngine.recordListingOutcome(id, {
            outcomeType: 'stale',
            outcomeAt: scan.finishedAt || new Date().toISOString(),
            notes: 'Listing became stale after not appearing in recent scans'
          });
        }
      } catch (learningError) {
        console.warn('Learning Engine recordScanOutcome failed:', learningError.message);
      }
      systemHealth.finishScan(scan);
      saveStore();
      scanInProgress = false;
    }

    return scan;
  }

  function isScanInProgress() {
    return scanInProgress;
  }

  return {
    runScoutScan,
    isScanInProgress
  };
}

module.exports = {
  createScoutScanner
};
