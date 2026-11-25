// Offers: what the matching engine sent to this NGO or volunteer.
const express = require('express');
const prisma = require('../lib/prisma');
const { z, idParam } = require('../lib/schemas');
const validate = require('../middleware/validate');
const { requireAuth, requireRole, requireVerified } = require('../middleware/auth');
const flow = require('../services/deliveryFlow');

const router = express.Router();
router.use(requireAuth, requireRole('ngo', 'volunteer'), requireVerified);

router.get('/mine', async (req, res) => {
  const now = new Date();
  const offers = await prisma.offer.findMany({
    where: { recipientUserId: req.user.id, response: 'none', expiresAt: { gt: now } },
    orderBy: { sentAt: 'desc' },
    include: {
      listing: { include: { items: true, donor: { select: { orgName: true, lat: true, lng: true } } } },
      delivery: {
        include: {
          claim: {
            include: {
              listing: { select: { title: true, foodType: true, bestBefore: true, pickupUntil: true, donor: { select: { orgName: true, lat: true, lng: true } } } },
              ngo: { select: { orgName: true, lat: true, lng: true } },
            },
          },
        },
      },
    },
  });

  // Volunteers see only the area (no street addresses) until they accept.
  const shaped = offers.map((o) => {
    if (!o.delivery) return o;
    const { pickupCode, dropCode, ...d } = o.delivery;
    return {
      ...o,
      delivery: {
        id: d.id,
        servings: d.claim.servings,
        distanceKm: d.distanceKm,
        title: d.claim.listing.title,
        foodType: d.claim.listing.foodType,
        pickupUntil: d.claim.listing.pickupUntil,
        bestBefore: d.claim.listing.bestBefore,
        donor: d.claim.listing.donor,
        ngo: d.claim.ngo,
      },
    };
  });
  res.json({ offers: shaped });
});

router.post('/:id/accept', requireRole('volunteer'), validate({ params: idParam }), async (req, res) => {
  const delivery = await flow.acceptOffer(req.valid.params.id, req.user);
  res.json({ deliveryId: delivery.id, status: delivery.status });
});

router.post('/:id/decline', validate({ params: idParam, body: z.object({}).passthrough() }), async (req, res) => {
  res.json(await flow.declineOffer(req.valid.params.id, req.user));
});

module.exports = router;
