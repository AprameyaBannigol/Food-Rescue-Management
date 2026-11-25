// Listings: donors post surplus food; NGOs browse the feed and claim.
const express = require('express');
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const { badRequest, conflict, forbidden, notFound } = require('../lib/errors');
const { addMinutes } = require('../lib/time');
const { z, url, idParam } = require('../lib/schemas');
const validate = require('../middleware/validate');
const { requireAuth, requireRole, requireVerified } = require('../middleware/auth');
const { getSettings } = require('../services/settings');
const { resolveBestBefore, maxBestBefore, handlingNote } = require('../services/foodSafety');
const { recordStatus } = require('../services/statusEvents');
const { runListingWave } = require('../services/listingFlow');
const { rankNgosForListing, currentWave, finalOpenWave, OPEN_LISTING_STATUSES } = require('../services/matching');
const { claimListing } = require('../services/claimFlow');
const { failDelivery } = require('../services/deliveryFlow');
const { notifyUsers } = require('../services/notify');
const { emitTo, rooms } = require('../realtime/emitter');
const { serializeDelivery } = require('./serializers');

const router = express.Router();
router.use(requireAuth);

const isoDate = z.coerce.date();

const createBody = z
  .object({
    title: z.string().trim().min(2).max(200),
    foodType: z.enum(['veg', 'non_veg', 'mixed']),
    holding: z.enum(['hot', 'room_temp', 'chilled']),
    items: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(200),
          quantity: z.coerce.number().positive(),
          unit: z.string().trim().min(1).max(30), // servings, kg, litres, packets...
        }),
      )
      .min(1, 'Add at least one item')
      .max(50),
    totalServings: z.coerce.number().int().min(1).max(100000),
    packaging: z.string().trim().max(200).optional(),
    cookedAt: isoDate,
    bestBefore: isoDate.optional(),
    pickupFrom: isoDate.optional(),
    pickupUntil: isoDate,
    photoUrl: url.optional(),
    notes: z.string().trim().max(1000).optional(),
    // FSSAI donor checklist; every box must be ticked.
    checklist: z.object({
      keptCovered: z.literal(true),
      tempChainUnbroken: z.literal(true),
      vegNonVegSeparate: z.literal(true),
      noPlateLeftovers: z.literal(true),
    }),
  })
  .strict();

async function verifiedDonor(user) {
  const donor = await prisma.donor.findUnique({ where: { userId: user.id } });
  if (!donor || !donor.verifiedAt) throw forbidden('Your donor profile is waiting for verification');
  return donor;
}

router.post('/', requireRole('donor'), requireVerified, validate({ body: createBody }), async (req, res) => {
  const donor = await verifiedDonor(req.user);
  const settings = await getSettings();
  const b = req.valid.body;
  const now = new Date();

  if (b.cookedAt > addMinutes(now, 5)) throw badRequest('Cooked-at time cannot be in the future');
  const bestBefore = resolveBestBefore({ cookedAt: b.cookedAt, holding: b.holding, requestedBestBefore: b.bestBefore }, settings);
  if (bestBefore <= addMinutes(now, settings.safety_buffer_minutes)) {
    throw badRequest(
      `This food is too close to its safe limit (${maxBestBefore(b.cookedAt, b.holding, settings).toISOString()}) to deliver safely`,
    );
  }
  const pickupFrom = b.pickupFrom ?? now;
  const pickupUntil = b.pickupUntil > bestBefore ? bestBefore : b.pickupUntil;
  if (pickupUntil <= pickupFrom) throw badRequest('Pickup window must end after it starts');
  if (pickupUntil <= now) throw badRequest('Pickup window has already ended');

  const listing = await prisma.$transaction(async (tx) => {
    const created = await tx.listing.create({
      data: {
        donorId: donor.id,
        title: b.title,
        foodType: b.foodType,
        holding: b.holding,
        totalServings: b.totalServings,
        remainingServings: b.totalServings,
        packaging: b.packaging,
        cookedAt: b.cookedAt,
        bestBefore,
        pickupFrom,
        pickupUntil,
        photoUrl: b.photoUrl,
        notes: b.notes,
        items: { create: b.items.map((it, i) => ({ itemNo: i + 1, ...it })) },
      },
      include: { items: true },
    });
    await recordStatus(tx, { entityType: 'listing', entityId: created.id, toStatus: 'posted', actorUserId: req.user.id });
    return created;
  });

  emitTo(rooms.admins, 'listing:status', { listingId: listing.id, status: 'posted' });

  // Matching runs at once (wave 1); later waves are timed jobs.
  let firstWave = null;
  try {
    firstWave = await runListingWave(listing.id, 1);
  } catch (err) {
    logger.error({ err, listingId: listing.id }, 'first wave failed');
  }
  const fresh = await prisma.listing.findUnique({ where: { id: listing.id }, include: { items: true } });
  res.status(201).json({ listing: fresh, firstWave, handling: handlingNote(fresh.holding) });
});

router.get('/mine', requireRole('donor'), async (req, res) => {
  const donor = await prisma.donor.findUnique({ where: { userId: req.user.id } });
  if (!donor) return res.json({ listings: [] });
  const listings = await prisma.listing.findMany({
    where: { donorId: donor.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      items: true,
      claims: { include: { ngo: { select: { orgName: true } }, delivery: true } },
    },
  });
  res.json({
    listings: listings.map((l) => ({
      ...l,
      claims: l.claims.map((c) => ({ ...c, delivery: c.delivery && serializeDelivery(c.delivery, 'donor') })),
    })),
  });
});

// NGO home feed: open listings it can claim, best match first.
router.get('/feed', requireRole('ngo'), requireVerified, async (req, res) => {
  const ngo = await prisma.ngo.findUnique({ where: { userId: req.user.id } });
  if (!ngo || !ngo.verifiedAt) throw forbidden('Your NGO profile is waiting for verification');
  const settings = await getSettings();
  const now = new Date();

  // Cheap spatial pre-filter, then the full filters and score per listing.
  const nearby = await prisma.$queryRaw`
    SELECT l.listing_id AS id FROM listings l
    JOIN donors d ON d.donor_id = l.donor_id
    WHERE l.status::text IN ('posted', 'offered', 'partially_claimed')
      AND l.remaining_servings > 0 AND l.best_before > ${now}
      AND ST_DWithin(d.geo, ST_SetSRID(ST_MakePoint(${ngo.lng}, ${ngo.lat}), 4326)::geography, ${settings.ngo_radius_km * 1000})
  `;
  const listings = await prisma.listing.findMany({
    where: { id: { in: nearby.map((r) => r.id) } },
    include: { items: true, donor: { select: { orgName: true, type: true, address: true, lat: true, lng: true } } },
  });

  const myOffers = new Set(
    (
      await prisma.offer.findMany({
        where: { recipientUserId: req.user.id, listingId: { in: listings.map((l) => l.id) } },
        select: { listingId: true },
      })
    ).map((o) => o.listingId),
  );

  const feed = [];
  for (const l of listings) {
    const { passing } = await rankNgosForListing(l, settings, now);
    const me = passing.find((p) => p.ngoId === ngo.id);
    if (!me) continue;
    if (!myOffers.has(l.id) && (await currentWave(l.id)) < finalOpenWave(settings)) continue;
    feed.push({
      ...l,
      match: {
        score: me.score,
        factors: me.factors,
        distanceKm: Number(me.distanceKm.toFixed(2)),
        etaMinutes: me.travelMinutes,
        capacityLeft: me.capacityLeft,
      },
      minutesLeft: Math.floor((l.bestBefore - now) / 60000),
      handling: handlingNote(l.holding),
    });
  }
  feed.sort((a, b) => b.match.score - a.match.score);
  res.json({ listings: feed });
});

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const listing = await prisma.listing.findUnique({
    where: { id: req.valid.params.id },
    include: {
      items: true,
      donor: { select: { id: true, userId: true, orgName: true, type: true, address: true, lat: true, lng: true } },
      claims: {
        include: {
          ngo: { select: { id: true, userId: true, orgName: true, address: true, lat: true, lng: true } },
          delivery: { include: { volunteer: { select: { id: true, userId: true, vehicle: true, rating: true, currentLat: true, currentLng: true, lastSeenAt: true } } } },
        },
      },
    },
  });
  if (!listing) throw notFound('Listing');

  const u = req.user;
  let view;
  if (u.role === 'admin') view = 'admin';
  else if (u.role === 'donor' && listing.donor.userId === u.id) view = 'donor';
  else if (u.role === 'ngo') view = 'ngo';
  else throw forbidden();

  const claims = listing.claims
    .filter((c) => view !== 'ngo' || c.ngo.userId === u.id)
    .map((c) => ({ ...c, delivery: c.delivery && serializeDelivery(c.delivery, view) }));

  if (view === 'ngo' && claims.length === 0 && !OPEN_LISTING_STATUSES.includes(listing.status)) throw forbidden();
  res.json({ listing: { ...listing, claims }, handling: handlingNote(listing.holding) });
});

router.get('/:id/history', requireRole('admin', 'donor'), validate({ params: idParam }), async (req, res) => {
  const listing = await prisma.listing.findUnique({ where: { id: req.valid.params.id }, include: { donor: true, claims: { include: { delivery: true } } } });
  if (!listing) throw notFound('Listing');
  if (req.user.role === 'donor' && listing.donor.userId !== req.user.id) throw forbidden();
  const ids = [listing.id, ...listing.claims.map((c) => c.id), ...listing.claims.map((c) => c.delivery?.id).filter(Boolean)];
  const events = await prisma.statusEvent.findMany({ where: { entityId: { in: ids } }, orderBy: { at: 'asc' } });
  res.json({ events });
});

// Allowed only before any pickup.
router.post('/:id/cancel', requireRole('donor', 'admin'), validate({ params: idParam, body: z.object({ reason: z.string().max(500).optional() }) }), async (req, res) => {
  const listing = await prisma.listing.findUnique({
    where: { id: req.valid.params.id },
    include: { donor: true, claims: { include: { delivery: true } } },
  });
  if (!listing) throw notFound('Listing');
  if (req.user.role === 'donor' && listing.donor.userId !== req.user.id) throw forbidden();
  if (['expired', 'cancelled'].includes(listing.status)) throw conflict(`Listing is already ${listing.status}`);
  const deliveries = listing.claims.map((c) => c.delivery).filter(Boolean);
  if (deliveries.some((d) => ['picked_up', 'delivered', 'confirmed'].includes(d.status))) {
    throw conflict('Food has already been picked up; it can no longer be cancelled');
  }
  const reason = req.valid.body.reason ?? 'Donor cancelled the listing';
  for (const d of deliveries.filter((x) => x.status !== 'failed')) {
    await failDelivery(d.id, req.user.id, { reason, claimStatus: 'cancelled', openIssue: false });
  }
  await prisma.$transaction(async (tx) => {
    await tx.listing.update({ where: { id: listing.id }, data: { status: 'cancelled', remainingServings: 0 } });
    await tx.offer.updateMany({ where: { listingId: listing.id, response: 'none' }, data: { response: 'expired' } });
    await recordStatus(tx, { entityType: 'listing', entityId: listing.id, fromStatus: listing.status, toStatus: 'cancelled', actorUserId: req.user.id, note: reason });
  });
  emitTo(rooms.listing(listing.id), 'listing:status', { listingId: listing.id, status: 'cancelled' });
  await notifyUsers(
    (await prisma.offer.findMany({ where: { listingId: listing.id }, select: { recipientUserId: true } })).map((o) => o.recipientUserId),
    { type: 'listing_cancelled', title: 'Listing cancelled', body: `"${listing.title}" was cancelled by the donor.`, data: { listingId: listing.id } },
  );
  res.json({ ok: true });
});

router.post(
  '/:id/claim',
  requireRole('ngo'),
  requireVerified,
  validate({ params: idParam, body: z.object({ servings: z.coerce.number().int().min(1) }) }),
  async (req, res) => {
    const result = await claimListing(req.valid.params.id, req.user, req.valid.body);
    res.status(201).json({
      claim: result.claim,
      delivery: serializeDelivery(result.delivery, 'ngo'),
      listing: { id: req.valid.params.id, status: result.status, remainingServings: result.remaining },
    });
  },
);

module.exports = router;
