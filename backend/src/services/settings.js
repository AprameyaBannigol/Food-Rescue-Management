// Tunable settings live in the CONFIG table (key -> JSON value) so admins can
// change radius, wave sizes, timeouts and score weights without a redeploy.
// Anything missing from the table falls back to these defaults from the design doc.
const prisma = require('../lib/prisma');

const DEFAULTS = {
  ngo_radius_km: 8,
  volunteer_radius_km: 4,
  volunteer_radius_widened_km: 6,
  offer_wave_sizes: [3, 5], // then everyone who passes the filters
  offer_wave_minutes: 10,
  volunteer_widen_after_minutes: 10,
  volunteer_escalate_after_minutes: 20,
  volunteer_offer_size: 3,
  min_claim_servings: 10,
  safety_buffer_minutes: 30,
  large_order_servings: 50, // above this, car only
  volunteer_location_max_age_minutes: 30, // ignore volunteers whose last location is older
  avg_speed_kmph: 20, // city traffic on a bike
  road_factor: 1.3, // straight-line distance x this = road distance
  auto_confirm_hours: 2,
  default_travel_minutes: 20, // used by the expiry check before anyone has claimed
  night_from: '22:00',
  night_to: '07:00',
  score_weights: { proximity: 0.35, need: 0.25, fairness: 0.2, reliability: 0.2 },
  // FSSAI guidance: hot or room-temperature food 4 h after cooking; chilled below 5°C up to 12 h
  safe_hours: { hot: 4, room_temp: 4, chilled: 12 },
  donor_pause_not_ok_count: 2,
  donor_pause_window_days: 30,
};

let cache = null;
let cacheAt = 0;
const TTL_MS = 30 * 1000;

async function getSettings() {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  const rows = await prisma.config.findMany();
  const merged = { ...DEFAULTS };
  for (const row of rows) merged[row.key] = row.value;
  cache = merged;
  cacheAt = Date.now();
  return merged;
}

function clearSettingsCache() {
  cache = null;
}

module.exports = { DEFAULTS, getSettings, clearSettingsCache };
