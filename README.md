# WorkSession Tracker

A work-session-scoped location tracking system: workers share live location **only**
between "Punch In" and "Punch Out"; managers see a live map and (for authorized
roles) completed-shift route history. See `ARCHITECTURE.md` for the data flow and
status-derivation rules.

```
worksession-tracker/
  backend/    Node + TypeScript + Express REST API + WebSocket, PostgreSQL/PostGIS
  mobile/     Expo React Native (TypeScript) worker app
  dashboard/  React + Vite (TypeScript) manager web dashboard
  docker-compose.yml
```

## 1. Prerequisites
- Node.js 20+, npm
- Docker (for the easiest Postgres+PostGIS setup) — or a local Postgres 14+ with the
  `postgis`, `pgcrypto`, and `citext` extensions available
- Expo CLI (`npx expo`) and either Expo Go on a physical phone, or an iOS/Android
  simulator, for the mobile app
- A modern browser for the dashboard

## 2. Database
```bash
cd worksession-tracker
docker compose up -d db
# wait a few seconds for healthcheck, then:
cd backend
cp .env.example .env   # edit values, see "Environment variables" below
npm install
npm run migrate        # applies schema.sql
npm run seed           # loads sample teams/users/logins
```

Development logins from `seed.sql` (replace these before production):
| Email | Role |
|---|---|
| admin@gmail.com / `admin@123` | admin |
| manager@gmail.com / `manager123` | manager (Field Ops - North) |
| worker@gmail.com / `pass123` | employee (Field Ops - North) |

The admin portal can view live manager and employee locations. The manager portal
can view live employee locations only. Employees use the mobile portal to punch in,
share location during the active shift, and stop sharing when they punch out.

To generate a real bcrypt hash for these (or any) accounts:
```bash
node -e "require('bcrypt').hash('yourpassword', 10).then(console.log)"
```

## 3. Backend API
```bash
cd backend
npm run dev      # http://localhost:4000, WebSocket at ws://localhost:4000/ws
npm test         # unit tests (status derivation + session-service rules)
```

### Environment variables (`backend/.env`)
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | Signing secret for auth tokens — generate a long random value, never commit it |
| `JWT_EXPIRES_IN` | Token lifetime (default `12h`) |
| `CORS_ORIGIN` | Allowed dashboard origin |
| `DEFAULT_UPDATE_INTERVAL_SEC` | Location update interval sent to the worker app at punch-in (default 60) |
| `DEFAULT_DISTANCE_FILTER_M` | Distance-triggered update threshold in meters (default 100) |
| `STALE_THRESHOLD_SEC` | Seconds with no update before the dashboard marks a worker "stale" |
| `LOCATION_RETENTION_DAYS` | Location rows older than this are purged by the daily retention job |
| `CONSENT_POLICY_VERSION` | Bump this whenever the consent text changes materially — workers must re-acknowledge |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | General API rate limiting |

## 4. Manager dashboard
```bash
cd dashboard
cp .env.example .env
npm install
npm run dev     # http://localhost:5173
```
Sign in with `manager1@example.com` / your seeded password.

### Maps configuration
The dashboard defaults to **MapLibre GL with a free, keyless OSM-style tile set**
(`https://demotiles.maplibre.org/style.json` in `src/components/MapView.tsx`) —
fine for development, but swap it for a production tile provider (MapTiler,
Stadia Maps, Mapbox, etc.) before going live; the demo tiles are not meant for
production traffic. To use **Google Maps** instead: get a Maps JavaScript API key,
set `VITE_GOOGLE_MAPS_API_KEY`, and replace the MapLibre loader in `MapView.tsx`
with the `@vis.gl/react-google-maps` (or similar) equivalent — the rest of the
component's marker/route logic ports over conceptually unchanged.

## 5. Worker mobile app
```bash
cd mobile
npm install
npx expo start
```
Edit `app.json` → `expo.extra.apiBaseUrl` / `wsBaseUrl` to point at your backend
(use your machine's LAN IP, not `localhost`, when testing on a physical device).
Sign in with `worker1@example.com`.

**Background location caveat:** iOS and Android both impose OS-level restrictions
and review requirements for background location. `app.json` is pre-configured with
the required permission strings and plugins, but for a real App Store/Play Store
submission you'll need to justify background location use in your app review
submission and, on iOS, request the `Always` permission with a clear in-app
rationale (the consent screen text can double as that rationale, but adapt it).

## 6. Privacy & policy settings you must decide
These are product/legal decisions, not just config — set them deliberately:

1. **Consent text** (`mobile/src/screens/ConsentScreen.tsx`) — the bundled copy is a
   reasonable starting point, not legal advice. Have it reviewed, especially for
   jurisdictions with specific employee-monitoring statutes (several US states
   require advance written notice; GDPR-covered workers have additional rights).
2. **`LOCATION_RETENTION_DAYS`** — how long raw location history is kept before
   the retention job purges it (`backend/src/services/retention.ts`).
3. **Alternate attendance process** — the app supports "punch in without location"
   (`clockMethod: manual_no_location`) for denied/unavailable permissions; decide
   your operational process around it (e.g., does it require manager approval,
   a manual location note, etc.) and adjust `session.controller.ts` accordingly.
4. **Who can see what** — `manager_team_access` lets you grant a manager visibility
   into additional teams beyond their own; decide your assignment process.
5. **No disciplinary automation** — by design, this system has no auto-flagging of
   "late," "off-route," or similar. If you build reporting on top of this data,
   keep human review in the loop per the safeguards in `ARCHITECTURE.md`.

## 7. Deployment notes
- **Backend**: containerized via `backend/Dockerfile`; `docker-compose.yml` shows a
  minimal Postgres+API stack. For production, put a real TLS-terminating reverse
  proxy (or managed load balancer) in front of the API/WebSocket, and use a managed
  Postgres with `sslmode=require` in `DATABASE_URL`.
- **Secrets**: `JWT_SECRET` and `DATABASE_URL` must come from a secrets manager
  (not committed `.env` files) in any real deployment.
- **Dashboard**: static build (`npm run build` in `dashboard/`) deployable to any
  static host (S3+CloudFront, Netlify, Vercel, etc.) — just point its env vars at
  your deployed backend's HTTPS/WSS URLs.
- **Mobile**: build with `eas build` (Expo Application Services) for store
  submission; update `app.json` extras to your production API/WS URLs first.
- **WebSocket scaling**: the current WS layer keeps manager connections in an
  in-process `Set` — fine for a single backend instance. For horizontal scaling,
  move to a pub/sub backplane (Redis, NATS) so broadcasts reach managers connected
  to a different instance.

## 8. What to extend first
1. **Push notifications for stale/offline workers** — the dashboard currently only
   shows a badge; a manager-facing alert (email/push) after N minutes stale is a
   natural next step, kept clearly separate from any disciplinary action.
2. **Manager multi-team access in the WebSocket broadcast** — the REST snapshot
   already supports `manager_team_access`, but the WS broadcast filter in
   `backend/src/ws/socket.ts` currently only checks a manager's home team; extend
   it to load their full accessible-team set at connect time.
3. **Refresh tokens** — the JWT is currently long-lived and stateless; add refresh
   tokens + revocation if you need faster forced logout (e.g., off-boarding).
4. **Admin UI** for managing teams, manager-team grants, and retention settings
   (the schema/tables exist; there's no UI yet).
5. **E2E tests** for the punch-in → location-update → punch-out flow across all
   three apps; current tests cover backend unit logic only.
