# UI Quality Pass v176

## Goal

Raise the interface from patch-by-patch visual fixes to a shared UI system. This pass keeps tournament logic and Firebase behavior unchanged.

## Foundation

- Non-TV pages use one light surface system: soft page background, white cards, pink accent, gray metadata.
- Common components share one rhythm: titlebar, toolbar, button, card, badge, input, stat block.
- TV LIVE remains presentation-first and is excluded from the non-TV foundation layer.

## Component Rules

- Page title: large, bold, tight line-height, same titlebar structure across operator, DB, dashboard, live lobby, mobile live, and login.
- Buttons: 42px desktop minimum height, 44px mobile minimum height, consistent radius and weight.
- Cards: white surface, subtle border, 22-26px radius, soft shadow.
- Toolbars: compact white strip with wrapped buttons on desktop and two-column grid on mobile.
- Badges and pills: pink soft background, 26px minimum height, ellipsis for long account or venue text.
- Inputs: 42px minimum height, same border/radius/focus ring.
- Mobile: no horizontal overflow, two-column toolbar actions when possible, full-width controls.

## QA Checklist

- Operator: header, top toolbar, final box, round tabs, stage cards, side details, mobile dock.
- Player DB: header, DB toolbar, selected player card, registration form, roster filters, table.
- Dashboard: header, account strip, filters, stat cards, rank cards.
- LIVE lobby: header, summary chips, live cards, action buttons, recent history.
- Mobile LIVE: titlebar, current match card, score/advance badges, history.
- Login/restricted/error: centered page, titlebar, card, action buttons.

## Follow-Up Candidates

- Replace more inline styles in `src/app.js` with named classes.
- Extract shared button/card/stat classes into a smaller CSS module once the single-file app is stable.
- Add visual regression screenshots for representative PC/mobile routes.
- Continue TV-specific typography tuning separately from non-TV UI.
