# CardHawk

CardHawk Scouting Engine is a production Node.js application for evidence-based sports card scouting. It evaluates marketplace listings, market evidence, risk, confidence, quality, history, and operational signals to surface recommendations for human review.

## Current Status

- Version: `v1.0.0` Release Candidate
- Status: Private Production Release Candidate
- Primary Marketplace: eBay
- Operating Modes:
  - Paper: default
  - Production: informational
- Purpose: Provide evidence-based sports card scouting recommendations for human review.

## Project Overview

CardHawk is designed to help an operator review sports card opportunities with more context and consistency. It combines listing data, comparable sales evidence, market value estimates, trend signals, sales velocity, quality checks, risk checks, decision validation, prediction accuracy tracking, metrics, and operational health reporting.

CardHawk v1.0 is a scouting engine. It is not an automated buying system, trading system, portfolio manager, bankroll manager, or sell strategy platform.

## What CardHawk Scouting Engine v1.0 Is

CardHawk Scouting Engine v1.0 includes:

- eBay marketplace scouting as the only active live marketplace.
- Marketplace abstraction with an inactive mock marketplace for compatibility and testing.
- Scout, comp, sold sales, market value, ROI, risk, confidence, quality, grading, trend, population, market intelligence, history, learning, sales velocity, decision, validation, prediction accuracy, notification, system health, and metrics engines.
- Persistent runtime state using JSON files with atomic writes where implemented.
- Read-only operational metrics and health views.
- Paper/production mode visibility.
- Operator audit logging for selected manual operational actions.
- Release, backup, restore, and architecture freeze documentation.

## Intentionally Out Of Scope

The following are intentionally out of scope for CardHawk Scouting Engine v1.0:

- Automated purchase execution.
- Portfolio Engine.
- Bankroll Management Engine.
- Sell/Exit Strategy Engine.
- SaaS account system.
- Live second-marketplace integration.
- Storage-key migration.
- Marketplace-qualified storage migration.
- Financial advice or profit guarantees.

## BUY_NOW Safety Statement

`BUY_NOW` is CardHawk's internal high-priority scouting recommendation.

It means a listing passed CardHawk's current review gates and should be reviewed by a human operator. It does not execute, authorize, or recommend an automatic purchase. CardHawk does not buy cards, place bids, submit offers, or perform payment actions.

## Paper Mode

`CARDHAWK_MODE` defaults to `paper`.

Valid modes:

- `paper`
- `production`

In v1.0, production mode is informational only. Neither mode changes scoring, Deal Gate behavior, BUY_NOW logic, alerts, notifications, or scan timing.

Mode visibility exists to make release status and operator expectations clear. It is not an execution guardrail for automated buying because CardHawk v1.0 does not perform automated buying.

## High-Level Architecture

CardHawk is organized around a production Node.js server with isolated engine modules and small shared utilities.

- Marketplace Registry: selects the active marketplace provider. eBay is the only active live provider in v1.0.
- Scanner Service: owns scan orchestration and scan-in-progress state.
- App Store: owns the main application store shape and listing lookup compatibility.
- State Store: provides JSON load/save behavior with atomic writes and corruption backups.
- Engine Ecosystem: evaluates listings through scouting, comps, market value, ROI, risk, confidence, quality, grading, trend, population, market intelligence, history, learning, sales velocity, decision, validation, and prediction accuracy logic.
- Metrics: summarizes existing store and health data without changing scan behavior.
- Health: reports runtime, config, marketplace, persistence, and engine status.
- Operator Audit Log: records selected manual operational actions without storing secrets.

## Persistent State

CardHawk stores runtime state in the `data/` directory.

Important persistent files:

- `data/cardhawk-data.json`: main application store, including listings, alerts, scans, rejections, and settings.
- `data/listingHistory.json`: listing history, price movements, disappeared listings, and scan history.
- `data/predictionAccuracy.json`: prediction records and outcomes.
- `data/decisionValidation.json`: decision validation records and outcomes.
- `data/notificationState.json`: sent alert keys for notification idempotency.
- `data/operatorAuditLog.json`: operator audit events for selected manual actions.

See [Backup and Restore](docs/backup-and-restore.md) before operating CardHawk with production data.

## Environment Variables

Required when the Scout Engine is enabled:

- `CARDHAWK_USER`: basic auth username.
- `CARDHAWK_PASS`: basic auth password.
- `EBAY_APP_ID`: eBay application/client ID.
- `EBAY_CERT_ID`: eBay certificate/client secret.

Common optional variables:

- `PORT`: HTTP port. Defaults to `3000`.
- `CARDHAWK_MODE`: `paper` or `production`. Defaults to `paper`.
- `SCOUT_ENABLED`: enables or disables scheduled scouting. Defaults to `true`.
- `SCOUT_INTERVAL_MINUTES`: scheduled scan interval. Defaults to `10`.

Notification variables:

- `CARDHAWK_ALERTS_ENABLED`: enables notification delivery. Defaults to `false`.
- `RESEND_API_KEY`: Resend API key for email delivery.
- `ALERT_TO`: alert recipient.
- `RESEND_FROM` or `ALERT_FROM`: alert sender.
- `RESEND_TIMEOUT_MS`: notification request timeout. Defaults to `15000`.
- `CARDHAWK_ALERT_MIN_PROFIT`: notification threshold. Defaults to `75`.
- `CARDHAWK_ALERT_MIN_ROI`: notification threshold. Defaults to `0.35`.
- `CARDHAWK_ALERT_MIN_SCORE`: notification threshold. Defaults to `90`.
- `CARDHAWK_ALERT_MIN_CONFIDENCE`: notification threshold. Defaults to `70`.

eBay rate-protection variables:

- `EBAY_SEARCH_DELAY_MS`: delay between eBay searches. Defaults to `2500`.
- `EBAY_LANE_DELAY_MS`: delay between scan lanes. Defaults to `6000`.
- `EBAY_MAX_RETRIES`: eBay retry count. Defaults to `2`.
- `EBAY_BACKOFF_BASE_MS`: eBay backoff base delay. Defaults to `15000`.
- `EBAY_SCAN_QUERY_LIMIT`: query limit per scan lane. Defaults to `8`.

## Local Development And Startup

Install dependencies:

```sh
npm install
```

Run the full test suite:

```sh
npm test
```

Run smoke tests:

```sh
npm run test:smoke
```

Start CardHawk:

```sh
npm start
```

After startup, verify:

- `/health`
- `/api/status`
- `/metrics`
- `/api/metrics`

## Railway Deployment Overview

CardHawk is deployed on Railway from GitHub.

Deployment checklist:

- Configure required environment variables in Railway.
- Confirm `CARDHAWK_MODE` is intentional.
- Confirm `SCOUT_ENABLED` is intentional.
- Confirm notification variables are present only when notifications are expected.
- Deploy from the intended Git commit.
- Verify the Railway service becomes healthy.
- Check logs for startup errors and secret exposure.
- Verify `/health`, `/api/status`, `/metrics`, and `/api/metrics`.
- Confirm a current backup exists before production operation.

## Operational Endpoints

Primary operational endpoints:

- `/health`: rendered health and readiness view.
- `/api/status`: JSON status, config readiness, marketplace status, mode, and runtime summary.
- `/metrics`: rendered operational metrics dashboard.
- `/api/metrics`: JSON operational metrics.

Additional operator views include:

- `/`
- `/alerts`
- `/rejections`
- `/history`
- `/history/price-drops`
- `/history/disappeared`
- `/history/active`
- `/scans`
- `/validation`
- `/api/operator-audit`
- `/api/notifications/status`

Side-effect routes should be used intentionally:

- `POST /scan-now`
- `POST /api/alerts/send-pending`
- `POST /api/notifications/test`

The corresponding GET routes for notification test and send-pending alerts return `405 Method Not Allowed`.

## Testing

Required release tests:

```sh
npm test
npm run test:smoke
```

The smoke suite uses temporary paths and should not touch production `data/` files.

## Operational Documentation

- [v1.0 Release Candidate](docs/v1.0-release-candidate.md)
- [Architecture Freeze](docs/architecture-freeze.md)
- [Release Smoke Checklist](docs/release-smoke-checklist.md)
- [Backup and Restore](docs/backup-and-restore.md)

## Roadmap After v1.0

Planned post-v1.0 product areas:

- Portfolio Engine.
- Bankroll Management Engine.
- Sell/Exit Strategy Engine.
- Additional approved marketplaces.
- Database migration.
- SaaS platform.

These are future roadmap items and are not included in CardHawk Scouting Engine v1.0.

## License

License: TBD.

