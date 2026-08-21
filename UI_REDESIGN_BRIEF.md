# UI Redesign Brief

This is the current UI direction for MINI4WD Tournament Maker. Use live code and
`AGENT_MEMORY.md` for implementation facts.

## Current baseline
- Verified baseline: v276, `BUILD v276 FIRST STAGE FORCED GROUP COUNT`.
- The old v222 starting point and split-chat v224 instructions are retired.
- The rejected v223 CSS-only luxury redesign must not be revived.

## Product direction
- Build a quiet, fast tournament operations tool, not a landing page.
- Put the current decision and next action first.
- Remove repeated explanations, duplicate controls, and duplicate status panels.
- Use white/gray surfaces, one accent color, and a distinct danger treatment.
- Use cards only for repeated match/player units or genuinely framed tools. Do not nest cards.
- Preserve tournament logic and Firebase behavior unless the task explicitly targets them.

## Alignment contract
- Every frame in the same stack shares the same left and right edges.
- Same-type sections use the same vertical gap.
- Buttons in one group share height, vertical alignment, padding rhythm, and inter-button gap.
- Border shape and radius are consistent across adjacent frames; default radius is 8px or less.
- Text must stay inside its control at desktop, 390px mobile, and 320px narrow mobile.
- Fixed-format controls use stable grid tracks so labels and state changes do not shift layout.

## Operator screen
- Header: tournament identity and operation status, visually substantial but compact.
- Top routes: `선수`, `기록`, `라이브`, `관리`.
- Main flow: tournament overview, round controls, current stage/group, score or advance selection, then secondary settings.
- `현재 경기`, participant list, settings, queue, point-stage header, and LIVE-send status must not be repeated in separate panels.
- Setup and `기타` are static sections, not accordion/tool drawers.
- `최종 결승 진행` belongs directly below the round buttons when relevant.
- No-finalist rounds show a deliberate unavailable/complete state and allow the tournament to continue safely.

## Mobile operator dock
- Exactly four equal columns: current primary action, `경기`, `설정`, `기타`.
- All four button backgrounds share the same outer height, top/bottom position, radius, and padding contract.
- The primary action may use the accent color but not a different geometry.
- Primary copy stays on one line; shorten the label when necessary.
- Dock container top and bottom padding must be optically equal.
- Reserve page bottom space so content is never hidden behind the dock.

## Player DB and admin
- Mobile player/admin lists remain compact horizontal data surfaces with controlled scrolling where needed.
- Sticky or top controls must not overlap the first list row.
- Checkboxes, favorite controls, names, venue/team, and record columns keep stable tracks.
- Bulk actions use equal-width buttons and do not resize the list.
- Desktop tables and mobile data surfaces must show the same underlying state without rendering duplicate copies.

## LIVE and TV
- Viewer surfaces are read-only and never inherit operator controls or dock navigation.
- Mobile LIVE prioritizes current match, score/advance state, and recent results.
- TV LIVE gives finals a dedicated final-state presentation rather than treating them as an ordinary three-group round.
- Viewer state must follow the operator round/final state without requiring a manual viewer refresh.
- Missing or stale data shows a clear fallback rather than an old round as if it were current.

## Implementation policy
- Change the owning DOM/component and base CSS rule. Remove superseded rules in the same pass.
- Do not add a broad late override layer as the default repair method.
- Reuse current helpers and established classes before creating abstractions.
- Verify affected screens at 1365px, 390px, and 320px.
- Tournament progression changes require full match simulation plus operator-flow QA.
- LIVE/TV changes require operator publication, mobile viewer, TV viewer, stale-write, and refresh checks.
