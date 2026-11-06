import { fillTab } from './fill-tab.js';

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const { profile } = await chrome.storage.local.get('profile');
  if (!profile) {
    // Start from the sample profile so filling works even before the first Save.
    const sample = await (await fetch(chrome.runtime.getURL('sample-profile.json'))).json();
    await chrome.storage.local.set({ profile: sample });
  }
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'fill-form' || !tab) return;
  const r = await fillTab(tab.id).catch((e) => ({ error: e.message }));
  const text = r.error ? '!' : String(r.filled.length);
  chrome.action.setBadgeBackgroundColor({ color: r.error ? '#b7791f' : '#3f7d5c', tabId: tab.id });
  chrome.action.setBadgeText({ text, tabId: tab.id });
});
