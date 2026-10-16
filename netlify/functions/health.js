import { store, paidSeats, json } from './_shared.js';

export async function handler() {
  return json({ ok: true, seats: paidSeats(await store.paidCount()) });
}
