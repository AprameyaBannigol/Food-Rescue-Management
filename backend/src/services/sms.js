// SMS sending for OTPs and urgent alerts (expiry, escalations).
// "console" provider just logs, which is what you want in development.
const env = require('../config/env');
const logger = require('../lib/logger');

async function sendSms(phone, text) {
  if (env.SMS_PROVIDER === 'console') {
    logger.info({ phone, text }, 'SMS (console provider)');
    return;
  }
  if (env.SMS_PROVIDER === 'msg91') {
    // MSG91 Flow API. The template must contain a ##message## variable.
    const res = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: { authkey: env.MSG91_AUTH_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        template_id: env.MSG91_TEMPLATE_ID,
        recipients: [{ mobiles: phone.replace(/^\+/, ''), message: text }],
      }),
    });
    if (!res.ok) logger.error({ status: res.status }, 'MSG91 send failed');
  }
}

module.exports = { sendSms };
