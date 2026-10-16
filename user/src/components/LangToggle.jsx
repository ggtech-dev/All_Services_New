import { LANGS, getLang, setLang } from '../i18n.js';

// Language switch: two small round buttons — A (English) · అ (తెలుగు). English is the default.
export default function LangToggle({ className = '' }) {
  const current = getLang();
  return (
    <div className={`lang-toggle ${className}`} role="radiogroup" aria-label="Language" translate="no">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          role="radio"
          aria-checked={current === l.code}
          className={current === l.code ? 'on' : ''}
          title={l.label}
          aria-label={l.label}
          onClick={() => current !== l.code && setLang(l.code)}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}
