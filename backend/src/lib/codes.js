const crypto = require('node:crypto');

// Random 4-digit handoff code ("0000"-"9999"), from a cryptographic source.
function fourDigitCode() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

function otpCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// Constant-time string comparison for codes.
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { fourDigitCode, otpCode, safeEqual };
