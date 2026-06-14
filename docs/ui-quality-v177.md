# UI Quality Pass v177

## Goal

Improve admin mobile readability without changing Firebase data paths or tournament logic.

## Scope

- Admin account/venue management uses the shared unified header and summary stats.
- Admin tournament record management uses the shared unified header and summary stats.
- Desktop keeps the table layout.
- Mobile converts admin rows into card-like list items with clear labels and full-width touch actions.

## QA Checklist

- Admin accounts mobile: no horizontal overflow, account cards are readable, action buttons wrap into two columns.
- Admin tournament records mobile: no horizontal overflow, tournament name/venue/class/date are readable, delete action is isolated.
- Admin desktop: tables remain compact and aligned.
- Non-admin surfaces: operator, player DB, dashboard, LIVE lobby, mobile LIVE, and TV LIVE keep their previous layout.
