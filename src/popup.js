import { fillTab, pageInfo } from './fill-tab.js';

const $ = (id) => document.getElementById(id);
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

async function render() {
  const { profile, jobs = [] } = await chrome.storage.local.get(['profile', 'jobs']);
  $('who').textContent = profile && profile.email ? `Filling as ${profile.firstName || ''} ${profile.lastName || ''} (${profile.email})` : 'No profile yet. Open Profile to set one up.';
  const ul = $('jobs');
  ul.replaceChildren();
  if (!jobs.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Nothing saved yet.'; ul.append(li); }
  for (const j of jobs.slice(0, 6)) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = j.url; a.target = '_blank'; a.textContent = `${j.company} · ${j.title}`;
    const s = document.createElement('span'); s.className = 'muted small'; s.textContent = ` ${j.date} · ${j.status}`;
    li.append(a, s); ul.append(li);
  }
}

$('open-options').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

$('fill').addEventListener('click', async () => {
  const box = $('result');
  box.hidden = false; box.className = ''; box.textContent = 'Filling...';
  let r;
  try { r = await fillTab(tab.id); } catch (e) { r = { error: "This page can't be filled (" + e.message + ')' }; }
  box.replaceChildren();
  if (r.error) { box.className = 'warn'; box.textContent = r.error; return; }
  const p = document.createElement('p');
  p.textContent = `Filled ${r.filled.length} field${r.filled.length === 1 ? '' : 's'}` + (r.kept ? `, left ${r.kept} you'd already filled.` : '.');
  box.append(p);
  if (r.review.length) {
    const h = document.createElement('p'); h.className = 'warn'; h.textContent = 'Please check these yourself:';
    const ul = document.createElement('ul');
    r.review.forEach((q) => { const li = document.createElement('li'); li.textContent = q; ul.append(li); });
    box.append(h, ul);
  }
});

$('save').addEventListener('click', async () => {
  let info;
  try { info = await pageInfo(tab.id); } catch { info = { title: tab.title, company: new URL(tab.url).hostname, url: tab.url }; }
  const { jobs = [] } = await chrome.storage.local.get('jobs');
  const filtered = jobs.filter((j) => j.url !== info.url);
  filtered.unshift({ ...info, date: new Date().toISOString().slice(0, 10), status: 'Applied' });
  await chrome.storage.local.set({ jobs: filtered });
  $('save').textContent = 'Saved';
  render();
});

render();
