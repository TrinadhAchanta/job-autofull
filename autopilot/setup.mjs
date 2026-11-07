#!/usr/bin/env node
// One-time setup: creates autopilot/my/ with your own copies of the config,
// profile and resume. That folder is ignored by git, so your details stay on
// your computer.
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const my = path.join(here, 'my');
mkdirSync(my, { recursive: true });
const copy = (from, to, what) => {
  const dest = path.join(my, to);
  if (existsSync(dest)) return console.log(`✓ ${what} already exists: ${dest}`);
  copyFileSync(from, dest);
  console.log(`+ Created ${what}: ${dest}`);
};
copy(path.join(here, 'config.example.json'), 'config.json', 'search settings');
copy(path.join(here, '..', 'sample-profile.json'), 'profile.json', 'application answers');
copy(path.join(here, 'resume.example.md'), 'resume.md', 'base resume');

try {
  execSync('npx playwright install chromium', { stdio: 'inherit' });
} catch {
  console.log('! Could not install the browser automatically. Run: npx playwright install chromium');
}

console.log(`
Next:
  1. Paste your real resume into   ${path.join(my, 'resume.md')}
  2. Check your answers in         ${path.join(my, 'profile.json')}
  3. Adjust job titles/places in   ${path.join(my, 'config.json')}
  4. Set your Claude API key:      ${process.platform === 'win32' ? 'setx ANTHROPIC_API_KEY "sk-ant-..."  (then open a new terminal)' : 'export ANTHROPIC_API_KEY=sk-ant-...'}
  5. Run:                          npm run autopilot -- run
`);
if (!process.env.ANTHROPIC_API_KEY) console.log('Note: ANTHROPIC_API_KEY is not set yet, so the "tailor" step will fail until you add it.');
