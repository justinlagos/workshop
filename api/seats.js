// GET /api/seats: sessions in the open intake, seats left in each, the session a payment made
// now would land in, and the fee. Used by the home page booking card.
import { configured, method } from './_shared.js';
import { getIntake, availability, intakeFee, sessionDay, sessionShort, sessionTimes } from '../lib/intake.js';

export default async function handler(req, res) {
  if (!method(req, res, 'GET')) return;
  res.setHeader('Cache-Control', 'no-store');
  if (!configured()) return res.status(503).json({ ok: false, error: 'Booking database configuration pending' });
  try {
    const intake = await getIntake();
    if (!intake) return res.status(200).json({ ok: true, open: false, sessions: [] });
    const av = await availability(intake.id);
    const sessions = av.sessions.map((s) => ({
      id: s.id, label: s.label, sessionAt: s.sessionAt, date: sessionDay(s.sessionAt), short: sessionShort(s.sessionAt), times: sessionTimes(s.sessionAt),
      capacity: s.capacity, remaining: s.remaining, bookingOpen: s.bookingOpen, isNext: s.isNext,
    }));
    return res.status(200).json({
      ok: true,
      open: !!intake.is_open && !!av.next,
      full: !!intake.is_open && !av.next,
      fee: { GBP: intakeFee(intake, 'GBP').label, NGN: intakeFee(intake, 'NGN').label },
      next: sessions.find((s) => s.isNext) || null,
      capacity: av.capacity, paid: av.paid, remaining: av.remaining,
      sessions,
    });
  } catch (e) {
    console.error('seats failed', e.message);
    return res.status(503).json({ ok: false, error: 'Seat availability temporarily unavailable' });
  }
}
