# Food Rescue backend

Backend API for the Hubballi surplus food rescue app. Hotels and mess halls post leftover cooked food, the nearest suitable NGO claims it, and a nearby volunteer picks it up and delivers it, with every handoff confirmed by a 4-digit code and a photo.

**Stack:** Node.js + Express 5 (JavaScript), Socket.IO, Prisma 6, PostgreSQL + PostGIS, BullMQ on Redis, phone OTP + JWT.

## Run it locally

You need Node 20+ and either Docker or a local Postgres (with PostGIS) and Redis.

```bash
npm install
cp .env.example .env          # then edit JWT_SECRET and ADMIN_PHONES
docker compose up -d          # Postgres + PostGIS and Redis
npx prisma migrate deploy     # creates the 13 tables
npm run db:seed               # optional: demo donors, NGOs and volunteers around Hubballi
npm run dev                   # API + Socket.IO + background jobs on http://localhost:4000
```

Check `GET /health`. With `SMS_PROVIDER=console` the OTP is printed in the server log, and with `OTP_DEV_ECHO=true` it is also returned by `/api/auth/otp/request` (never in production).

The phone numbers in `ADMIN_PHONES` become admins the first time they log in. Those are the project creators.

### Tests

```bash
createdb food_rescue_test     # once; tests use their own database and Redis DB 1
npm test
```

29 tests cover the full flow (post, offer, claim, volunteer, pickup, drop, confirm), the matching filters and score, offer waves, the 4 h / 12 h FSSAI limits, concurrent claims, expiry, auto-confirm, day and night escalation, and Socket.IO permissions and live location.

## How it fits together

```
src/
  app.js, server.js          Express app; HTTP + Socket.IO + workers
  config/env.js              environment variables (validated)
  modules/                   REST routes per area (auth, profiles, listings, deliveries, offers, issues, stats, admin)
  services/
    matching.js              filters + score for NGOs, ranking for volunteers (PostGIS)
    listingFlow.js           offer waves to NGOs
    claimFlow.js             claim with row locks (first come, first served)
    deliveryFlow.js          volunteer offers, accept, pickup, drop, confirm, fail
    sweep.js                 every-minute job: expiry, late pickups, auto-confirm, stale offers
    escalation.js            admin by day, on-call volunteers at night (10 PM to 7 AM IST)
    foodSafety.js            FSSAI safe windows
    settings.js              tunables from the CONFIG table, with defaults
    notify.js, sms.js        Socket.IO notifications + SMS for urgent alerts
  jobs/                      BullMQ queue, worker, scheduling
  realtime/                  Socket.IO server and Redis emitter
prisma/
  schema.prisma              the 13 entities from the ER diagram
  migrations/                SQL, including the hand-written constraints
  seed.js                    demo data
tests/
```

To run the background jobs as a separate process, set `RUN_WORKERS=false` on the API and run `npm run worker`.

## Data model

The schema follows the Chen ER diagram: USER, DONOR, NGO, VOLUNTEER, LISTING, FOOD_ITEM (weak entity, primary key `listing_id + item_no`), CLAIM, DELIVERY, OFFER, FEEDBACK, ISSUE, STATUS_EVENT and CONFIG.

Composite attributes are flattened: `location` becomes `lat`, `lng`, plus a PostGIS `geo` column generated from them with a GiST index. `open_hours` becomes `open_from`/`open_to`, and `pickup_window` becomes `pickup_from`/`pickup_until`.

Rules enforced in the database (see the end of the first migration):

- `remaining_servings` is between 0 and `total_servings`, and every quantity is positive.
- An offer points at exactly one of a listing or a delivery, and an issue at one or both.
- One active delivery per volunteer, through a partial unique index on `volunteer_id` where the status is assigned or picked up.
- Pickup and drop codes are 4 digits.
- `best_before` is after `cooked_at`, and `pickup_until` is after `pickup_from`.

Small additions to the ER diagram, each needed by a rule in the design doc:

| Table | Added | Why |
|---|---|---|
| LISTING | `holding` (hot, room_temp, chilled) | Decides the 4 h or 12 h FSSAI limit and the reheat note for the NGO |
| DONOR, NGO | `licence_url`, `reg_cert_url` | The uploaded document the admin checks |
| DELIVERY | `confirmed_at`, `created_at`, pickup/drop lat and lng | Auto-confirm timer, 20-minute escalation, and location proof at both handoffs |
| ISSUE | `description`, `created_at`, `resolved_at`; types `unmatched`, `no_volunteer`, `other` | Escalations are stored as issues |
| FEEDBACK | `created_at` | The "two not-OK reports in 30 days" rule |

## Business rules, as implemented

| Rule | Where |
|---|---|
| Hot or room-temperature food: best-before is at most 4 h after cooking. Chilled below 5°C: at most 12 h, and the NGO is told to reheat to 74°C. Donors can set earlier, never later. | `services/foodSafety.js` |
| Donor checklist (covered, temperature chain, veg/non-veg separate, no plate leftovers) must be fully ticked | `POST /api/listings` |
| NGO filters: verified, veg preference, within 8 km, open at arrival time, capacity left ≥ min(10, servings), arrival + 30 min before best-before | `services/matching.js` |
| NGO score = 0.35 proximity + 0.25 need + 0.2 fairness + 0.2 reliability (weights in CONFIG) | `services/matching.js` |
| Offer waves: top 3, after 10 min the next 5, after 20 min everyone who passes, after 30 min escalate if nobody claimed | `services/listingFlow.js` |
| Claims are first come, first served, with `SELECT … FOR UPDATE` on the listing and the NGO | `services/claimFlow.js` |
| Volunteers: verified, available, no active task, within 4 km, location fresher than 30 min, car only above 50 servings. Ranked by trip time, then rating. Top 3 get it; first to accept wins. | `services/matching.js`, `deliveryFlow.js` |
| No volunteer in 10 min: widen to 6 km. In 20 min: escalate and ask the NGO whether it can collect. | `deliveryFlow.js` |
| Escalations go to admins by day, and to on-call volunteers from 10 PM to 7 AM IST, who can then see and resolve issues | `services/escalation.js`, `modules/issues.js` |
| Expiry every minute: best-before minus travel time passed and not picked up, so the listing expires and the donor is told to dispose safely. This wins over every other state. | `services/sweep.js` |
| Assigned volunteer not at the donor by `pickup_until`: back to unassigned | `services/sweep.js` |
| NGO does not confirm in 2 h: auto-confirmed | `services/sweep.js` |
| Two "food not OK" reports in 30 days: the donor is paused until an admin reinstates them | `modules/deliveries.js` |
| Codes: donor sees only the pickup code, NGO only the drop code, volunteer neither | `modules/serializers.js` |
| Every status change is written to STATUS_EVENT | `services/statusEvents.js` |

All the numbers above can be changed by admins at runtime through `PUT /api/admin/config/:key`.

## API

All routes are under `/api`. Send the JWT as the `token` cookie (set at login) or as `Authorization: Bearer <token>`. Errors look like `{ "error": { "code", "message", "details" } }`.

### Auth and profile

| Method | Path | Who | Body / notes |
|---|---|---|---|
| POST | `/auth/otp/request` | anyone | `{ phone }`. Indian mobile; normalised to +91 |
| POST | `/auth/otp/verify` | anyone | `{ phone, code, role?, name? }`. `role` is required the first time (donor, ngo, volunteer) |
| POST | `/auth/logout` | any | |
| GET | `/auth/me` | any | user + profile |
| PUT | `/profile/donor` | donor | `{ orgName, type, fssaiLicenceNo, licenceUrl, address, lat, lng }` |
| PUT | `/profile/ngo` | ngo | `{ orgName, regCertNo, regCertUrl, address, lat, lng, dailyCapacity, vegOnly, openFrom, openTo }` |
| PATCH | `/profile/ngo/settings` | ngo | capacity, hours, veg only, pin (no re-verification) |
| PUT | `/profile/volunteer` | volunteer | `{ vehicle, idProofUrl }` |
| PATCH | `/profile/volunteer/availability` | volunteer | `{ isAvailable?, isOnCall? }` |
| POST | `/profile/volunteer/location` | volunteer | `{ lat, lng }` (REST fallback for Socket.IO) |

Changing a licence, certificate or ID document sends the profile back to the verification queue.

### Donor

| Method | Path | Body / notes |
|---|---|---|
| POST | `/listings` | `{ title, foodType, holding, items[{name, quantity, unit}], totalServings, packaging?, cookedAt, bestBefore?, pickupFrom?, pickupUntil, photoUrl?, notes?, checklist{keptCovered, tempChainUnbroken, vegNonVegSeparate, noPlateLeftovers} }` |
| GET | `/listings/mine` | listings with claims and deliveries, including pickup codes |
| GET | `/listings/:id` | detail, claiming NGOs, volunteer location |
| GET | `/listings/:id/history` | status history |
| POST | `/listings/:id/cancel` | `{ reason? }`, only before any pickup |
| GET | `/stats/me` | meals donated, kg saved, monthly summary |

### NGO

| Method | Path | Body / notes |
|---|---|---|
| GET | `/listings/feed` | open listings it can claim, with score, distance, ETA and minutes left |
| GET | `/offers/mine` | open offers |
| POST | `/listings/:id/claim` | `{ servings }`, all or part |
| GET | `/deliveries/mine?active=true` | incoming deliveries, with drop codes |
| POST | `/deliveries/:id/confirm` | `{ rating 1-5, foodOk, comment? }` |
| GET | `/stats/me` | meals received, reliability |

### Volunteer

| Method | Path | Body / notes |
|---|---|---|
| GET | `/offers/mine` | offered tasks: servings, area, deadline (no street address until accepted) |
| POST | `/offers/:id/accept` | first to accept gets it |
| POST | `/offers/:id/decline` | the next volunteer is offered it |
| GET | `/deliveries/mine` | tasks with both addresses |
| POST | `/deliveries/:id/pickup` | `{ code, photoUrl, lat?, lng? }`, using the donor's code |
| POST | `/deliveries/:id/drop` | `{ code, photoUrl, lat?, lng? }`, using the NGO's code |
| POST | `/deliveries/:id/fail` | `{ reason }` |
| GET | `/stats/me` | deliveries, km, meals moved, badges |

### Everyone

| Method | Path | Notes |
|---|---|---|
| POST | `/issues` | `{ listingId? , deliveryId?, type, description }` |
| GET | `/issues` | admins (and on-call volunteers at night) see all open issues; others see their own |
| PATCH | `/issues/:id` | `{ status: in_progress or resolved, note? }` (admins, on-call volunteers at night) |
| POST | `/deliveries/:id/feedback` | any party, after delivery |

### Admin

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/verifications` | pending users with their profiles |
| POST | `/admin/users/:id/verify` | |
| POST | `/admin/users/:id/suspend` | `{ reason }` |
| POST | `/admin/users/:id/reinstate` | |
| GET | `/admin/users?role=&status=` | |
| GET | `/admin/live` | active listings with map points, status, and stuck flags (unmatched, expiring_soon, no_volunteer, pickup_late) |
| GET | `/admin/stats?days=30` | meals delivered, average post-to-delivery minutes, counts by status |
| GET | `/admin/config` | defaults, overrides, effective values |
| PUT | `/admin/config/:key` | `{ value }` |

### Socket.IO

Connect with `io(API_URL, { auth: { token }, withCredentials: true })`; the cookie also works. Each user joins their own room, and admins also join the admin room.

| Direction | Event | Payload |
|---|---|---|
| client → server | `subscribe:listing` | `listingId`, ack `{ ok }`. Donor, claiming NGO or admin |
| client → server | `subscribe:delivery` | `deliveryId`, ack `{ ok }`. Any party to it |
| client → server | `location:update` | `{ lat, lng }`. Volunteer, while the task page is open |
| server → client | `notification` | `{ type, title, body, data, at }` |
| server → client | `listing:status`, `delivery:status` | status changes |
| server → client | `volunteer:location` | `{ deliveryId, lat, lng, at }` |
| server → client | `admin:alert`, `issue:new`, `verification:new` | admin room |

## Not done yet

- Web push through Firebase Cloud Messaging. Notifications go over Socket.IO, and urgent ones by SMS (console or MSG91).
- Photo upload: the frontend uploads to Cloudinary or Firebase Storage and sends the URL.
- Road distances: travel time is straight-line distance × 1.3 at 20 km/h. Swap in Google Distance Matrix or OSRM in `services/geo.js`.
- Masked calling between parties.
