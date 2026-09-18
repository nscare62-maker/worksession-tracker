# Architecture & Implementation Plan

## Components
- **mobile/** — Expo React Native TS app for workers (auth, consent, punch in/out, foreground+background location tracking, offline queue).
- **backend/** — Node + TypeScript + Express REST API, `ws` WebSocket server, PostgreSQL + PostGIS.
- **dashboard/** — React + TS manager web app (Vite), MapLibre GL map, live socket updates.

## Data flow
1. Worker signs in (JWT, role=`worker`). First run requires **consent acknowledgment**, stored with timestamp/version — punch-in is blocked until consent exists.
2. **Punch in** → `POST /sessions/start` creates `work_sessions` row (`status=active`). Response includes tracking config (interval, distance filter). Mobile shows a persistent "Tracking active" banner + OS notification, and starts `expo-location` foreground + background updates.
3. Every update (60s timer OR >100m movement, both configurable) → `POST /locations` with `sessionId`. If offline, the update is written to a local queue (AsyncStorage) with `capturedAt`; on reconnect the queue flushes and each late item is flagged `isDelayed=true` server-side (server compares `capturedAt` vs `receivedAt`).
4. Backend validates (schema + auth + "session must be active & owned by requester"), inserts into `location_updates` (PostGIS `geography(Point,4326)`), updates `work_sessions.last_location_id`, and **broadcasts** a `location:update` WS event to managers subscribed to that worker's team.
5. **Punch out** → `POST /sessions/:id/end` closes the session (`status=ended`, `ended_at=now()`), mobile immediately stops all location tasks and cancels the notification. No further location writes are accepted for that session (enforced server-side, not just client-trusted).
6. Manager dashboard connects via WebSocket, subscribes to its authorized teams, renders live markers, computes `live/delayed/stale/offline/ended` client-side from `last_update_at` + `is_delayed` + session status, and can fetch a closed session's full route (`GET /sessions/:id/route`) only if RBAC allows.

## Status state machine
| Status | Condition |
|---|---|
| `live` | session active, last update within `2 × updateIntervalSec` |
| `delayed` | update arrived flagged `isDelayed` (queued while offline) |
| `stale` | session active, no update for > `STALE_THRESHOLD_SEC` (configurable) |
| `offline` | device explicitly reported connectivity loss (last-known frozen, not extrapolated) |
| `ended` | session closed by punch-out (or admin force-end) |

**No location is ever inferred** — if GPS/network fails, the app reports the *state* (`permission_denied`, `gps_unavailable`, `offline`) rather than fabricating coordinates, and the dashboard shows "last known" with an explicit staleness age.

## RBAC
- `worker`: only their own sessions/location.
- `manager`: read access to workers on their assigned team(s) only, live + historical route.
- `admin`: cross-team read, retention/config management, audit log access.
All enforced server-side per request, not just hidden in the UI.

## Non-negotiable safeguards implemented
- Consent record required before first punch-in; consent text/version stored immutably (`consent_acks` table).
- Tracking rows are only ever created while `work_sessions.status = 'active'`; a DB trigger + service-layer check both reject writes to non-active sessions.
- No disciplinary fields/flags anywhere in schema; API deliberately has no "auto-flag late/absent" logic — only raw session/location facts.
- `LOCATION_RETENTION_DAYS` env var drives a scheduled purge job (see `backend/src/services/retention.ts` note in README).
- Alternate attendance path: `work_sessions.clock_method` can be `gps` or `manual_no_location`, used when permission is denied — session still opens, just without tracking.

## Folder structure
```
worksession-tracker/
  backend/   (Express API + WS + PostGIS)
  mobile/    (Expo RN TS)
  dashboard/ (React + Vite TS)
  docker-compose.yml
  README.md
```
