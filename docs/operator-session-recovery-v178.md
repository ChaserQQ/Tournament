# Operator Session Recovery

## Goal

Reduce race-day mistakes caused by the same account opening multiple browser tabs, another PC taking control, or an operator refreshing the browser during a running tournament.

## What Changed

- Each operator browser tab gets a `sessionId` stored in `sessionStorage`, so refresh keeps the same session but a new tab gets a different session.
- Operator presence writes heartbeat data to `operationLocks/sessions/{venueId}/{uid}/{sessionId}`.
- The write owner lease is stored at `operationLocks/leases/{venueId}` with a 45 second expiry.
- Running-tournament write actions are blocked when another live session owns the lease.
- The operator panel shows the current lease owner, heartbeat time, and recovery candidate status.
- Refresh recovery checks `activeTournaments/{venueId}` and `tournaments/{id}/state`, then offers a remote restore when the remote running state is newer or different from local state.

## Behavior

- Same browser refresh: keeps the same `sessionId` and refreshes the lease.
- Same account in a different tab: receives a new `sessionId`; if another session owns the lease, it becomes read-only for guarded actions.
- Manual takeover: the operator can use `운영권 가져오기` after confirming.
- Offline/stale owner: a new session can claim the lease after expiry.

## QA Checklist

- Operator page shows the `다중접속 · 새로고침 보호` panel.
- `data-operator-session-id` and `data-operator-lease` update on the document element.
- `window.__mini4wdOperatorSession` exists.
- Mobile and PC operator layouts have no horizontal overflow.
- LIVE viewer routes remain public and are not blocked by the lease layer.
- TV LIVE and mobile LIVE keep receiving public live state from `publicLive`.
