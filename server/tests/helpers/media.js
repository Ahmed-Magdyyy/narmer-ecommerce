export function mediaFixture() {
  const rows = new Map();
  const uploads = [];
  const removals = [];
  let clock = new Date('2026-10-11T00:00:00Z');
  let failUpload = false;
  let failRemove = false;
  const copy = value => structuredClone(value);
  const matches = (row, store, kind, targetId) => row.store === store && row.kind === kind && row.targetId === targetId;
  const eligible = (row, now) => row.status === 'deletePending' || (['ready', 'uploading'].includes(row.status) && row.expiresAt <= now);
  const repository = {
    async create(data) { rows.set(data._id, copy(data)); return copy(data); },
    async ready(id, now) {
      const row = rows.get(id);
      if (!row || row.status !== 'uploading' || row.expiresAt <= now) return null;
      row.status = 'ready'; return copy(row);
    },
    async find(store, kind, targetId, ids) { return copy([...rows.values()].filter(row => matches(row, store, kind, targetId) && ids.includes(row._id))); },
    async attach(store, kind, targetId, ids, now) {
      let matchedCount = 0;
      for (const row of rows.values()) if (matches(row, store, kind, targetId) && ids.includes(row._id)
        && (row.status === 'attached' || (row.status === 'ready' && row.expiresAt > now))) {
        row.status = 'attached'; matchedCount++;
      }
      return { matchedCount };
    },
    async retire(store, kind, targetId, ids) {
      for (const row of rows.values()) if (matches(row, store, kind, targetId) && ids.includes(row._id) && row.status === 'attached') row.status = 'deletePending';
    },
    async cleanupCandidates(now, target) { return copy([...rows.values()].filter(row => eligible(row, now)
      && (!target || matches(row, target.store, target.kind, target.targetId))).slice(0, 50)); },
    async claimCleanup(id, now) {
      const row = rows.get(String(id));
      if (!row || !eligible(row, now)) return null;
      row.status = 'deletePending'; return copy(row);
    },
    async completeCleanup(id) { if (rows.get(String(id))?.status === 'deletePending') rows.delete(String(id)); },
  };
  const storage = {
    assertReady() {},
    scope: () => ({ endpoint: 'https://storage.bunnycdn.com', zone: 'test-zone' }),
    url: key => `https://catalog.example/${key}`,
    async upload(key, buffer) { uploads.push({ key, buffer }); if (failUpload) throw new Error('upload failed'); },
    async remove(key) { removals.push(key); if (failRemove) throw new Error('remove failed'); },
  };
  return { rows, repository, storage, uploads, removals, now: () => new Date(clock),
    advance(ms) { clock = new Date(clock.getTime() + ms); },
    failUpload(value) { failUpload = value; }, failRemove(value) { failRemove = value; } };
}
