// Shared by the popup and the keyboard shortcut: inject the filler into every
// frame of the tab we can reach (ATS forms are often in an iframe), run it, and
// merge what each frame reports.
export async function fillTab(tabId) {
  const { profile, settings } = await chrome.storage.local.get(['profile', 'settings']);
  if (!profile || !profile.email) return { error: 'Set up your profile first (Options page).' };
  const target = { tabId, allFrames: true };
  await chrome.scripting.executeScript({ target, files: ['src/filler.js'] });
  const runs = await chrome.scripting.executeScript({
    target,
    func: (p, o) => globalThis.__jobAutofill.fill(p, o),
    args: [profile, { overwrite: !!(settings && settings.overwrite) }],
  });
  const merged = { filled: [], review: [], kept: 0 };
  for (const r of runs) {
    if (!r.result) continue;
    merged.filled.push(...r.result.filled);
    merged.review.push(...r.result.review);
    merged.kept += r.result.kept;
  }
  merged.review = [...new Set(merged.review)];
  return merged;
}

export async function pageInfo(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/filler.js'] });
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__jobAutofill.pageInfo() });
  return r.result;
}
