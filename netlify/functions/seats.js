import { store, paidSeats, json } from './_shared.js';

// Availability reflects VERIFIED PAID seats only — never application counts.
export async function handler() {
  return json(paidSeats(await store.paidCount()));
}
