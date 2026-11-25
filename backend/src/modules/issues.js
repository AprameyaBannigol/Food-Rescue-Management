// Issues and escalations. Admins handle them by day; from night_from to night_to
// on-call volunteers can see and resolve them too.
const express = require('express');
const prisma = require('../lib/prisma');
const { badRequest, forbidden, notFound } = require('../lib/errors');
const { z, uuid, idParam } = require('../lib/schemas');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { isNight } = require('../services/escalation');
const { notifyAdmins } = require('../services/notify');
const { recordStatus } = require('../services/statusEvents');
const { deliveryInclude } = require('../services/deliveryFlow');

const router = express.Router();
router.use(requireAuth);

async function canHandleIssues(user) {
  if (user.role === 'admin') return true;
  if (user.role !== 'volunteer' || user.status !== 'verified') return false;
  const v = await prisma.volunteer.findUnique({ where: { userId: user.id } });
  return Boolean(v?.isOnCall) && (await isNight());
}

const createBody = z
  .object({
    listingId: uuid.optional(),
    deliveryId: uuid.optional(),
    type: z.enum(['food_quality', 'no_show', 'wrong_quantity', 'safety', 'other']),
    description: z.string().trim().min(3).max(2000),
  })
  .refine((b) => b.listingId || b.deliveryId, 'Give a listingId or a deliveryId');

router.post('/', validate({ body: createBody }), async (req, res) => {
  const b = req.valid.body;
  const u = req.user;
  let listingId = b.listingId ?? null;
  // Only people involved can raise an issue about something.
  if (b.deliveryId) {
    const d = await prisma.delivery.findUnique({ where: { id: b.deliveryId }, include: deliveryInclude });
    if (!d) throw notFound('Delivery');
    const parties = [d.claim.listing.donor.userId, d.claim.ngo.userId, d.volunteer?.userId];
    if (u.role !== 'admin' && !parties.includes(u.id)) throw forbidden();
    listingId = listingId ?? d.claim.listingId;
  } else {
    const l = await prisma.listing.findUnique({ where: { id: listingId }, include: { donor: true, claims: { include: { ngo: true } } } });
    if (!l) throw notFound('Listing');
    const parties = [l.donor.userId, ...l.claims.map((c) => c.ngo.userId)];
    if (u.role !== 'admin' && !parties.includes(u.id)) throw forbidden();
  }
  const issue = await prisma.issue.create({
    data: { listingId, deliveryId: b.deliveryId ?? null, type: b.type, description: b.description, raisedById: u.id },
  });
  await notifyAdmins({ type: 'issue', title: `New issue: ${b.type.replace('_', ' ')}`, body: b.description, data: { issueId: issue.id } });
  res.status(201).json({ issue });
});

router.get('/', validate({ query: z.object({ status: z.enum(['open', 'in_progress', 'resolved']).optional() }) }), async (req, res) => {
  if (!(await canHandleIssues(req.user))) {
    // Everyone else sees only the issues they raised.
    const issues = await prisma.issue.findMany({ where: { raisedById: req.user.id }, orderBy: { createdAt: 'desc' } });
    return res.json({ issues });
  }
  const issues = await prisma.issue.findMany({
    where: { status: req.valid.query.status ?? { in: ['open', 'in_progress'] } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      listing: { select: { id: true, title: true, status: true, donor: { select: { orgName: true, address: true } } } },
      delivery: { select: { id: true, status: true } },
      raisedBy: { select: { id: true, name: true, role: true } },
    },
  });
  res.json({ issues });
});

router.patch(
  '/:id',
  validate({ params: idParam, body: z.object({ status: z.enum(['in_progress', 'resolved']), note: z.string().max(1000).optional() }) }),
  async (req, res) => {
    if (!(await canHandleIssues(req.user))) throw forbidden('Only admins, or on-call volunteers at night, can handle issues');
    const issue = await prisma.issue.findUnique({ where: { id: req.valid.params.id } });
    if (!issue) throw notFound('Issue');
    if (issue.status === 'resolved') throw badRequest('Issue is already resolved');
    const { status, note } = req.valid.body;
    const updated = await prisma.issue.update({
      where: { id: issue.id },
      data: status === 'resolved' ? { status, resolvedById: req.user.id, resolvedAt: new Date() } : { status },
    });
    await recordStatus(prisma, { entityType: 'issue', entityId: issue.id, fromStatus: issue.status, toStatus: status, actorUserId: req.user.id, note });
    res.json({ issue: updated });
  },
);

module.exports = router;
