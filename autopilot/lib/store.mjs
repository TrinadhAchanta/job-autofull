// The job list lives in one JSON file so you can read and edit it by hand.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import path from 'path';

export function createStore(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'jobs.json');
  const load = () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []);
  const save = (jobs) => writeFileSync(file, JSON.stringify(jobs, null, 2));
  return {
    file,
    all: load,
    save,
    upsert(newJobs) {
      const jobs = load();
      const seen = new Set(jobs.map((j) => j.id));
      let num = jobs.reduce((m, j) => Math.max(m, j.num || 0), 0);
      const added = newJobs.filter((j) => !seen.has(j.id)).map((j) => ({ ...j, num: ++num, status: 'new', foundAt: new Date().toISOString() }));
      save([...added, ...jobs]);
      return added;
    },
    update(id, patch) {
      const jobs = load();
      const j = jobs.find((x) => x.id === id);
      if (j) Object.assign(j, patch, { updatedAt: new Date().toISOString() });
      save(jobs);
      return j;
    },
  };
}

// Status flow: new → tailored → ready (form filled, waiting for you) | needs-you
//              ready → approved → submitted | submit-failed ; skipped at any point
export const STATUS = ['new', 'tailored', 'ready', 'needs-you', 'approved', 'submitted', 'submit-failed', 'skipped'];
