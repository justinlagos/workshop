// Server-side purchase events for Meta (Conversions API), so ad results count bookings even when
// the browser blocks the pixel. Sent only when META_PIXEL_ID and META_CAPI_TOKEN are set and the
// person allowed ad measurement when they booked. event_id is the booking reference, which the
// pixel's Purchase event on the success page also uses, so Meta counts the booking once.
import crypto from 'node:crypto';
import { site } from '../api/_shared.js';

const sha = (s) => crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex');

export async function sendPurchase(a, value, currency) {
  const pixel = process.env.META_PIXEL_ID, token = process.env.META_CAPI_TOKEN;
  if (!pixel || !token || !a?.ad_consent) return { sent: false };
  const version = process.env.META_GRAPH_VERSION || 'v22.0';
  const utm = a.utm || {};
  const landed = Date.parse(utm.landed_at || a.created_at) || Date.now();
  const user = { em: [sha(a.email)] };
  if (utm.fbclid) user.fbc = `fb.1.${landed}.${utm.fbclid}`;
  const body = {
    data: [{
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      event_id: a.reference,
      action_source: 'website',
      event_source_url: site() + '/payment-success.html',
      user_data: user,
      custom_data: { value, currency, content_name: 'The Build Session' },
    }],
  };
  const r = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(pixel)}/events?access_token=${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('Meta CAPI ' + r.status);
  return { sent: true };
}
