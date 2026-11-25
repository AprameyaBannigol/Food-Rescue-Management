// Profiles: each non-admin user owns exactly one Donor, NGO or Volunteer profile.
// Saving a profile (or changing verification documents) puts it back in the
// admin verification queue.
const express = require('express');
const prisma = require('../lib/prisma');
const { forbidden, notFound } = require('../lib/errors');
const { z, lat, lng, hhmm, url } = require('../lib/schemas');
const validate = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { emitTo, rooms } = require('../realtime/emitter');

const router = express.Router();

async function profileOf(user) {
  if (user.role === 'donor') return prisma.donor.findUnique({ where: { userId: user.id } });
  if (user.role === 'ngo') return prisma.ngo.findUnique({ where: { userId: user.id } });
  if (user.role === 'volunteer') return prisma.volunteer.findUnique({ where: { userId: user.id } });
  return null;
}

const donorBody = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  orgName: z.string().trim().min(2).max(200),
  type: z.enum(['hotel', 'restaurant', 'mess', 'caterer']),
  fssaiLicenceNo: z.string().regex(/^\d{14}$/, 'FSSAI licence numbers have 14 digits'),
  licenceUrl: url,
  address: z.string().trim().min(5).max(500),
  lat,
  lng,
});

const ngoBody = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    orgName: z.string().trim().min(2).max(200),
    regCertNo: z.string().trim().min(3).max(100),
    regCertUrl: url,
    address: z.string().trim().min(5).max(500),
    lat,
    lng,
    openFrom: hhmm.default('00:00'),
    openTo: hhmm.default('23:59'),
    dailyCapacity: z.coerce.number().int().min(1).max(100000),
    vegOnly: z.boolean().default(false),
  });

const volunteerBody = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  vehicle: z.enum(['bike', 'car', 'none']),
  idProofUrl: url,
});

// Fields whose change needs a fresh admin check.
const SENSITIVE = {
  donor: ['orgName', 'fssaiLicenceNo', 'licenceUrl'],
  ngo: ['orgName', 'regCertNo', 'regCertUrl'],
  volunteer: ['idProofUrl'],
};

async function saveProfile(user, kind, data) {
  const { name, ...fields } = data;
  const model = prisma[kind];
  const existing = await model.findUnique({ where: { userId: user.id } });
  const needsReview = !existing || SENSITIVE[kind].some((f) => existing[f] !== fields[f]);

  const profile = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx[kind].update({ where: { userId: user.id }, data: { ...fields, ...(needsReview ? { verifiedAt: null } : {}) } })
      : await tx[kind].create({ data: { ...fields, userId: user.id } });
    if (name || (needsReview && user.status === 'verified')) {
      await tx.user.update({
        where: { id: user.id },
        data: { ...(name ? { name } : {}), ...(needsReview && user.status === 'verified' ? { status: 'pending' } : {}) },
      });
    }
    return saved;
  });
  if (needsReview) emitTo(rooms.admins, 'verification:new', { userId: user.id, role: user.role });
  return profile;
}

router.put('/donor', requireAuth, requireRole('donor'), validate({ body: donorBody }), async (req, res) => {
  res.json({ profile: await saveProfile(req.user, 'donor', req.valid.body) });
});

router.put('/ngo', requireAuth, requireRole('ngo'), validate({ body: ngoBody }), async (req, res) => {
  res.json({ profile: await saveProfile(req.user, 'ngo', req.valid.body) });
});

// NGO settings that do not need re-verification: capacity, hours, veg only, pin.
const ngoSettingsBody = ngoBody.pick({ dailyCapacity: true, openFrom: true, openTo: true, vegOnly: true, lat: true, lng: true, address: true }).partial();
router.patch('/ngo/settings', requireAuth, requireRole('ngo'), validate({ body: ngoSettingsBody }), async (req, res) => {
  const ngo = await prisma.ngo.findUnique({ where: { userId: req.user.id } });
  if (!ngo) throw notFound('NGO profile');
  res.json({ profile: await prisma.ngo.update({ where: { id: ngo.id }, data: req.valid.body }) });
});

router.put('/volunteer', requireAuth, requireRole('volunteer'), validate({ body: volunteerBody }), async (req, res) => {
  res.json({ profile: await saveProfile(req.user, 'volunteer', req.valid.body) });
});

const availabilityBody = z.object({ isAvailable: z.boolean().optional(), isOnCall: z.boolean().optional() });
router.patch('/volunteer/availability', requireAuth, requireRole('volunteer'), validate({ body: availabilityBody }), async (req, res) => {
  const v = await prisma.volunteer.findUnique({ where: { userId: req.user.id } });
  if (!v) throw notFound('Volunteer profile');
  if (!v.verifiedAt) throw forbidden('Your volunteer profile is waiting for verification');
  res.json({ profile: await prisma.volunteer.update({ where: { id: v.id }, data: req.valid.body }) });
});

// Location also arrives over Socket.IO during a trip; this is the REST fallback.
router.post('/volunteer/location', requireAuth, requireRole('volunteer'), validate({ body: z.object({ lat, lng }) }), async (req, res) => {
  const v = await updateVolunteerLocation(req.user.id, req.valid.body);
  res.json({ ok: true, lastSeenAt: v.lastSeenAt });
});

async function updateVolunteerLocation(userId, { lat: la, lng: ln }) {
  return prisma.volunteer.update({
    where: { userId },
    data: { currentLat: la, currentLng: ln, lastSeenAt: new Date() },
  });
}

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user, profile: await profileOf(req.user) });
});

module.exports = { router, profileOf, updateVolunteerLocation };
