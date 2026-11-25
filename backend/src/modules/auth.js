// Phone OTP login, then a JWT in an HTTP-only cookie (also returned in the body
// for clients that prefer an Authorization header).
const express = require('express');
const crypto = require('node:crypto');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const prisma = require('../lib/prisma');
const { redis } = require('../lib/redis');
const { signToken } = require('../lib/jwt');
const { otpCode, safeEqual } = require('../lib/codes');
const { badRequest, unauthorized } = require('../lib/errors');
const { z, phone } = require('../lib/schemas');
const validate = require('../middleware/validate');
const { requireAuth, COOKIE_NAME } = require('../middleware/auth');
const { sendSms } = require('../services/sms');
const { profileOf } = require('./profiles');

const router = express.Router();

const OTP_TTL_S = 5 * 60;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 5;

const hash = (v) => crypto.createHash('sha256').update(`${env.JWT_SECRET}:${v}`).digest('hex');

// Per-IP limit on top of the per-phone limits below. Off in tests.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  message: { error: { code: 'rate_limited', message: 'Too many attempts. Try again in a few minutes.' } },
});

router.post('/otp/request', otpLimiter, validate({ body: z.object({ phone }) }), async (req, res) => {
  const { phone: p } = req.valid.body;
  const sendsKey = `otp:sends:${p}`;
  const sends = await redis.incr(sendsKey);
  if (sends === 1) await redis.expire(sendsKey, 3600);
  if (sends > MAX_SENDS_PER_HOUR) throw badRequest('Too many OTP requests. Try again in an hour.');

  const code = otpCode();
  await redis.set(`otp:${p}`, JSON.stringify({ h: hash(code), attempts: 0 }), 'EX', OTP_TTL_S);
  await sendSms(p, `Your Food Rescue login code is ${code}. It expires in 5 minutes.`);

  const body = { ok: true, expiresInSeconds: OTP_TTL_S };
  if (env.OTP_DEV_ECHO) body.devCode = code;
  res.json(body);
});

const verifyBody = z.object({
  phone,
  code: z.string().regex(/^\d{6}$/),
  // Needed only the first time a phone number logs in.
  name: z.string().trim().min(2).max(100).optional(),
  role: z.enum(['donor', 'ngo', 'volunteer']).optional(),
});

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

router.post('/otp/verify', otpLimiter, validate({ body: verifyBody }), async (req, res) => {
  const { phone: p, code, name, role } = req.valid.body;
  const key = `otp:${p}`;
  const raw = await redis.get(key);
  if (!raw) throw unauthorized('Code expired. Request a new one.');
  const entry = JSON.parse(raw);
  if (entry.attempts >= MAX_ATTEMPTS) {
    await redis.del(key);
    throw unauthorized('Too many wrong attempts. Request a new code.');
  }
  if (!safeEqual(hash(code), entry.h)) {
    entry.attempts += 1;
    await redis.set(key, JSON.stringify(entry), 'KEEPTTL');
    throw unauthorized('Wrong code');
  }

  let user = await prisma.user.findUnique({ where: { phone: p } });
  const isAdmin = env.adminPhones.includes(p);
  // Keep the code valid so the app can resend the same code with a role.
  if (!user && !isAdmin && !role) {
    throw badRequest('New user: choose a role (donor, ngo or volunteer)', { needsRole: true });
  }
  await redis.del(key);

  let isNew = false;
  if (!user) {
    user = await prisma.user.create({
      data: {
        phone: p,
        name: name ?? null,
        role: isAdmin ? 'admin' : role,
        status: isAdmin ? 'verified' : 'pending',
      },
    });
    isNew = true;
  }

  const token = signToken(user);
  setAuthCookie(res, token);
  res.json({ token, user, isNew });
});

router.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user, profile: await profileOf(req.user) });
});

module.exports = router;
