const prisma = require('../lib/prisma');
const { verifyToken } = require('../lib/jwt');
const { unauthorized, forbidden } = require('../lib/errors');

const COOKIE_NAME = 'token';

function tokenFrom(req) {
  if (req.cookies?.[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

// Loads the user on every request so suspensions take effect immediately.
async function requireAuth(req, _res, next) {
  const token = tokenFrom(req);
  if (!token) throw unauthorized();
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw unauthorized('Session expired, please log in again');
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) throw unauthorized();
  if (user.status === 'suspended') throw forbidden('Your account is suspended. Contact the admins.');
  req.user = user;
  next();
}

const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!roles.includes(req.user.role)) throw forbidden(`Only ${roles.join(' or ')} accounts can do this`);
    next();
  };

// No one can post, claim or deliver until an admin has verified their documents.
function requireVerified(req, _res, next) {
  if (req.user.status !== 'verified') throw forbidden('Your account is waiting for admin verification');
  next();
}

module.exports = { COOKIE_NAME, tokenFrom, requireAuth, requireRole, requireVerified };
