import { store, requireAdmin, json } from './_shared.js';

export async function handler(event) {
  if (!requireAdmin(event)) return json({ ok: false, error: 'unauthorized' }, 401);
  const rows = await store.all();
  const cols = ['reference', 'fullName', 'email', 'country', 'whatsapp', 'aiExperience', 'claudePlan', 'projectGoal', 'currency', 'classification', 'classificationScore', 'status', 'inviteExpiresAt', 'paymentReceipt', 'paymentSource', 'paidAt', 'createdAt'];
  const cell = (r, c) => {
    if (c === 'inviteExpiresAt') return r.invite?.expiresAt ?? '';
    if (c === 'paymentReceipt') return r.payment?.receipt ?? '';
    if (c === 'paymentSource') return !r.payment ? '' : (r.payment.manual ? 'manual-exception' : 'stripe-webhook');
    if (c === 'paidAt') return r.payment?.paidAt ?? '';
    return r[c] ?? '';
  };
  const csv = [cols.join(',')].concat(rows.map((r) => cols.map((c) => JSON.stringify(cell(r, c))).join(','))).join('\n');
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="build-session-applicants.csv"',
    },
    body: csv,
  };
}
