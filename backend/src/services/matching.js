// Matching, in two rounds (see "Matching logic" in the design doc):
//   Round 1: listing -> NGO. Hard filters, then a 0..1 score, offered in waves.
//   Round 2: delivery -> volunteer. Filter, rank by trip time then rating.
const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma');
const { addMinutes, istStartOfDay, isWithinDailyWindow } = require('../lib/time');
const { travelMinutes } = require('./geo');

const OPEN_LISTING_STATUSES = ['posted', 'offered', 'partially_claimed'];

// ---------- Round 1: listing -> NGO ----------

// Raw facts about every verified NGO within the radius of the listing's donor.
async function nearbyNgoFacts(listing, settings, now) {
  const dayStart = istStartOfDay(now);
  const weekAgo = addMinutes(now, -7 * 24 * 60);
  const monthAgo = addMinutes(now, -30 * 24 * 60);
  const radiusM = settings.ngo_radius_km * 1000;

  return prisma.$queryRaw`
    SELECT n.ngo_id AS "ngoId", n.user_id AS "userId", n.org_name AS "orgName",
           n.daily_capacity AS "dailyCapacity", n.veg_only AS "vegOnly",
           n.open_from AS "openFrom", n.open_to AS "openTo",
           ST_Distance(n.geo, d.geo) / 1000.0 AS "distanceKm",
           COALESCE((SELECT SUM(c.servings) FROM claims c
                     WHERE c.ngo_id = n.ngo_id AND c.claimed_at >= ${dayStart}
                       AND c.status <> 'cancelled'), 0)::int AS "claimedToday",
           COALESCE((SELECT SUM(c.servings) FROM claims c
                     WHERE c.ngo_id = n.ngo_id AND c.claimed_at >= ${weekAgo}
                       AND c.status IN ('active', 'delivered')), 0)::int AS "received7d",
           (SELECT COUNT(*) FROM claims c WHERE c.ngo_id = n.ngo_id AND c.claimed_at >= ${monthAgo}
              AND c.status = 'delivered')::int AS "delivered30d",
           (SELECT COUNT(*) FROM claims c WHERE c.ngo_id = n.ngo_id AND c.claimed_at >= ${monthAgo}
              AND c.status = 'failed')::int AS "failed30d"
    FROM ngos n
    JOIN users u ON u.user_id = n.user_id
    JOIN donors d ON d.donor_id = ${listing.donorId}::uuid
    WHERE u.status = 'verified' AND n.verified_at IS NOT NULL
      AND ST_DWithin(n.geo, d.geo, ${radiusM})
  `;
}

// Applies the hard filters and scores the NGOs that pass. Pure function, easy to unit test.
function filterAndScoreNgos(listing, facts, settings, now) {
  const reasons = {};
  const passing = [];
  for (const f of facts) {
    const distanceKm = Number(f.distanceKm);
    const minutes = travelMinutes(distanceKm, settings);
    const eta = addMinutes(now, minutes);
    const capacityLeft = f.dailyCapacity - f.claimedToday;
    const minNeeded = Math.min(settings.min_claim_servings, listing.remainingServings);

    let reason = null;
    if (f.vegOnly && listing.foodType !== 'veg') reason = 'veg_only';
    else if (distanceKm > settings.ngo_radius_km) reason = 'too_far';
    else if (!isWithinDailyWindow(eta, f.openFrom, f.openTo)) reason = 'closed_at_eta';
    else if (capacityLeft < minNeeded) reason = 'no_capacity';
    else if (addMinutes(eta, settings.safety_buffer_minutes) > listing.bestBefore) reason = 'too_late';

    if (reason) {
      reasons[f.ngoId] = reason;
      continue;
    }
    passing.push({ ...f, distanceKm, travelMinutes: minutes, eta, capacityLeft });
  }

  const maxReceived = Math.max(0, ...passing.map((p) => p.received7d));
  const w = settings.score_weights;
  for (const p of passing) {
    const proximity = Math.max(0, 1 - p.distanceKm / settings.ngo_radius_km);
    const need = Math.max(0, Math.min(1, p.capacityLeft / p.dailyCapacity));
    const fairness = maxReceived > 0 ? 1 - p.received7d / maxReceived : 1;
    const settled = p.delivered30d + p.failed30d;
    const reliability = settled > 0 ? p.delivered30d / settled : 1;
    p.factors = { proximity, need, fairness, reliability };
    p.score = Number(
      (w.proximity * proximity + w.need * need + w.fairness * fairness + w.reliability * reliability).toFixed(4),
    );
  }
  passing.sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm);
  return { passing, reasons };
}

async function rankNgosForListing(listing, settings, now = new Date()) {
  const facts = await nearbyNgoFacts(listing, settings, now);
  return filterAndScoreNgos(listing, facts, settings, now);
}

// Waves: wave 1 = top N1, wave 2 = next N2, wave 3 = everyone else who passes.
function finalOpenWave(settings) {
  return settings.offer_wave_sizes.length + 1;
}

async function currentWave(listingId) {
  const agg = await prisma.offer.aggregate({ where: { listingId }, _max: { waveNo: true } });
  return agg._max.waveNo ?? 0;
}

// Can this NGO see / claim this listing right now? It must pass the filters and
// either have been offered it, or the listing must have reached the open wave.
async function ngoCanClaim(listing, ngo, settings, now = new Date()) {
  if (!OPEN_LISTING_STATUSES.includes(listing.status) || listing.remainingServings <= 0) {
    return { ok: false, reason: 'not_open' };
  }
  const { passing, reasons } = await rankNgosForListing(listing, settings, now);
  const match = passing.find((p) => p.ngoId === ngo.id);
  if (!match) return { ok: false, reason: reasons[ngo.id] ?? 'out_of_range' };

  const [offered, wave] = await Promise.all([
    prisma.offer.findFirst({ where: { listingId: listing.id, recipientUserId: ngo.userId } }),
    currentWave(listing.id),
  ]);
  if (!offered && wave < finalOpenWave(settings)) return { ok: false, reason: 'not_offered_yet' };
  return { ok: true, match };
}

// ---------- Round 2: delivery -> volunteer ----------

async function rankVolunteersForDelivery(delivery, settings, { radiusKm, excludeUserIds = [] }, now = new Date()) {
  const { claim } = delivery;
  const listing = claim.listing;
  const radiusM = radiusKm * 1000;
  const freshSince = addMinutes(now, -(settings.volunteer_location_max_age_minutes ?? 30));
  const needsCar = claim.servings > settings.large_order_servings;
  const exclude = excludeUserIds.length > 0 ? excludeUserIds : ['00000000-0000-0000-0000-000000000000'];

  const rows = await prisma.$queryRaw`
    SELECT v.volunteer_id AS "volunteerId", v.user_id AS "userId", v.vehicle, v.rating,
           ST_Distance(v.current_geo, d.geo) / 1000.0 AS "toDonorKm"
    FROM volunteers v
    JOIN users u ON u.user_id = v.user_id
    JOIN donors d ON d.donor_id = ${listing.donorId}::uuid
    WHERE u.status = 'verified' AND v.verified_at IS NOT NULL
      AND v.is_available = true
      AND v.current_geo IS NOT NULL
      AND v.last_seen_at >= ${freshSince}
      AND ST_DWithin(v.current_geo, d.geo, ${radiusM})
      AND (${!needsCar} OR v.vehicle = 'car')
      AND NOT EXISTS (SELECT 1 FROM deliveries x
                      WHERE x.volunteer_id = v.volunteer_id AND x.status IN ('assigned', 'picked_up'))
      AND v.user_id NOT IN (${Prisma.join(exclude.map((id) => Prisma.sql`${id}::uuid`))})
  `;

  const donorToNgoKm = delivery.distanceKm ?? 0;
  return rows
    .map((r) => {
      const toDonorKm = Number(r.toDonorKm);
      return {
        ...r,
        toDonorKm,
        tripMinutes: travelMinutes(toDonorKm + donorToNgoKm, settings),
      };
    })
    .sort((a, b) => a.tripMinutes - b.tripMinutes || b.rating - a.rating);
}

module.exports = {
  OPEN_LISTING_STATUSES,
  filterAndScoreNgos,
  rankNgosForListing,
  finalOpenWave,
  currentWave,
  ngoCanClaim,
  rankVolunteersForDelivery,
};
