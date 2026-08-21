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
- Verified 2026-08-22 KST: local `main`, `origin/main`, and HEAD match at `8c7b5089954c2924a3ccef67df5e68231d41b4f7` (`Build v276 apply forced group count to first stage`).
- Verified 2026-08-22 KST: current Git history has 7 commits. The older snapshot-only/force-push policy is stale; do not rewrite history without a fresh explicit request.
- Verified 2026-08-22 KST: build is `276`, label `BUILD v276 FIRST STAGE FORCED GROUP COUNT`.
- Verified assets: `config: 156`, `build/app/css/operatorMobileCss: 276`, `og: 51`.
- Verified 2026-08-22 KST: Pages run `29318678193` completed successfully for app commit `8c7b508`; public index and build asset both return HTTP 200 and identify v276.
- Verified 2026-08-22 KST: tracked app state is clean. Untracked items are `.codex-remote-attachments/`, `DESIGN_OUTPUT.md`, `FIREBASE_REPORT.md`, and `QA_REPORT.md`; leave them untouched unless requested.
- Active source-of-truth files: `src/app.js`, `src/core/build.js`, `src/styles/app.css`, `src/styles/operator-mobile.css`, `tools/verify-static.js`, and the QA scripts under `tools/`.
- `TASK_QUEUE.md` no longer defines split-chat roles. `IMPLEMENTATION_REPORT.md` is a compact deployed-app summary. `UI_REDESIGN_BRIEF.md` contains current UI invariants.

## Validation checklist
- Always run `npm.cmd run verify` and `git diff --check` after meaningful implementation changes.
- Run `npm.cmd run qa:audit` after JS/CSS structure changes.
- Run `npm.cmd run qa:match` for tournament progression, scoring, finalist, final, refresh recovery, or LIVE-state changes. It covers `basic`, `points3`, `points5Tree`, `revival`, and `crow` with Firebase stubs.
- Run `npm.cmd run qa:result` for result rows, history, ranking, or dashboard metric changes.
- Run `node tools/qa-operator-flow.cjs` for operator controls, mobile layout, forced groups, no-finalist handling, undo, session lease, or LIVE publication.
- Run `node tools/qa-surface-check.cjs` for login/auth routes, LIVE lobby, mobile/TV viewers, missing-state fallbacks, and overflow.
- Run `node tools/qa-admin-flow.cjs` for admin/player DB list or account layout changes.
- Browser QA should cover desktop 1365x900 and mobile 390x844 plus 320px narrow width when layout is affected.
- If Playwright cannot be resolved, use `%TEMP%\mini4wd-playwright-cache\node_modules` as task-specific `NODE_PATH`; do not assume it exists without checking.
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
- Historical reports under untracked `DESIGN_OUTPUT.md`, `QA_REPORT.md`, and `FIREBASE_REPORT.md` are not current source of truth.
- GitHub Pages currently emits a non-blocking Node 20 deprecation annotation.

## Next cleanup targets
- Split `src/app.js` only along stable responsibilities when touched; avoid a broad rewrite without dedicated regression coverage.
- Consolidate versioned CSS layers into component-owned rules one surface at a time, with measured browser QA before removal.
- Gradually replace inline `onclick`/`onchange` handlers with centralized event binding.
- Expand forced-group QA across more player/lane/group permutations.
- Keep dedicated regression cases for zero-finalist rounds, refresh-stable rosters, final/TV LIVE state, and mobile dock geometry.
