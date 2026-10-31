// What the kit assistant answers from: the kit itself as plain text, plus the facts below.
import fs from 'node:fs';
import crypto from 'node:crypto';

const KIT_HTML = fs.readFileSync(new URL('../private/kit.html', import.meta.url), 'utf8');

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ', '&rarr;': '->', '&minus;': '-', '&times;': 'x' };

export function kitText() {
  let s = KIT_HTML;
  s = s.replace(/<head[\s\S]*?<\/head>/i, '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<header class="top"[\s\S]*?<\/header>/i, '').replace(/<nav[\s\S]*?<\/nav>/i, '').replace(/<form class="askbox"[\s\S]*?<\/form>/i, '');
  s = s.replace(/<template[\s\S]*?<\/template>/gi, '');
  s = s.replace(/<section[^>]*\bid="([^"]+)"[^>]*>/gi, '\n\n=== KIT PAGE: $1 (link: https://workshop.motionplaylabs.com/kit#$1) ===\n');
  s = s.replace(/<(h1|h2)[^>]*>/gi, '\n\n## ').replace(/<h3[^>]*>/gi, '\n\n### ');
  s = s.replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => `${inner} (${href.startsWith('#') ? 'https://workshop.motionplaylabs.com/kit' + href : href})`);
  s = s.replace(/<pre[^>]*>/gi, '\n```\n').replace(/<\/pre>/gi, '\n```\n');
  s = s.replace(/<li[^>]*>/gi, '\n- ').replace(/<(p|div|tr|article|summary|br)[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e);
  // Placeholders filled per person when the kit is served. Here they read generically; FACTS give each cohort's dates.
  const GENERIC = { COHORT: 'their cohort', COHORT_CAPS: 'THEIR COHORT', SUPPORT_SHORT: 'the end of their support window', SUPPORT_MEDIUM: 'the end of their support window', SUPPORT_LONG: 'the end of their support window', KIT_SHORT: 'their kit closing date', KIT_MEDIUM: 'their kit closing date', KIT_LONG: 'their kit closing date', WHATSAPP: 'https://chat.whatsapp.com/Dji5FzXLAvKEIhUWNKCT6r', GROUP_CALLS: 'Cohort 01 only: Saturday 31 October and Saturday 14 November.' };
  s = s.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => GENERIC[k] ?? '');
  s = s.replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

export const FACTS = `
THE BUILD SESSION: FACTS
- Run by Justin Ukaegbu, MotionPlay Labs Ltd (UK company 17304660, Nigeria RC 9621200). Justin is a brand and communication designer, not a developer.
- Each question comes with the asker's cohort, session date, support end and kit closing date. Use those for anything about their dates. Never give one cohort's dates to someone in another cohort.
- Cohorts:
  - Founding Cohort 01: Saturday 24 October 2026, on Zoom. Five attendees: Alex (UK), Henry, Olaniyi, Daniel and Adeoluwa (Lagos). Support and the Ask box until Saturday 14 November 2026. Group calls on Saturday 31 October and Saturday 14 November, times confirmed in the WhatsApp group. Kit open until Thursday 31 December 2026. Their deck is at https://workshop.motionplaylabs.com/kit/deck.pdf (Cohort 01 only). Fee was £50 or ₦85,000.
  - Cohort 02: Saturday 21 November 2026. Support and the Ask box until Saturday 12 December 2026. Kit open until Saturday 30 January 2027.
  - Cohort 03: Saturday 5 December 2026. Support and the Ask box until Saturday 26 December 2026. Kit open until Saturday 13 February 2027.
  - Cohort 04: Saturday 19 December 2026. Support and the Ask box until Saturday 9 January 2027. Kit open until Saturday 27 February 2027.
- Cohorts 02 to 04 run 2 to 5 PM UK (3 to 6 PM Lagos) on Zoom, cost £75 or ₦125,000, need a paid Claude plan (Pro or above) and a laptop or desktop, and go further than Cohort 01: real data behind the build, the attendee's own domain, and a live link. Their Zoom link is in their confirmation email and on their kit page before the session. There are no scheduled group calls for Cohorts 02 to 04.
- The method: Structure (ChatGPT turns the idea into a Build Brief, Prompt 1), Direct (Claude builds it, Prompt 2), Evaluate (you judge it against the checklist, plus Prompt 6 for a second opinion from ChatGPT or a new Claude chat), Refine (one change at a time, Prompt 3 with Now:/Instead:). Then save and put it online (Step 7, Netlify).
- Support: one WhatsApp group for all cohorts (https://chat.whatsapp.com/Dji5FzXLAvKEIhUWNKCT6r). Replies within 24 hours, Monday to Friday, during each person's support window.
- The kit (https://workshop.motionplaylabs.com/kit): sign in with the booking reference (starts TBS-) and a 6-digit code sent by email. Before someone's session starts, the kit only shows their date, Zoom link and setup checklist; everything else unlocks when the session starts.
- The Ask box in the kit is open from the start of each person's session to the end of their support window. The kit assistant answers within the hour. Justin sees every answer.
- Email: hello@motionplaylabs.com.
- Void Canvas (https://voidcanvas.app) is Justin's own free design studio in the browser: Studio, Editor, Effects and Brand. No account needed; files stay on the device. Designers in Cohort 01 were asked to test it and send feedback through the kit.
- Booking for Cohorts 02 to 04 is at https://workshop.motionplaylabs.com. Seats go in payment order.
- Payments, refunds, moving to another date, invoices, call times not yet posted, private arrangements and anything about another attendee are for Justin to answer.
`.trim();

export const ANSWER_RULES = `
HOW TO ANSWER
- Answer the question asked, first line first. No greeting, no preamble, no "Great question", no sign-off.
- Be direct and specific: exact prompts, exact clicks, exact wording to type. Use the kit's own prompts and link to the kit page that covers it.
- Never invent a setting, menu path, feature, price, date or fact. If the kit covers it, use the kit. If it's about how Claude, ChatGPT, Netlify, Higgsfield or another tool works today, check current official help pages before stating steps. If you still can't verify it, say exactly what you're not sure of and how they can check.
- If it can't be done the way they want (for example a browser page reading heart-rate data from a watch), say so plainly and give the closest thing that works.
- Plain British English, short sentences. No em dashes. No marketing language. Keep it under about 250 words unless step-by-step instructions need more.
- Format: short paragraphs, "1." steps or "-" bullets, **bold** sparingly, \`code\` for things to type, \`\`\` blocks for prompts to paste. No tables, no headings above level 4.
- Escalate (set escalate: true) only when the answer must come from Justin: payments, refunds, moving to another date, invoices, private arrangements, complaints, call times not yet posted, or anything about another attendee. Then write a short holding reply saying Justin will reply by email, and put what Justin needs to know in note_for_justin.
`.trim();

// Everything the assistant reads, as one document, and its hash for change detection.
export function knowledge() {
  const body = `${ANSWER_RULES}\n\n${FACTS}\n\nTHE KIT (what attendees see, page by page)\n\n${kitText()}`;
  return { body, hash: crypto.createHash('sha256').update(body).digest('hex') };
}
