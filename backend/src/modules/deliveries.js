// Deliveries: the volunteer's pickup and drop, and the NGO's confirmation.
const express = require('express');
const prisma = require('../lib/prisma');
const { forbidden, notFound, conflict } = require('../lib/errors');
const { addMinutes } = require('../lib/time');
const { z, lat, lng, url, idParam } = require('../lib/schemas');
const validate = require('../middleware/validate');
const { requireAuth, requireRole, requireVerified } = require('../middleware/auth');
const { getSettings } = require('../services/settings');
const { notifyAdmins } = require('../services/notify');
const { recordStatus } = require('../services/statusEvents');
const flow = require('../services/deliveryFlow');
const { handlingNote } = require('../services/foodSafety');
const { serializeDelivery, maskPhone } = require('./serializers');

const router = express.Router();
router.use(requireAuth);

// Which view of a delivery the caller gets, or null if they are not part of it.
function viewFor(delivery, user) {
  if (user.role === 'admin') return 'admin';
  if (user.role === 'donor' && delivery.claim.listing.donor.userId === user.id) return 'donor';
  if (user.role === 'ngo' && delivery.claim.ngo.userId === user.id) return 'ngo';
  if (user.role === 'volunteer' && delivery.volunteer?.userId === user.id) return 'volunteer';
  return null;
}

function present(delivery, view) {
  const { claim, volunteer, ...rest } = delivery;
  const listing = claim.listing;
  return {
    ...serializeDelivery(rest, view),
    servings: claim.servings,
    listing: {
      id: listing.id,
      title: listing.title,
      foodType: listing.foodType,
      holding: listing.holding,
      bestBefore: listing.bestBefore,
      pickupFrom: listing.pickupFrom,
      pickupUntil: listing.pickupUntil,
      photoUrl: listing.photoUrl,
      handling: handlingNote(listing.holding),
    },
    // A volunteer sees addresses only for an accepted task, which is the only way they reach this view.
    donor: { orgName: listing.donor.orgName, address: listing.donor.address, lat: listing.donor.lat, lng: listing.donor.lng },
    ngo: { orgName: claim.ngo.orgName, address: claim.ngo.address, lat: claim.ngo.lat, lng: claim.ngo.lng },
    volunteer: volunteer && {
      id: volunteer.id,
      vehicle: volunteer.vehicle,
      rating: volunteer.rating,
      currentLat: volunteer.currentLat,
      currentLng: volunteer.currentLng,
      lastSeenAt: volunteer.lastSeenAt,
    },
  };
}

async function loadForUser(id, user) {
  const delivery = await flow.loadDelivery(prisma, id);
  const view = viewFor(delivery, user);
  if (!view) throw forbidden('This is not your delivery');
  return { delivery, view };
}

router.get('/mine', async (req, res) => {
  const u = req.user;
  let where;
  if (u.role === 'volunteer') where = { volunteer: { userId: u.id } };
  else if (u.role === 'ngo') where = { claim: { ngo: { userId: u.id } } };
  else if (u.role === 'donor') where = { claim: { listing: { donor: { userId: u.id } } } };
  else where = { status: { in: ['unassigned', 'assigned', 'picked_up', 'delivered'] } };
  if (req.query.active === 'true') where = { ...where, status: { in: ['unassigned', 'assigned', 'picked_up', 'delivered'] } };

  const deliveries = await prisma.delivery.findMany({ where, include: flow.deliveryInclude, orderBy: { createdAt: 'desc' }, take: 100 });
  const view = u.role === 'admin' ? 'admin' : u.role;
  res.json({ deliveries: deliveries.map((d) => present(d, view)) });
});

router.get('/:id', validate({ params: idParam }), async (req, res) => {
  const { delivery, view } = await loadForUser(req.valid.params.id, req.user);
  res.json({ delivery: present(delivery, view) });
});

const handoffBody = z.object({ code: z.string().regex(/^\d{4}$/), photoUrl: url, lat: lat.optional(), lng: lng.optional() });

router.post('/:id/pickup', requireRole('volunteer'), requireVerified, validate({ params: idParam, body: handoffBody }), async (req, res) => {
  const d = await flow.confirmPickup(req.valid.params.id, req.user, req.valid.body);
  res.json({ delivery: present(d, 'volunteer') });
});

router.post('/:id/drop', requireRole('volunteer'), requireVerified, validate({ params: idParam, body: handoffBody }), async (req, res) => {
  const d = await flow.confirmDrop(req.valid.params.id, req.user, req.valid.body);
  res.json({ delivery: present(d, 'volunteer') });
});

const confirmBody = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  foodOk: z.boolean(),
  comment: z.string().trim().max(1000).optional(),
});

// NGO confirms receipt and rates the food. Two "not OK" reports in 30 days pause the donor.
router.post('/:id/confirm', requireRole('ngo'), validate({ params: idParam, body: confirmBody }), async (req, res) => {
  const { delivery, view } = await loadForUser(req.valid.params.id, req.user);
  if (view !== 'ngo') throw forbidden();
  const b = req.valid.body;
  await prisma.feedback.create({
    data: { deliveryId: delivery.id, fromUserId: req.user.id, rating: b.rating, foodOk: b.foodOk, comment: b.comment },
  });
  const confirmed = await flow.confirmReceipt(delivery.id, req.user.id);

  if (delivery.volunteerId) await refreshVolunteerRating(delivery.volunteerId);
  if (!b.foodOk) await handleFoodNotOk(delivery, req.user, b.comment);
  res.json({ delivery: present(confirmed, 'ngo') });
});

// Any party can leave feedback on a finished delivery (for example the donor rating the volunteer).
router.post('/:id/feedback', validate({ params: idParam, body: confirmBody }), async (req, res) => {
  const { delivery } = await loadForUser(req.valid.params.id, req.user);
  if (!['delivered', 'confirmed'].includes(delivery.status)) throw conflict('Feedback opens after delivery');
  const fb = await prisma.feedback.create({ data: { deliveryId: delivery.id, fromUserId: req.user.id, ...req.valid.body } });
  if (delivery.volunteerId) await refreshVolunteerRating(delivery.volunteerId);
  res.status(201).json({ feedback: fb });
});

router.post(
  '/:id/fail',
  requireRole('volunteer', 'admin'),
  validate({ params: idParam, body: z.object({ reason: z.string().trim().min(3).max(500) }) }),
  async (req, res) => {
    const { view } = await loadForUser(req.valid.params.id, req.user);
    if (!['volunteer', 'admin'].includes(view)) throw forbidden();
    const d = await flow.failDelivery(req.valid.params.id, req.user.id, { reason: req.valid.body.reason });
    res.json({ delivery: present(d, view) });
  },
);

async function refreshVolunteerRating(volunteerId) {
  const agg = await prisma.feedback.aggregate({ where: { delivery: { volunteerId } }, _avg: { rating: true } });
  if (agg._avg.rating) await prisma.volunteer.update({ where: { id: volunteerId }, data: { rating: Number(agg._avg.rating.toFixed(2)) } });
}

async function handleFoodNotOk(delivery, reporter, comment) {
  const settings = await getSettings();
  const donor = delivery.claim.listing.donor;
  await prisma.issue.create({
    data: {
      type: 'food_quality',
      deliveryId: delivery.id,
      listingId: delivery.claim.listingId,
      raisedById: reporter.id,
      description: comment ?? 'NGO marked the food as not OK',
    },
  });
  const since = addMinutes(new Date(), -settings.donor_pause_window_days * 24 * 60);
  const notOk = await prisma.feedback.count({
    where: { foodOk: false, createdAt: { gte: since }, delivery: { claim: { listing: { donorId: donor.id } } } },
  });
  if (notOk >= settings.donor_pause_not_ok_count) {
    const user = await prisma.user.update({ where: { id: donor.userId }, data: { status: 'suspended' } });
    await recordStatus(prisma, {
      entityType: 'user',
      entityId: user.id,
      fromStatus: 'verified',
      toStatus: 'suspended',
      note: `${notOk} "food not OK" reports in ${settings.donor_pause_window_days} days`,
    });
    await notifyAdmins({
      type: 'donor_paused',
      title: 'Donor paused',
      body: `${donor.orgName} (${maskPhone(user.phone)}) got ${notOk} "food not OK" reports and is paused until you review.`,
      data: { userId: user.id },
      urgent: true,
    });
  }
}

module.exports = router;
