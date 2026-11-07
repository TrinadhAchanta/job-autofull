// Opens each application in a real browser, fills it with your profile using
// the same filler as the Chrome extension, attaches the tailored resume, and
// takes a screenshot for you to review. Submitting is a separate step.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const FILLER = readFileSync(fileURLToPath(new URL('../../src/filler.js', import.meta.url)), 'utf8');
const APPLY_TEXT = /^\s*(apply( now| for this (job|position|role))?|apply on company (site|website)|i'?m interested|start (your )?application)\s*$/i;
const SUBMIT_TEXT = /^\s*(submit( application| my application)?|send application|apply)\s*$/i;
const DONE_TEXT = /thank you for (applying|your (application|interest))|application (has been |was )?(submitted|received)|we('ve| have) received your application|successfully (submitted|applied)/i;

async function formFieldCount(frame) {
  return frame.evaluate(() => [...document.querySelectorAll('input:not([type=hidden]):not([type=search]), textarea, select')]
    .filter((el) => { const r = el.getBoundingClientRect(); return (r.width > 0 && r.height > 0) || el.type === 'file'; }).length).catch(() => 0);
}

async function bestFrame(page) {
  let best = page.mainFrame(), max = await formFieldCount(best);
  for (const f of page.frames()) {
    const n = await formFieldCount(f);
    if (n > max) { best = f; max = n; }
  }
  return { frame: best, fields: max };
}

// Job pages often show the description first and the form after an Apply click.
async function reachForm(page, context) {
  for (let hop = 0; hop < 3; hop++) {
    const { fields } = await bestFrame(page);
    if (fields >= 3) return page;
    const targets = page.locator('a, button, [role=button]').filter({ hasText: APPLY_TEXT });
    const n = await targets.count();
    let clicked = false;
    for (let i = 0; i < n && !clicked; i++) {
      const el = targets.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const popup = context.waitForEvent('page', { timeout: 4000 }).catch(() => null);
      await el.click({ timeout: 5000 }).catch(() => {});
      clicked = true;
      const newPage = await popup;
      if (newPage) { await newPage.waitForLoadState('domcontentloaded').catch(() => {}); page = newPage; }
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }
    if (!clicked) break;
  }
  return page;
}

async function blockers(page) {
  const found = [];
  if (await page.locator('input[type=password]:visible').count()) found.push('This site wants you to sign in or create an account first');
  if (await page.locator('iframe[src*="recaptcha/api2/anchor"]:visible, iframe[src*="hcaptcha.com"]:visible, iframe[title*="challenge" i]:visible').count()) found.push('There is a CAPTCHA to solve');
  const url = page.url();
  if (/linkedin\.com|indeed\.com|glassdoor\.com|ziprecruiter\.com/i.test(url)) found.push('This is a job-board page, not the company form. Open it and use the company link');
  return found;
}

async function attachFiles(frame, { resume, coverLetter }) {
  const inputs = frame.locator('input[type=file]');
  const n = await inputs.count();
  const done = { resume: false, coverLetter: false };
  let resumeIdx = -1, coverIdx = -1;
  for (let i = 0; i < n; i++) {
    const hint = await inputs.nth(i).evaluate((el) => `${el.name} ${el.id} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-automation-id') || ''} ${(el.closest('div, fieldset, li') || el).innerText || ''}`).catch(() => '');
    if (/cover/i.test(hint)) { if (coverIdx < 0) coverIdx = i; } else if (/resume|cv\b|curriculum/i.test(hint)) { if (resumeIdx < 0) resumeIdx = i; }
  }
  if (resumeIdx < 0 && n && coverIdx !== 0) resumeIdx = 0;
  if (resume && resumeIdx >= 0) { await inputs.nth(resumeIdx).setInputFiles(resume); done.resume = true; }
  if (coverLetter && coverIdx >= 0) { await inputs.nth(coverIdx).setInputFiles(coverLetter); done.coverLetter = true; }
  if (done.resume || done.coverLetter) await frame.waitForTimeout(1500);
  return done;
}

const qNorm = (q) => String(q).replace(/\s*\*\s*$/, '').trim().toLowerCase();

// Free-text questions: reuse answers you already reviewed, draft the rest.
async function answerOpenQuestions(frame, { answerer, savedAnswers = [] }) {
  const qs = await frame.evaluate(() => globalThis.__jobAutofill.openQuestions());
  if (!qs.length) return [];
  const saved = new Map(savedAnswers.map((a) => [qNorm(a.question), a.answer]));
  const answers = qs.filter((q) => saved.has(qNorm(q.question))).map((q) => ({ id: q.id, question: q.question, answer: saved.get(qNorm(q.question)) }));
  const rest = qs.filter((q) => !saved.has(qNorm(q.question)));
  if (rest.length && answerer) answers.push(...(await answerer(rest).catch(() => [])));
  await frame.evaluate((a) => globalThis.__jobAutofill.setAnswers(a), answers.map(({ id, answer }) => ({ id, answer })));
  return answers.map(({ question, answer }) => ({ question, answer }));
}

export async function fillApplication(context, job, { profile, pdfPath, coverLetterPath, shotPath, submit = false, answerer = null, savedAnswers = [] }) {
  let page = await context.newPage();
  const out = { review: [], filled: 0, notes: [], drafted: [] };
  try {
    await page.goto(job.applyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    page = await reachForm(page, context);
    out.finalUrl = page.url();
    out.notes.push(...(await blockers(page)));
    const { frame, fields } = await bestFrame(page);
    if (fields < 3) {
      out.review.push(out.notes[0] || 'Could not find the application form on this page');
    } else {
      await frame.addScriptTag({ content: FILLER });
      const r = await frame.evaluate((p) => globalThis.__jobAutofill.fill(p, {}), profile);
      out.filled = r.filled.length;
      out.review = r.review;
      const attached = await attachFiles(frame, { resume: pdfPath, coverLetter: coverLetterPath });
      if (attached.resume) out.review = out.review.filter((q) => q !== 'Resume upload');
      if (attached.coverLetter) out.review = out.review.filter((q) => q !== 'Cover letter upload');
      out.drafted = await answerOpenQuestions(frame, { answerer, savedAnswers });
      const answered = new Set(out.drafted.map((a) => qNorm(a.question)));
      out.review = out.review.filter((q) => !answered.has(qNorm(q)));
      if (/myworkday/i.test(page.url())) out.review.push('Workday forms have several pages: finish the remaining pages by hand');
      out.review.push(...out.notes.filter((n) => !out.review.includes(n)));
    }
    if (submit && !out.review.length) {
      const btn = frame.locator('button, input[type=submit]').filter({ hasText: SUBMIT_TEXT });
      const target = (await btn.count()) ? btn.last() : frame.locator('button[type=submit], input[type=submit]').last();
      await target.click({ timeout: 10000 });
      out.submitted = await page.waitForFunction((re) => new RegExp(re, 'i').test(document.body.innerText), DONE_TEXT.source, { timeout: 25000 }).then(() => true).catch(() => false);
      if (!out.submitted) out.review.push('Clicked Submit but did not see a confirmation. The form may have an error or a CAPTCHA');
    }
    if (shotPath) await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
  } catch (e) {
    out.review.push(`Could not open the application: ${e.message.split('\n')[0]}`);
  }
  out.page = page;
  return out;
}
