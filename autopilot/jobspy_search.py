"""Optional: search LinkedIn, Indeed, Glassdoor and ZipRecruiter with the
open-source JobSpy library (pip install python-jobspy). Search only: the
autopilot never applies through these sites, it follows each job's link to the
company's own application page.

Usage: python jobspy_search.py '<json options>'  -> prints a JSON list of jobs
"""
import json
import sys

from jobspy import scrape_jobs  # pip install python-jobspy

opts = json.loads(sys.argv[1])
jobs = []
for keyword in opts["keywords"]:
    df = scrape_jobs(
        site_name=opts.get("sites", ["linkedin", "indeed", "glassdoor", "zip_recruiter"]),
        search_term=keyword,
        location=opts.get("location", "United States"),
        results_wanted=opts.get("resultsWanted", 40),
        hours_old=opts.get("hoursOld", 72),
        country_indeed=opts.get("countryIndeed", "USA"),
        linkedin_fetch_description=True,
    )
    for row in df.fillna("").to_dict("records"):
        direct = row.get("job_url_direct") or ""
        jobs.append({
            "id": f"js-{row.get('site')}-{row.get('id')}",
            "ats": str(row.get("site")),
            "company": str(row.get("company")),
            "title": str(row.get("title")),
            "location": str(row.get("location")),
            "url": str(row.get("job_url")),
            # Prefer the company's own page; fall back to the listing.
            "applyUrl": str(direct or row.get("job_url")),
            "postedAt": str(row.get("date_posted")),
            "description": str(row.get("description"))[:20000],
        })
print(json.dumps(jobs))
