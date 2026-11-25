// Reads and validates environment variables once, at startup.
require('dotenv').config({ quiet: true });
const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // Comma-separated phone numbers that become admins on first login (the project creators)
  ADMIN_PHONES: z.string().default(''),
  // "console" logs OTPs and SMS to the server log; "msg91" sends real SMS
  SMS_PROVIDER: z.enum(['console', 'msg91']).default('console'),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),
  // Return the OTP in the API response. Only for local development and tests.
  OTP_DEV_ECHO: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // Run BullMQ workers inside the API process (simple setup). Set false and run `npm run worker` to split them.
  RUN_WORKERS: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;
env.adminPhones = env.ADMIN_PHONES.split(',').map((p) => p.trim()).filter(Boolean);

if (env.NODE_ENV === 'production' && env.OTP_DEV_ECHO) {
  console.error('OTP_DEV_ECHO must be false in production');
  process.exit(1);
}

module.exports = env;
