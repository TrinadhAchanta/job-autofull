# Job Autofull

Two tools for applying to jobs faster:

1. **Job autopilot** (`autopilot/`): finds jobs on many sites, writes a resume tailored to each one with Claude, fills in the application form in a browser and attaches that resume. You look over a review page, approve the ones you like, and it submits them.
2. **Job Autofill Chrome extension**: fills any application form you have open with one click.

Nothing is ever sent to an employer until you approve it.

---

## Job autopilot

### How it works

```
search  →  tailor  →  fill  →  review page  →  you approve  →  submit
```

- **search** checks company career sites (Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Workable, Recruitee) and job search sites (Adzuna, The Muse, Remotive, Himalayas). Optionally it can also search LinkedIn, Indeed, Glassdoor and ZipRecruiter. It drops jobs whose title, location, age or required years of experience don't fit your settings, and removes duplicates.
- **tailor** asks Claude to pick, reorder and reword your real resume for each job and saves it as a PDF in the same layout as a classic LaTeX resume (Computer Modern font, small-caps section titles, bold lead-ins on each bullet), at most two pages. A fact check then compares every number, employer, skill and certification with your base resume. If anything was made up, it asks Claude to fix it once, and if it is still wrong the job is flagged for you instead of used.
- **fill** opens each application in Chrome, clicks through to the form, fills it using the same matching as the extension, uploads the tailored resume, and takes a screenshot.
- **review** builds `autopilot/data/review.html`: every job with its fit notes, tailored resume, screenshot and anything left for you to answer.
- **approve** + **submit** sends only the jobs you approved, and only when every required question was answered. It waits for the "thank you" page and marks each job submitted or failed.

### Set up (once)

1. Install **Node.js 20 or newer** from [nodejs.org](https://nodejs.org) (the LTS button).
2. Download this repository (green **Code** button → **Download ZIP**) and unzip it.
3. Open a terminal in the folder that contains `package.json`. On Windows: open the folder in File Explorer, click the address bar, type `powershell` and press Enter.
4. Run:
   ```
   npm install
   npm run setup
   ```
   This installs the browser the autopilot uses and creates a private `autopilot/my/` folder (ignored by git) with three files to edit:
   - `resume.md`: your full resume in plain text. This is the only source of facts for tailored resumes.
   - `profile.json`: your answers to common form questions (contact details, work authorization, sponsorship, EEO answers).
   - `config.json`: job titles, keywords, locations, the most years of experience you want to see asked for, and which companies and sites to search.
5. Get a Claude API key at [console.anthropic.com](https://console.anthropic.com) (Settings → API keys) and add some credit. A tailored resume typically costs a few cents. Then set it:
   - Windows: `setx ANTHROPIC_API_KEY "sk-ant-..."` and open a new terminal
   - Mac/Linux: `export ANTHROPIC_API_KEY=sk-ant-...`

### Use it

```
npm run autopilot -- run              # search, tailor and fill (never submits)
```
Open `autopilot/data/review.html` in your browser. Then:
```
npm run autopilot -- approve 3 5 8    # the job numbers that look right
npm run autopilot -- submit           # sends only those
```
Other commands: `search`, `tailor`, `fill`, `review`, `list`, `skip 4`, and `--limit 5` to do fewer at a time. For jobs marked **Needs you**, run `npm run autopilot -- fill --keep-open` to leave the browser open and finish them by hand.

### Choosing what to search

In `autopilot/my/config.json`:

- `companies`: company career boards to watch. The name is the part of the company's jobs address:
  - Greenhouse `job-boards.greenhouse.io/`**`stripe`** · Lever `jobs.lever.co/`**`palantir`** · Ashby `jobs.ashbyhq.com/`**`ramp`**
  - Workable `apply.workable.com/`**`name`** · Recruitee **`name`**`.recruitee.com` · SmartRecruiters `jobs.smartrecruiters.com/`**`Name`**
  - Workday: host and site together, for example **`united.wd5.myworkdayjobs.com/UnitedCareers`**
- `searchSites`: keyword search across many companies at once. Adzuna needs a free key from [developer.adzuna.com](https://developer.adzuna.com).
- `searchSites.jobspy`: set `"enabled": true` to also search LinkedIn, Indeed, Glassdoor and ZipRecruiter. It needs Python and `pip install python-jobspy`. These sites are only searched: the autopilot follows each job to the company's own application page and never applies through LinkedIn or Indeed, because they ban accounts that apply automatically.

### What it can't do

- Sites that make you **sign in or create an account** first (most Workday sites, iCIMS, Taleo) and **CAPTCHAs** are flagged as *Needs you*. The browser profile is saved in `autopilot/my/browser-profile`, so after you sign in once with `--keep-open`, later runs reuse that login.
- **Workday** forms have several pages. The autopilot fills the first page and leaves the rest for you.
- Open-ended questions ("Why do you want to work here?") are left for you, unless you saved an answer in `profile.json` → `customAnswers`.
- Job boards change their pages and feeds. If a source stops returning jobs, the search prints which one failed.

### Tests

```
npm test
```
Runs the extension tests and the autopilot tests (job feeds and Claude are replaced with canned responses, and forms are local practice pages).

---

## Chrome extension

### What it does

- **Fills common fields** on Greenhouse, Lever, Ashby, Workday, SmartRecruiters, iCIMS,
  Workable, BambooHR, Jobvite and most plain company forms: name, email, phone, address,
  links, current role, education, work authorization, sponsorship, relocation, salary,
  start date, "how did you hear about us" and the voluntary EEO questions.
- **Picks dropdown and radio answers** by meaning, so "Yes", "I am authorized" and
  "Decline to self identify" vs "I don't wish to answer" all line up with your profile.
- **Remembers your own answers** to recurring questions: if a question contains a phrase
  you saved (for example "certification"), it fills your answer.
- **Flags what it can't do.** Fields it filled get a green outline. Required questions it
  has no answer for, file uploads and dropdowns it couldn't match get an amber outline and
  are listed in the popup.
- **Keeps a list of your applications** with a status (Applied, Interviewing, Offer...)
  that you can export as CSV.
- Leaves fields you already typed in alone (you can change that in settings).

### Install (developer mode)

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. The profile page opens. Fill it in and click **Save profile**.
5. Pin the extension from the puzzle-piece menu so the button is always one click away.

Works in Chrome, Edge, Brave and other Chromium browsers.

### How matching works

`src/filler.js` reads each visible field's label, `aria-label`, placeholder, `name`, `id`
and Workday `data-automation-id`, then checks it against an ordered list of rules
(specific ones like "first name" before general ones like "name"). Dropdowns and radio
groups are scored option by option, with synonyms for yes / no / decline. Values are set
through the native input setter and `input` / `change` events are fired, so React-based
forms register the change.

To teach it a new kind of question, add a rule to `RULES` in `src/filler.js` or save a
custom answer on the profile page.

### Tests

The fixtures in `test/fixtures/` imitate Greenhouse, Lever and Workday forms; `npm test` runs them.

### Privacy

The extension stores everything with `chrome.storage.local` on your machine and makes no
network requests. The autopilot keeps your files in `autopilot/my/` and `autopilot/data/`
(both ignored by git) and sends only your base resume and each job description to the
Claude API. Back up or move your profile with **Download profile (JSON)**.

### Roadmap ideas

- Draft answers to open-ended questions with Claude
- Follow-up reminders for submitted applications

## Credits

Inspired by [job-fill-autopilot](https://github.com/Saketh1997/job-fill-autopilot)
(itself built on [career-ops](https://github.com/santifer/career-ops)). This is an
independent, from-scratch implementation; no code was copied.

## License

MIT
