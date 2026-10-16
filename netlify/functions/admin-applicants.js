import { store, paidSeats, requireAdmin, json } from './_shared.js';

export async function handler(event) {
  if (!requireAdmin(event)) return json({ ok: false, error: 'unauthorized' }, 401);
  return json({ ok: true, seats: paidSeats(await store.paidCount()), applicants: await store.all() });
}
