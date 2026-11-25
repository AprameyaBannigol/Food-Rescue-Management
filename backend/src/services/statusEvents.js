// Every status change is written to STATUS_EVENT (append-only history).
async function recordStatus(db, { entityType, entityId, fromStatus, toStatus, actorUserId = null, note = null }) {
  return db.statusEvent.create({
    data: { entityType, entityId, fromStatus: fromStatus ?? null, toStatus, actorUserId, note },
  });
}

module.exports = { recordStatus };
