# CardHawk Release Smoke Checklist

Use this checklist before every CardHawk Scouting Engine release. It is documentation only and does not change runtime behavior.

## Release Identity

- Release version:
- Release date:
- Git commit:
- Railway environment:
- CardHawk mode: `paper` / `production`
- Operator:

## Pre-Release Checks

- Confirm the release contains only approved changes.
- Confirm no unintended changes exist in `server.js`.
- Confirm no unintended engine changes exist.
- Confirm no unintended test or `package.json` changes exist.
- Confirm no production `data/` files are included in the release.
- Confirm the current branch is synced with GitHub.
- Confirm all required environment variables are present for the target environment.
- Confirm `CARDHAWK_MODE` is set intentionally.
- Confirm backup and restore documentation is available at `docs/backup-and-restore.md`.
- Confirm a current backup exists, or record why backup was intentionally skipped.

## Automated Checks

- Run `npm test`.
- Run `npm run test:smoke`.
- Confirm all tests pass.
- Confirm smoke tests do not touch production data.
- Confirm route-method hardening checks still pass.
- Confirm config readiness checks still pass.
- Confirm persistence utility checks still pass.
- Confirm notification idempotency checks still pass.
- Confirm operator audit log checks still pass.

## Local Startup Checks

- Start CardHawk locally with production-like environment variables.
- Confirm the app starts without crashing.
- Confirm startup logs do not expose secret values.
- Confirm startup logs do not show unexpected persistence or config errors.
- Confirm the selected `CARDHAWK_MODE` appears as expected.
- Confirm the main dashboard loads.
- Confirm `/health` loads.
- Confirm `/api/status` returns JSON.
- Confirm `/api/metrics` returns JSON.
- Stop the local process cleanly.

## Railway Deployment Checks

- Confirm the deployment builds successfully.
- Confirm the Railway service starts successfully.
- Confirm Railway health status becomes healthy.
- Confirm Railway logs do not expose secret values.
- Confirm Railway logs do not show repeated startup failures.
- Confirm Railway logs do not show unexpected state corruption warnings.
- Confirm configured environment variables match the intended release environment.
- Confirm the deployed commit matches the expected release commit.

## Production Health Checks

- Open `/health`.
- Confirm app status is healthy or intentionally warning-only.
- Confirm config readiness is visible.
- Confirm operating mode is visible.
- Confirm marketplace health is visible.
- Confirm system health includes the `config` key.
- Open `/api/status`.
- Confirm `cardhawkMode` is correct.
- Confirm marketplace status is present.
- Confirm no unexpected critical config issues are present.
- Open `/api/metrics`.
- Confirm metrics return valid JSON.
- Open `/metrics`.
- Confirm the Operational Metrics page renders.

## Operational Action Checks

Only run side-effect checks intentionally.

- Confirm `GET /api/alerts/send-pending` returns 405 Method Not Allowed.
- Confirm `GET /api/notifications/test` returns 405 Method Not Allowed.
- If testing manual scan, trigger `POST /scan-now` once and confirm it completes or reports an expected guarded status.
- If testing send-pending alerts, trigger `POST /api/alerts/send-pending` only when duplicate or real sends are acceptable.
- If testing notification delivery, trigger `POST /api/notifications/test` only when a real test notification is acceptable.
- Open `/api/operator-audit`.
- Confirm manual operational actions were recorded.
- Confirm audit entries do not contain secrets, auth headers, passwords, tokens, or full sensitive payloads.

## Persistence and Backup Checks

- Confirm `data/cardhawk-data.json` exists after runtime activity.
- Confirm `data/listingHistory.json` exists after history activity.
- Confirm `data/predictionAccuracy.json` exists after prediction activity.
- Confirm `data/decisionValidation.json` exists after decision validation activity.
- Confirm `data/notificationState.json` exists after successful non-forced notification send activity.
- Confirm `data/operatorAuditLog.json` exists after audited operator activity.
- Confirm no unexpected `*.tmp-*` files remain after normal operation.
- Investigate any new `*.corrupt-*.bak` files before release approval.
- Confirm a current full `data/` backup exists before production release.
- Confirm restore steps in `docs/backup-and-restore.md` are understood by the operator.

## Notification Checks

- Confirm `CARDHAWK_ALERTS_ENABLED` is intentionally configured.
- Confirm notification credentials are present only when alerts are expected to send.
- Confirm `/api/notifications/status` reflects expected alert configuration.
- Confirm duplicate alert idempotency is preserved after restart when applicable.
- Confirm no unexpected notification sends occur during release validation.
- Confirm any intentional notification test is recorded in `/api/operator-audit`.

## Marketplace Checks

- Confirm eBay remains the active marketplace.
- Confirm marketplace registry lists eBay as active.
- Confirm mock marketplace remains inactive.
- Confirm no storage keys were migrated.
- Confirm listing normalization still includes canonical marketplace fields.
- Confirm `ebayItemId` compatibility remains intact.
- Confirm live marketplace checks do not violate provider terms or rate limits.
- Confirm any eBay rate-limit condition is reported as expected, not treated as a successful scan.

## Rollback Readiness

- Confirm the previous known-good Git commit is identified.
- Confirm the previous known-good Railway deployment is identifiable.
- Confirm a current pre-release `data/` backup exists.
- Confirm rollback can be performed without schema migration.
- Confirm restoring the full `data/` directory is preferred over partial file restore.
- Confirm notification state implications are understood before restoring old backups.
- Confirm operator audit implications are understood before restoring old backups.

## Final Release Sign-Off

- Automated checks passed:
- Local startup checks passed:
- Railway deployment checks passed:
- Production health checks passed:
- Operational action checks completed or intentionally skipped:
- Backup confirmed:
- Rollback plan confirmed:
- No unexpected runtime behavior observed:
- Approved for release by:
- Approval timestamp:

