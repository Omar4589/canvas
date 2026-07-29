# Doorline

Multi-tenant SaaS for door-to-door canvassing, sold to political consulting firms, campaigns, and advocacy organizations. Each customer organization runs its own campaigns with its own admins, team leads, and canvassers, isolated from every other organization, under a super-admin (vendor) tier.

A web console for the office (turf cutting, imports, oversight, client reports) plus an offline-first iOS/Android field app for canvassers. Marketing site: [doorline.app](https://doorline.app).

## Repo layout

```
canvass-app/
├── server/         Express + MongoDB API (port 4000)
├── client/         React + Vite admin dashboard (port 5173 in dev; bundled into server in prod)
├── mobile/         Expo SDK 54 app (Mapbox + offline queue)
├── package.json    Workspace scripts (dev, build, start, heroku-postbuild)
└── Procfile        Heroku entry point
```

## Local development

One command runs both server and client with live reload:

```bash
npm install                  # installs concurrently at root
npm run install:all          # installs server/ and client/ deps
npm run seed:admin           # creates admin@example.com / changeme123 + default survey
npm run dev                  # http://localhost:4000 (API) + http://localhost:5173 (admin)
```

`server/.env` should already be set up from earlier. If you ever start fresh, copy `server/.env.example` to `server/.env` and edit.

For the mobile app, see [`mobile/README.md`](mobile/README.md). Mobile builds need:
1. `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` exported in your shell.
2. `mobile/eas.json` `env.EXPO_PUBLIC_API_BASE_URL` set to your Mac's LAN IP for local Dev Client testing.

## Deploying the server + admin to Heroku

This monorepo deploys as a **single** Heroku app. The server serves the built React admin dashboard from the same origin, so you only pay for one dyno.

### One-time

```bash
# Install Heroku CLI if you don't have it
brew tap heroku/brew && brew install heroku

heroku login
heroku create canvass-app                   # pick your name
heroku git:remote -a canvass-app
```

### MongoDB Atlas (free tier)

You need a MongoDB Atlas cluster. Heroku no longer ships a Mongo add-on.

1. Sign up at https://www.mongodb.com/cloud/atlas/register (free).
2. Create a free **M0** cluster.
3. **Database Access** → add a user (save the password).
4. **Network Access** → add `0.0.0.0/0` (Heroku's outbound IPs aren't fixed).
5. **Connect** → **Drivers** → copy the URI:
   `mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/canvass-app?retryWrites=true&w=majority`

Replace `<password>` with the actual password and append `/canvass-app` as the database name.

### Heroku config vars

```bash
heroku config:set \
  NODE_ENV=production \
  MONGODB_URI='mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/canvass-app?retryWrites=true&w=majority' \
  JWT_SECRET="$(openssl rand -hex 48)" \
  MAPBOX_PUBLIC_TOKEN='pk.xxxxx'
```

`MAPBOX_PUBLIC_TOKEN` (a `pk.*` token) is what the server hands to the admin dashboard to render Mapbox map tiles. The Mapbox **download** token (different — `RNMAPBOX_MAPS_DOWNLOAD_TOKEN`) is only needed when *building the mobile app*, not when running the server.

### Deploy

```bash
git init                             # if not already a repo
git add .
git commit -m "initial deploy"
git push heroku main
```

What Heroku does:
1. Runs `npm install` (root)
2. Runs `npm run heroku-postbuild` → installs server/client deps + builds `client/dist/`
3. Runs `npm start` → boots the Express server from `Procfile`
4. Express serves `/api/*` from routes and everything else from `client/dist/`

### After first deploy

```bash
# Seed the first admin user on Heroku
heroku run npm run seed:admin

# Watch logs
heroku logs --tail
```

Visit `https://doorline.app` to log in.

### Re-uploading the CSV on production

1. Open the deployed admin dashboard.
2. Sign in.
3. Go to CSV Import → upload your `Target-Universe-HD-64.csv` (the CSV must include `p_Latitude` / `p_Longitude` columns; rows without coordinates are rejected).

(Alternatively, do the upload locally against the prod Mongo URI if you trust the data — but the dashboard works fine.)

## Shipping the mobile app

Two lanes, separated by the **channel** baked into each binary: `staging` (TestFlight + Play internal)
and `production` (App Store + Play production). Full walkthrough in
[`mobile/README.md`](mobile/README.md). Short version:

**Most changes are JS and need no build at all** — one command per lane, both platforms:

```bash
cd mobile
npm run ota:staging      # from a feature branch -> testers
npm run ota:production   # from main, once confirmed -> real users
```

**Native changes** (anything touching `app.json`, `eas.json`, a native dep, an icon) need four
builds from one commit — production pair first, staging pair last:

```bash
eas build --profile production --platform ios
eas build --profile production --platform android
eas build --profile staging    --platform ios
eas build --profile staging    --platform android

eas build:list --limit 4       # grab the ids
eas submit --profile <production|staging> --platform <ios|android> --id <build-id>
```

> 🛑 **Never `eas submit --latest`** — it ignores the profile and picks the newest build for the
> platform, so on iOS it sends your *staging* build to the App Store. Always `--id`.

One-time setup (EAS account, Mapbox token, submit credentials) is in
[`mobile/README.md`](mobile/README.md) → **One-time setup**.

## Status checklist

| Area | State |
|---|---|
| Auth + role middleware | ✅ |
| CSV import (upsert by State Voter ID) | ✅ tested with real CSV: 8,668 voters / 5,840 households / 0 errors |
| Admin dashboard: login, dashboard, import, campaigns, users, **surveys** | ✅ |
| Mobile API (bootstrap, household actions, voter survey) | ✅ |
| Mobile app: login, map, household, voter survey, offline queue | ✅ code complete, needs phone |
| Heroku one-process deploy + monorepo build | ✅ smoke-tested locally in NODE_ENV=production |
| EAS Build profiles (development / preview / production) | ✅ eas.json ready, fill in placeholders |
| Reports beyond overview, activity audit page | ⏳ post-launch |

## Plan file

`~/.claude/plans/ive-come-up-with-drifting-fountain.md`
