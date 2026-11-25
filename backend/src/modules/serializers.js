// Handoff codes are shown only to the party who reads them out:
// the donor sees the pickup code, the NGO sees the drop code, the volunteer sees neither.
function serializeDelivery(delivery, view) {
  if (!delivery) return delivery;
  const { pickupCode, dropCode, ...rest } = delivery;
  if (view === 'admin') return delivery;
  if (view === 'donor') return { ...rest, pickupCode };
  if (view === 'ngo') return { ...rest, dropCode };
  return rest;
}

// Phone numbers are masked; calls go through the in-app call button.
function maskPhone(phone) {
  if (!phone) return phone;
  return `${phone.slice(0, 3)}******${phone.slice(-2)}`;
}

module.exports = { serializeDelivery, maskPhone };
