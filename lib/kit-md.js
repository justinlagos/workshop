// A small, safe Markdown subset for kit answers: paragraphs, - and 1. lists, **bold**, `code`,
// ``` code blocks and bare https links. Everything is escaped first, so no HTML gets through.
import { esc } from './emails.js';

function inline(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])(https:\/\/[^\s<)]+[^\s<).,;:!?])/g, '$1<a href="$2">$2</a>');
  return out;
}

// styles: optional inline styles for email clients { p, ul, ol, li, pre, code, a }
export function mdToHtml(md, styles = {}) {
  const st = (k) => (styles[k] ? ` style="${styles[k]}"` : '');
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let para = [], list = null, code = null;
  const flushPara = () => { if (para.length) { html.push(`<p${st('p')}>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { html.push(`<${list.type}${list.start > 1 ? ` start="${list.start}"` : ''}${st(list.type)}>${list.items.map((i) => `<li${st('li')}>${inline(i)}</li>`).join('')}</${list.type}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (code) {
      if (/^```/.test(line)) { html.push(`<pre${st('pre')}><code>${esc(code.join('\n'))}</code></pre>`); code = null; }
      else code.push(raw);
      continue;
    }
    if (/^```/.test(line)) { flushPara(); flushList(); code = []; continue; }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const type = ul ? 'ul' : 'ol';
      if (!list || list.type !== type) { flushList(); list = { type, items: [], start: ol ? Number(ol[1]) : 1 }; }
      list.items.push(ul ? ul[1] : ol[2]);
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) { flushPara(); flushList(); html.push(`<p${st('p')}><strong>${inline(h[1])}</strong></p>`); continue; }
    if (list) flushList();
    para.push(line.trim());
  }
  if (code) html.push(`<pre${st('pre')}><code>${esc(code.join('\n'))}</code></pre>`);
  flushPara(); flushList();
  return html.join('');
}
