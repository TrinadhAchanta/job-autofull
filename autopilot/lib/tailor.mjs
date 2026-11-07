// Writes a resume for one job by asking Claude to select, reorder and reword
// your real resume. A separate fact check rejects anything (numbers, employers,
// skills) that isn't in your base resume, so it can't invent experience.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

export const TailoredResume = z.object({
  headline: z.string().describe('Job title line under the name, taken from titles you have actually held'),
  summary: z.string().describe('2-3 sentences aimed at this job'),
  experience: z.array(z.object({
    company: z.string(),
    title: z.string(),
    dates: z.string(),
    location: z.string(),
    bullets: z.array(z.object({
      label: z.string().describe('Short bold lead-in, e.g. "Contract Information Extraction"'),
      text: z.string().describe('The rest of the bullet after the lead-in'),
    })),
  })),
  projects: z.array(z.object({ name: z.string(), description: z.string() })),
  skills: z.array(z.object({ group: z.string(), items: z.array(z.string()) })),
  education: z.array(z.object({
    school: z.string(), degree: z.string(), dates: z.string(), location: z.string(),
    details: z.array(z.object({ label: z.string(), text: z.string() })),
  })),
  certifications: z.array(z.string()),
  matchNotes: z.string().describe('For the candidate only: how well they fit and any requirements they do not meet'),
});

const SYSTEM = `You tailor a candidate's resume to one job posting.

The base resume is the only source of facts. You may choose which bullets to keep, put the most relevant first, shorten them, and reword them using the posting's vocabulary where the base resume supports it. You must not add employers, titles, dates, degrees, certifications, tools, skills, metrics or numbers that are not in the base resume, and you must not make a number bigger or more specific. If the posting asks for something the candidate lacks, leave it out of the resume and mention it in matchNotes.

Keep every job from the base resume. Match the base resume's style: each bullet starts with a short bold lead-in (label) followed by the detail. Keep it to two pages at most: up to 6 bullets for the most relevant job, 3-5 for others, up to 6 projects, and skills grouped as in the base resume with the groups and items most relevant to this job first. Certifications are written as "Name: detail" when there is a detail.`;

const norm = (s) => String(s).toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');

// Every number-like token in the output (92%, 10K+, $2M, 4+, 3.8) must appear in the base resume.
export function factCheck(resume, baseText) {
  const base = norm(baseText).replace(/,/g, '');
  const problems = [];
  const texts = [resume.headline, resume.summary,
    ...resume.experience.flatMap((e) => [e.company, e.title, ...e.bullets.flatMap((b) => [b.label, b.text])]),
    ...resume.projects.flatMap((p) => [p.name, p.description]),
    ...resume.education.flatMap((e) => [e.school, e.degree, ...e.details.flatMap((d) => [d.label, d.text])]),
    ...resume.certifications];
  for (const t of texts) {
    for (const m of norm(t).replace(/,/g, '').matchAll(/\$?\d+(?:\.\d+)?\s*(?:%|k\+?|m\+?|\+|x)?/g)) {
      const tok = m[0].replace(/\s+/g, '');
      if (/^\d{4}$/.test(tok)) continue; // years are checked through dates
      const bare = tok.replace(/[^\d.]/g, '');
      if (!base.includes(tok) && !base.includes(bare)) problems.push(`number "${m[0].trim()}" is not in your resume`);
    }
  }
  for (const e of resume.experience) {
    if (!base.includes(norm(e.company))) problems.push(`employer "${e.company}" is not in your resume`);
  }
  for (const c of resume.certifications) {
    const words = norm(c).split(' ').filter((w) => w.length > 3);
    if (words.length && words.filter((w) => base.includes(w)).length < Math.ceil(words.length * 0.7)) problems.push(`certification "${c}" is not in your resume`);
  }
  for (const g of resume.skills) {
    for (const item of g.items) {
      const words = norm(item).replace(/[()/,]/g, ' ').split(' ').filter((w) => w.length > 1);
      if (words.some((w) => !base.includes(w))) problems.push(`skill "${item}" is not in your resume`);
    }
  }
  return [...new Set(problems)];
}

export async function tailorResume({ baseResume, job, model = 'claude-opus-5-5', effort = 'medium', client = new Anthropic() }) {
  const ask = async (extra = '') => {
    const response = await client.messages.parse({
      model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort, format: zodOutputFormat(TailoredResume) },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `<base_resume>\n${baseResume}\n</base_resume>\n\n<job_posting>\nCompany: ${job.company}\nTitle: ${job.title}\nLocation: ${job.location}\n\n${job.description.slice(0, 30000)}\n</job_posting>${extra}`,
      }],
    });
    if (response.stop_reason === 'refusal') throw new Error('Claude declined to write this resume');
    if (response.stop_reason === 'max_tokens') throw new Error('Resume output was cut off');
    if (!response.parsed_output) throw new Error('Could not read the resume Claude returned');
    return response.parsed_output;
  };
  let resume = await ask();
  let problems = factCheck(resume, baseResume);
  if (problems.length) {
    resume = await ask(`\n\nYour previous draft had these problems. Remove or fix every one, using only the base resume:\n- ${problems.join('\n- ')}`);
    problems = factCheck(resume, baseResume);
  }
  return { resume, problems };
}
