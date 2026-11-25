// Test setup: a separate database and Redis DB, reset before each test file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/food_rescue_test?schema=public';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';
process.env.JWT_SECRET = 'test-secret-at-least-16-chars';
process.env.OTP_DEV_ECHO = 'true';
process.env.RUN_WORKERS = 'false';
process.env.ADMIN_PHONES = '+919900000001';

const { execSync } = require('node:child_process');
const request = require('supertest');

let migrated = false;
function migrate() {
  if (migrated) return;
  execSync('npx prisma migrate deploy', { env: process.env, stdio: 'ignore' });
  migrated = true;
}

const prisma = require('../src/lib/prisma');
const { redis } = require('../src/lib/redis');
const { createApp } = require('../src/app');
const { clearSettingsCache } = require('../src/services/settings');

const app = createApp();

async function resetDb() {
  migrate();
  await prisma.$executeRawUnsafe(`
    TRUNCATE status_events, feedback, issues, offers, deliveries, claims, food_items, listings,
             volunteers, ngos, donors, users, config CASCADE`);
  await redis.flushdb();
  clearSettingsCache();
}

// Hubballi points. ~0.009 degrees of latitude = 1 km.
const HUBLI = { lat: 15.3647, lng: 75.124 };
const north = (km) => ({ lat: HUBLI.lat + km * 0.009, lng: HUBLI.lng });

let phoneSeq = 0;
function nextPhone() {
  phoneSeq += 1;
  return `+9198${String(phoneSeq).padStart(8, '0')}`;
}

async function login(phone, role, name = 'Test User') {
  const r1 = await request(app).post('/api/auth/otp/request').send({ phone });
  if (r1.status !== 200) throw new Error(`otp request ${r1.status} ${JSON.stringify(r1.body)}`);
  const r2 = await request(app).post('/api/auth/otp/verify').send({ phone, code: r1.body.devCode, role, name });
  if (r2.status !== 200) throw new Error(`otp verify ${r2.status} ${JSON.stringify(r2.body)}`);
  return { token: r2.body.token, user: r2.body.user };
}

function api(token) {
  const wrap = (method) => (path) => request(app)[method](path).set('Authorization', `Bearer ${token}`);
  return { get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch') };
}

async function admin() {
  const a = await login('+919900000001');
  return { ...a, api: api(a.token) };
}

async function verify(adminApi, userId) {
  const r = await adminApi.post(`/api/admin/users/${userId}/verify`);
  if (r.status !== 200) throw new Error(`verify ${r.status} ${JSON.stringify(r.body)}`);
}

async function makeDonor(adm, at = HUBLI) {
  const u = await login(nextPhone(), 'donor', 'Hotel Manager');
  const a = api(u.token);
  const r = await a.put('/api/profile/donor').send({
    orgName: 'Hotel Test',
    type: 'hotel',
    fssaiLicenceNo: '12345678901234',
    licenceUrl: 'https://example.com/fssai.pdf',
    address: 'Station Road, Hubballi',
    ...at,
  });
  if (r.status !== 200) throw new Error(`donor profile ${r.status} ${JSON.stringify(r.body)}`);
  await verify(adm.api, u.user.id);
  return { ...u, api: a, profile: r.body.profile };
}

async function makeNgo(adm, at, extra = {}) {
  const u = await login(nextPhone(), 'ngo', 'NGO Lead');
  const a = api(u.token);
  const r = await a.put('/api/profile/ngo').send({
    orgName: extra.orgName ?? 'Test NGO',
    regCertNo: 'KA/TR/123',
    regCertUrl: 'https://example.com/cert.pdf',
    address: 'Gokul Road, Hubballi',
    dailyCapacity: 100,
    ...at,
    ...extra,
  });
  if (r.status !== 200) throw new Error(`ngo profile ${r.status} ${JSON.stringify(r.body)}`);
  await verify(adm.api, u.user.id);
  return { ...u, api: a, profile: r.body.profile };
}

async function makeVolunteer(adm, at, vehicle = 'bike') {
  const u = await login(nextPhone(), 'volunteer', 'Volunteer');
  const a = api(u.token);
  const r = await a.put('/api/profile/volunteer').send({ vehicle, idProofUrl: 'https://example.com/id.jpg' });
  if (r.status !== 200) throw new Error(`volunteer profile ${r.status} ${JSON.stringify(r.body)}`);
  await verify(adm.api, u.user.id);
  await a.patch('/api/profile/volunteer/availability').send({ isAvailable: true });
  await a.post('/api/profile/volunteer/location').send(at);
  return { ...u, api: a, profile: r.body.profile };
}

function listingBody(overrides = {}) {
  const now = Date.now();
  return {
    title: 'Veg biryani and dal',
    foodType: 'veg',
    holding: 'hot',
    items: [
      { name: 'Veg biryani', quantity: 8, unit: 'kg' },
      { name: 'Dal', quantity: 5, unit: 'litres' },
    ],
    totalServings: 40,
    packaging: 'Steel containers',
    cookedAt: new Date(now - 30 * 60000).toISOString(),
    pickupUntil: new Date(now + 90 * 60000).toISOString(),
    checklist: { keptCovered: true, tempChainUnbroken: true, vegNonVegSeparate: true, noPlateLeftovers: true },
    ...overrides,
  };
}

async function closeAll() {
  await prisma.$disconnect();
  redis.disconnect();
  const { closeQueue } = require('../src/jobs/queues');
  await closeQueue();
}

module.exports = {
  app,
  prisma,
  redis,
  request,
  resetDb,
  HUBLI,
  north,
  nextPhone,
  login,
  api,
  admin,
  verify,
  makeDonor,
  makeNgo,
  makeVolunteer,
  listingBody,
  closeAll,
};
