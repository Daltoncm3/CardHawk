# CardHawk Architecture Freeze

This document defines the architecture freeze rules for the CardHawk Scouting Engine v1.0 Release Candidate. It is documentation only and does not change runtime behavior.

## Architecture Freeze Rules

During the v1.0 architecture freeze:

- Do not add new engines.
- Do not add new marketplace providers.
- Do not add new scoring inputs.
- Do not change scoring weights or formulas.
- Do not change Deal Gate behavior.
- Do not change BUY_NOW logic or internal naming.
- Do not change alert criteria.
- Do not change notification behavior.
- Do not change scan timing, startup delay, or scan interval behavior.
- Do not migrate storage keys.
- Do not change persisted state formats unless fixing a release blocker.
- Do not rewrite `server.js`.
- Do not perform broad refactors.
- Do not remove compatibility aliases such as `ebayItemId`.
- Do not change production runtime behavior unless fixing a confirmed release blocker.

Allowed during freeze:

- Documentation updates.
- Release checklist updates.
- Critical bug fixes required for v1.0 release.
- Test-only fixes that do not alter production behavior.
- Configuration or deployment documentation corrections.
- Small rollback-safe patches for confirmed release blockers.

## What Is Frozen For v1.0

The following architecture is frozen for v1.0:

- eBay is the only active live marketplace.
- Mock marketplace remains inactive and test-oriented.
- Marketplace registry remains single-active-provider with eBay selected.
- `server.js` remains the main route/rendering/integration file.
- Scout scan orchestration remains in `services/scoutScannerService.js`.
- Main store ownership remains in `utils/appStore.js`.
- Atomic JSON persistence remains in `utils/stateStore.js`.
- Persistent runtime state remains under `data/`.
- Paper/production mode remains informational only.
- BUY_NOW remains a scouting recommendation for human review, not an automated purchase action.
- Existing API route paths remain unchanged.
- Existing storage keys remain unchanged.
- Existing alert and notification behavior remains unchanged.
- Existing scan timing remains unchanged.

## Known Technical Debt

Known technical debt that should not block v1.0 unless it creates a release blocker:

- `server.js` is still large and owns routing, rendering, scoring integration, and operational endpoints.
- Some helper logic is duplicated across engines, including number parsing, clamping, array handling, and summary helpers.
- Legacy `ebayItemId` compatibility remains throughout stored data and some read paths.
- Storage keys are not marketplace-qualified yet.
- README content is minimal and should be completed before public release.
- Live second-marketplace integration is intentionally paused until approved access is confirmed.
- More complete automated route tests can wait until after v1.0 if manual release checks pass.
- Backup automation can wait if documented manual backup procedures are followed.
- Portfolio, Bankroll, Sell Strategy, and SaaS capabilities are outside the Scouting Engine v1.0 scope.

Known technical debt that should be treated carefully after v1.0:

- Further `server.js` decomposition.
- Marketplace-qualified storage strategy.
- Expanded automated integration testing.
- Automated backup/export process.
- More formal release versioning and changelog process.
- Operator authentication and role model beyond basic access control.

## Release Blockers

The following should block the v1.0 Release Candidate:

- `npm test` fails.
- `npm run test:smoke` fails.
- CardHawk fails to start.
- `/health` fails to load.
- `/api/status` fails to return valid JSON.
- `/api/metrics` fails to return valid JSON.
- Required production environment variables are missing unexpectedly.
- Config readiness reports unexpected critical issues.
- Runtime logs expose secrets, passwords, auth headers, API keys, or tokens.
- Persistent state cannot be loaded and no safe backup or recovery path exists.
- Unexpected state corruption warnings appear during release validation.
- Notification idempotency does not survive restart.
- Side-effect GET routes are reintroduced.
- Manual scan action fails in a way that prevents operational validation.
- eBay marketplace failures are not surfaced safely.
- Scoring, Deal Gate, BUY_NOW, alert behavior, notification behavior, or scan timing changed without explicit release-blocker approval.
- Storage keys or persisted state formats changed without explicit release-blocker approval.
- No current backup exists before production deployment.
- Rollback path is unknown.

## Required Tests and Checks

Automated checks required before freeze sign-off:

- Run `npm test`.
- Run `npm run test:smoke`.
- Confirm all tests pass.
- Confirm tests do not touch production `data/` files.

Local checks required before freeze sign-off:

- Start CardHawk locally with production-like environment variables.
- Confirm startup completes without crashing.
- Confirm startup logs do not expose secrets.
- Confirm `/health` loads.
- Confirm `/api/status` returns valid JSON.
- Confirm `/api/metrics` returns valid JSON.
- Confirm `/metrics` renders.

Production or Railway checks required before release candidate sign-off:

- Confirm Railway deployment builds successfully.
- Confirm Railway service starts successfully.
- Confirm deployment becomes healthy.
- Confirm deployed commit matches the intended release commit.
- Confirm `CARDHAWK_MODE` is correct.
- Confirm eBay remains the active marketplace.
- Confirm mock marketplace remains inactive.
- Confirm `/api/operator-audit` is available.
- Confirm release smoke checklist is completed or intentionally annotated.

## Documentation Status

Required v1.0 operational documentation:

- `docs/backup-and-restore.md`
- `docs/release-smoke-checklist.md`
- `docs/architecture-freeze.md`

Documentation that should be completed before a public v1.0 announcement:

- `README.md` product overview and operator setup.
- Environment variable reference.
- Paper mode and production mode explanation.
- Release notes or v1.0 announcement draft.

Documentation that can wait until after v1.0:

- Portfolio Engine documentation.
- Bankroll Engine documentation.
- Sell Strategy Engine documentation.
- SaaS onboarding documentation.
- Second-marketplace integration documentation.

## Rollback Expectations

Before release candidate approval:

- Identify the previous known-good Git commit.
- Identify the previous known-good Railway deployment.
- Confirm a current backup of the full `data/` directory exists.
- Confirm rollback does not require a data migration.
- Confirm restoring the full `data/` directory is preferred over partial restore.
- Confirm notification state implications are understood before restoring old backups.
- Confirm operator audit implications are understood before restoring old backups.

If a release blocker is found:

1. Stop the release.
2. Record the blocker and affected area.
3. Decide whether to roll back or apply a narrow release-blocker fix.
4. Avoid unrelated cleanup while fixing the blocker.
5. Re-run required tests and checks after the fix.
6. Update the release smoke checklist with the outcome.

## Final Sign-Off Checklist

Architecture freeze sign-off:

- No new features added during freeze:
- No new engines added:
- No new marketplace providers added:
- No scoring changes:
- No Deal Gate changes:
- No BUY_NOW changes:
- No alert or notification behavior changes:
- No scan timing changes:
- No storage key migrations:
- No broad `server.js` rewrite:
- Known technical debt reviewed:
- Release blockers reviewed:
- Required tests passed:
- Local startup checks passed:
- Railway checks passed:
- Backup confirmed:
- Rollback path confirmed:
- Release smoke checklist completed:
- Approved for v1.0 Release Candidate by:
- Approval timestamp:

