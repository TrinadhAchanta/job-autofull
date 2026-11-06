# Job Autofill

A Chrome extension that fills job application forms from a profile you save once.
Open an application, click **Fill this application** (or press `Alt+Shift+F`), check
the highlighted fields, attach your resume, and submit it yourself.

It never clicks submit, never sends anything to a server, and keeps your profile in
your browser only.

## What it does

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

## Install (developer mode)

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder.
4. The profile page opens. Fill it in and click **Save profile**.
5. Pin the extension from the puzzle-piece menu so the button is always one click away.

Works in Chrome, Edge, Brave and other Chromium browsers.

## How matching works

`src/filler.js` reads each visible field's label, `aria-label`, placeholder, `name`, `id`
and Workday `data-automation-id`, then checks it against an ordered list of rules
(specific ones like "first name" before general ones like "name"). Dropdowns and radio
groups are scored option by option, with synonyms for yes / no / decline. Values are set
through the native input setter and `input` / `change` events are fired, so React-based
forms register the change.

To teach it a new kind of question, add a rule to `RULES` in `src/filler.js` or save a
custom answer on the profile page.

## Tests

The fixtures in `test/fixtures/` imitate Greenhouse, Lever and Workday forms.

```bash
npm install
npx playwright install chromium
npm test
```

## Privacy

Everything is stored with `chrome.storage.local` on your machine. The extension makes no
network requests. Back up or move your profile with **Download profile (JSON)**.

## Roadmap ideas

- Draft answers to open-ended questions with an AI model, using your own API key
- Attach a stored resume PDF automatically
- Per-company notes and follow-up reminders

## Credits

Inspired by [job-fill-autopilot](https://github.com/Saketh1997/job-fill-autopilot)
(itself built on [career-ops](https://github.com/santifer/career-ops)). This is an
independent, from-scratch implementation; no code was copied.

## License

MIT
