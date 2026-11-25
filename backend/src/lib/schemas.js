// Shared zod pieces.
const { z } = require('zod');

// Indian mobile numbers. Accepts 10 digits, 0-prefixed, or +91; stores +91XXXXXXXXXX.
const phone = z
  .string()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .refine((v) => /^(\+91|91|0)?[6-9]\d{9}$/.test(v), 'Enter a valid Indian mobile number')
  .transform((v) => `+91${v.slice(-10)}`);

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Use HH:MM (24-hour)');
const uuid = z.string().uuid();
const url = z.string().url().max(2000);
const idParam = z.object({ id: uuid });

module.exports = { z, phone, lat, lng, hhmm, uuid, url, idParam };
