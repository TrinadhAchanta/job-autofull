// Public job-board APIs. These are the same JSON feeds the companies' own
// career pages use, so no scraping or logging in is needed.
const strip = (html = '') => html
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/<\/(p|li|h\d|div|br)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': 'job-autofull/0.2' } });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.json();
}

export async function greenhouse(board, fetchImpl = fetch) {
  const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`, fetchImpl);
  return (data.jobs || []).map((j) => ({
    id: `gh-${board}-${j.id}`,
    ats: 'greenhouse',
    company: data.company_name || board,
    board,
    title: j.title,
    location: j.location?.name || '',
    url: j.absolute_url,
    applyUrl: j.absolute_url,
    postedAt: j.first_published || j.updated_at,
    description: strip(j.content),
  }));
}

export async function lever(site, fetchImpl = fetch) {
  const data = await getJson(`https://api.lever.co/v0/postings/${site}?mode=json`, fetchImpl);
  return (data || []).map((j) => ({
    id: `lv-${site}-${j.id}`,
    ats: 'lever',
    company: site,
    board: site,
    title: j.text,
    location: [j.categories?.location, j.workplaceType === 'remote' ? 'Remote' : ''].filter(Boolean).join(' · '),
    url: j.hostedUrl,
    applyUrl: j.applyUrl || `${j.hostedUrl}/apply`,
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : '',
    description: [j.descriptionPlain, ...(j.lists || []).map((l) => `${l.text}\n${strip(l.content)}`), j.additionalPlain].filter(Boolean).join('\n'),
  }));
}

export async function ashby(board, fetchImpl = fetch) {
  const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${board}?includeCompensation=true`, fetchImpl);
  return (data.jobs || []).filter((j) => j.isListed !== false).map((j) => ({
    id: `ab-${board}-${j.id}`,
    ats: 'ashby',
    company: board,
    board,
    title: j.title,
    location: [j.location, j.isRemote ? 'Remote' : ''].filter(Boolean).join(' · '),
    url: j.jobUrl,
    applyUrl: j.applyUrl || `${j.jobUrl}/application`,
    postedAt: j.publishedAt || '',
    description: j.descriptionPlain || strip(j.descriptionHtml),
  }));
}

// ---- More company career-site systems ----

export async function workable(account, fetchImpl = fetch) {
  const data = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${account}?details=true`, fetchImpl);
  return (data.jobs || []).map((j) => ({
    id: `wk-${account}-${j.shortcode}`,
    ats: 'workable',
    company: data.name || account,
    board: account,
    title: j.title,
    location: [j.city, j.state, j.country, j.telecommuting ? 'Remote' : ''].filter(Boolean).join(', '),
    url: j.url || j.shortlink,
    applyUrl: j.application_url || `${j.url}/apply`,
    postedAt: j.published_on || j.created_at || '',
    description: strip(j.description),
  }));
}

export async function recruitee(company, fetchImpl = fetch) {
  const data = await getJson(`https://${company}.recruitee.com/api/offers/`, fetchImpl);
  return (data.offers || []).map((j) => ({
    id: `rc-${company}-${j.id}`,
    ats: 'recruitee',
    company: j.company_name || company,
    board: company,
    title: j.title,
    location: [j.location, j.remote ? 'Remote' : ''].filter(Boolean).join(' · '),
    url: j.careers_url,
    applyUrl: j.careers_apply_url || j.careers_url,
    postedAt: j.published_at || '',
    description: strip(`${j.description || ''}\n${j.requirements || ''}`),
  }));
}

// SmartRecruiters and Workday list jobs without descriptions; `hydrate` fetches
// the description only for jobs that already passed the title filter.
export async function smartrecruiters(companyId, fetchImpl = fetch) {
  const data = await getJson(`https://api.smartrecruiters.com/v1/companies/${companyId}/postings?limit=100`, fetchImpl);
  return (data.content || []).map((j) => ({
    id: `sr-${companyId}-${j.id}`,
    ats: 'smartrecruiters',
    company: j.company?.name || companyId,
    board: companyId,
    title: j.name,
    location: [j.location?.city, j.location?.region, j.location?.country, j.location?.remote ? 'Remote' : ''].filter(Boolean).join(', '),
    url: `https://jobs.smartrecruiters.com/${companyId}/${j.id}`,
    applyUrl: `https://jobs.smartrecruiters.com/${companyId}/${j.id}`,
    postedAt: j.releasedDate || '',
    description: '',
    hydrate: async (f = fetchImpl) => {
      const d = await getJson(`https://api.smartrecruiters.com/v1/companies/${companyId}/postings/${j.id}`, f);
      const s = d.jobAd?.sections || {};
      return strip([s.jobDescription?.text, s.qualifications?.text, s.additionalInformation?.text].filter(Boolean).join('\n'));
    },
  }));
}

// Workday: give the career site as "tenant.wd5.myworkdayjobs.com/SiteName",
// copied from the company's job page address.
export async function workday(site, fetchImpl = fetch, { searchText = '' } = {}) {
  const [host, siteName] = site.split('/');
  const tenant = host.split('.')[0];
  const base = `https://${host}/wday/cxs/${tenant}/${siteName}`;
  const out = [];
  for (let offset = 0; offset < 200; offset += 20) {
    const res = await fetchImpl(`${base}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText }),
    });
    if (!res.ok) throw new Error(`${res.status} from ${base}/jobs`);
    const data = await res.json();
    for (const j of data.jobPostings || []) {
      out.push({
        id: `wd-${tenant}-${j.externalPath.split('_').pop()}`,
        ats: 'workday',
        company: tenant,
        board: site,
        title: j.title,
        location: j.locationsText || '',
        url: `https://${host}/en-US/${siteName}${j.externalPath}`,
        applyUrl: `https://${host}/en-US/${siteName}${j.externalPath}/apply`,
        postedAt: '',
        postedText: j.postedOn || '',
        description: '',
        hydrate: async (f = fetchImpl) => strip((await getJson(`${base}${j.externalPath}`, f)).jobPostingInfo?.jobDescription),
      });
    }
    if (!data.jobPostings?.length || offset + 20 >= (data.total || 0)) break;
  }
  return out;
}

// ---- Job search sites (search by keyword instead of by company) ----

export async function adzuna({ appId, appKey, country = 'us', where = '', maxDaysOld = 14 }, keyword, fetchImpl = fetch) {
  const q = new URLSearchParams({ app_id: appId, app_key: appKey, what: keyword, results_per_page: '50', max_days_old: String(maxDaysOld), 'content-type': 'application/json' });
  if (where) q.set('where', where);
  const data = await getJson(`https://api.adzuna.com/v1/api/jobs/${country}/search/1?${q}`, fetchImpl);
  return (data.results || []).map((j) => ({
    id: `az-${j.id}`,
    ats: 'adzuna',
    company: j.company?.display_name || '',
    title: j.title?.replace(/<[^>]+>/g, ''),
    location: j.location?.display_name || '',
    url: j.redirect_url,
    applyUrl: j.redirect_url,
    postedAt: j.created || '',
    description: strip(j.description),
    partialDescription: true,
  }));
}

export async function themuse({ location = '' }, keyword, fetchImpl = fetch) {
  const q = new URLSearchParams({ page: '0', descending: 'true' });
  q.append('category', 'Data and Analytics'); q.append('category', 'Data Science'); q.append('category', 'Software Engineering');
  if (location) q.append('location', location);
  const data = await getJson(`https://www.themuse.com/api/public/jobs?${q}`, fetchImpl);
  const kw = keyword.toLowerCase();
  return (data.results || []).filter((j) => j.name.toLowerCase().includes(kw)).map((j) => ({
    id: `mu-${j.id}`,
    ats: 'themuse',
    company: j.company?.name || '',
    title: j.name,
    location: (j.locations || []).map((l) => l.name).join(' / '),
    url: j.refs?.landing_page,
    applyUrl: j.refs?.landing_page,
    postedAt: j.publication_date || '',
    description: strip(j.contents),
  }));
}

export async function remotive(_opts, keyword, fetchImpl = fetch) {
  const data = await getJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(keyword)}&limit=100`, fetchImpl);
  return (data.jobs || []).map((j) => ({
    id: `rm-${j.id}`,
    ats: 'remotive',
    company: j.company_name,
    title: j.title,
    location: `Remote (${j.candidate_required_location || 'anywhere'})`,
    url: j.url,
    applyUrl: j.url,
    postedAt: j.publication_date || '',
    description: strip(j.description),
  }));
}

export async function himalayas(_opts, keyword, fetchImpl = fetch) {
  const data = await getJson(`https://himalayas.app/jobs/api/search?q=${encodeURIComponent(keyword)}`, fetchImpl);
  return (data.jobs || []).map((j) => ({
    id: `hm-${j.guid || j.applicationLink}`,
    ats: 'himalayas',
    company: j.companyName,
    title: j.title,
    location: `Remote (${(j.locationRestrictions || []).join(', ') || 'anywhere'})`,
    url: j.applicationLink,
    applyUrl: j.applicationLink,
    postedAt: j.pubDate ? new Date(j.pubDate * 1000).toISOString() : '',
    description: strip(j.description),
  }));
}

export const COMPANY_SOURCES = { greenhouse, lever, ashby, workable, recruitee, smartrecruiters, workday };
export const SEARCH_SOURCES = { adzuna, themuse, remotive, himalayas };

// Works out which form system a link leads to, so the apply step knows what to expect.
export function atsFromUrl(url = '') {
  const u = url.toLowerCase();
  if (u.includes('greenhouse.io')) return 'greenhouse';
  if (u.includes('lever.co')) return 'lever';
  if (u.includes('ashbyhq.com')) return 'ashby';
  if (u.includes('myworkdayjobs.com') || u.includes('myworkdaysite.com')) return 'workday';
  if (u.includes('workable.com')) return 'workable';
  if (u.includes('smartrecruiters.com')) return 'smartrecruiters';
  if (u.includes('recruitee.com')) return 'recruitee';
  if (u.includes('linkedin.com')) return 'linkedin';
  if (u.includes('indeed.com')) return 'indeed';
  return 'other';
}

import { execFile } from 'child_process';
import { fileURLToPath } from 'url';

function jobspy(opts, keywords) {
  const script = fileURLToPath(new URL('../jobspy_search.py', import.meta.url));
  return new Promise((resolve, reject) => {
    execFile(opts.python || 'python3', [script, JSON.stringify({ ...opts, keywords })], { maxBuffer: 200 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(/No module named/.test(stderr) ? 'JobSpy is not installed. Run: pip install python-jobspy' : stderr.trim().split('\n').pop() || err.message));
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(new Error('JobSpy returned unreadable output')); }
    });
  });
}

// Runs every company board and every keyword search in your config.
export async function searchAll(config, { fetchImpl = fetch, log = console.log } = {}) {
  const tasks = [];
  for (const [ats, boards] of Object.entries(config.companies || {})) {
    if (!COMPANY_SOURCES[ats]) { log(`  ! unknown job system "${ats}" in companies`); continue; }
    for (const board of boards || []) tasks.push({ label: `${ats}/${board}`, run: () => COMPANY_SOURCES[ats](board, fetchImpl) });
  }
  const sites = config.searchSites || {};
  for (const [name, opts] of Object.entries(sites)) {
    if (!opts || opts.enabled === false) continue;
    if (name === 'jobspy') { tasks.push({ label: 'LinkedIn/Indeed/Glassdoor via JobSpy', run: () => jobspy(opts, config.search.keywords || []) }); continue; }
    if (!SEARCH_SOURCES[name]) { log(`  ! unknown search site "${name}"`); continue; }
    if (name === 'adzuna' && (!opts.appId || !opts.appKey)) { log('  - adzuna skipped: add your free appId/appKey from developer.adzuna.com'); continue; }
    for (const kw of config.search.keywords || []) tasks.push({ label: `${name} "${kw}"`, run: () => SEARCH_SOURCES[name](opts, kw, fetchImpl) });
  }
  const results = [];
  for (let i = 0; i < tasks.length; i += 4) {
    const slice = tasks.slice(i, i + 4);
    const batch = await Promise.allSettled(slice.map((t) => t.run()));
    batch.forEach((r, k) => {
      if (r.status === 'fulfilled') results.push(...r.value);
      else log(`  ! ${slice[k].label}: ${r.reason.message}`);
    });
  }
  return results;
}
