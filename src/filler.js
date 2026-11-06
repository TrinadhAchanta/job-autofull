// filler.js — injected into the job application page (and its ATS iframes).
// Exposes globalThis.__jobAutofill.fill(profile, options) which finds form
// fields, works out what each one is asking for, and fills it from the
// profile. It never clicks submit.
(() => {
  if (globalThis.__jobAutofill) return;

  // Each rule maps a field's description (label, name, placeholder, ...) to a
  // profile value. Order matters: the first rule that matches wins, so the
  // specific ones ("first name") come before the general ones ("name").
  const RULES = [
    { key: 'firstName', re: /\b(first|given|fore)[\s_-]*name\b|^fname$|first_?name/i },
    { key: 'lastName', re: /\b(last|family|sur)[\s_-]*name\b|^lname$|last_?name|surname/i },
    { key: 'preferredName', re: /\b(preferred|nick)[\s_-]*name\b/i },
    { key: 'fullName', re: /\b(full|legal|your)[\s_-]*name\b|^name$|^name\b(?!.*(company|school|employer|reference|manager))/i },
    { key: 'howDidYouHear', re: /how did you (hear|find|learn)|source|referr(al|ed) source|where did you (hear|find)/i, not: /open source|employee name/i },
    { key: 'email', re: /e-?mail/i },
    { key: 'phone', re: /phone|mobile|cell|telephone/i, not: /type|extension|country code/i },
    { key: 'linkedin', re: /linked\s*in/i },
    { key: 'github', re: /git\s*hub/i },
    { key: 'portfolio', re: /portfolio|personal (web)?site|website|blog|other (url|link)/i },
    { key: 'address', re: /street|address\s*(line)?\s*1?$|^address/i, not: /e-?mail|web/i },
    { key: 'city', re: /\bcity\b|town/i },
    { key: 'state', re: /\bstate\b|province|region/i, not: /united states|statement/i },
    { key: 'zip', re: /zip|postal/i },
    { key: 'country', re: /\bcountry\b/i, not: /code|phone/i },
    { key: 'location', re: /\blocation\b|where are you (located|based)|current(ly)? (city|location)/i },
    { key: 'currentCompany', re: /current (company|employer)|company name|employer|organization/i, not: /previous|past/i },
    { key: 'currentTitle', re: /current (job )?title|job title|position title|current role|^title$/i },
    { key: 'yearsExperience', re: /years of (relevant |professional |work )?experience|how many years/i },
    { key: 'school', re: /school|university|college|institution/i },
    { key: 'degree', re: /\bdegree\b|level of education|highest education/i },
    { key: 'major', re: /major|field of study|discipline|concentration/i },
    { key: 'gradYear', re: /graduation (year|date)|year of graduation|grad(uation)? year/i },
    { key: 'gpa', re: /\bgpa\b|grade point/i },
    { key: 'needsSponsorship', re: /(require|need).{0,60}(sponsor|visa)|(sponsor|visa).{0,40}(require|need)/i },
    { key: 'workAuthorized', re: /authori[sz]ed to work|legally (authori[sz]ed|eligible|able)|eligib(le|ility) to work|right to work|work authori[sz]ation/i },
    { key: 'needsSponsorship', re: /sponsor|h-?1b|visa status/i },
    { key: 'willingToRelocate', re: /relocat/i },
    { key: 'salaryExpectation', re: /salary|compensation|pay expectation|desired pay/i },
    { key: 'noticePeriod', re: /notice period/i },
    { key: 'startDate', re: /start date|available to start|earliest (start|date)|availability/i },
    { key: 'hispanic', re: /hispanic|latin[oax]/i },
    { key: 'race', re: /\brace\b|ethnicity/i },
    { key: 'gender', re: /gender|\bsex\b/i, not: /pronoun|transgender/i },
    { key: 'veteran', re: /veteran|military|protected veteran/i },
    { key: 'disability', re: /disabilit/i },
    { key: 'coverLetter', re: /cover letter/i },
    { key: 'summary', re: /summary|about (yourself|you)|tell us about|additional information/i },
  ];

  // Words that mean the same answer across different forms' option lists.
  const SYNONYMS = {
    yes: ['yes', 'y', 'true', 'i am', 'i do', 'i will', 'authorized'],
    no: ['no', 'n', 'false', 'i am not', 'i do not', "i don't", 'not required', 'will not'],
    decline: ['decline', 'prefer not', "don't wish", 'do not wish', 'not to answer', 'not want to answer', 'choose not', 'not to disclose', 'not specified', 'rather not'],
  };

  const norm = (s) => String(s ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/[*:?]/g, ' ').replace(/\s+/g, ' ').trim();

  function textOf(el) {
    if (!el) return '';
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(el) {
    if (el.type === 'hidden' || el.disabled || el.readOnly) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    // Radio/checkbox inputs are often visually hidden but have a visible label.
    if (el.type === 'radio' || el.type === 'checkbox') return true;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // The question a field is asking, from the most to the least reliable source.
  function questionFor(el) {
    const doc = el.ownerDocument;
    const parts = [];
    if (el.type === 'radio' || el.type === 'checkbox') {
      const fs = el.closest('fieldset');
      const legend = fs && fs.querySelector('legend');
      if (legend) parts.push(textOf(legend));
      const group = el.closest('[role="radiogroup"], [role="group"]');
      if (group) {
        const lb = group.getAttribute('aria-labelledby');
        if (lb) lb.split(/\s+/).forEach((id) => parts.push(textOf(doc.getElementById(id))));
        if (group.getAttribute('aria-label')) parts.push(group.getAttribute('aria-label'));
      }
      if (!parts.length) parts.push(nearbyText(el.closest('div, li, td') ? el.closest('div, li, td').parentElement : el));
      parts.push(el.name || '');
      return parts.filter(Boolean).join(' | ');
    }
    if (el.labels && el.labels.length) el.labels.forEach((l) => parts.push(textOf(l)));
    const lb = el.getAttribute('aria-labelledby');
    if (lb) lb.split(/\s+/).forEach((id) => parts.push(textOf(doc.getElementById(id))));
    ['aria-label', 'placeholder', 'data-automation-id', 'name', 'id', 'autocomplete'].forEach((a) => {
      const v = el.getAttribute(a);
      if (v && v !== 'on' && v !== 'off') parts.push(v.replace(/[_\-[\]]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'));
    });
    if (!el.labels || !el.labels.length) parts.unshift(nearbyText(el));
    return parts.filter(Boolean).join(' | ');
  }

  // Many ATS forms put the label in a sibling element instead of <label for>.
  function nearbyText(el) {
    let node = el;
    for (let depth = 0; depth < 4 && node; depth++) {
      let sib = node.previousElementSibling;
      while (sib) {
        const t = textOf(sib);
        if (t && t.length < 200 && !sib.querySelector('input, select, textarea')) return t;
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
      const label = node && node.querySelector(':scope > label, :scope > legend, :scope > .label, :scope > [class*="label"]');
      if (label && !label.contains(el)) return textOf(label);
    }
    return '';
  }

  function valueFor(question, profile) {
    const q = norm(question);
    for (const ca of profile.customAnswers || []) {
      if (ca && ca.match && ca.answer && q.includes(norm(ca.match))) return { key: 'custom: ' + ca.match, value: ca.answer };
    }
    for (const rule of RULES) {
      if (!rule.re.test(question)) continue;
      if (rule.not && rule.not.test(question)) continue;
      let value = profile[rule.key];
      if (rule.key === 'fullName') value = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
      if (rule.key === 'location') value = [profile.city, profile.state, profile.country].filter(Boolean).join(', ');
      return { key: rule.key, value: value == null ? '' : String(value) };
    }
    return null;
  }

  function synonymClass(s) {
    const t = norm(s);
    if (SYNONYMS.decline.some((w) => t.includes(w))) return 'decline';
    if (SYNONYMS.no.some((w) => t === w || t.startsWith(w + ' ') || t.startsWith(w + ','))) return 'no';
    if (SYNONYMS.yes.some((w) => t === w || t.startsWith(w + ' ') || t.startsWith(w + ','))) return 'yes';
    return null;
  }

  // Score how well an option's text matches the answer we want to give.
  function optionScore(optionText, want) {
    const o = norm(optionText), w = norm(want);
    if (!o || !w) return 0;
    if (o === w) return 100;
    const so = synonymClass(o), sw = synonymClass(w);
    if (so && sw) return so === sw ? 90 : 0;
    if (o.startsWith(w) || w.startsWith(o)) return 80;
    if (o.includes(w) || w.includes(o)) return 70;
    const ow = new Set(o.split(' ')), ww = w.split(' ');
    const overlap = ww.filter((x) => x.length > 2 && ow.has(x)).length;
    return overlap ? 40 + overlap * 5 : 0;
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function mark(el, state, note) {
    const colors = { filled: '#3f7d5c', review: '#b7791f' };
    el.style.outline = `2px solid ${colors[state]}`;
    el.style.outlineOffset = '2px';
    el.dataset.jobAutofill = state;
    if (note) el.title = note;
  }

  function fillText(el, value, overwrite) {
    if (el.value && !overwrite) return 'kept';
    if (el.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'skip';
    setNativeValue(el, value);
    return 'filled';
  }

  function fillSelect(el, value) {
    let best = null, bestScore = 0;
    for (const opt of el.options) {
      if (!opt.value && !opt.text.trim()) continue;
      const s = optionScore(opt.text, value);
      if (s > bestScore) { best = opt; bestScore = s; }
    }
    if (!best || bestScore < 60) return 'skip';
    setNativeValue(el, best.value);
    return 'filled';
  }

  function optionLabel(input) {
    if (input.labels && input.labels.length) return textOf(input.labels[0]);
    return input.getAttribute('aria-label') || input.value || textOf(input.parentElement);
  }

  function fillRadioGroup(radios, value) {
    let best = null, bestScore = 0;
    for (const r of radios) {
      const s = optionScore(optionLabel(r), value);
      if (s > bestScore) { best = r; bestScore = s; }
    }
    if (!best || bestScore < 60) return 'skip';
    if (!best.checked) best.click();
    return 'filled';
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function realClick(el) {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      el.dispatchEvent(new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true, view: window }));
    }
    el.click();
  }

  // Workday, Ashby and others use a button that opens a list instead of a
  // <select>. Open it, pick the best matching option, or close it again.
  async function fillCustomDropdowns(profile, result, overwrite) {
    const PLACEHOLDER = /^(select( one)?|choose( one)?|please select|--|\s*)$/i;
    const dropdowns = [...document.querySelectorAll('button[aria-haspopup="listbox"], [role="combobox"]:not(input)')]
      .filter((el) => isVisible(el) && !el.querySelector('input'));
    for (const el of dropdowns) {
      const current = textOf(el);
      if (!PLACEHOLDER.test(current) && !overwrite) { result.kept++; continue; }
      const q = questionFor(el).replace(current, '');
      const match = valueFor(q, profile);
      if (!match || !match.value) {
        if (el.getAttribute('aria-required') === 'true' || /required/i.test(el.getAttribute('aria-label') || '')) { mark(el, 'review', 'No saved answer for this question'); result.review.push(shortQ(q)); }
        continue;
      }
      realClick(el);
      let options = [];
      for (let i = 0; i < 10 && !options.length; i++) {
        await sleep(150);
        options = [...document.querySelectorAll('[role="option"]')].filter((o) => o.getBoundingClientRect().height > 0);
      }
      let best = null, bestScore = 0;
      for (const o of options) { const sc = optionScore(textOf(o), match.value); if (sc > bestScore) { best = o; bestScore = sc; } }
      if (best && bestScore >= 60) {
        realClick(best);
        await sleep(250);
        mark(el, 'filled', 'Filled from your profile: ' + match.key); result.filled.push(match.key);
      } else {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        document.activeElement && document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        await sleep(150);
        mark(el, 'review', 'Could not pick an option automatically'); result.review.push(shortQ(q));
      }
    }
  }

  async function fill(profile, options = {}) {
    const overwrite = !!options.overwrite;
    const doc = document;
    const result = { filled: [], review: [], kept: 0, host: location.hostname };
    const fields = [...doc.querySelectorAll('input, textarea, select')].filter(isVisible);
    const doneRadioGroups = new Set();

    for (const el of fields) {
      const type = (el.type || '').toLowerCase();
      if (['submit', 'button', 'reset', 'image', 'search', 'password'].includes(type)) continue;

      if (type === 'file') {
        const q = questionFor(el);
        mark(el.closest('div') || el, 'review', 'Attach your file here');
        result.review.push(/cover/i.test(q) ? 'Cover letter upload' : 'Resume upload');
        continue;
      }
      if (type === 'checkbox') continue; // consent boxes etc. are yours to tick

      if (type === 'radio') {
        const groupKey = el.name || questionFor(el);
        if (doneRadioGroups.has(groupKey)) continue;
        doneRadioGroups.add(groupKey);
        const radios = el.name ? fields.filter((f) => f.type === 'radio' && f.name === el.name) : [el];
        const q = questionFor(el);
        const match = valueFor(q, profile);
        if (!match || !match.value) { if (radios.some((r) => r.required)) result.review.push(shortQ(q)); continue; }
        const r = fillRadioGroup(radios, match.value);
        if (r === 'filled') { radios.forEach((x) => mark(x.parentElement || x, 'filled')); result.filled.push(match.key); }
        else result.review.push(shortQ(q));
        continue;
      }

      const q = questionFor(el);
      const match = valueFor(q, profile);
      if (!match || !match.value) {
        if (el.required || el.getAttribute('aria-required') === 'true') { mark(el, 'review', 'No saved answer for this question'); result.review.push(shortQ(q)); }
        continue;
      }
      const r = el.tagName === 'SELECT' ? fillSelect(el, match.value) : fillText(el, match.value, overwrite);
      if (r === 'filled') { mark(el, 'filled', 'Filled from your profile: ' + match.key); result.filled.push(match.key); }
      else if (r === 'kept') result.kept++;
      else { mark(el, 'review', 'Could not pick an option automatically'); result.review.push(shortQ(q)); }
    }
    await fillCustomDropdowns(profile, result, overwrite);
    return result;
  }

  function shortQ(q) {
    const first = String(q).split(' | ').find(Boolean) || 'Unlabeled field';
    return first.length > 80 ? first.slice(0, 77) + '...' : first;
  }

  function pageInfo() {
    const title = (document.querySelector('h1') && textOf(document.querySelector('h1'))) || document.title;
    const meta = document.querySelector('meta[property="og:site_name"]');
    let company = meta ? meta.content : '';
    if (!company) {
      const m = location.href.match(/(?:greenhouse\.io|lever\.co|ashbyhq\.com)\/(?:embed\/job_app\?for=)?([^/?#&]+)/) || location.hostname.match(/^([^.]+)\.(?:wd\d+\.)?myworkdayjobs\.com/);
      company = m ? m[1].replace(/[-_]/g, ' ') : location.hostname.replace(/^www\./, '').split('.')[0];
    }
    return { title: title.slice(0, 140), company, url: location.href };
  }

  globalThis.__jobAutofill = { fill, pageInfo, _valueFor: valueFor, _optionScore: optionScore };
})();
