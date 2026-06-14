# Legacy Patch Cleanup v179

## Scope

- Removed runtime-only self-audit hooks that were useful during older patch delivery but no longer drive product behavior:
  - `runV77CleanupAudit`
  - `runCommercialSelfAuditV58`
  - `runProductionAuditV85`
  - `runFinalPracticeAuditV95`
  - `runV102HotfixAudit`
  - `shouldRunStartupAuditsV152`
  - `runMini4wdAuditsV152`
- Removed the dead v102 action wrapper table. The wrapper had already returned immediately since later batched live sync work superseded per-click immediate wrappers.
- Added static verification guards so these obsolete audit hooks, the dead wrapper, and duplicate function declarations are not reintroduced.

## Kept Intentionally

- v104 save batching, v135 active tournament backup/auto-close, and v178 session lease remain because they are active operational safeguards.
- v181 removed the superseded v102 live-sync/local-save runtime wrapper after base live watching and v104/v170 save batching covered the active behavior.
- No Firebase rules or database shape changes were required.

## QA Focus

- Confirm the app loads build `v179`.
- Confirm operator, LIVE lobby, mobile LIVE, and TV LIVE routes still render.
- Confirm `npm run verify` passes in an environment with Node.js available.
