// "History and impact" numbers for each role's own page.
const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const DONE = ['delivered', 'confirmed'];

router.get('/me', async (req, res) => {
  const u = req.user;

  if (u.role === 'donor') {
    const donor = await prisma.donor.findUnique({ where: { userId: u.id } });
    if (!donor) return res.json({});
    const meals = await prisma.claim.aggregate({ where: { status: 'delivered', listing: { donorId: donor.id } }, _sum: { servings: true } });
    const kg = await prisma.foodItem.aggregate({
      where: { unit: { in: ['kg', 'KG', 'Kg'] }, listing: { donorId: donor.id, claims: { some: { status: 'delivered' } } } },
      _sum: { quantity: true },
    });
    const monthly = await prisma.$queryRaw`
      SELECT to_char(date_trunc('month', c.claimed_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS month,
             SUM(c.servings)::int AS meals, COUNT(DISTINCT c.listing_id)::int AS listings
      FROM claims c JOIN listings l ON l.listing_id = c.listing_id
      WHERE l.donor_id = ${donor.id}::uuid AND c.status = 'delivered'
      GROUP BY 1 ORDER BY 1 DESC LIMIT 12`;
    return res.json({ mealsDonated: meals._sum.servings ?? 0, kgSaved: Number(kg._sum.quantity ?? 0), monthly });
  }

  if (u.role === 'ngo') {
    const ngo = await prisma.ngo.findUnique({ where: { userId: u.id } });
    if (!ngo) return res.json({});
    const meals = await prisma.claim.aggregate({ where: { ngoId: ngo.id, status: 'delivered' }, _sum: { servings: true }, _count: true });
    return res.json({ mealsReceived: meals._sum.servings ?? 0, deliveries: meals._count, reliabilityScore: ngo.reliabilityScore });
  }

  if (u.role === 'volunteer') {
    const v = await prisma.volunteer.findUnique({ where: { userId: u.id } });
    if (!v) return res.json({});
    const agg = await prisma.delivery.aggregate({ where: { volunteerId: v.id, status: { in: DONE } }, _count: true, _sum: { distanceKm: true } });
    const meals = await prisma.claim.aggregate({ where: { delivery: { volunteerId: v.id, status: { in: DONE } } }, _sum: { servings: true } });
    const count = agg._count;
    const badges = [
      count >= 1 && 'first_delivery',
      count >= 10 && 'ten_deliveries',
      count >= 50 && 'fifty_deliveries',
      (meals._sum.servings ?? 0) >= 1000 && 'thousand_meals',
    ].filter(Boolean);
    return res.json({
      deliveries: count,
      kmTravelled: Number((agg._sum.distanceKm ?? 0).toFixed(1)),
      mealsMoved: meals._sum.servings ?? 0,
      rating: v.rating,
      badges,
    });
  }

  res.json({});
});

module.exports = router;
