# Food Rescue web app

The web app for the Hubballi surplus food rescue project: one Next.js app for donors (hotels and mess halls), NGOs, volunteers and admins, installable as a PWA so it behaves like an app on a phone without an app store.

**Stack:** Next.js 15 (App Router, JavaScript — no TypeScript), React 19, Tailwind CSS 4, Socket.IO client, Leaflet with OpenStreetMap tiles. It talks to the Express API in [`../backend`](../backend).

## Run it locally

Start the backend first (see its README), then:

```bash
npm install
cp .env.example .env.local      # NEXT_PUBLIC_API_URL=http://localhost:4000
npm run dev                     # http://localhost:3000
```

Log in with any seeded phone number (`npm run db:seed` in the backend). The OTP is printed in the API log and, while `OTP_DEV_ECHO=true`, shown on the login screen.

| Role | Demo phone |
|---|---|
| Donor (hotel) | 9800000101 |
| Donor (college mess) | 9800000102 |
| NGO (night shelter) | 9800000201 |
| NGO (children's home, veg only) | 9800000202 |
| NGO (community kitchen) | 9800000203 |
| Volunteer (bike) | 9800000301 |
| Volunteer (car) | 9800000302 |
| Volunteer (on call) | 9800000303 |
| Admin | whatever is in the backend's `ADMIN_PHONES` |

The backend's `CORS_ORIGIN` must list this app's origin.

## Pages

Twenty screens, phone-first, with the role deciding the home page and the bottom navigation.

| Who | Pages |
|---|---|
| Shared | `/login` (phone OTP, then pick a role), `/onboarding` (profile and verification documents), `/profile`, `/notifications` |
| Donor | `/donor` (active listings with live status), `/donor/post` (post surplus food), `/listing/[id]` (claiming NGO, volunteer, pickup code), `/donor/impact` |
| NGO | `/ngo` (feed of nearby food, list or map, with claim), `/ngo/deliveries` (incoming, with the drop code), `/ngo/confirm/[id]` (confirm and rate), `/ngo/settings` (capacity, hours, veg only, pin) |
| Volunteer | `/volunteer` (availability, on-call switch, offered tasks), `/volunteer/task/[id]` (both legs, navigate, pickup and drop checks), `/volunteer/history`, `/volunteer/issues` (night escalations) |
| Admin | `/admin` (live board and map), `/admin/verifications`, `/admin/issues`, `/admin/users`, `/admin/stats` (analytics and runtime settings) |
| Shared tracking | `/delivery/[id]` — the donor, NGO and admins follow one delivery on a map |

## How it is put together

```
app/            one folder per route (App Router, all client components)
components/
  AppShell.js   header, role navigation, verification banner, guards
  ui.js         buttons, cards, fields, badges, toggles, stats
  bits.js       status badges, countdowns, photo input, code input, steps
  MapView.js    Leaflet map (markers, routes, tap to pin)
  ProfileForm.js, ReportIssue.js, IssueList.js, ConfigPanel.js
lib/
  api.js        fetch wrapper; JWT cookie plus a Bearer fallback
  auth.js       session, role routing, page guards
  realtime.js   Socket.IO, notifications inbox, toasts
  useData.js    loading with reload and polling
  format.js     India-time formatting, labels, distances
  upload.js     photo upload (Cloudinary) and geolocation
public/sw.js    service worker: installable, cached shell, offline page
```

Notes on a few choices:

- **Auth.** The API sets an HTTP-only cookie at login; the app also keeps the JWT and sends it as a Bearer token, because some phone browsers block cookies when the app and the API are on different domains.
- **Live updates.** Socket.IO carries notifications, listing and delivery status, and the volunteer's location. Every page also polls slowly as a backstop, so nothing looks frozen if the socket drops.
- **Volunteer location.** The browser cannot track in the background, so the active-task page sends GPS while it is open and asks the volunteer to keep it open.
- **Handoff codes.** The API only ever sends the donor the pickup code and the NGO the drop code; the volunteer sees neither and types what is read out to them.
- **Photos.** With `NEXT_PUBLIC_CLOUDINARY_*` set, photos go to Cloudinary through an unsigned preset and only the URL reaches the API. Without them the app runs in demo mode and stores a tiny thumbnail, which is enough to try the flow locally.
- **Maps.** Leaflet and OpenStreetMap, so no API key is needed. "Navigate" opens Google Maps.

## PWA

`app/manifest.js` plus `public/sw.js` make the app installable ("Add to home screen"), cache the shell and show `public/offline.html` when there is no connection. The service worker registers only in a production build. API calls are never cached. Notifications arrive over Socket.IO while the app is open, and the system notification is shown when the tab is in the background and the user allowed it; urgent alerts also go by SMS from the backend.

## Build and deploy

```bash
npm run build
npm start
```

Vercel works with no configuration: set `NEXT_PUBLIC_API_URL` to the deployed API, and add that origin to the backend's `CORS_ORIGIN`.

## Not done yet

- Web push through Firebase Cloud Messaging (notifications are Socket.IO and SMS for now).
- The notifications inbox is per device: it keeps what arrived over the socket in that browser, because the API has no notifications table.
- Masked in-app calling; the app shows no phone numbers, so parties coordinate through the admins for now.
- No automated frontend tests yet; the whole flow was walked through with Playwright against the seeded backend.
