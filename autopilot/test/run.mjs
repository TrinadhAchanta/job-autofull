// Tests for the autopilot. No network or API key needed: job boards and Claude
// are replaced with canned responses, and forms are local pages.
// Usage: node autopilot/test/run.mjs
import { createServer } from 'http';
import { readFileSync, statSync, mkdtempSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { chromium } from 'playwright';
import * as S from '../lib/sources.mjs';
import { requiredYears, check } from '../lib/filter.mjs';
import { factCheck, tailorResume } from '../lib/tailor.mjs';
import { resumeHtml, writePdf } from '../lib/resume-html.mjs';
import { fillApplication } from '../lib/apply.mjs';
import { reviewHtml } from '../lib/review.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
const t = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + detail}`); };

// ---------- sources ----------
console.log('\n# Job sources (canned API responses)');
const canned = {
  'boards-api.greenhouse.io': { company_name: 'Acme', jobs: [{ id: 1, title: 'Data Scientist', location: { name: 'Remote - US' }, absolute_url: 'https://job-boards.greenhouse.io/acme/jobs/1', updated_at: '2026-11-01T00:00:00Z', content: '&lt;p&gt;3+ years of Python&lt;/p&gt;' }] },
  'api.lever.co': [{ id: 'abc', text: 'ML Engineer', categories: { location: 'Boston, MA' }, hostedUrl: 'https://jobs.lever.co/beta/abc', applyUrl: 'https://jobs.lever.co/beta/abc/apply', createdAt: 1761955200000, descriptionPlain: 'Build models', lists: [{ text: 'Requirements', content: '<li>5 years experience</li>' }] }],
  'api.ashbyhq.com': { jobs: [{ id: 'x1', title: 'Applied Scientist', location: 'New York', isRemote: true, jobUrl: 'https://jobs.ashbyhq.com/gamma/x1', publishedAt: '2026-11-02', descriptionPlain: 'NLP work' }] },
  'apply.workable.com': { name: 'Delta', jobs: [{ title: 'Data Scientist', shortcode: 'AB12', url: 'https://apply.workable.com/delta/j/AB12', application_url: 'https://apply.workable.com/delta/j/AB12/apply', city: 'Austin', country: 'United States', published_on: '2026-11-03', description: '<p>SQL</p>' }] },
  'eps.recruitee.com': { offers: [{ id: 7, title: 'Data Scientist', location: 'Remote', careers_url: 'https://eps.recruitee.com/o/ds', careers_apply_url: 'https://eps.recruitee.com/o/ds/c/new', published_at: '2026-11-03', description: '<p>ML</p>', requirements: '<p>2 years</p>' }] },
  'api.smartrecruiters.com': { content: [{ id: '99', name: 'Data Scientist', location: { city: 'Chicago', country: 'us' }, releasedDate: '2026-11-04' }] },
  'api.smartrecruiters.com/detail': { jobAd: { sections: { jobDescription: { text: '<p>Forecasting</p>' }, qualifications: { text: '<p>4 years</p>' } } } },
  'united.wd5.myworkdayjobs.com': { total: 1, jobPostings: [{ title: 'Data Engineer', externalPath: '/job/Chicago/Data-Engineer_WHQ00027010', locationsText: 'Chicago, IL', postedOn: 'Posted 3 Days Ago' }] },
  'united.wd5.myworkdayjobs.com/detail': { jobPostingInfo: { jobDescription: '<p>Spark and SQL</p>' } },
  'remotive.com': { jobs: [{ id: 5, url: 'https://remotive.com/j/5', title: 'Data Scientist', company_name: 'Rem', candidate_required_location: 'USA', publication_date: '2026-11-05', description: '<p>R</p>' }] },
  'www.themuse.com': { results: [{ id: 8, name: 'Senior Data Scientist', company: { name: 'Muse Co' }, locations: [{ name: 'Boston, MA' }], refs: { landing_page: 'https://www.themuse.com/jobs/museco/sds' }, publication_date: '2026-11-05', contents: '<p>Stats</p>' }, { id: 9, name: 'Accountant', company: { name: 'X' }, locations: [], refs: {}, contents: '' }] },
  'himalayas.app': { jobs: [{ title: 'Data Scientist', companyName: 'Him', applicationLink: 'https://himalayas.app/companies/him/jobs/ds', pubDate: 1762300000, locationRestrictions: ['United States'], description: '<p>Python</p>', guid: 'g1' }] },
  'api.adzuna.com': { results: [{ id: '42', title: '<strong>Data</strong> Scientist', company: { display_name: 'Adz' }, location: { display_name: 'Boston, MA' }, redirect_url: 'https://www.adzuna.com/land/ad/42', created: '2026-11-05T00:00:00Z', description: 'Python and SQL...' }] },
};
const fakeFetch = async (url) => {
  const u = new URL(url);
  if (u.pathname.includes('missing-co')) return { ok: false, status: 404, json: async () => ({}) };
  let key = u.host;
  if (u.host === 'api.smartrecruiters.com' && /postings\/\d+$/.test(u.pathname)) key += '/detail';
  if (u.host.endsWith('myworkdayjobs.com') && !u.pathname.endsWith('/jobs')) key += '/detail';
  if (!canned[key]) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => canned[key] };
};
const gh = await S.greenhouse('acme', fakeFetch);
t('greenhouse maps title, location, decoded description', gh[0].title === 'Data Scientist' && gh[0].location === 'Remote - US' && gh[0].description.includes('3+ years of Python'));
const lv = await S.lever('beta', fakeFetch);
t('lever includes requirement lists in description', lv[0].description.includes('5 years experience') && lv[0].applyUrl.endsWith('/apply'));
const ab = await S.ashby('gamma', fakeFetch);
t('ashby builds application url and remote flag', ab[0].applyUrl === 'https://jobs.ashbyhq.com/gamma/x1/application' && ab[0].location.includes('Remote'));
const wk = await S.workable('delta', fakeFetch);
t('workable', wk[0].applyUrl.endsWith('/apply') && wk[0].location.includes('Austin'));
const rc = await S.recruitee('eps', fakeFetch);
t('recruitee', rc[0].description.includes('2 years'));
const sr = await S.smartrecruiters('epsilon', fakeFetch);
t('smartrecruiters lazy description', sr[0].description === '' && (await sr[0].hydrate()).includes('4 years'));
const wd = await S.workday('united.wd5.myworkdayjobs.com/UnitedCareers', fakeFetch);
t('workday list + description', wd[0].title === 'Data Engineer' && wd[0].applyUrl.endsWith('/apply') && (await wd[0].hydrate()).includes('Spark'));
const all = await S.searchAll({
  search: { keywords: ['data scientist'] },
  companies: { greenhouse: ['acme', 'missing-co'], lever: ['beta'] },
  searchSites: { remotive: { enabled: true }, themuse: { enabled: true }, himalayas: { enabled: true }, adzuna: { enabled: true, appId: 'a', appKey: 'b' } },
}, { fetchImpl: fakeFetch, log: () => {} });
t('searchAll combines company boards and search sites, survives a bad board', all.length === 6 && all.some((j) => j.ats === 'adzuna') && all.some((j) => j.ats === 'themuse'), all.map((j) => j.ats).join(','));
t('adzuna title tags stripped', all.find((j) => j.ats === 'adzuna').title === 'Data Scientist');
t('atsFromUrl', S.atsFromUrl('https://acme.wd1.myworkdayjobs.com/x') === 'workday' && S.atsFromUrl('https://www.linkedin.com/jobs/view/1') === 'linkedin');

// ---------- filter ----------
console.log('\n# Filters');
const search = { titleInclude: ['data scientist'], titleExclude: ['intern', 'manager'], locationInclude: ['remote', 'ma', 'united states'], maxYearsRequired: 5, maxAgeDays: 30 };
const now = Date.parse('2026-11-06');
t('years: "5+ years of experience"', requiredYears('You have 5+ years of experience in ML') === 5);
t('years: "3-5 years experience" takes the low end', requiredYears('3-5 years of relevant industry experience') === 3);
t('years: none', requiredYears('Great team, free lunch') === null);
t('keeps a good match', check({ title: 'Data Scientist II', location: 'Boston, MA', postedAt: '2026-11-01', description: '3+ years experience' }, search, now) === null);
t('drops excluded title', /intern/.test(check({ title: 'Data Scientist Intern', location: 'Remote', description: '' }, search, now)));
t('drops too many years', /8\+ years/.test(check({ title: 'Data Scientist', location: 'Remote', description: 'Requires 8+ years of experience' }, search, now)));
t('drops other countries', /location/.test(check({ title: 'Data Scientist', location: 'Berlin, Germany', description: '' }, search, now)));
t('drops old postings', /days ago/.test(check({ title: 'Data Scientist', location: 'Remote', postedAt: '2026-08-01', description: '' }, search, now)));
t('"ma" does not match "Germany" or "Manila"', /location/.test(check({ title: 'Data Scientist', location: 'Manila', description: '' }, search, now)));

// ---------- tailoring ----------
console.log('\n# Resume tailoring (Claude replaced by canned replies)');
const baseResume = readFileSync(path.join(here, 'fixtures', 'base-resume.md'), 'utf8');
const good = {
  headline: 'Data Scientist', summary: 'Data Scientist with 4+ years building NLP and LLM systems.',
  experience: [{ company: 'Verizon', title: 'Data Scientist', dates: 'Jul 2024 - Mar 2026', location: 'Boston, MA', bullets: [{ label: 'Contract Extraction', text: 'Built NLP extraction over 10K+ contracts with 92% accuracy' }] }],
  projects: [], skills: [{ group: 'Languages', items: ['Python', 'SQL'] }],
  education: [{ school: 'New England College', degree: 'M.S. Computer Information Systems', dates: '2024', location: 'Henniker, NH', details: [{ label: 'GPA', text: '3.8' }] }],
  certifications: ['Azure Data Engineer Associate'], matchNotes: 'Strong NLP fit.',
};
t('fact check passes a faithful resume', factCheck(good, baseResume).length === 0, factCheck(good, baseResume).join('; '));
const bad = structuredClone(good);
bad.experience[0].bullets.push({ label: 'Cost', text: 'Cut cloud costs by 70%' });
bad.experience.push({ company: 'Google', title: 'ML Engineer', dates: '2020', location: '', bullets: [] });
bad.skills[0].items.push('Kubernetes');
const probs = factCheck(bad, baseResume);
t('fact check catches invented number, employer and skill', probs.some((p) => p.includes('70%')) && probs.some((p) => p.includes('Google')) && probs.some((p) => p.includes('Kubernetes')), probs.join('; '));
const calls = [];
const fakeClient = { messages: { parse: async (req) => { calls.push(req); return { stop_reason: 'end_turn', parsed_output: calls.length === 1 ? bad : good }; } } };
const res = await tailorResume({ baseResume, job: { company: 'Acme', title: 'Data Scientist', location: 'Remote', description: 'NLP' }, client: fakeClient });
t('retries once with the problems listed, then passes', calls.length === 2 && calls[1].messages[0].content.includes('Kubernetes') && res.problems.length === 0);
t('request uses Opus 5.5 with adaptive thinking and structured output', calls[0].model === 'claude-opus-5-5' && calls[0].thinking.type === 'adaptive' && !!calls[0].output_config.format);

const browser = await chromium.launch();
const tmp = mkdtempSync(path.join(tmpdir(), 'autopilot-'));
const profile = { ...JSON.parse(readFileSync(path.join(here, '..', '..', 'sample-profile.json'), 'utf8')), phone: '555-0100', linkedin: 'https://linkedin.com/in/example', workAuthorized: 'Yes', city: 'Boston', state: 'MA' };
const pdf = path.join(tmp, 'resume.pdf');
await writePdf(browser, resumeHtml(good, profile), pdf);
const pdfText = readFileSync(pdf, 'latin1');
t('resume PDF is written, one page for a short resume, with the Computer Modern font', statSync(pdf).size > 5000 && (pdfText.match(/\/Type\s*\/Page[^s]/g) || []).length === 1 && /CMU/.test(pdfText));

// ---------- applying ----------
console.log('\n# Filling applications (local practice pages)');
const server = createServer((req, res) => {
  const f = path.join(here, 'fixtures', path.basename(req.url.split('?')[0]));
  if (!existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(readFileSync(f));
}).listen(0);
const base = `http://localhost:${server.address().port}`;
const context = await browser.newContext();

let r = await fillApplication(context, { applyUrl: `${base}/job-page.html` }, { profile, pdfPath: pdf, shotPath: path.join(tmp, 's1.png') });
const f1 = r.page;
t('follows the Apply link to the form', r.finalUrl.endsWith('apply-form.html'), r.finalUrl);
t('fills fields and attaches the resume', r.filled >= 5 && (await f1.$eval('#cv', (el) => el.files.length)) === 1 && (await f1.inputValue('#em')) === profile.email);
t('nothing left to check on a fully answerable form', r.review.length === 0, r.review.join(' | '));
t('screenshot saved', existsSync(path.join(tmp, 's1.png')));
await f1.close();

r = await fillApplication(context, { applyUrl: `${base}/apply-form-open-question.html` }, { profile, pdfPath: pdf, submit: true });
t('open question is left for you and blocks submitting', r.review.some((q) => /favorite dataset/.test(q)) && !r.submitted && r.page.url().endsWith('apply-form-open-question.html'));
await r.page.close();

r = await fillApplication(context, { applyUrl: `${base}/apply-form.html` }, { profile, pdfPath: pdf, submit: true });
t('submits an approved, complete form and sees the confirmation', r.submitted === true, r.review.join(' | '));
await r.page.close();

r = await fillApplication(context, { applyUrl: `${base}/login.html` }, { profile, pdfPath: pdf });
t('flags sign-in pages', r.review.some((q) => /sign in/i.test(q)), r.review.join(' | '));
await r.page.close();

r = await fillApplication(context, { applyUrl: `${base}/missing.html` }, { profile, pdfPath: pdf });
t('missing page is reported, not crashed', r.review.length > 0);
await r.page.close();

// ---------- review page + CLI ----------
console.log('\n# Review page and commands');
const home = mkdtempSync(path.join(tmpdir(), 'autopilot-home-'));
const jobs = [
  { id: 'a', num: 1, status: 'ready', title: 'Data Scientist', company: 'Acme', location: 'Remote', url: 'https://x', applyUrl: 'https://x/apply', matchNotes: 'Good fit', pdf: path.join(home, 'data', 'r.pdf'), shot: path.join(home, 'data', 'shots', '1.png'), review: [] },
  { id: 'b', num: 2, status: 'needs-you', title: 'ML <Engineer>', company: 'Beta', location: 'NY', url: 'https://y', review: ['Sign in first'] },
];
const html = reviewHtml(jobs, path.join(home, 'data'));
t('review page lists jobs, escapes text, uses relative links', html.includes('ML &lt;Engineer&gt;') && html.includes('href="r.pdf"') && html.includes('approve 1'));
writeFileSync(path.join(mkdtempSync(path.join(home, 'x')), '.keep'), '');
execFileSync('mkdir', ['-p', path.join(home, 'data')]);
writeFileSync(path.join(home, 'data', 'jobs.json'), JSON.stringify(jobs));
const cli = (...a) => execFileSync('node', [path.join(here, '..', 'cli.mjs'), ...a], { env: { ...process.env, AUTOPILOT_HOME: home }, encoding: 'utf8' });
const out = cli('approve', '1', '2');
const after = JSON.parse(readFileSync(path.join(home, 'data', 'jobs.json'), 'utf8'));
t('approve only moves ready jobs', after.find((j) => j.num === 1).status === 'approved' && after.find((j) => j.num === 2).status === 'needs-you', out);
cli('skip', '2');
t('skip', JSON.parse(readFileSync(path.join(home, 'data', 'jobs.json'), 'utf8')).find((j) => j.num === 2).status === 'skipped');
t('help prints commands', cli('help').includes('approve 3 5 8'));

server.close();
await browser.close();
console.log(failures ? `\n${failures} failed` : '\nAll passed');
process.exit(failures ? 1 : 0);
