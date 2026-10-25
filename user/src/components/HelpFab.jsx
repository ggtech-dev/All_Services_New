import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { MessageCircle, X } from 'lucide-react';
import { useSettings } from '../settings.js';
import { CallIcon, MailIcon, WhatsAppIcon, intl } from './SupportLinks.jsx';

// 💬 Help, always one tap away: a "Chat" pill in the bottom-right corner. Tapping it opens WhatsApp · Call · Mail
// (numbers / email from HQ → System settings) and turns into ✕. Above the bottom tabs on phones; hidden on checkout
// and whenever a page shows its own bottom bar (shop "View cart", Share Ride booking) so it never covers a button.
export default function HelpFab() {
  const s = useSettings();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  // not on checkout, an offer's page or Goods Transportation (their own Call · WhatsApp buttons are there)
  if (pathname.startsWith('/checkout') || pathname.startsWith('/transport') || /^\/offers\/\d+/.test(pathname)) return null;
  const wa = s.support_whatsapp || s.support_phone;
  const items = [
    wa && { key: 'whatsapp', label: 'WhatsApp', Icon: WhatsAppIcon, href: `https://wa.me/${intl(wa)}?text=${encodeURIComponent('Hi All Services, I need help.')}`, external: true },
    s.support_phone && { key: 'call', label: 'Call us', Icon: CallIcon, href: `tel:+${intl(s.support_phone)}` },
    s.support_email && { key: 'mail', label: 'Mail', Icon: MailIcon, href: `mailto:${s.support_email}?subject=${encodeURIComponent('Help with All Services')}` },
  ].filter(Boolean);
  if (!items.length) return null;

  return (
    <div className={`help-fab${open ? ' open' : ''}`}>
      {open && <button type="button" className="help-fab-scrim" aria-label="Close help" onClick={() => setOpen(false)} />}
      <ul className="help-fab-menu" id="help-fab-menu" aria-hidden={!open}>
        {items.map(({ key, label, Icon, href, external }, i) => (
          <li key={key} style={{ '--i': items.length - 1 - i }}>
            <a className={`help-fab-item ${key}`} href={href} tabIndex={open ? 0 : -1} onClick={() => setOpen(false)}
              {...(external && { target: '_blank', rel: 'noreferrer' })}>
              <span className="help-fab-label">{label}</span>
              <span className="help-fab-icon"><Icon /></span>
            </a>
          </li>
        ))}
      </ul>
      <button type="button" className="help-fab-main" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="help-fab-menu"
        aria-label={open ? 'Close help' : 'Need help? Talk to us'} title={open ? 'Close' : 'Need help? Talk to us'}>
        {open ? <X size={24} strokeWidth={2.4} /> : <><MessageCircle size={22} strokeWidth={2.3} /><span className="help-fab-word">Chat</span></>}
      </button>
    </div>
  );
}
