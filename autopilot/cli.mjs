#!/usr/bin/env node
// Job autopilot: search → tailor resume → fill application → you approve → submit.
// Run `npm run autopilot -- help` for the commands.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { createStore } from './lib/store.mjs';
import { searchAll } from './lib/sources.mjs';
import { filterJobs, check } from './lib/filter.mjs';
import { tailorResume, answerQuestions } from './lib/tailor.mjs';
import { resumeHtml, coverLetterHtml, writePdf } from './lib/resume-html.mjs';
import { fillApplication } from './lib/apply.mjs';
import { reviewHtml } from './lib/review.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.AUTOPILOT_HOME || HERE;
const MY = path.join(HOME, 'my');
const DATA = path.join(HOME, 'data');
const log = console.log;

function readJson(file, fallback) { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback; }

function loadSetup({ needResume = false } = {}) {
  const config = readJson(path.join(MY, 'config.json'), null) || readJson(path.join(HERE, 'config.example.json'));
  const profile = readJson(path.join(MY, 'profile.json'), null) || readJson(path.join(HERE, '..', 'sample-profile.json'));
  const resumeFile = path.join(MY, 'resume.md');
  if (needResume && !existsSync(resumeFile)) {
    log(`\nPut your resume in ${resumeFile} first (plain text or Markdown). See resume.example.md.`);
    process.exit(1);
  }
  return { config, profile, baseResume: existsSync(resumeFile) ? readFileSync(resumeFile, 'utf8') : '' };
}

const args = process.argv.slice(2);
const cmd = args[0] || 'help';
const flag = (name, dflt) => { const i = args.indexOf(`--${name}`); return i === -1 ? dflt : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const store = createStore(DATA);

const normKey = (j) => `${(j.company || '').toLowerCase().replace(/[^a-z0-9]/g, '')}|${(j.title || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;

async function search() {
  const { config } = loadSetup();
  log('Searching job sites...');
  const all = await searchAll(config, { log });
  // Same job on several sites: keep the one that links to a company form.
  const preferred = new Map();
  const rank = (j) => (['greenhouse', 'lever', 'ashby', 'workable', 'recruitee', 'smartrecruiters', 'workday'].includes(j.ats) ? 0 : 1);
  for (const j of all) {
    const k = normKey(j);
    if (!preferred.has(k) || rank(j) < rank(preferred.get(k))) preferred.set(k, j);
  }
  let jobs = [...preferred.values()];
  const known = new Set(store.all().map(normKey));
  jobs = jobs.filter((j) => !known.has(normKey(j)));
  // Fetch full descriptions only for titles that pass, to keep requests low.
  const titleOk = jobs.filter((j) => !/^title/.test(check({ ...j, description: '', postedAt: '' }, config.search) || ''));
  for (const j of titleOk) {
    if (j.hydrate && !j.description) j.description = await j.hydrate().catch(() => '');
    delete j.hydrate;
  }
  const { kept, dropped } = filterJobs(titleOk, config.search);
  const added = store.upsert(kept);
  log(`Found ${all.length} postings, ${titleOk.length} with matching titles, ${kept.length} fit your filters, ${added.length} new.`);
  const reasons = {};
  dropped.forEach((d) => { const r = d.reason.replace(/".*"/, '').replace(/\d+/g, 'N'); reasons[r] = (reasons[r] || 0) + 1; });
  if (dropped.length) log('Skipped because: ' + Object.entries(reasons).map(([r, n]) => `${r} (${n})`).join(', '));
  added.slice(0, 30).forEach((j) => log(`  #${j.num} ${j.title} · ${j.company} · ${j.location}`));
}

async function tailor() {
  const { config, profile, baseResume } = loadSetup({ needResume: true });
  const limit = Number(flag('limit', config.apply?.maxPerRun || 10));
  const jobs = store.all().filter((j) => j.status === 'new').slice(0, limit);
  if (!jobs.length) return log('No new jobs to write resumes for. Run search first.');
  mkdirSync(path.join(DATA, 'resumes'), { recursive: true });
  const browser = await chromium.launch();
  for (const j of jobs) {
    log(`Writing resume for #${j.num} ${j.title} · ${j.company}...`);
    try {
      const { resume, problems } = await tailorResume({ baseResume, job: j, model: config.tailor?.model, effort: config.tailor?.effort });
      const base = path.join(DATA, 'resumes', `${j.num}-${j.company}`.replace(/[^\w.-]+/g, '_'));
      writeFileSync(`${base}.json`, JSON.stringify(resume, null, 2));
      const pdf = `${base}.pdf`;
      await writePdf(browser, resumeHtml(resume, profile), pdf);
      const coverPdf = `${base}-cover-letter.pdf`;
      await writePdf(browser, coverLetterHtml(resume.coverLetter, profile, j), coverPdf);
      const extra = { coverLetter: resume.coverLetter, coverPdf };
      if (problems.length) {
        store.update(j.id, { ...extra, status: 'needs-you', pdf, matchNotes: resume.matchNotes, factProblems: problems, review: ['The resume mentions things not in your base resume. Fix the PDF or skip this job'] });
        log(`  ! check failed: ${problems.join('; ')}`);
      } else {
        store.update(j.id, { ...extra, status: 'tailored', pdf, matchNotes: resume.matchNotes, factProblems: [] });
        log('  done');
      }
    } catch (e) {
      log(`  ! ${e.message}`);
      store.update(j.id, { status: 'needs-you', review: [`Resume could not be written: ${e.message}`] });
    }
  }
  await browser.close();
}

async function withBrowser(fn, { headless }) {
  const context = await chromium.launchPersistentContext(path.join(MY, 'browser-profile'), { headless, viewport: { width: 1280, height: 900 } });
  try { return await fn(context); } finally { if (!flag('keep-open')) await context.close(); }
}

const jobProfile = (profile, j) => ({ ...profile, coverLetter: j.coverLetter || profile.coverLetter });

async function fill() {
  const { config, profile, baseResume } = loadSetup();
  const limit = Number(flag('limit', config.apply?.maxPerRun || 10));
  const jobs = store.all().filter((j) => j.status === 'tailored').slice(0, limit);
  if (!jobs.length) return log('Nothing to fill. Run tailor first.');
  mkdirSync(path.join(DATA, 'shots'), { recursive: true });
  await withBrowser(async (context) => {
    for (const j of jobs) {
      log(`Filling #${j.num} ${j.title} · ${j.company}...`);
      const shot = path.join(DATA, 'shots', `${j.num}.png`);
      const answerer = baseResume
        ? (questions) => answerQuestions({ baseResume, profile, job: j, questions, model: config.tailor?.model, effort: config.tailor?.effort })
        : null;
      const r = await fillApplication(context, j, { profile: jobProfile(profile, j), pdfPath: j.pdf, coverLetterPath: j.coverPdf, shotPath: shot, answerer });
      store.update(j.id, { status: r.review.length ? 'needs-you' : 'ready', review: r.review, drafted: r.drafted, filledCount: r.filled, finalUrl: r.finalUrl, shot });
      if (r.drafted.length) log(`  drafted ${r.drafted.length} answer(s) for this job`);
      log(r.review.length ? `  needs you: ${r.review.join(' | ')}` : `  ready (${r.filled} fields filled, resume attached)`);
      if (!flag('keep-open')) await r.page.close();
    }
  }, { headless: flag('keep-open') ? false : !!config.apply?.headless });
  await review();
}

async function submit() {
  const { config, profile } = loadSetup();
  const jobs = store.all().filter((j) => j.status === 'approved');
  if (!jobs.length) return log('Nothing approved yet. Use: approve <numbers>');
  await withBrowser(async (context) => {
    for (const j of jobs) {
      log(`Submitting #${j.num} ${j.title} · ${j.company}...`);
      const shot = path.join(DATA, 'shots', `${j.num}-submitted.png`);
      // Re-uses the exact answers you reviewed; never drafts new ones at submit time.
      const r = await fillApplication(context, j, { profile: jobProfile(profile, j), pdfPath: j.pdf, coverLetterPath: j.coverPdf, shotPath: shot, submit: true, savedAnswers: j.drafted || [] });
      if (r.submitted) { store.update(j.id, { status: 'submitted', submittedAt: new Date().toISOString(), shot }); log('  submitted'); }
      else { store.update(j.id, { status: 'submit-failed', review: r.review, shot }); log(`  not sent: ${r.review.join(' | ')}`); }
      await r.page.close();
    }
  }, { headless: false });
  await review();
}

function setStatus(nums, status, from) {
  const jobs = store.all();
  const pick = nums[0] === 'all' ? jobs.filter((j) => from.includes(j.status)) : jobs.filter((j) => nums.includes(String(j.num)));
  for (const j of pick) {
    if (!from.includes(j.status)) { log(`  #${j.num} is "${j.status}", skipping`); continue; }
    store.update(j.id, { status });
    log(`  #${j.num} ${j.title} · ${j.company} → ${status}`);
  }
}

async function review() {
  const file = path.join(DATA, 'review.html');
  writeFileSync(file, reviewHtml(store.all(), DATA));
  log(`\nReview page: ${file}`);
}

function list() {
  for (const j of store.all()) log(`#${String(j.num).padEnd(4)} ${j.status.padEnd(13)} ${j.title} · ${j.company}`);
}

const HELP = `Job autopilot

  search            find new jobs that match your config
  tailor            write a tailored resume PDF for each new job
  fill              open each application, fill it, attach the resume, screenshot it
  run               search + tailor + fill, then build the review page (never submits)
  review            rebuild the review page (data/review.html)
  approve 3 5 8     mark jobs as approved ("approve all" approves every ready job)
  skip 4            drop a job
  submit            send every approved application
  list              show all jobs and their status

Options: --limit N (jobs per run), --keep-open (leave the browser open to finish forms by hand)`;

const commands = {
  search, tailor, fill, review, list, submit,
  run: async () => { await search(); await tailor(); await fill(); },
  approve: () => setStatus(args.slice(1), 'approved', ['ready', 'submit-failed']),
  skip: () => setStatus(args.slice(1), 'skipped', ['new', 'tailored', 'ready', 'needs-you', 'approved', 'submit-failed']),
  help: () => log(HELP),
};
if (!commands[cmd]) { log(HELP); process.exit(1); }
await commands[cmd]();
