# Changelog

All notable changes to CardHawk will be documented in this file.

## [v1.0.0-rc.1] - 2026-07-07

### Release Status

This is the first private production Release Candidate for CardHawk Scouting Engine.

### Added

- Core scouting engine foundation for evaluating sports card listings and surfacing evidence-based recommendations for human review.
- Marketplace abstraction foundation with eBay as the active marketplace and an inactive mock marketplace for future expansion.
- Persistence hardening for core runtime state and selected engine state.
- Prediction Accuracy tracking for recorded predictions and outcomes.
- Decision Validation tracking for recorded decisions and outcomes.
- Listing History tracking for listing observations, price movement, and disappeared listings.
- Scanner Service for scan orchestration and scan-in-progress ownership.
- Metrics & Health visibility through operational pages and JSON endpoints.
- Notification idempotency persistence to reduce duplicate alert sends across restarts.
- Operator audit logging for selected manual operational actions.
- Paper Mode visibility with `CARDHAWK_MODE=paper` as the default.
- Release guardrails covering backup/restore, smoke checks, architecture freeze, and Release Candidate sign-off.

### Changed

- Extracted marketplace-specific eBay behavior behind a marketplace adapter and registry while keeping eBay as the only active live provider.
- Moved scan orchestration into a dedicated scanner service while preserving scan timing and existing behavior.
- Centralized main store ownership in a shared app store utility.
- Standardized JSON state persistence through a shared state store utility.
- Added canonical listing identity compatibility while preserving existing storage keys and `ebayItemId` compatibility.
- Expanded read-only operational visibility through metrics, health, status, and validation reporting.

### Hardened

- Atomic persistence for main store and hardened engine state using temp-file writes and rename.
- Startup config readiness checks without exposing secret values.
- Side-effect route hardening for notification test and send-pending alert actions.
- Dependency-free smoke tests using Node built-in test tooling.
- Operator audit trail for manual scan, send-pending alerts, and notification test actions.
- Release readiness improvements through operational documentation, architecture freeze rules, and Release Candidate checklist.

### Documentation

- Added `README.md` for v1.0 operator-facing overview, setup, safety language, and operational links.
- Added `docs/v1.0-release-candidate.md`.
- Added `docs/architecture-freeze.md`.
- Added `docs/release-smoke-checklist.md`.
- Added `docs/backup-and-restore.md`.

### Operational Notes

- eBay is the only active live marketplace in this Release Candidate.
- Mock marketplace support exists for future expansion and is not active for live scouting.
- `BUY_NOW` is CardHawk's internal high-priority scouting recommendation and requires human review.
- CardHawk does not perform automated purchases, place bids, submit offers, or execute payment actions.

### Out of Scope

- Portfolio Engine.
- Bankroll Engine.
- Sell Strategy Engine.
- Automated buying.
- SaaS platform.
- Second live marketplace.
- Database migration.
- Storage-key migration away from `ebayItemId`.

