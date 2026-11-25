// Admin pages (project creators): verification queue, live board, users, analytics, config.
const express = require('express');
const prisma = require('../lib/prisma');
const { badRequest, notFound } = require('../lib/errors');
const { addMinutes } = require('../lib/time');
const { z, idParam } = require('../lib/schemas');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { recordStatus } = require('../services/statusEvents');
const { notifyUsers } = require('../services/notify');
const { getSettings, clearSettingsCache, DEFAULTS } = require('../services/settings');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const profileInclude = { donor: true, ngo: true, volunteer: true };

router.get('/verifications', async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { status: 'pending', role: { not: 'admin' } },
    include: profileInclude,
    orderBy: { createdAt: 'asc' },
  });
  // Only users who have filled in a profile are ready to review.
  res.json({ users: users.filter((u) => u.donor || u.ngo || u.volunteer) });
});

router.post('/users/:id/verify', validate({ params: idParam }), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.valid.params.id }, include: profileInclude });
  if (!user) throw notFound('User');
  const profile = user.donor ?? user.ngo ?? user.volunteer;
  if (!profile) throw badRequest('This user has not filled in a profile yet');
  const kind = user.donor ? 'donor' : user.ngo ? 'ngo' : 'volunteer';
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx[kind].update({ where: { userId: user.id }, data: { verifiedAt: now } });
    await tx.user.update({ where: { id: user.id }, data: { status: 'verified' } });
    await recordStatus(tx, { entityType: 'user', entityId: user.id, fromStatus: user.status, toStatus: 'verified', actorUserId: req.user.id });
  });
  await notifyUsers([user.id], { type: 'verified', title: 'You are verified', body: 'Your account is approved. Welcome aboard!', urgent: true });
  res.json({ ok: true });
});

router.post(
  '/users/:id/suspend',
  validate({ params: idParam, body: z.object({ reason: z.string().trim().min(3).max(500) }) }),
  async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.valid.params.id } });
    if (!user) throw notFound('User');
    if (user.role === 'admin') throw badRequest('Admins cannot be suspended here');
    await prisma.user.update({ where: { id: user.id }, data: { status: 'suspended' } });
    await recordStatus(prisma, { entityType: 'user', entityId: user.id, fromStatus: user.status, toStatus: 'suspended', actorUserId: req.user.id, note: req.valid.body.reason });
    res.json({ ok: true });
  },
);

router.post('/users/:id/reinstate', validate({ params: idParam }), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.valid.params.id }, include: profileInclude });
  if (!user) throw notFound('User');
  const verified = Boolean((user.donor ?? user.ngo ?? user.volunteer)?.verifiedAt);
  const status = verified ? 'verified' : 'pending';
  await prisma.user.update({ where: { id: user.id }, data: { status } });
  await recordStatus(prisma, { entityType: 'user', entityId: user.id, fromStatus: user.status, toStatus: status, actorUserId: req.user.id });
  res.json({ ok: true, status });
});

router.get(
  '/users',
  validate({ query: z.object({ role: z.enum(['donor', 'ngo', 'volunteer', 'admin']).optional(), status: z.enum(['pending', 'verified', 'suspended']).optional() }) }),
  async (req, res) => {
    const users = await prisma.user.findMany({ where: req.valid.query, include: profileInclude, orderBy: { createdAt: 'desc' }, take: 500 });
    res.json({ users });
  },
);

// Live board: every active listing on a map, coloured by status, with stuck ones flagged.
router.get('/live', async (_req, res) => {
  const settings = await getSettings();
  const now = new Date();
  const listings = await prisma.listing.findMany({
    where: {
      OR: [
        { status: { in: ['posted', 'offered', 'partially_claimed'] } },
        { claims: { some: { delivery: { status: { in: ['unassigned', 'assigned', 'picked_up', 'delivered'] } } } } },
      ],
    },
    include: {
      donor: { select: { orgName: true, lat: true, lng: true } },
      claims: {
        include: {
          ngo: { select: { orgName: true, lat: true, lng: true } },
          delivery: { include: { volunteer: { select: { id: true, currentLat: true, currentLng: true, lastSeenAt: true } } } },
        },
      },
    },
    orderBy: { bestBefore: 'asc' },
  });

  const board = listings.map((l) => {
    const flags = [];
    const unclaimedFor = (now - l.createdAt) / 60000;
    if (l.claims.length === 0 && unclaimedFor > settings.offer_wave_minutes * (settings.offer_wave_sizes.length + 1)) flags.push('unmatched');
    if ((l.bestBefore - now) / 60000 < 60) flags.push('expiring_soon');
    for (const c of l.claims) {
      const d = c.delivery;
      if (d?.status === 'unassigned' && (now - d.createdAt) / 60000 > settings.volunteer_escalate_after_minutes) flags.push('no_volunteer');
      if (d?.status === 'assigned' && l.pickupUntil < addMinutes(now, 10)) flags.push('pickup_late');
    }
    return {
      id: l.id,
      title: l.title,
      status: l.status,
      remainingServings: l.remainingServings,
      bestBefore: l.bestBefore,
      donor: l.donor,
      claims: l.claims.map((c) => ({
        id: c.id,
        servings: c.servings,
        ngo: c.ngo,
        delivery: c.delivery && { id: c.delivery.id, status: c.delivery.status, volunteer: c.delivery.volunteer },
      })),
      stuck: flags.length > 0,
      flags: [...new Set(flags)],
    };
  });
  res.json({ listings: board });
});

// City-level analytics.
router.get('/stats', validate({ query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }) }), async (req, res) => {
  const since = addMinutes(new Date(), -req.valid.query.days * 24 * 60);
  const [byListingStatus, byDeliveryStatus, meals, users, openIssues] = await Promise.all([
    prisma.listing.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: true, _sum: { totalServings: true } }),
    prisma.delivery.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: true }),
    prisma.claim.aggregate({ where: { status: 'delivered', claimedAt: { gte: since } }, _sum: { servings: true } }),
    prisma.user.groupBy({ by: ['role', 'status'], _count: true }),
    prisma.issue.count({ where: { status: { in: ['open', 'in_progress'] } } }),
  ]);
  const avgMinutes = await prisma.$queryRaw`
    SELECT AVG(EXTRACT(EPOCH FROM (d.delivered_at - l.created_at)) / 60)::float AS minutes
    FROM deliveries d JOIN claims c ON c.claim_id = d.claim_id JOIN listings l ON l.listing_id = c.listing_id
    WHERE d.delivered_at IS NOT NULL AND d.delivered_at >= ${since}`;
  res.json({
    days: req.valid.query.days,
    mealsDelivered: meals._sum.servings ?? 0,
    avgPostToDeliveryMinutes: avgMinutes[0]?.minutes ? Math.round(avgMinutes[0].minutes) : null,
    listingsByStatus: byListingStatus,
    deliveriesByStatus: byDeliveryStatus,
    users,
    openIssues,
  });
});

router.get('/config', async (_req, res) => {
  res.json({ defaults: DEFAULTS, effective: await getSettings(), overrides: await prisma.config.findMany() });
});

router.put(
  '/config/:key',
  validate({ params: z.object({ key: z.string() }), body: z.object({ value: z.any() }) }),
  async (req, res) => {
    const { key } = req.valid.params;
    if (!(key in DEFAULTS)) throw badRequest(`Unknown setting "${key}"`);
    const { value } = req.valid.body;
    if (typeof value !== typeof DEFAULTS[key] || Array.isArray(value) !== Array.isArray(DEFAULTS[key])) {
      throw badRequest(`"${key}" must be a ${Array.isArray(DEFAULTS[key]) ? 'list' : typeof DEFAULTS[key]}`);
    }
    const row = await prisma.config.upsert({ where: { key }, update: { value }, create: { key, value } });
    clearSettingsCache();
    res.json({ config: row });
  },
);

module.exports = router;
