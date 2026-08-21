# Task Queue

## Status
- No implementation task is currently queued.
- Split-chat role coordination was retired on 2026-06-23 and must not be restarted from old instructions.
- Current app baseline is v276. Use `AGENT_MEMORY.md`, live Git state, and the user's newest request as the source of truth.
- Do not change code until the user explicitly asks to work, fix, or implement.

## When new work is requested
1. Inspect the relevant current code and `git status`; do not assume an old version note is current.
2. Preserve unrelated and untracked files.
3. Implement the smallest complete fix in the owning DOM/runtime/CSS layer.
4. Run the validation matrix appropriate to the affected surface or tournament logic.
5. For public app changes, bump build metadata and asset query versions.
6. Commit, push to `main`, verify Pages, and verify cache-busted public assets when feasible.
7. Refresh `AGENT_MEMORY.md` only for durable state, invariants, deployment facts, or newly discovered traps.

## Mandatory regression areas
- Tournament flow: all supported modes, finalists/finals, no-finalist path, and saved result rows.
- Recovery: participant order after refresh, session lease, and one-step undo.
- LIVE: operator publication, freshness guard, mobile viewer, TV viewer, and final-state progression.
- Grouping: explicit group count applies only to the first generated stage.
- Mobile UI: operator dock geometry, frame rhythm, player DB control/list overlap, and 390px/320px overflow.

## Historical files
- `UI_REDESIGN_BRIEF.md` contains current visual rules.
- `IMPLEMENTATION_REPORT.md` summarizes the latest deployed app build.
- Untracked `DESIGN_OUTPUT.md`, `QA_REPORT.md`, and `FIREBASE_REPORT.md` are historical working files and are not authoritative.
