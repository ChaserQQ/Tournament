# Agent Memory

This is the compact, durable project context. Treat it as a navigation aid and
verify volatile facts from Git, GitHub Pages, Firebase, and the current code
before acting.

## Project identity
- Verified 2026-08-22 KST: workspace is `C:\Users\rlaal\Desktop\mtm`.
- Verified 2026-08-22 KST: repository is `ChaserQQ/Tournament`, branch `main`, remote `origin`.
- Verified 2026-08-22 KST: public URL is `https://chaserqq.github.io/Tournament/`.
- The app is a static frontend backed by Firebase RTDB. Main runtime is `src/app.js`.

## Standing user instructions
- Use Korean for user-facing communication.
- Do not change code until the user explicitly asks to work, fix, or implement. A status, diagnosis, or design discussion alone does not authorize edits.
- Once implementation is requested, finish the scoped change, proportional QA, commit/push to `main`, Pages verification, and public asset verification when feasible.
- Every public app change must update `src/core/build.js` metadata and matching `index.html` asset query strings. Documentation-only changes do not bump the app build.
- Preserve unrelated user changes and untracked files. Never commit `.codex-remote-attachments/`.
- Firebase data/rules may be changed only when explicitly requested or clearly required by the requested fix. Protect active tournaments and back up targeted data before live mutation.
- Never retain credentials, auth codes, raw private data, or Firebase exports in memory or reports.
- Operator UI is an operations tool: remove duplicate panels/copy, keep controls direct, and do not turn setup/other areas into folding tool panels. The visible label is `기타`, not `도구`.
- Frames and section boundaries must share left/right edges. Same-type vertical gaps must match. Neighboring buttons must use consistent height, padding, background geometry, and gaps.
- The mobile operator dock uses four equal columns. Its primary action must fit on one line and align optically and geometrically with the other three buttons at 390px and 320px widths.
- When a surface needs substantial UI repair, consolidate its DOM/base CSS and remove superseded rules. Do not keep appending late override layers.

## Current verified state
- Verified 2026-08-26 KST: v280 app release commit is `3100ab85bf7136fa94134ee60e7364542e8ef9c0` (`Fix bracket advancement flow v280`) on `main`. Pages run `32915582525` completed successfully; the public index, `src/core/build.js?v=280`, and `src/app.js?v=280` return HTTP 200 and expose the v280 bracket guards while retaining RTDB protocol 279.
- Verified 2026-08-26 KST: local reviewed build is v280, label BUILD v280 BRACKET ADVANCEMENT GUARDS; config remains 156, CSS assets remain 278, and the RTDB write protocol remains 279 because this release does not change Firebase rules.
- Previous verified release: v279 app commit `c92dc35ba2abef43c3dbe50859c3937f01dac5dd` (`Enforce Firebase live write protocol v279`) and Pages run `32550653884`; Firebase RTDB rules were released before that app version.
- Verified 2026-08-22 KST: pre-existing untracked items are `.codex-remote-attachments/`, `DESIGN_OUTPUT.md`, `FIREBASE_REPORT.md`, and `QA_REPORT.md`; leave them untouched unless requested. `package-lock.json` is an intentional project artifact. `node_modules/` is generated QA output and must not be committed.
- Verified 2026-08-22 KST: local v279 `npm.cmd run qa:release` passes, including RTDB rules `21/21`, operator browser `3/3`, surface `37/37`, admin `3/3`, result/match/audit/static suites, changed JS/CJS syntax, `git diff --check`, and production dependency audit with zero vulnerabilities.
- Verified 2026-08-22 KST: v279 rollout completed from a recoverable six-node backup at `C:\Users\rlaal\AppData\Local\Temp\mtm-v279-backup-20260822-121402`. After exact revalidation, only `/activeTournaments/test` was removed; its private terminal record, public LIVE/history, and all other data were preserved. Post-deploy state is active pointers `0`, pending claims `0`, unexpired leases `0`, approved venue profiles `7`, and missing approved-profile `venueId` fields `0`.
- Active source-of-truth files: `src/app.js`, `src/core/build.js`, `src/styles/app.css`, `src/styles/operator-mobile.css`, `tools/verify-static.js`, and the QA scripts under `tools/`.
- `TASK_QUEUE.md` no longer defines split-chat roles. `IMPLEMENTATION_REPORT.md` is a compact deployed-app summary. `UI_REDESIGN_BRIEF.md` contains current UI invariants.

## Validation checklist
- `npm.cmd run qa:all` is the stable aggregate for static verification, structure audit, result/match/admin/operator/surface browser QA.
- Always run `npm.cmd run verify` and `git diff --check` after meaningful implementation changes.
- Run `npm.cmd run qa:audit` after JS/CSS structure changes.
- Run `npm.cmd run qa:match` for tournament progression, scoring, finalist, final, refresh recovery, or LIVE-state changes. It covers `basic`, `points3`, `points5Tree`, `revival`, and `crow` with Firebase stubs.
- Run `npm.cmd run qa:result` for result rows, history, ranking, or dashboard metric changes.
- Run `node tools/qa-operator-flow.cjs` for operator controls, mobile layout, forced groups, no-finalist handling, undo, session lease, or LIVE publication.
- Run `node tools/qa-surface-check.cjs` for login/auth routes, LIVE lobby, mobile/TV viewers, missing-state fallbacks, and overflow.
- Run `node tools/qa-admin-flow.cjs` for admin/player DB list or account layout changes.
- Browser QA should cover desktop 1365x900 and mobile 390x844 plus 320px narrow width when layout is affected.
- Playwright is pinned at `1.62.1` in `package.json` and `package-lock.json`; use `npm ci` in a clean environment.
- Run `node --check` for each changed JS/CJS file.
- After push, verify the Pages workflow and fetch the public index plus versioned assets with a cache-busting query.
- Use Firebase stubs for routine QA. Touch live Firebase only when the task truly requires live-state validation.

## Firebase and data safety
- Never store secrets, credentials, private account details, raw Firebase exports, or private participant data in this file.
- Do not commit exports or rule dumps unless the user explicitly requests a sanitized artifact.
- For live fixes, record only paths, intended behavior, and validation outcome.
- Operator writes are lease-protected. Background LIVE publication must not bypass another active operator lease.
- Public LIVE payloads must remain sanitized and must never embed the full private tournament state.

## Recent durable changes
- 2026-08-26 local v280: stage naming now follows the actual group count produced by lane and next-group-size settings; every active group must choose an advancing racer, every point heat must have complete scores, tied point cutoffs continue through convergent playoff stages, crow semifinals require exactly one winner per group, forced grouping cannot create singleton groups, and crow lane history includes all semifinal groups. qa:all passes, including 174 planning combinations across 3/5 lanes and desktop/mobile match simulations.
- 2026-08-22 local v279: RTDB writes are server-enforced with strict protocol/envelope, venue, generation, fence, sequence, lease, active-registry, public/private history linkage, and legacy read-only constraints. The emulator security matrix covers 21 allow/deny contracts including root/child/multipath bypasses and sparse legacy lease migration.
- 2026-08-22 local v279: Firebase server-time offset drives lease and semantic timestamps, survives client-clock rollback, and prevents future publisher timestamps from blocking finish/auto-close recovery. Manual finish, force-end, and current-tab auto-close renew and verify the exact running lease immediately before terminal mutation.
- 2026-08-22 local v279: a failed first private terminal write can reclaim the exact unchanged running lease/fence and retry; identity or freshness divergence restores authoritative running state instead of leaving an infinite pending finish. Strict result history uses the exact source LIVE ID, preventing same-minute cross-venue key collisions.
- 2026-08-22 local v279: pre-start cleanup recovers an eligible rootless stale active pointer only with exact expired-lease/high-water proof. Reload mutation replay rebuilds the strict record envelope and all protocol markers.
- 2026-08-22 local v278: tournament start is single-flight and exact-owner guarded from draft fingerprint through lease reservation, fence allocation, registry activation, and first private/public publication. Running semantic mutations use a reload WAL with exact tournament/generation/venue/fence bases; viewer routes never restore or publish operator state.
- 2026-08-22 local v278: finish, 60-minute auto-close, undo, snapshot load, remote recovery, takeover, and current-tournament rollover now use exact tournament/generation/venue cleanup. Divergent terminal attempts converge to the authoritative remote terminal without false history, and successful current-tab auto-close releases both the active registry and matching operation lease.
- 2026-08-22 local v278: optional blank keys remain blank instead of normalizing to `default`, preventing non-default admin venues and legacy blank LIVE IDs from targeting the default venue. Regression QA covers blank-key fallback, stale cleanup races, local terminal conflict retirement/retry, and exact current auto-close lease release.
- 2026-08-22 local v278: remote/current tournament finish now stops draft rollover on failed Firebase sync and preserves recovered noncanonical LIVE IDs. Remote 60-minute auto-close rechecks the record transactionally, supports legacy flat records and legacy venue names, uses a short single-publisher lease, retains retryable pending state on ambiguous write failures, and never publishes private state. Freshness rejection is a real transaction abort rather than a false committed success.
- 2026-08-22 local v278: public H2H names follow nickname policy; final/older snapshots remain recoverable across new drafts with a 12-entry/2 MB bound and honest save failures; admin record deletion surfaces Firebase failures instead of reporting success. QA covers privacy, stale timestamps, concurrent publishers, double failure recovery, recovered LIVE IDs, snapshot access/capping, and delete rejection.
- 2026-08-22 local v277 (not pushed/deployed): public LIVE data now uses explicit allowlist DTOs and consistent `pub-*` participant IDs; inline record/LIVE ID handlers use delegated data actions; Firebase write rejection is propagated; per-tournament/final snapshots are retained; mobile operator focus is visible; browser QA is local/stubbed and reproducible.
- 2026-08-22 verified context cleanup: compressed project memory and retired stale v222/v255 split-chat instructions. No app asset or Firebase change.
- 2026-07-14 v276: manual `조 편성` applies to the actual first generated stage even when its name is `준결승`. Regression case: 15 players, 5 lanes, 5 groups creates five balanced groups of three; later stages return to automatic grouping.
- 2026-07-10 v275: a round may end with zero finalists. Point, regular final, and crow flows can confirm no finalist, advance/finish safely, and exclude withdrawn racers.
- 2026-07-03 v274: refresh recovery preserves the running tournament participant input and roster order instead of reparsing into a changed list.
- 2026-06-28 v271-v273: final/crow LIVE state now advances correctly, stale writes cannot regress the public or private round, and public finalist payloads sanitize undefined lane values.
- 2026-06-27 v269-v270: operator LIVE publication has a fallback and waits/retries for the session lease after refresh without surfacing false operator-rights alerts.
- v266-v268: mobile operator has one-step floating undo; LIVE viewer opening/polling repairs missed realtime updates.
- v236-v255: operator UI was structurally simplified: static setup/other panels, duplicate current/queue/live blocks removed, `기타` copy applied, four-column dock geometry aligned, shared frame rhythm enforced, and stale CSS selectors removed.
- v188 onward: result-matrix, operator-flow, surface, admin, audit, and full actual-match simulation QA suites guard the supported match modes and key mobile surfaces.

## Known traps
- Commit hashes, Pages runs, public assets, active Firebase tournaments, and CLI availability are volatile. Re-check them live.
- `src/app.js` is large and contains active version-named compatibility functions. A high version suffix alone does not make code dead.
- `src/styles/operator-mobile.css` loads after `src/styles/app.css`; mobile dock or operator fixes in the first file may be overridden by the second.
- Do not repair operator CSS by adding another broad `!important` patch block. Locate the owning rule, consolidate it, and remove superseded selectors.
- Forced group count is a first-stage constraint, not an `예선` name check, and must not leak into later stages.
- Refresh restore must use the v274 stabilized participant text path or the participant list can change during an active tournament.
- No-finalist is a valid terminal outcome for a round; never require at least one finalist unconditionally.
- LIVE writes must go through the sanitized payload and freshness guard so a delayed write cannot move viewers back a round.
- Public viewer routes must not be overwritten by authentication callbacks.
- The v279 RTDB rules deliberately trust an approved operator inside the same venue. Dynamic result subtrees cannot be fully frozen during a terminal publisher-marker update with dependable RTDB deep equality; a server-side writer or trusted content hash is the follow-up hardening path.
- Approved legacy venue profiles must retain an explicit `venueId`; the v279 exact venue check intentionally refuses an ambiguous missing-field fallback. The 2026-08-22 live preflight found all seven approved venue profiles populated.
- Historical reports under untracked `DESIGN_OUTPUT.md`, `QA_REPORT.md`, and `FIREBASE_REPORT.md` are not current source of truth.
- GitHub Pages currently emits a non-blocking Node 20 deprecation annotation.

## Next cleanup targets
- Move terminal result publication to a server-side writer or add a trusted content hash to narrow the same-venue trusted-operator boundary.
- Backfill and continuously validate explicit `venueId` on any newly discovered legacy approved profiles.
- Continue enforcing the operator lease on every remaining write path and dispose route/auth listeners cleanly.
- Split `src/app.js` only along stable responsibilities when touched; avoid a broad rewrite without dedicated regression coverage.
- Consolidate versioned CSS layers into component-owned rules one surface at a time, with measured browser QA before removal.
- Gradually replace inline `onclick`/`onchange` handlers with centralized event binding.
- Expand forced-group QA across more player/lane/group permutations.
- Keep dedicated regression cases for zero-finalist rounds, refresh-stable rosters, final/TV LIVE state, and mobile dock geometry.
