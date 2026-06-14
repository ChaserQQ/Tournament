# UI Redesign Brief

This document is the shared source for the MINI4WD Tournament Maker UI redesign.
All chats should read this before making design, implementation, verification, or Firebase decisions.

## Current Baseline
- Project: MINI4WD Tournament Maker
- Workspace: `C:\Users\rlaal\Desktop\mtm`
- Public URL: `https://chaserqq.github.io/Tournament/`
- Current accepted build: v222, `BUILD v222 AUX SURFACE DESIGN`
- Rejected build: v223 luxury-minimal CSS-only attempt. Do not continue that direction.

## Redesign Scope
This is a full app UI and information-architecture redesign, not a player DB-only fix.

Target screens:
- Operator screen
- Player DB
- Admin screen
- LIVE/viewer screen
- Login, permission, waiting, error states
- Print, result, and auxiliary screens

## Core Direction
- Prioritize an operations tool: fast judgment, fast input, and mistake prevention.
- Keep every screen structurally consistent: top context, central task, side or bottom actions.
- Remove repetitive explanation copy. Prefer labels, status, and clear button names.
- Use restrained color: white/gray base, one accent color, one danger color.
- Do not wrap everything in cards. Use layout, spacing, and alignment first.
- Do not create a landing-page style. This must remain a practical tournament tool.
- Do not solve the redesign by adding another late CSS override layer.

## Common Layout
- Top: tournament name, current state, user authority, primary navigation.
- Main: the single most important task for the current screen.
- Secondary panel: settings, details, logs, or risk actions.
- Fixed action area: only the action the user is likely to need now.
- Empty, error, waiting, and permission screens use the same quiet status layout.

## Desktop Layout
- Default app layout: two columns.
- Left/main column: primary work.
- Right/side column: detail, action, status, or logs.
- Operator screen: current match, queue, result input.
- Player DB: searchable list plus selected-player detail panel.
- Admin: vertical setting groups; dangerous work separated at the bottom.
- LIVE: viewer information only, with management controls removed.

## Mobile Layout
- Use one column: current task, next action, list, then secondary information.
- Bottom navigation for operator mode should have three items or fewer.
- LIVE must not share the operator bottom navigation.
- Long tables become compact lists.
- Each mobile list item should stay within three visible information lines where possible.
- Only one fixed primary action is allowed on a mobile screen.

## Component Rules
- Buttons: primary, secondary, danger only. One primary button per area.
- Cards: use only for repeated items, selected-player detail, or match units.
- Nested cards are not allowed.
- Tables: mainly desktop. Use fixed header, clickable rows, and status chips.
- Tabs: four or fewer, only for switching views inside one task.
- Bottom bar: icon plus short label. LIVE is not the center of the operator flow.
- Toolbar: search, filter, sort, add. Remove duplicate navigation and explanation controls.
- Inputs: label, value, error. Long help text goes into collapsed help.
- Status: progress, waiting, complete, warning, error.

## Screen Reconstruction
- Operator: current round and next action first, then waiting racers, result input, and progress log.
- Player DB: search/filter, player list, detail panel, registration/edit flow.
- Admin: tournament settings, match format, data management, authority, dangerous actions.
- LIVE: current match, ranking, next match, tournament status.
- Login/permission/waiting/error: centered status, one-line reason, one available action.
- Print/result/auxiliary: output content first; remove unnecessary app navigation.

## Removal Targets
- Repeated explanation text with the same meaning.
- Obvious instructions such as "select below".
- Card-wrapped sections for every block.
- Duplicate save, move, refresh, or navigation buttons.
- LIVE and operator controls mixed in one bottom bar.
- Table and card versions showing the same information at the same time.
- State that relies only on color without text or icon support.

## Implementation Policy
- Start from v224 after the accepted v222 baseline.
- Replace old structure deliberately. Do not stack another patch layer over it.
- Work screen by screen, but keep the common system consistent from the start.
- Preserve tournament logic and Firebase behavior unless a task explicitly targets them.
- Verify PC and mobile separately.
