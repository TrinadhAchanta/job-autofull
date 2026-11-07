// A local web page listing every job the autopilot prepared, so you can check
// the filled form and resume before approving.
import path from 'path';
const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rel = (from, to) => (to ? path.relative(from, to).split(path.sep).join('/') : '');

const LABEL = {
  new: 'Found', tailored: 'Resume ready', ready: 'Ready for your approval', 'needs-you': 'Needs you',
  approved: 'Approved, will submit', submitted: 'Submitted', 'submit-failed': 'Submit failed', skipped: 'Skipped',
};

export function reviewHtml(jobs, dataDir) {
  const order = ['ready', 'needs-you', 'approved', 'submit-failed', 'tailored', 'new', 'submitted', 'skipped'];
  const sorted = [...jobs].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || (b.num || 0) - (a.num || 0));
  const card = (j) => `<article class="card s-${j.status}">
    <header><span class="num">#${j.num}</span><div><h2>${esc(j.title)}</h2><p>${esc(j.company)} · ${esc(j.location || '')}</p></div><span class="badge">${LABEL[j.status] || j.status}</span></header>
    ${j.matchNotes ? `<p class="notes"><b>Fit:</b> ${esc(j.matchNotes)}</p>` : ''}
    ${j.review?.length ? `<div class="todo"><b>Left for you:</b><ul>${j.review.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}
    ${j.factProblems?.length ? `<div class="todo"><b>Resume check failed:</b><ul>${j.factProblems.map((q) => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}
    <p class="links"><a href="${esc(j.url)}" target="_blank">Job posting</a>${j.applyUrl ? ` · <a href="${esc(j.finalUrl || j.applyUrl)}" target="_blank">Application form</a>` : ''}${j.pdf ? ` · <a href="${esc(rel(dataDir, j.pdf))}" target="_blank">Tailored resume (PDF)</a>` : ''}</p>
    ${j.shot ? `<details><summary>Screenshot of the filled form</summary><img loading="lazy" src="${esc(rel(dataDir, j.shot))}" alt="Filled form for ${esc(j.company)}"></details>` : ''}
  </article>`;
  const ready = jobs.filter((j) => j.status === 'ready').map((j) => j.num);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Job autopilot review</title><style>
  :root { --bg:#f6f4ef; --card:#fff; --ink:#2b2b2b; --muted:#6b6860; --pine:#2f5d4a; --amber:#8a5a12; --line:#ddd8cc; }
  @media (prefers-color-scheme: dark) { :root { --bg:#1c1d1b; --card:#262825; --ink:#ecebe6; --muted:#a8a59c; --pine:#7fbf9f; --amber:#e2b061; --line:#3a3c37; } }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui, sans-serif; }
  main { max-width:900px; margin:0 auto; padding:24px 16px 80px; }
  h1 { margin:0 0 4px; } .lead { color:var(--muted); margin:0 0 20px; }
  .cmd { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin-bottom:20px; }
  code { background:rgba(127,127,127,.15); padding:2px 6px; border-radius:4px; }
  .card { background:var(--card); border:1px solid var(--line); border-left:4px solid var(--line); border-radius:10px; padding:14px 16px; margin:12px 0; }
  .s-ready { border-left-color:var(--pine); } .s-needs-you, .s-submit-failed { border-left-color:var(--amber); }
  header { display:flex; gap:12px; align-items:flex-start; } header div { flex:1; } h2 { font-size:17px; margin:0; } header p { margin:2px 0 0; color:var(--muted); }
  .num { font-weight:700; color:var(--muted); } .badge { font-size:12px; border:1px solid var(--line); border-radius:999px; padding:2px 10px; white-space:nowrap; }
  .notes { margin:10px 0 0; } .todo { color:var(--amber); margin-top:8px; } .todo ul { margin:4px 0 0 18px; padding:0; }
  .links a { color:var(--pine); } img { max-width:100%; border:1px solid var(--line); border-radius:6px; margin-top:8px; }
  </style></head><body><main>
  <h1>Job autopilot review</h1>
  <p class="lead">${jobs.length} jobs · ${ready.length} ready for approval · ${jobs.filter((j) => j.status === 'needs-you').length} need you · ${jobs.filter((j) => j.status === 'submitted').length} submitted</p>
  <div class="cmd">To send the ones that look right: <code>npm run autopilot -- approve ${ready.length ? ready.join(' ') : '&lt;numbers&gt;'}</code> then <code>npm run autopilot -- submit</code>.<br>To drop one: <code>npm run autopilot -- skip &lt;number&gt;</code></div>
  ${sorted.map(card).join('\n')}
  </main></body></html>`;
}
