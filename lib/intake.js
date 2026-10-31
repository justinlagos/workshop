// Rolling intake: one continuous application form feeding several sessions.
// Seats are given in payment order. The database (workshop_confirm_payment) decides the
// session at the moment payment is verified; this module only reads availability and
// formats dates and fees for pages and emails.
import { db, rpc } from '../api/_shared.js';

export const INTAKE_ID = () => process.env.INTAKE_ID || 'winter-2026';

export async function getIntake(id = INTAKE_ID()) {
  const rows = await db('workshop_intakes?id=eq.' + encodeURIComponent(id) + '&select=*');
  return rows[0] || null;
}

// Sessions in date order with seats left, plus the session a payment made now would land in.
export async function availability(id = INTAKE_ID()) {
  const rows = await rpc('workshop_intake_availability', { p_intake: id });
  const sessions = (rows || []).map((r) => ({
    id: r.cohort_id,
    label: r.label,
    sessionAt: r.session_at,
    capacity: r.capacity,
    paid: r.confirmed_count,
    remaining: r.remaining,
    bookingOpen: r.booking_open,
    isNext: r.is_next,
  }));
  const bookable = sessions.filter((s) => s.bookingOpen);
  return {
    sessions,
    next: sessions.find((s) => s.isNext) || null,
    capacity: bookable.reduce((n, s) => n + s.capacity, 0),
    paid: bookable.reduce((n, s) => n + s.paid, 0),
    remaining: bookable.reduce((n, s) => n + s.remaining, 0),
  };
}

export function intakeFee(intake, currency) {
  return currency === 'NGN'
    ? { amount: Number(intake.fee_ngn), currency: 'ngn', label: '₦' + (Number(intake.fee_ngn) / 100).toLocaleString('en-GB') }
    : { amount: Number(intake.fee_gbp), currency: 'gbp', label: '£' + (Number(intake.fee_gbp) / 100).toLocaleString('en-GB') };
}

const fmt = (date, tz, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }).format(date);
const hour = (date, tz) => fmt(date, tz, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(':00', '').replace(/\s?([ap])m$/i, (_, p) => ' ' + p.toUpperCase() + 'M');

const parts = (iso, opts) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', ...opts }).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
// "Saturday 21 November 2026"
export const sessionDay = (iso) => { const p = parts(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return `${p.weekday} ${p.day} ${p.month} ${p.year}`; };
// "Sat 21 Nov"
export const sessionShort = (iso) => { const p = parts(iso, { weekday: 'short', day: 'numeric', month: 'short' }); return `${p.weekday} ${p.day} ${p.month}`; };
// "2 to 5 PM UK (3 to 6 PM Lagos)"
export function sessionTimes(iso, minutes = 180) {
  const start = new Date(iso), end = new Date(start.getTime() + minutes * 60000);
  const span = (tz) => hour(start, tz).replace(/ [AP]M$/, '') + ' to ' + hour(end, tz);
  return `${span('Europe/London')} UK (${span('Africa/Lagos')} Lagos)`;
}
// "Cohort 02, Saturday 21 November 2026, 2 to 5 PM UK (3 to 6 PM Lagos)"
export const sessionLine = (c) => `${c.label}, ${sessionDay(c.session_at || c.sessionAt)}, ${sessionTimes(c.session_at || c.sessionAt, c.duration_minutes || 180)}`;
