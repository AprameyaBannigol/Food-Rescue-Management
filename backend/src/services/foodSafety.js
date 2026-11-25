// FSSAI safe-window rules for surplus cooked food.
const { HOUR } = require('../lib/time');

// The latest best-before a donor may set. Donors can choose an earlier time, never a later one.
function maxBestBefore(cookedAt, holding, settings) {
  const hours = settings.safe_hours[holding];
  if (!hours) throw new Error(`Unknown holding type ${holding}`);
  return new Date(cookedAt.getTime() + hours * HOUR);
}

function resolveBestBefore({ cookedAt, holding, requestedBestBefore }, settings) {
  const cap = maxBestBefore(cookedAt, holding, settings);
  if (!requestedBestBefore) return cap;
  return requestedBestBefore < cap ? requestedBestBefore : cap;
}

// Instruction shown to the NGO with the delivery.
function handlingNote(holding) {
  if (holding === 'chilled') return 'Chilled food: keep below 5°C and reheat once to 74°C before serving.';
  return 'Serve soon after delivery. Do not store and reuse.';
}

module.exports = { maxBestBefore, resolveBestBefore, handlingNote };
