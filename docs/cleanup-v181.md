# Legacy Runtime Trim v181

## Scope

- Removed the old v102 mobile/TV live-sync runtime wrapper from `src/app.js`.
- Kept the base `watchFirebaseState()` implementation because it already watches both public LIVE payload shapes:
  - `publicLive/{id}/state`
  - `publicLive/{id}`
- Kept v104/v170 save batching and trailing Firebase sync as the active save/live-sync path.
- Kept v135 active tournament backup/auto-close and v178 operator session lease.

## Removed Runtime Names

- `installV102MobileTvLiveSyncHotfix`
- `syncLiveNowV102`
- `watchFirebaseStateV102`
- `mini4wdTournamentLastSafeStateV102`
- `__mini4wdV102UnloadFlushWrapped`

## Guardrails

- `tools/verify-static.js` now fails if the removed v102 runtime names are reintroduced.
- No Firebase rules, database paths, or CSS rules changed in this pass.

## QA Focus

- Confirm build `v181`.
- Confirm operator route renders.
- Confirm LIVE lobby, mobile LIVE, and TV LIVE routes render without console errors.
