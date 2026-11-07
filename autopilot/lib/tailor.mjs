// Writes a resume for one job by asking Claude to select, reorder and reword
// your real resume. A separate fact check rejects anything (numbers, employers,
// skills) that isn't in your base resume, so it can't invent experience.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

export const TailoredResume = z.object({
  headline: z.string().describe('Target-role line under the name, matching the role family of this posting (e.g. "Software Engineer", "Data Scientist", "Machine Learning Engineer"), optionally with a short focus like "| Python, ML Systems"'),
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
  coverLetter: z.string().describe('Cover letter for this job, 180-260 words, plain paragraphs separated by blank lines, no address block or date, starting "Dear Hiring Team," and ending with the sign-off line "Sincerely," only (the name is added later)'),
  matchNotes: z.string().describe('For the candidate only: how well they fit and any requirements they do not meet'),
});

const SYSTEM = `You tailor a candidate's resume to one job posting.

Shape the whole resume around the role in the posting. If it is a Software Engineer job, the headline says Software Engineer, the summary presents the candidate as a software engineer, and each job's bullets lead with the engineering work that is really in the base resume (building pipelines, APIs, services, deployment, cloud, testing, performance) described in the posting's terms. If it is a Data Scientist, ML Engineer, Data Engineer or Analyst job, lead with the matching work in the same way. Order skill groups and items by what the posting asks for. Each employer's job title must stay exactly as in the base resume, because employers verify it; only the headline and summary describe the target role.

The base resume is the only source of facts. You may choose which bullets to keep, put the most relevant first, shorten them, and reword them using the posting's vocabulary where the base resume supports it. You must not add employers, titles, dates, degrees, certifications, tools, skills, metrics or numbers that are not in the base resume, and you must not make a number bigger or more specific. If the posting asks for something the candidate lacks, leave it out of the resume and mention it in matchNotes.

Keep every job from the base resume. Match the base resume's style: each bullet starts with a short bold lead-in (label) followed by the detail. Keep it to two pages at most: up to 6 bullets for the most relevant job, 3-5 for others, up to 6 projects, and skills grouped as in the base resume with the groups and items most relevant to this job first. Certifications are written as "Name: detail" when there is a detail.

Also write a short cover letter for this specific company and role: why this role, and two or three concrete examples from the base resume that match the posting. The same fact rules apply. Do not claim knowledge about the company beyond what the posting says.`;

const norm = (s) => String(s).toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');

// Every number-like token in the output (92%, 10K+, $2M, 4+, 3.8) must appear in the base resume.
export function factCheck(resume, baseText) {
  const base = norm(baseText).replace(/,/g, '');
  const problems = [];
  const texts = [resume.headline, resume.summary,
    ...resume.experience.flatMap((e) => [e.company, e.title, ...e.bullets.flatMap((b) => [b.label, b.text])]),
    ...resume.projects.flatMap((p) => [p.name, p.description]),
    ...resume.education.flatMap((e) => [e.school, e.degree, ...e.details.flatMap((d) => [d.label, d.text])]),
    ...resume.certifications, resume.coverLetter || ''];
  for (const t of texts) {
    for (const m of norm(t).replace(/,/g, '').matchAll(/\$?\d+(?:\.\d+)?\s*(?:%|k\+?|m\+?|\+|x)?/g)) {
      const tok = m[0].replace(/\s+/g, '');
      if (/^\d{4}$/.test(tok)) continue; // years are checked through dates
      const hasUnit = /[%$kmx+]/.test(tok);
      const bareRe = new RegExp(`(^|[^\\d.])${tok.replace(/[^\d.]/g, '').replace('.', '\\.')}([^\\d]|$)`);
      if (!base.includes(tok) && (hasUnit || !bareRe.test(base))) problems.push(`number "${m[0].trim()}" is not in your resume`);
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

// ---- Answers to a form's open questions ----

const Answers = z.object({
  answers: z.array(z.object({
    id: z.string(),
    canAnswer: z.boolean().describe('false when an honest answer needs information that is not in the resume or profile'),
    answer: z.string().describe('The answer to put in the form, or "" when canAnswer is false'),
  })),
});

const ANSWER_SYSTEM = `You fill in the free-text questions on a job application for the candidate, in their voice (first person).

Use only facts from the base resume, the candidate's profile answers and the job posting. Never invent experience, numbers, names, salary figures, dates or reasons. If a question needs information you do not have (for example a referrer's name, a salary number not in the profile, a portfolio link not given, or personal motivations beyond what the resume supports), set canAnswer to false and leave answer empty.

Match the length to the question: one line for short fields, 80-180 words for open questions like "Why do you want to work here?" unless a character limit is given. Write plainly and specifically about this company and role.`;

export async function answerQuestions({ baseResume, profile, job, questions, model = 'claude-opus-5-5', effort = 'medium', client = new Anthropic() }) {
  if (!questions.length) return [];
  const facts = Object.fromEntries(Object.entries(profile).filter(([k, v]) => v && typeof v === 'string' && !['coverLetter', 'summary', 'gender', 'race', 'hispanic', 'veteran', 'disability'].includes(k)));
  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort, format: zodOutputFormat(Answers) },
    system: ANSWER_SYSTEM,
    messages: [{
      role: 'user',
      content: `<base_resume>\n${baseResume}\n</base_resume>\n<profile>\n${JSON.stringify(facts, null, 1)}\n</profile>\n<job_posting>\nCompany: ${job.company}\nTitle: ${job.title}\n\n${(job.description || '').slice(0, 20000)}\n</job_posting>\n<questions>\n${questions.map((q) => `[${q.id}] ${q.question}${q.maxLength ? ` (max ${q.maxLength} characters)` : ''}${q.long ? '' : ' (short field)'}`).join('\n')}\n</questions>`,
    }],
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) return [];
  const allowed = `${baseResume}\n${JSON.stringify(facts)}\n${job.description || ''}`;
  return response.parsed_output.answers
    .filter((a) => a.canAnswer && a.answer.trim() && questions.some((q) => q.id === a.id))
    .map((a) => ({ ...a, question: questions.find((q) => q.id === a.id).question, problems: factCheck({ headline: '', summary: a.answer, experience: [], projects: [], skills: [], education: [], certifications: [] }, allowed) }))
    .filter((a) => !a.problems.length);
}
