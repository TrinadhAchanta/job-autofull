// Runs the filler against local fixture pages that imitate common ATS forms.
// Usage: node test/run-tests.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const filler = readFileSync(path.join(here, '../src/filler.js'), 'utf8');
const profile = {
  ...JSON.parse(readFileSync(path.join(here, '../sample-profile.json'), 'utf8')),
  phone: '555-0100', city: 'Boston', zip: '02101', address: '1 Main St', linkedin: 'https://linkedin.com/in/example',
  workAuthorized: 'Yes', needsSponsorship: 'No', willingToRelocate: 'Yes',
};

let failures = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(actual)}${ok ? '' : ' (expected ' + JSON.stringify(expected) + ')'}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();
async function run(fixture) {
  await page.goto('file://' + path.join(here, 'fixtures', fixture));
  await page.addScriptTag({ content: filler });
  return page.evaluate((p) => globalThis.__jobAutofill.fill(p, {}), profile);
}
const val = (sel) => page.$eval(sel, (el) => el.value);
const selText = (sel) => page.$eval(sel, (el) => el.selectedOptions[0]?.text);
const checked = (name) => page.$eval(`input[name="${name}"]:checked`, (el) => el.value).catch(() => null);

console.log('\n# Greenhouse-style');
let r = await run('greenhouse.html');
check('first name', await val('#first_name'), 'Trinadh');
check('last name', await val('#last_name'), 'Achanta');
check('email', await val('#email'), 'trinadh.eng@gmail.com');
check('phone', await val('#phone'), '555-0100');
check('linkedin', await val('#q1'), profile.linkedin);
check('website', await val('#q2'), profile.portfolio);
check('work authorization', await selText('#q3'), 'Yes');
check('sponsorship', await selText('#q4'), 'No');
check('custom answer', await val('#q5'), 'Microsoft Certified: Azure Data Engineer Associate');
check('unknown required question left empty', await val('#q6'), '');
check('gender', await selText('#gender'), 'Decline To Self Identify');
check('veteran', await selText('#vet'), "I don't wish to answer");
check('input events fired', (await page.evaluate(() => window.events)).includes('first_name'), true);
check('review list has resume + open question', r.review.includes('Resume upload') && r.review.some((q) => /favorite dataset/.test(q)), true);
console.log('  review:', r.review);

console.log('\n# Lever-style');
r = await run('lever.html');
check('full name', await val('input[name="name"]'), 'Trinadh Achanta');
check('email', await val('input[name="email"]'), 'trinadh.eng@gmail.com');
check('company', await val('input[name="org"]'), 'CVS Caremark');
check('github', await val('input[name="urls[GitHub]"]'), 'https://github.com/TrinadhAchanta');
check('portfolio', await val('input[name="urls[Portfolio]"]'), 'https://trinadha-kumar.vercel.app');
check('relocate radio', await checked('cards[0][field0]'), 'Yes');
check('hispanic radio', await checked('eeo[hispanic]'), 'Decline');

console.log('\n# Workday-style');
r = await run('workday.html');
check('given name', await val('#i1'), 'Trinadh');
check('family name', await val('#i2'), 'Achanta');
check('address', await val('#i3'), '1 Main St');
check('city', await val('#i4'), 'Boston');
check('postal', await val('#i5'), '02101');
check('phone', await val('#i6'), '555-0100');
check('keeps existing value', await val('#i7'), 'already@there.com');
check('phone device type not filled with number', await val('#i8'), '');

await browser.close();
console.log(failures ? `\n${failures} failed` : '\nAll passed');
process.exit(failures ? 1 : 0);
