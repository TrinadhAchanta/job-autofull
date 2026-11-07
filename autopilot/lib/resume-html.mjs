// Turns a tailored resume into a clean one-page PDF (ATS-friendly: real text,
// one column, standard headings).
const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function resumeHtml(r, profile) {
  const contact = [profile.email, profile.phone, profile.linkedin && profile.linkedin.replace(/^https?:\/\/(www\.)?/, ''), profile.portfolio && profile.portfolio.replace(/^https?:\/\//, ''), [profile.city, profile.state].filter(Boolean).join(', ')].filter(Boolean);
  const section = (title, body) => (body ? `<h2>${title}</h2>${body}` : '');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: Letter; margin: 0.5in 0.6in; }
  body { font: 10.3pt/1.32 "Helvetica Neue", Arial, sans-serif; color: #1d1d1d; margin: 0; }
  h1 { font-size: 20pt; margin: 0; letter-spacing: .01em; }
  .headline { font-size: 11pt; color: #2f5d4a; font-weight: 600; margin: 2px 0 4px; }
  .contact { color: #444; font-size: 9.5pt; }
  h2 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: .08em; color: #2f5d4a; border-bottom: 1px solid #cfcabd; padding-bottom: 2px; margin: 12px 0 5px; }
  .row { display: flex; justify-content: space-between; gap: 12px; }
  .row b { font-weight: 700; } .muted { color: #555; }
  ul { margin: 2px 0 7px 16px; padding: 0; } li { margin: 1px 0; }
  p { margin: 0 0 4px; } .skills p { margin: 1px 0; }
  </style></head><body>
  <h1>${esc([profile.firstName, profile.lastName].join(' '))}</h1>
  <div class="headline">${esc(r.headline)}</div>
  <div class="contact">${contact.map(esc).join(' &nbsp;·&nbsp; ')}</div>
  ${section('Summary', `<p>${esc(r.summary)}</p>`)}
  ${section('Experience', r.experience.map((e) => `<div class="row"><span><b>${esc(e.title)}</b>, ${esc(e.company)}</span><span class="muted">${esc(e.dates)}${e.location ? ' · ' + esc(e.location) : ''}</span></div><ul>${e.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`).join(''))}
  ${section('Projects', r.projects.length ? `<ul>${r.projects.map((p) => `<li><b>${esc(p.name)}:</b> ${esc(p.description)}</li>`).join('')}</ul>` : '')}
  ${section('Skills', `<div class="skills">${r.skills.map((g) => `<p><b>${esc(g.group)}:</b> ${g.items.map(esc).join(', ')}</p>`).join('')}</div>`)}
  ${section('Education', r.education.map((e) => `<div class="row"><span><b>${esc(e.degree)}</b>, ${esc(e.school)}</span><span class="muted">${esc(e.dates)}</span></div>${e.details ? `<p class="muted">${esc(e.details)}</p>` : ''}`).join(''))}
  ${section('Certifications', r.certifications.length ? `<ul>${r.certifications.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : '')}
  </body></html>`;
}

export async function writePdf(browser, html, file) {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({ path: file, format: 'Letter', printBackground: true, margin: { top: '0.5in', bottom: '0.5in', left: '0.6in', right: '0.6in' } });
  await page.close();
}
