// Emails for the Cohort 01 kit: the sign-in code, and the after-session follow-up.
// Same design system as lib/prep.js (table layout, Plus Jakarta Sans with Arial fallback).
import { esc } from './emails.js';

const ASSET = 'https://workshop.motionplaylabs.com/email';
const FONT = "'Plus Jakarta Sans',Arial,Helvetica,sans-serif";
const INK = '#111111', MUTED = '#5b5b66', LINE = '#e7e2f3', LIME = '#ccff00', PURPLE = '#9040ff', LAV = '#f5f0ff';

export const KIT_URL = 'https://workshop.motionplaylabs.com/kit';
export const WHATSAPP_URL = 'https://chat.whatsapp.com/Dji5FzXLAvKEIhUWNKCT6r';

// How each attendee asked to be addressed, where it differs from the first word of their booking name.
const PREFERRED_FIRST = { 'TBS-E12072A8-E': 'Daniel' };
export const firstName = (m) => PREFERRED_FIRST[m.reference] || String(m.full_name || '').trim().split(/\s+/)[0] || 'there';

function head(title, preheader) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(title)}</title><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;700;800&display=swap" rel="stylesheet"><style>@media (max-width:620px){.wrap{width:100%!important}.px{padding-left:22px!important;padding-right:22px!important}.h1{font-size:30px!important}.arrow{display:none!important}.code{font-size:40px!important;letter-spacing:8px!important}}</style></head><body style="margin:0;padding:0;background:${LAV}"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${LAV}" style="background:${LAV}"><tr><td align="center" style="padding:28px 12px"><table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">`
    + `<tr><td bgcolor="#ffffff" class="px" style="background:#ffffff;border-radius:20px 20px 0 0;padding:22px 36px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle"><img src="${ASSET}/mpl-logo.png" width="76" height="76" alt="MotionPlay Labs" style="display:block;width:76px;height:76px;border:0"></td><td valign="middle" align="right" style="font-family:${FONT};font-size:11px;font-weight:800;letter-spacing:2px;color:${INK}">THE BUILD SESSION<br><span style="color:${PURPLE}">FOUNDING COHORT 01</span></td></tr></table></td></tr>`;
}
function foot(reason) {
  return `<tr><td align="center" style="padding:20px 24px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#8a8597">MotionPlay Labs Ltd · UK company 17304660 · <a href="mailto:hello@motionplaylabs.com" style="color:#8a8597">hello@motionplaylabs.com</a><br>${esc(reason)}</td></tr></table></td></tr></table></body></html>`;
}
const button = (href, label, bg = LIME, fg = INK) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${bg}" style="border-radius:12px;background:${bg}"><a href="${esc(href)}" target="_blank" style="display:inline-block;padding:14px 24px;font-family:${FONT};font-size:15px;font-weight:800;color:${fg};text-decoration:none;border-radius:12px">${esc(label)}</a></td></tr></table>`;

export function kitCodeEmail(member, code) {
  const first = firstName(member);
  const html = head('Your kit code', `${code} is your code. It works for 10 minutes.`)
    + `<tr><td bgcolor="${INK}" class="px" style="background:${INK};padding:36px 36px 34px"><p style="margin:0 0 12px;font-family:${FONT};font-size:12px;font-weight:800;letter-spacing:2px;color:${LIME}">COHORT 01 KIT · SIGN-IN CODE</p><h1 class="h1" style="margin:0 0 18px;font-family:${FONT};font-size:30px;line-height:1.15;font-weight:800;letter-spacing:-0.8px;color:#ffffff">Here's your code, ${esc(first)}.</h1><p class="code" style="margin:0 0 18px;font-family:${FONT};font-size:46px;line-height:1;font-weight:800;letter-spacing:12px;color:${LIME}">${esc(code)}</p><p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.6;color:#d9d9e0">Enter it on the kit page within 10 minutes. You'll stay signed in on this device until the kit closes on 31 December.</p></td></tr>`
    + `<tr><td bgcolor="#ffffff" class="px" style="background:#ffffff;border-radius:0 0 20px 20px;padding:22px 36px 26px;font-family:${FONT};font-size:14px;line-height:1.6;color:${MUTED}">Didn't ask for a code? You can ignore this email. Nobody can open your kit without it.</td></tr>`
    + foot('You received this because someone entered your booking reference on the Cohort 01 kit page.');
  const text = `Hi ${first},\n\nYour Cohort 01 kit code is ${code}\n\nEnter it on the kit page within 10 minutes: ${KIT_URL}\nYou'll stay signed in on this device until the kit closes on 31 December.\n\nDidn't ask for a code? You can ignore this email.\n\nMotionPlay Labs\nhello@motionplaylabs.com`;
  return { subject: `${code} is your Build Session kit code`, html, text };
}

export function followUpEmail(member) {
  const first = firstName(member);
  const ref = member.reference;
  const step = (n, title, body, extra = '') =>
    `<tr><td width="46" valign="top" style="padding:0 0 26px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="32" height="32" align="center" valign="middle" bgcolor="${LIME}" style="width:32px;height:32px;border-radius:16px;background:${LIME};font-family:${FONT};font-size:14px;font-weight:800;color:${INK}">${n}</td></tr></table></td><td valign="top" style="padding:4px 0 26px 0;font-family:${FONT};font-size:15px;line-height:1.6;color:${MUTED}"><strong style="display:block;color:${INK};font-size:17px;font-weight:800;margin-bottom:4px">${esc(title)}</strong>${body}${extra}</td></tr>`;
  const dateRow = (label, value, top) =>
    `<tr><td style="padding:11px 0;${top ? '' : `border-top:1px solid ${LINE};`}font-family:${FONT};font-size:14px;color:${MUTED}">${esc(label)}</td><td align="right" style="padding:11px 0;${top ? '' : `border-top:1px solid ${LINE};`}font-family:${FONT};font-size:14px;font-weight:800;color:${INK}">${esc(value)}</td></tr>`;

  const html = head('After Saturday', 'Your kit, your group, and the deck. Support runs until Saturday 14 November.')
    + `<tr><td bgcolor="${INK}" class="px" style="background:${INK};padding:40px 36px 38px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top"><p style="margin:0 0 12px;font-family:${FONT};font-size:12px;font-weight:800;letter-spacing:2px;color:${LIME}">AFTER SATURDAY</p><h1 class="h1" style="margin:0 0 16px;font-family:${FONT};font-size:36px;line-height:1.1;font-weight:800;letter-spacing:-1px;color:#ffffff">Thank you for building with us, ${esc(first)}.</h1><p style="margin:0;font-family:${FONT};font-size:16px;line-height:1.65;color:#d9d9e0">You were the first group to do this, and you came ready to work. Saturday was the start. The next three weeks are where the method becomes yours. Here's everything you need, in the order you'll need it.</p></td><td class="arrow" width="88" valign="top" align="right"><img src="${ASSET}/arrow.png" width="72" height="73" alt="" style="display:block;width:72px;height:73px;border:0"></td></tr></table></td></tr>`
    + `<tr><td bgcolor="#ffffff" class="px" style="background:#ffffff;padding:36px 36px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">`
    + step(1, 'Join the cohort group', 'Questions, progress and builds go here. Post where you are and what you\'re stuck on, and you\'ll get an answer.', `<div style="height:14px;line-height:14px">&nbsp;</div>${button(WHATSAPP_URL, 'Join the WhatsApp group')}`)
    + step(2, 'Open your kit', 'Every prompt from Saturday, plus what I promised after it: the prompts behind the demos, a motion graphics library, how to use Claude with Void Canvas, and how to put your build online.',
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 14px"><tr><td bgcolor="${LAV}" style="background:${LAV};border-left:4px solid ${PURPLE};border-radius:0 14px 14px 0;padding:16px 20px"><p style="margin:0 0 4px;font-family:${FONT};font-size:11px;font-weight:800;letter-spacing:2px;color:${PURPLE}">YOUR REFERENCE</p><p style="margin:0 0 6px;font-family:${FONT};font-size:22px;font-weight:800;letter-spacing:1px;color:${INK}">${esc(ref)}</p><p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.55;color:${MUTED}">Enter it on the kit page. We'll send a 6-digit code to this email address, and you're in. The kit is just for this cohort, so the code keeps it that way.</p></td></tr></table>${button(KIT_URL, 'Open my kit', INK, '#ffffff')}`)
    + step(3, 'Keep the deck', 'The full deck from Saturday is attached as a PDF. It\'s in your kit too, so you never have to dig for this email.')
    + `</table></td></tr>`
    + `<tr><td bgcolor="#ffffff" class="px" style="background:#ffffff;padding:0 36px 30px"><h2 style="margin:0 0 6px;font-family:${FONT};font-size:20px;font-weight:800;letter-spacing:-0.4px;color:${INK}">The dates</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${dateRow('Support in the group', 'Until Saturday 14 November', true)}${dateRow('Your kit', 'Open until Thursday 31 December')}${dateRow('Kit updates', 'Emailed to you as they land')}</table></td></tr>`
    + `<tr><td bgcolor="#ffffff" class="px" style="background:#ffffff;padding:0 36px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${INK}" style="background:${INK};border-radius:16px;padding:22px 24px"><p style="margin:0 0 8px;font-family:${FONT};font-size:11px;font-weight:800;letter-spacing:2px;color:${LIME}">ONE THING THIS WEEK</p><p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.6;color:#ffffff">Open your build, run Prompt 6 for a second opinion, and fix the first problem it finds. One change. Then post the before and after in the group.</p></td></tr></table></td></tr>`
    + `<tr><td bgcolor="#ffffff" class="px" style="background:#ffffff;border-radius:0 0 20px 20px;padding:0 36px 34px"><p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:1.6;color:${INK}">Thank you for backing this before anyone else did. I can't wait to see what you build next.</p><p style="margin:0 0 20px;font-family:${FONT};font-size:15px;line-height:1.6;color:${INK}">Reply to this email any time.</p><p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.5;color:${INK}"><strong>Justin Ukaegbu</strong><br><span style="color:${MUTED}">MotionPlay Labs</span></p></td></tr>`
    + foot('You\'re receiving this because you attended The Build Session, Founding Cohort 01.');

  const text = [
    `Hi ${first},`, '',
    'Thank you for building with us. You were the first group to do this, and you came ready to work. Saturday was the start. The next three weeks are where the method becomes yours. Here is everything you need, in the order you will need it.', '',
    '1. JOIN THE COHORT GROUP',
    'Questions, progress and builds go here.', WHATSAPP_URL, '',
    '2. OPEN YOUR KIT',
    'Every prompt from Saturday, plus the prompts behind the demos, a motion graphics library, how to use Claude with Void Canvas, and how to put your build online.',
    `Your reference: ${ref}`,
    `Enter it at ${KIT_URL} and we will email a 6-digit code to this address.`, '',
    '3. KEEP THE DECK',
    'The full deck from Saturday is attached as a PDF, and it is in your kit too.', '',
    'THE DATES',
    'Support in the group: until Saturday 14 November',
    'Your kit: open until Thursday 31 December',
    'Kit updates: emailed to you as they land', '',
    'ONE THING THIS WEEK',
    'Open your build, run Prompt 6 for a second opinion, and fix the first problem it finds. One change. Then post the before and after in the group.', '',
    'Thank you for backing this before anyone else did. I can\'t wait to see what you build next.',
    'Reply to this email any time.', '',
    'Justin Ukaegbu', 'MotionPlay Labs', 'hello@motionplaylabs.com',
  ].join('\n');

  return { subject: 'After Saturday: your kit, your group and the deck', html, text };
}
