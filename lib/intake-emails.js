// Emails for the rolling intake (Cohorts 02 to 04). Plain, short, same look as the Cohort 01 mails.
import { esc } from './emails.js';
import { sessionDay, sessionTimes } from './intake.js';

const LOGO = 'https://d2ol7oe51mr4n9.cloudfront.net/user_3B7NW37kNCO9R3JjEQ3Re2UR4ee/33f6247e-a677-4e37-9ca6-0fad86efc4d4.png';
const SIGN = 'Justin Ukaegbu, MotionPlay Labs\nhello@motionplaylabs.com';

function shell(kicker, title, html) {
  return '<div style="margin:0 auto;max-width:540px;font:15px/1.65 Arial,sans-serif;color:#111">'
    + `<div style="padding:18px 25px 8px"><img src="${LOGO}" alt="MotionPlay Labs" width="132" height="94" style="display:block;width:132px;height:94px;object-fit:contain;margin:0 0 4px -8px;border:0"/>`
    + `<div style="font-size:10px;font-weight:800;letter-spacing:2px">THE BUILD SESSION / ${esc(kicker.toUpperCase())}</div></div>`
    + `<div style="padding:8px 25px 26px;border-bottom:1px solid #ddd"><h1 style="font-size:28px;letter-spacing:-1px;line-height:1.1">${esc(title)}</h1>${html}</div>`
    + '<div style="padding:16px 25px;color:#777;font-size:12px">Justin Ukaegbu · MotionPlay Labs<br>hello@motionplaylabs.com</div></div>';
}
const firstName = (a) => (String(a.full_name || '').trim().split(/\s+/)[0] || 'there');
const when = (c) => `${sessionDay(c.session_at)}, ${sessionTimes(c.session_at, c.duration_minutes || 180)}`;
const button = (url, label) => `<p><a href="${esc(url)}" style="display:inline-block;padding:14px 20px;background:#ccff00;color:#111;text-decoration:none;font-weight:bold">${esc(label)}</a></p>`;

// Sent with the payment link, straight after the form.
export function intakeApplication(a, { payUrl, fee, projected, expiresAt }) {
  const until = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(expiresAt)) + ' UK time';
  const where = projected ? `${projected.label}: ${when(projected)}` : 'the next session with a free seat';
  const html = shell('Booking', 'Pay to take your seat.',
    `<p>Hi ${esc(firstName(a))},</p><p>Seats go in payment order. If you pay now, you're in <b>${esc(where)}</b>.</p>`
    + `<p>Fee: <b>${esc(fee.label)}</b> · Reference ${esc(a.reference)}</p>`
    + button(payUrl, `Pay ${fee.label} and take my seat`)
    + `<p style="color:#555;font-size:13px">This link works until ${esc(until)}. If that session fills before your payment goes through, you'll be placed in the next one, and your confirmation email will say which.</p>`);
  const text = `Hi ${firstName(a)},\n\nSeats go in payment order. If you pay now, you're in ${where}.\n\nFee: ${fee.label}\nReference: ${a.reference}\n\nPay and take your seat: ${payUrl}\n\nThis link works until ${until}. If that session fills before your payment goes through, you'll be placed in the next one, and your confirmation email will say which.\n\n${SIGN}`;
  return { subject: `Pay to take your Build Session seat · ${fee.label}`, html, text };
}

// Sent on payment when the session has no Zoom link yet. With a Zoom link, prepEmail is used instead.
export function intakeConfirmed(a, cohort, { movedFrom } = {}) {
  const moved = movedFrom ? `${movedFrom.label} filled before your payment went through, so you're in ${cohort.label}.` : '';
  const html = shell(cohort.label, "You're in.",
    `<p>Hi ${esc(firstName(a))},</p>` + (moved ? `<p><b>${esc(moved)}</b></p>` : '')
    + `<p>Your seat is confirmed for <b>${esc(cohort.label)}</b>.</p><p><b>${esc(when(cohort))}</b><br>Live online, on Zoom<br>Reference ${esc(a.reference)}</p>`
    + `<p>Your Zoom link and a 10-minute setup checklist will follow before the session.</p>`
    + `<p style="color:#555;font-size:13px">Can't make this date? Reply before 2 PM UK the day before for a full refund. If a later session has a free seat, we can move you instead.</p>`);
  const text = `Hi ${firstName(a)},\n\n${moved ? moved + '\n\n' : ''}Your seat is confirmed for ${cohort.label}.\n${when(cohort)}\nLive online, on Zoom\nReference: ${a.reference}\n\nYour Zoom link and a 10-minute setup checklist will follow before the session.\n\nCan't make this date? Reply before 2 PM UK the day before for a full refund. If a later session has a free seat, we can move you instead.\n\n${SIGN}`;
  return { subject: `Confirmed: ${cohort.label}, ${sessionDay(cohort.session_at)}`, html, text };
}

// Paid after every seat in every session had gone. The refund is issued automatically.
export function intakeFullRefund(a, feeLabel) {
  const html = shell('Booking', 'Every seat has gone.',
    `<p>Hi ${esc(firstName(a))},</p><p>The last seat was taken just before your payment went through. Your ${esc(feeLabel)} has been refunded in full to the card you paid with. Banks usually take 5 to 10 working days to show it.</p>`
    + `<p>You'll be first to hear when the next dates open. Sorry it didn't work out this time.</p><p style="color:#666">Reference: ${esc(a.reference)}</p>`);
  const text = `Hi ${firstName(a)},\n\nThe last seat was taken just before your payment went through. Your ${feeLabel} has been refunded in full to the card you paid with. Banks usually take 5 to 10 working days to show it.\n\nYou'll be first to hear when the next dates open. Sorry it didn't work out this time.\n\nReference: ${a.reference}\n\n${SIGN}`;
  return { subject: 'Your Build Session payment has been refunded', html, text };
}

// To Justin.
export function intakeAdmin(label, a, { cohort, sessions, note } = {}) {
  const lines = [label, 'Name: ' + a.full_name, 'Email: ' + a.email, 'Country: ' + a.country, 'WhatsApp: ' + (a.whatsapp || '-'), 'AI level: ' + a.ai_experience, 'Build: ' + a.project_goal, 'Reference: ' + a.reference];
  if (cohort) lines.push('Placed in: ' + cohort.label + ', ' + sessionDay(cohort.session_at));
  if (note) lines.push(note);
  if (sessions) lines.push('', 'Seats paid:', ...sessions.map((s) => `${s.label} (${sessionDay(s.sessionAt)}): ${s.paid}/${s.capacity}${s.bookingOpen ? '' : ', closed'}`));
  return {
    subject: 'Build Session: ' + label + ' · ' + a.reference,
    text: lines.join('\n'),
    html: '<div style="font-family:Arial;max-width:540px"><pre style="font-family:Arial;white-space:pre-wrap">' + esc(lines.join('\n')) + '</pre></div>',
  };
}
