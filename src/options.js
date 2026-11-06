const SECTIONS = [
  ['About you', [
    ['firstName', 'First name'], ['lastName', 'Last name'], ['preferredName', 'Preferred name'],
    ['email', 'Email', 'email'], ['phone', 'Phone', 'tel'],
  ]],
  ['Location', [['address', 'Street address'], ['city', 'City'], ['state', 'State'], ['zip', 'ZIP code'], ['country', 'Country']]],
  ['Links', [['linkedin', 'LinkedIn URL', 'url'], ['github', 'GitHub URL', 'url'], ['portfolio', 'Portfolio / website', 'url']]],
  ['Work', [['currentTitle', 'Current job title'], ['currentCompany', 'Current company'], ['yearsExperience', 'Years of experience']]],
  ['Education', [['school', 'School'], ['degree', 'Degree'], ['major', 'Major / field of study'], ['gradYear', 'Graduation year'], ['gpa', 'GPA']]],
  ['Eligibility and logistics', [
    ['workAuthorized', 'Authorized to work in the US? (Yes / No)'], ['needsSponsorship', 'Need visa sponsorship? (Yes / No)'],
    ['willingToRelocate', 'Willing to relocate? (Yes / No)'], ['salaryExpectation', 'Salary expectation'],
    ['noticePeriod', 'Notice period'], ['startDate', 'Earliest start date'], ['howDidYouHear', 'How did you hear about us (default)'],
  ]],
  ['Voluntary self-identification', [
    ['gender', 'Gender'], ['race', 'Race / ethnicity'], ['hispanic', 'Hispanic or Latino?'], ['veteran', 'Veteran status'], ['disability', 'Disability status'],
  ]],
  ['Longer answers', [['summary', 'Short summary about you', 'textarea'], ['coverLetter', 'Default cover letter', 'textarea']]],
];

const $ = (id) => document.getElementById(id);
const form = $('profile');

for (const [title, fields] of SECTIONS) {
  const fs = document.createElement('fieldset');
  const lg = document.createElement('legend'); lg.textContent = title; fs.append(lg);
  for (const [key, label, type] of fields) {
    const l = document.createElement('label');
    l.textContent = label;
    const input = type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
    if (type && type !== 'textarea') input.type = type;
    if (type === 'textarea') input.rows = 5;
    input.name = key;
    l.append(input); fs.append(l);
  }
  form.append(fs);
}

function customRow(match = '', answer = '') {
  const row = document.createElement('div'); row.className = 'custom-row';
  const m = document.createElement('input'); m.placeholder = 'Question contains...'; m.value = match; m.className = 'match';
  const a = document.createElement('textarea'); a.placeholder = 'Your answer'; a.value = answer; a.rows = 2; a.className = 'answer';
  const del = document.createElement('button'); del.type = 'button'; del.textContent = 'Remove'; del.className = 'link';
  del.onclick = () => row.remove();
  row.append(m, a, del); $('custom').append(row);
}

function readForm() {
  const profile = {};
  for (const el of form.elements) if (el.name) profile[el.name] = el.value.trim();
  profile.customAnswers = [...document.querySelectorAll('.custom-row')]
    .map((r) => ({ match: r.querySelector('.match').value.trim(), answer: r.querySelector('.answer').value.trim() }))
    .filter((c) => c.match && c.answer);
  return profile;
}

function writeForm(profile = {}) {
  for (const el of form.elements) if (el.name) el.value = profile[el.name] ?? '';
  $('custom').replaceChildren();
  (profile.customAnswers || []).forEach((c) => customRow(c.match, c.answer));
}

async function load() {
  let { profile, settings = {} } = await chrome.storage.local.get(['profile', 'settings']);
  if (!profile) profile = await (await fetch(chrome.runtime.getURL('sample-profile.json'))).json();
  writeForm(profile);
  $('overwrite').checked = !!settings.overwrite;
  renderJobs();
}

async function save() {
  await chrome.storage.local.set({ profile: readForm(), settings: { overwrite: $('overwrite').checked } });
  $('status').textContent = 'Saved.';
  setTimeout(() => ($('status').textContent = ''), 2000);
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click(); URL.revokeObjectURL(url);
}

const STATUSES = ['Saved', 'Applied', 'Interviewing', 'Offer', 'Rejected', 'Withdrawn'];

async function renderJobs() {
  const { jobs = [] } = await chrome.storage.local.get('jobs');
  const tbody = document.querySelector('#jobs tbody');
  tbody.replaceChildren();
  jobs.forEach((j, i) => {
    const tr = document.createElement('tr');
    const cells = [j.date, j.company];
    cells.forEach((c) => { const td = document.createElement('td'); td.textContent = c; tr.append(td); });
    const role = document.createElement('td'); const a = document.createElement('a'); a.href = j.url; a.target = '_blank'; a.textContent = j.title; role.append(a); tr.append(role);
    const st = document.createElement('td'); const sel = document.createElement('select');
    STATUSES.forEach((s) => sel.add(new Option(s, s, false, s === j.status)));
    sel.onchange = async () => { jobs[i].status = sel.value; await chrome.storage.local.set({ jobs }); };
    st.append(sel); tr.append(st);
    const rm = document.createElement('td'); const b = document.createElement('button'); b.className = 'link'; b.textContent = 'Remove';
    b.onclick = async () => { jobs.splice(i, 1); await chrome.storage.local.set({ jobs }); renderJobs(); };
    rm.append(b); tr.append(rm);
    tbody.append(tr);
  });
}

$('add-custom').onclick = () => customRow();
$('save').onclick = save;
$('export').onclick = () => download('job-autofill-profile.json', JSON.stringify(readForm(), null, 2), 'application/json');
$('import').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try { writeForm(JSON.parse(await file.text())); $('status').textContent = 'Loaded. Click Save profile to keep it.'; }
  catch { $('status').textContent = "That file isn't a valid profile."; }
};
$('export-csv').onclick = async () => {
  const { jobs = [] } = await chrome.storage.local.get('jobs');
  const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv = ['date,company,role,status,url', ...jobs.map((j) => [j.date, j.company, j.title, j.status, j.url].map(esc).join(','))].join('\n');
  download('applications.csv', csv, 'text/csv');
};

load();
