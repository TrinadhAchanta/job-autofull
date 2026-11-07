// Turns a tailored resume into a PDF laid out like Tri's original LaTeX resume:
// Computer Modern font, name top-left with contact details on the right,
// small-caps section titles with a rule, bold company / italic title rows with
// dates and places on the right, and bullets that start with a bold lead-in.
// The text stays real text, so applicant tracking systems can read it.
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';

const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Computer Modern (the LaTeX font) from the computer-modern package, embedded
// so the PDF looks the same on any computer without internet.
function fontFaces() {
  let dir;
  try { dir = path.join(path.dirname(createRequire(import.meta.url).resolve('computer-modern/package.json')), 'fonts'); } catch { return ''; }
  const face = (file, style, weight) => {
    const f = path.join(dir, file);
    if (!existsSync(f)) return '';
    return `@font-face { font-family: "CMU Serif"; font-style: ${style}; font-weight: ${weight}; src: url(data:font/woff2;base64,${readFileSync(f).toString('base64')}) format("woff2"); }`;
  };
  return [
    face('cmu-serif-500-roman.woff2', 'normal', 400),
    face('cmu-serif-500-italic.woff2', 'italic', 400),
    face('cmu-serif-700-roman.woff2', 'normal', 700),
    face('cmu-serif-700-italic.woff2', 'italic', 700),
  ].join('\n');
}

// "Name: detail" → bold name, plain detail
const leadIn = (label, text) => (label ? `<b>${esc(label)}</b>${text ? `: ${esc(text)}` : ''}` : esc(text));
const splitLead = (s) => { const i = s.indexOf(':'); return i > 0 && i < 60 ? leadIn(s.slice(0, i), s.slice(i + 1).trim()) : esc(s); };

export function resumeHtml(r, profile) {
  const name = [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' ') || profile.fullName || '';
  const linkedin = profile.linkedin ? profile.linkedin.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : '';
  const place = [profile.city, profile.state, profile.country === 'United States' ? 'USA' : profile.country].filter(Boolean).join(', ');
  const left = [esc(r.headline), linkedin && `LinkedIn: <a href="https://${esc(linkedin)}">${esc(linkedin)}</a>`].filter(Boolean);
  const right = [
    profile.email && `Email: <a href="mailto:${esc(profile.email)}">${esc(profile.email)}</a>`,
    profile.phone && `Mobile: ${esc(profile.phone)}`,
    place && `Location: ${esc(place)}`,
  ].filter(Boolean);
  const section = (title, body) => (body ? `<section><h2>${title}</h2>${body}</section>` : '');
  const entry = (a, b, c, d, items) => `<div class="entry"><div class="row"><b>${esc(a)}</b><span>${esc(b)}</span></div>
    <div class="row sub"><i>${esc(c)}</i><i>${esc(d)}</i></div>
    ${items.length ? `<ul class="inner">${items.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}</div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${fontFaces()}
  @page { size: A4; margin: 0.42in 0.5in 0.45in; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "CMU Serif", "Latin Modern Roman", "Computer Modern", Georgia, serif; font-size: 9.6pt; line-height: 1.22; color: #000; }
  a { color: inherit; text-decoration: none; }
  header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2pt; }
  h1 { font-size: 19pt; font-weight: 700; margin: 0 0 1pt; letter-spacing: .01em; }
  header .r { text-align: right; }
  header div div { line-height: 1.25; }
  h2 { font-size: 12pt; font-weight: 400; font-variant: small-caps; letter-spacing: .02em; margin: 7pt 0 3pt; padding-bottom: 1pt; border-bottom: .6pt solid #000; }
  section > p { margin: 0; text-align: justify; }
  .entry { position: relative; padding-left: 11pt; margin-bottom: 1.5pt; break-inside: avoid-page; }
  .entry::before { content: "\\2022"; position: absolute; left: 1pt; top: 2pt; font-size: 10pt; }
  .row { display: flex; justify-content: space-between; gap: 10pt; }
  .row b { font-size: 10pt; }
  .sub { font-size: 9.4pt; }
  ul { margin: 0; padding: 0; list-style: none; }
  ul.inner { margin: 1pt 0 1pt 14pt; }
  ul.inner li { position: relative; padding-left: 10pt; margin: .6pt 0; }
  ul.inner li::before { content: "\\25E6"; position: absolute; left: 0; top: 0; }
  ul.top li { position: relative; padding-left: 11pt; margin: .5pt 0; }
  ul.top li::before { content: "\\2022"; position: absolute; left: 1pt; top: 0; }
  </style></head><body>
  <header>
    <div><h1>${esc(name)}</h1>${left.map((x) => `<div>${x}</div>`).join('')}</div>
    <div class="r">${right.map((x) => `<div>${x}</div>`).join('')}</div>
  </header>
  ${section('Professional Summary', `<p>${esc(r.summary)}</p>`)}
  ${section('Work Experience', r.experience.map((e) => entry(e.company, e.dates, e.title, e.location, e.bullets.map((b) => leadIn(b.label, b.text)))).join(''))}
  ${section('Technical Skills', r.skills.length ? `<ul class="top">${r.skills.map((g) => `<li>${leadIn(g.group, g.items.join(', '))}</li>`).join('')}</ul>` : '')}
  ${section('Education', r.education.map((e) => entry(e.school, e.dates, e.degree, e.location || '', (e.details || []).map((d) => leadIn(d.label, d.text)))).join(''))}
  ${section('Key Projects &amp; Achievements', r.projects.length ? `<ul class="top">${r.projects.map((p) => `<li>${leadIn(p.name, p.description)}</li>`).join('')}</ul>` : '')}
  ${section('Certifications', r.certifications.length ? `<ul class="top">${r.certifications.map((c) => `<li>${splitLead(c)}</li>`).join('')}</ul>` : '')}
  </body></html>`;
}

export async function writePdf(browser, html, file) {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: file, preferCSSPageSize: true, printBackground: true });
  await page.close();
}
