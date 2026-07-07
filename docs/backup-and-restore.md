# CardHawk Backup and Restore Guide

This guide documents the persistent CardHawk state that must be protected in production. It is operational documentation only and does not change runtime behavior.

## Persistent Data Files

CardHawk runtime state is stored in the `data/` directory.

| File | Type | What it stores | Criticality |
| --- | --- | --- | --- |
| `data/cardhawk-data.json` | Business-critical | Main application store: scouted listings, alerts, scans, rejections, and settings. | Highest |
| `data/listingHistory.json` | Business-critical | Listing history across scans, price movement, disappeared listings, scan records, and history stats. | High |
| `data/predictionAccuracy.json` | Business-critical | Prediction Accuracy Engine records, prediction history, and recorded outcomes. | High |
| `data/decisionValidation.json` | Business-critical | Decision Validation Engine records, decision history, and outcome history. | High |
| `data/notificationState.json` | Operational-critical | Sent alert keys used to avoid duplicate notifications across restarts. | High operational |
| `data/operatorAuditLog.json` | Operational-critical | Operator audit events for manual scans, send-pending alert actions, and notification test actions. | High operational |

## Business-Critical vs Operational Files

Business-critical files preserve CardHawk's scouting memory and should usually be restored together from the same backup timestamp:

- `data/cardhawk-data.json`
- `data/listingHistory.json`
- `data/predictionAccuracy.json`
- `data/decisionValidation.json`

Operational-critical files preserve runtime safety, auditability, and notification idempotency:

- `data/notificationState.json`
- `data/operatorAuditLog.json`

If possible, back up and restore the entire `data/` directory instead of restoring individual files. Restoring partial state can make reports, validation history, and notification behavior inconsistent.

## Secondary and Transient Files

CardHawk uses atomic JSON writes and corruption backups for persisted state.

| File pattern | Purpose | Restore guidance |
| --- | --- | --- |
| `data/*.corrupt-*.bak` | Backup copy made when a corrupt JSON state file is detected during load. | Keep for investigation or manual recovery. Do not automatically restore without validation. |
| `data/*.tmp-*` | Temporary file created during an atomic write before rename. | Usually safe to ignore. Do not restore unless manually recovering from an interrupted write and the JSON has been validated. |

## Backup Recommendations

Minimum production backup posture:

- Back up the full `data/` directory before every deployment.
- Back up the full `data/` directory daily while CardHawk is active.
- Retain at least 14 daily backups.
- Retain at least 4 weekly backups.
- Store backups outside the active Railway runtime volume whenever possible.
- Label backups with environment, timestamp, and commit or deployment identifier.
- Periodically test restore using a non-production copy.

For real-money operation, backups should eventually be automated and copied to durable external storage. Railway volume data should not be the only copy of business-critical CardHawk state.

## Restore Procedure

Use the safest full-directory restore flow when possible.

1. Stop the running CardHawk process, pause scheduled scans, or otherwise prevent writes.
2. Create a backup of the current `data/` directory before replacing anything.
3. Restore the selected backup copy of the full `data/` directory.
4. Validate that every restored JSON file parses cleanly.
5. Start CardHawk.
6. Check `/health` for runtime and config readiness.
7. Check `/api/status` for application status and mode visibility.
8. Check `/api/metrics` for expected data counts.
9. Confirm key pages and read-only API routes load normally.
10. Keep the pre-restore backup until the restored application has been verified.

## Important Restore Warnings

- Prefer restoring the full `data/` directory from one timestamp.
- Restoring only `data/cardhawk-data.json` may remove newer listings, alerts, scans, rejections, or settings.
- Restoring only `data/listingHistory.json` may make history reports disagree with the main listing store.
- Restoring only `data/predictionAccuracy.json` or `data/decisionValidation.json` may make accuracy and validation reporting inconsistent with recent scans.
- Restoring an older `data/notificationState.json` may allow duplicate notifications for alerts that were already sent after that backup was created.
- Restoring an older `data/operatorAuditLog.json` may remove audit evidence for recent manual actions.
- Do not blindly restore `*.corrupt-*.bak` files. Validate the JSON and inspect the contents first.
- Do not treat `*.tmp-*` files as authoritative unless a manual recovery confirms they contain complete valid JSON.

## Risks

- No backup means a lost or damaged Railway volume can permanently remove CardHawk scouting history and validation memory.
- Partial restores can create confusing reports or duplicate operational side effects.
- Old notification state can weaken alert idempotency.
- Old audit state can reduce operational traceability.
- Corrupt backups can make recovery worse if restored without validation.
- Backups stored in the same runtime environment can fail at the same time as production state.

## Rollback Steps

This documentation-only phase has no runtime rollback.

To remove Phase 7.7D:

1. Delete `docs/backup-and-restore.md`.
2. Confirm no runtime files changed.
3. No application restart is required.

## Verification Checklist

Before considering this documentation complete:

- `git status` shows only `docs/backup-and-restore.md` changed.
- No changes exist in `server.js`.
- No engine files changed.
- No persistence utilities changed.
- No tests changed.
- No `package.json` changes exist.
- No production data files changed.
- The guide lists every persistent data file.
- The guide separates business-critical and operational files.
- The guide documents secondary and transient file patterns.
- The guide includes backup recommendations.
- The guide includes a restore procedure.
- The guide includes restore warnings.
- The guide includes risks and rollback steps.

