// Decide which postings are worth applying to. Every rule is a plain check you
// can read and tune in config.json.
const lc = (s) => String(s || '').toLowerCase();
const hasWord = (text, phrase) => new RegExp(`(^|[^a-z])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(text);

export function requiredYears(description) {
  // "5+ years", "at least 7 years", "minimum of 4 years", "3-5 years"
  const text = lc(description);
  const nums = [];
  const re = /(?:at least|minimum(?: of)?|min\.?)?\s*(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|to)?\s*(\d{1,2})?\s*\+?\s*years?(?:'|’)?\s*(?:of)?\s*(?:[a-z/&,\- ]{0,40})?(?:experience|exp\b)/g;
  let m;
  while ((m = re.exec(text))) nums.push(Number(m[1]));
  return nums.length ? Math.min(...nums) : null;
}

export function check(job, search, now = Date.now()) {
  const title = lc(job.title);
  if (!search.titleInclude.some((p) => title.includes(lc(p)))) return 'title not in your list';
  const bad = search.titleExclude.find((p) => hasWord(title, lc(p)));
  if (bad) return `title has "${bad}"`;
  const loc = lc(job.location);
  if (search.locationInclude?.length && loc && !search.locationInclude.some((p) => hasWord(loc, lc(p)))) return `location "${job.location}"`;
  if (search.maxAgeDays && job.postedAt) {
    const age = (now - Date.parse(job.postedAt)) / 86400000;
    if (age > search.maxAgeDays) return `posted ${Math.round(age)} days ago`;
  }
  const years = requiredYears(job.description);
  if (years != null && years > search.maxYearsRequired) return `asks for ${years}+ years`;
  if (search.needsSponsorship && /(no|not|unable to|cannot|will not) (provide |offer )?(visa )?sponsor/i.test(job.description)) return 'no visa sponsorship';
  return null;
}

export function filterJobs(jobs, search) {
  const kept = [], dropped = [];
  for (const j of jobs) {
    const reason = check(j, search);
    if (reason) dropped.push({ ...j, reason }); else kept.push(j);
  }
  return { kept, dropped };
}
