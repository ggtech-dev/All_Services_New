import { DICT, PATTERNS } from './i18n-dict.js';

// App language: English (default) or Telugu — for the customer and agent apps.
// The screens are written in English; when Telugu is chosen, every text shown on the page (and pop-up questions)
// is replaced from the dictionary in i18n-dict.js as it appears. Anything inside translate="no" (admin / HQ pages,
// people's names typed by users…) is left as it is. Changing the language reloads the page once.
export const LANGS = [
  { code: 'en', label: 'English', short: 'A' },
  { code: 'te', label: 'తెలుగు', short: 'అ' },
];
const KEY = 'as_lang';
const COL = { te: 0 }; // column of the translation in i18n-dict.js

export function getLang() {
  try {
    const l = localStorage.getItem(KEY);
    return COL[l] !== undefined ? l : 'en';
  } catch {
    return 'en';
  }
}

export function setLang(code) {
  try {
    if (code === 'en') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, code);
  } catch {
    /* storage blocked: stays English */
  }
  window.location.reload();
}

const lang = getLang();
const col = COL[lang];

// "🛒 Shop now →" → "🛒" + "Shop now" + " →": translate the words, keep the emoji and arrows.
const EDGES = /^([^\p{L}\p{N}]*)([\s\S]*?)([^\p{L}\p{N}]*)$/u;
const LEAD = /^[^\p{L}\p{N}]+/u;
export function tr(text) {
  if (col === undefined || !text || !/[A-Za-z]/.test(text)) return text;
  const lead = text.match(/^\s*/)[0];
  const tail = text.match(/\s*$/)[0];
  const core = text.trim().replace(/\s+/g, ' '); // pop-up questions may contain line breaks
  const exact = DICT[core];
  if (exact) return lead + exact[col] + tail;
  // "🔒 Documents are … number." → keep the emoji, the sentence keeps its own full stop / ! / ?
  const icon = core.match(LEAD)?.[0];
  if (icon && DICT[core.slice(icon.length)]) return lead + icon + DICT[core.slice(icon.length)][col] + tail;
  // "Regular agents / Home services", "🛵 Regular agents, 🏠 Home services": translate each part
  const parts = core.split(/( \/ |, )/);
  if (parts.length > 1) {
    const done = parts.map((p, i) => (i % 2 ? p : tr(p)));
    if (done.every((p, i) => i % 2 || p !== parts[i] || !/[A-Za-z]/.test(p))) return lead + done.join('') + tail;
  }
  const m = core.match(EDGES);
  if (m && m[2]) {
    const inner = DICT[m[2]];
    if (inner) return lead + m[1] + inner[col] + m[3] + tail;
    for (const [re, out] of PATTERNS) {
      const p = m[2].match(re);
      if (p) return lead + m[1] + out[col](p) + m[3] + tail;
    }
  }
  for (const [re, out] of PATTERNS) {
    const p = core.match(re);
    if (p) return lead + out[col](p) + tail;
  }
  return text;
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'CODE', 'NOSCRIPT']);
const ATTRS = ['placeholder', 'title', 'aria-label'];
const skipped = (el) => !el || SKIP.has(el.tagName) || !!el.closest?.('[translate="no"]');
// hints in input boxes (placeholder…) are translated; what people type is never touched
const attrSkipped = (el) => !el || !!el.closest?.('[translate="no"]');

function doText(node) {
  if (skipped(node.parentElement)) return;
  const t = tr(node.nodeValue);
  if (t !== node.nodeValue) node.nodeValue = t;
}
function doAttrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (v) {
      const t = tr(v);
      if (t !== v) el.setAttribute(a, t);
    }
  }
}
function walk(root) {
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType !== 1) return;
  if (!attrSkipped(root)) doAttrs(root);
  if (skipped(root)) return;
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = it.nextNode(); n; n = it.nextNode()) {
    if (n.nodeType === 3) doText(n);
    else if (!attrSkipped(n)) doAttrs(n);
  }
}

export function startTranslation() {
  document.documentElement.lang = lang === 'en' ? 'en-IN' : `${lang}-IN`;
  if (col === undefined) return;
  document.documentElement.classList.add(`lang-${lang}`);
  // pop-up questions too
  const { confirm, alert, prompt } = window;
  window.confirm = (msg) => confirm.call(window, tr(String(msg ?? '')));
  window.alert = (msg) => alert.call(window, tr(String(msg ?? '')));
  window.prompt = (msg, def) => prompt.call(window, tr(String(msg ?? '')), def);
  const run = () => {
    walk(document.body);
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') { if (!attrSkipped(m.target)) doAttrs(m.target); }
        else m.addedNodes.forEach(walk);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  };
  if (document.body) run();
  else document.addEventListener('DOMContentLoaded', run);
}

// For texts built in code that never reach the page as text (e.g. phone notifications shown by the app).
export const t = tr;
