// Confirmation + prep email sent the moment a seat is paid: Zoom link, 10-minute checklist,
// the attendee's own build, and the afternoon's timings. Same design as the Cohort 01 prep email.
// Needs a cohort row with join_url (plus optional join_meeting_id, join_passcode, duration_minutes).
import { esc } from './emails.js';

const ASSET = 'https://workshop.motionplaylabs.com/email';
const FONT = "'Plus Jakarta Sans',Arial,Helvetica,sans-serif";
const INK = '#111111', MUTED = '#5b5b66', LINE = '#e7e2f3', LIME = '#ccff00', PURPLE = '#9040ff', LAV = '#f5f0ff';

export const STEPS = [
  ['Use a laptop, not a phone', 'Chrome or Edge, charged, somewhere you can sit for three hours.'],
  ['Install the Zoom app', "Join from the desktop app, not a browser. On a Mac, allow screen recording when Zoom asks, then restart Zoom. You'll share your screen during the session."],
  ['Sign in to ChatGPT and Claude', 'chatgpt.com and claude.ai. Free accounts are fine.'],
  ['Turn on file creation in Claude', "In Claude's settings, turn on code execution and file creation. Claude needs it to build pages."],
  ['Gather your content', 'The words, names, prices and links you want on your build, plus 3 to 5 examples you like the look of.'],
  ['Have a backup', 'A power bank and a phone hotspot if you can. Camera is optional.'],
];
// Minutes from the session start.
const AGENDA = [
  [-10, 'Join and check your sound'], [0, 'Welcome and the method'], [40, 'Live demo: idea to working page'],
  [60, 'Sprint 1: plan your build'], [85, 'Break'], [95, 'Sprint 2: build it, with me beside you'],
  [155, 'Go live on your domain'], [180, 'Close and next steps'],
];

const fmt = (date, tz, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }).format(date);
const dayKey = (date, tz) => fmt(date, tz, { year: 'numeric', month: '2-digit', day: '2-digit' });
const clock = (date, tz) => fmt(date, tz, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?[ap]m$/i, '');
const ampm = (date, tz) => fmt(date, tz, { hour: 'numeric', hour12: true }).replace(/^\d+\s?/, '').toUpperCase();

// Cohorts 02 onwards state a paid Claude plan as a prerequisite on the booking form.
export function stepsFor(cohort) {
  return cohort && cohort.id !== 'cohort-01'
    ? STEPS.map(([t, d]) => (t === 'Sign in to ChatGPT and Claude' ? [t, 'chatgpt.com and claude.ai. ChatGPT free is fine; Claude needs your paid plan (Pro or above).'] : [t, d]))
    : STEPS;
}

const KIT_LINE = 'Your kit opens when the session starts, at workshop.motionplaylabs.com/kit. Sign in with your booking reference and a code we email you.';

export function prepEmail(a, cohort, now = new Date(), opts = {}) {
  const label = cohort.label || 'Founding Cohort 01';
  const STEP_LIST = stepsFor(cohort);
  const kitLine = cohort.id && cohort.id !== 'cohort-01' ? KIT_LINE : '';
  const note = opts.note ? String(opts.note) : '';
  const start = new Date(cohort.session_at);
  const end = new Date(start.getTime() + (Number(cohort.duration_minutes) || 180) * 60000);
  const first = (a.full_name || '').trim().split(/\s+/)[0] || 'there';
  const dayName = fmt(start, 'Europe/London', { weekday: 'long', day: 'numeric', month: 'long' });
  const sameDay = dayKey(start, 'Europe/London') === dayKey(now, 'Europe/London');
  const tomorrow = dayKey(start, 'Europe/London') === dayKey(new Date(now.getTime() + 864e5), 'Europe/London');
  const when = sameDay ? 'today' : tomorrow ? 'tomorrow' : 'on ' + dayName;
  const beforeLabel = sameDay ? 'Before we start' : tomorrow ? 'Before tomorrow' : 'Before the session';
  const ukTimes = `${clock(start, 'Europe/London')} to ${clock(end, 'Europe/London')} ${ampm(end, 'Europe/London')} UK time`;
  const lagosTimes = `${clock(start, 'Africa/Lagos')} to ${clock(end, 'Africa/Lagos')} ${ampm(end, 'Africa/Lagos')} in Lagos`;
  const joinFrom = clock(new Date(start.getTime() - 10 * 60000), 'Europe/London') + ' ' + ampm(new Date(start.getTime() - 10 * 60000), 'Europe/London');
  const zoomLine = [cohort.join_meeting_id && 'Meeting ID ' + cohort.join_meeting_id, cohort.join_passcode && 'Passcode ' + cohort.join_passcode].filter(Boolean).join(' · ');
  const goal = String(a.project_goal || '').trim().slice(0, 200);
  const sameZone = ukTimes.replace(' UK time', '') === lagosTimes.replace(' in Lagos', '');

  const steps = STEP_LIST.map(([t, d], i) =>
    `<tr><td width="44" valign="top" style="padding:0 0 18px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="30" height="30" align="center" valign="middle" bgcolor="${LIME}" style="width:30px;height:30px;border-radius:15px;background:${LIME};font-family:${FONT};font-size:14px;font-weight:800;color:${INK}">${i + 1}</td></tr></table></td><td valign="top" style="padding:3px 0 18px 0;font-family:${FONT};font-size:15px;line-height:1.55;color:${MUTED}"><strong style="display:block;color:${INK};font-size:16px;font-weight:700;margin-bottom:2px">${esc(t)}</strong>${esc(d)}</td></tr>`).join('');
  const agenda = AGENDA.map(([m, x]) =>
    `<tr><td width="64" valign="top" style="padding:9px 0;border-top:1px solid ${LINE};font-family:${FONT};font-size:14px;font-weight:800;color:${PURPLE}">${clock(new Date(start.getTime() + m * 60000), 'Europe/London')}</td><td valign="top" style="padding:9px 0;border-top:1px solid ${LINE};font-family:${FONT};font-size:15px;color:${INK}">${esc(x)}</td></tr>`).join('');

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>Your Build Session seat is confirmed</title><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;700;800&display=swap" rel="stylesheet"><style>@media (max-width:620px){.wrap{width:100%!important}.px{padding-left:22px!important;padding-right:22px!important}.h1{font-size:30px!important}.arrow{display:none!important}}</style></head><body style="margin:0;padding:0;background:${LAV}"><div style="display:none;max-height:0;overflow:hidden;opacity:0">Seat confirmed. Your Zoom link, and 6 things to set up before ${esc(when === 'today' ? 'we start' : 'the session')} (10 minutes).</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${LAV}" style="background:${LAV}"><tr><td align="center" style="padding:28px 12px"><table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">`
    + `<tr><td bgcolor="#ffffff" class="px" style="background:#ffffff;border-radius:20px 20px 0 0;padding:22px 36px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle"><img src="${ASSET}/mpl-logo.png" width="76" height="76" alt="MotionPlay Labs" style="display:block;width:76px;height:76px;border:0"></td><td valign="middle" align="right" style="font-family:${FONT};font-size:11px;font-weight:800;letter-spacing:2px;color:${INK}">THE BUILD SESSION<br><span style="color:${PURPLE}">${esc(label.toUpperCase())}</span></td></tr></table></td></tr>`
    + `<tr><td bgcolor="${INK}" class="px" style="background:${INK};padding:38px 36px 36px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top"><p style="margin:0 0 12px;font-family:${FONT};font-size:12px;font-weight:800;letter-spacing:2px;color:${LIME}">PAYMENT RECEIVED · YOUR SEAT IS CONFIRMED</p><h1 class="h1" style="margin:0 0 16px;font-family:${FONT};font-size:36px;line-height:1.1;font-weight:800;letter-spacing:-1px;color:#ffffff">See you ${esc(when)}, ${esc(first)}.</h1><p style="margin:0 0 26px;font-family:${FONT};font-size:16px;line-height:1.6;color:#d9d9e0">${esc(dayName)}<br>${esc(ukTimes)}${sameZone ? ' (the same time in Lagos)' : ' (' + esc(lagosTimes) + ')'}<br>Live online, on Zoom</p>${note ? `<p style="margin:0 0 22px;font-family:${FONT};font-size:15px;line-height:1.6;font-weight:700;color:${LIME}">${esc(note)}</p>` : ''}<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${LIME}" style="border-radius:12px;background:${LIME}"><a href="${esc(cohort.join_url)}" target="_blank" style="display:inline-block;padding:15px 26px;font-family:${FONT};font-size:16px;font-weight:800;color:${INK};text-decoration:none;border-radius:12px">Join on Zoom</a></td></tr></table><p style="margin:14px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:#a9a9b5">${zoomLine ? esc(zoomLine) + '<br>' : ''}Join from ${esc(joinFrom)} so we can start on time.</p></td><td class="arrow" width="88" valign="top" align="right"><img src="${ASSET}/arrow.png" width="72" height="73" alt="" style="display:block;width:72px;height:73px;border:0"></td></tr></table></td></tr>`
    + `<tr><td bgcolor="#ffffff" class="px" style="background:#ffffff;padding:18px 36px;border-bottom:1px solid ${LINE};font-family:${FONT};font-size:14px;color:${MUTED}">Booking reference <strong style="color:${INK};font-weight:800">${esc(a.reference)}</strong></td></tr>`
    + `<tr><td bgcolor="#ffffff" class="px" style="background:#ffffff;padding:32px 36px 14px"><h2 style="margin:0 0 4px;font-family:${FONT};font-size:22px;font-weight:800;letter-spacing:-0.5px;color:${INK}">${esc(beforeLabel)}</h2><p style="margin:0 0 22px;font-family:${FONT};font-size:15px;color:${MUTED}">About 10 minutes.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${steps}</table></td></tr>`
    + `<tr><td bgcolor="#ffffff" class="px" style="background:#ffffff;padding:4px 36px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${LAV}" style="background:${LAV};border-left:4px solid ${PURPLE};border-radius:0 14px 14px 0;padding:22px 24px"><p style="margin:0 0 8px;font-family:${FONT};font-size:11px;font-weight:800;letter-spacing:2px;color:${PURPLE}">YOUR BUILD</p>${goal ? `<p style="margin:0 0 6px;font-family:${FONT};font-size:14px;color:${MUTED}">From your application:</p><p style="margin:0 0 14px;font-family:${FONT};font-size:18px;line-height:1.4;font-weight:800;color:${INK}">${esc(goal)}</p>` : ''}<p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.55;color:${INK}"><strong>Reply to this email before the session</strong> with your build in one sentence: what it is, who it's for, and the one job it does. Keep it to one page that does one job.</p></td></tr></table></td></tr>`
    + `<tr><td bgcolor="#ffffff" class="px" style="background:#ffffff;padding:0 36px 30px"><h2 style="margin:0 0 4px;font-family:${FONT};font-size:22px;font-weight:800;letter-spacing:-0.5px;color:${INK}">How the afternoon runs</h2><p style="margin:0 0 14px;font-family:${FONT};font-size:15px;color:${MUTED}">${sameZone ? 'UK and Lagos times are the same.' : 'Times are UK time.'}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${agenda}</table></td></tr>`
    + `<tr><td bgcolor="#ffffff" class="px" style="background:#ffffff;border-radius:0 0 20px 20px;padding:4px 36px 34px"><p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.6;color:${INK}">You'll leave with something that works, the prompt pack to keep building, and 21 days of support after the session.</p>${kitLine ? `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.6;color:${INK}">${esc(kitLine)}</p>` : ''}<p style="margin:0 0 22px;font-family:${FONT};font-size:15px;line-height:1.6;color:${INK}">Any questions, just reply to this email.</p><p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.5;color:${INK}"><strong>Justin Ukaegbu</strong><br><span style="color:${MUTED}">MotionPlay Labs</span></p></td></tr>`
    + `<tr><td align="center" style="padding:20px 24px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#8a8597">MotionPlay Labs Ltd · UK company 17304660 · <a href="mailto:hello@motionplaylabs.com" style="color:#8a8597">hello@motionplaylabs.com</a><br>You're receiving this because you booked The Build Session, ${esc(label)}.</td></tr>`
    + `</table></td></tr></table></body></html>`;

  const text = [
    `Hi ${first},`, '',
    `Payment received. Your seat at The Build Session is confirmed. See you ${when}.`, '', ...(note ? [note, ''] : []),
    `${dayName}, ${ukTimes}${sameZone ? ' (the same time in Lagos)' : ' (' + lagosTimes + ')'}`, 'Live online, on Zoom',
    `Join here: ${cohort.join_url}`, ...(zoomLine ? [zoomLine.replace(' · ', ', ')] : []),
    `Join from ${joinFrom} so we can start on time.`, `Booking reference: ${a.reference}`, '',
    `${beforeLabel.toUpperCase()} (about 10 minutes)`, ...STEP_LIST.map(([t, d], i) => `${i + 1}. ${t}. ${d}`), '',
    'YOUR BUILD', ...(goal ? [`From your application: ${goal}`] : []),
    "Reply to this email before the session with your build in one sentence: what it is, who it's for, and the one job it does. Keep it to one page that does one job.", '',
    `HOW THE AFTERNOON RUNS (${sameZone ? 'UK and Lagos times are the same' : 'UK time'})`,
    ...AGENDA.map(([m, x]) => `${clock(new Date(start.getTime() + m * 60000), 'Europe/London')}  ${x}`), '',
    "You'll leave with something that works, the prompt pack to keep building, and 21 days of support after the session.", '',
    ...(kitLine ? [kitLine, ''] : []),
    'Any questions, just reply to this email.', '', 'Justin Ukaegbu', 'MotionPlay Labs', 'hello@motionplaylabs.com',
  ].join('\n');

  return { subject: `Confirmed: your Build Session seat, Zoom link and prep`, html, text };
}
