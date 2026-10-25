import { useState } from 'react';
import { isIOS, useInstall, useOnline } from '../pwa.js';

const DISMISS_KEY = 'as_install_dismissed';
const dismissedRecently = () => {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < 30 * 864e5; // closed with ✕: ask again after 30 days
  } catch {
    return false;
  }
};
const isAndroid = () => /android/i.test(navigator.userAgent);
const secure = () => window.isSecureContext;

// One tap where the browser allows it (Chrome / Edge / Android); otherwise show the steps for this device.
function useInstallAction() {
  const app = useInstall();
  const [steps, setSteps] = useState(false);
  const run = async () => (app.canPrompt ? app.prompt() : (setSteps(true), false));
  const modal = steps ? <InstallSteps onClose={() => setSteps(false)} /> : null;
  return { app, run, modal };
}

// "📲 Install the app" — always visible until the app is installed.
export function InstallButton({ className = 'btn btn-ghost btn-block', label = '📲 Install the app' }) {
  const { app, run, modal } = useInstallAction();
  if (app.installed) return className.includes('btn-block') ? <p className="muted small center">✓ You're using the installed app.</p> : null;
  return (
    <>
      <button type="button" className={className} onClick={run} title="Install All Services on this phone / computer">{label}</button>
      {modal}
    </>
  );
}

// A slim bar on the home screen, offered once (again after 30 days if closed).
export function InstallBanner({ who = 'customer' }) {
  const { app, run, modal } = useInstallAction();
  const [hidden, setHidden] = useState(dismissedRecently);
  if (hidden || app.installed) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* storage blocked: just hide for now */
    }
    setHidden(true);
  };
  // one slim line: icon · "Get the All Services app" · Install · ✕
  return (
    <div className="install-bar" role="region" aria-label="Install the app">
      <img src="/icons/icon-192.png" alt="" width="30" height="30" />
      <p className="install-bar-text">
        <b>Get the All Services app</b>
        <span className="install-bar-sub">{who === 'agent' ? 'New orders faster' : 'Faster ordering, right from your home screen'}</span>
      </p>
      <button type="button" className="install-bar-btn" onClick={async () => (await run()) && setHidden(true)}>Install</button>
      <button type="button" className="install-bar-close" onClick={dismiss} aria-label="Not now"><span aria-hidden="true">✕</span></button>
      {modal}
    </div>
  );
}

// Steps when the browser has no one-tap install (iPhone, or the browser hasn't offered it yet).
function InstallSteps({ onClose }) {
  const ios = isIOS();
  const android = isAndroid();
  return (
    <div className="qr-scanner" role="dialog" aria-label="Install the app" onClick={onClose}>
      <div className="company-qr-sheet" onClick={(e) => e.stopPropagation()}>
        <img src="/icons/icon-192.png" alt="" width="64" height="64" style={{ alignSelf: 'center' }} />
        <h3 style={{ margin: 0 }}>Install All Services</h3>
        {!secure() && <p className="alert small">Installing needs the secure link (https://…). Open the app from the link we shared.</p>}
        <ol className="ios-steps">
          {ios ? (
            <>
              <li>Open this page in <b>Safari</b>.</li>
              <li>Tap <b>Share</b> <span aria-hidden="true">⬆️</span> at the bottom of the screen.</li>
              <li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
            </>
          ) : android ? (
            <>
              <li>Open this page in <b>Chrome</b>.</li>
              <li>Tap the menu <b>⋮</b> (top right).</li>
              <li>Tap <b>Install app</b> (or <b>Add to Home screen</b>), then <b>Install</b>.</li>
            </>
          ) : (
            <>
              <li>Use <b>Chrome</b> or <b>Edge</b>.</li>
              <li>Click the <b>install icon</b> at the right end of the address bar (a screen with a ⬇ arrow).</li>
              <li>Or open the menu <b>⋮</b> → <b>Cast, save and share</b> → <b>Install page as app</b> (Edge: <b>⋯</b> → <b>Apps</b> → <b>Install this site as an app</b>).</li>
            </>
          )}
        </ol>
        <small className="muted">The app gets its own icon and opens full-screen. It's free and uses very little space.</small>
        <button type="button" className="btn btn-primary btn-block" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}

// "📤 Share the app" — WhatsApp (or any app on the phone's share sheet).
export const shareText = (url) =>
  `Order fresh vegetables, milk, meat, kirana, plumbers, electricians & more near you — delivered to your door. Install the All Services app: ${url}`;
export function ShareApp({ className = 'btn btn-ghost btn-block' }) {
  const url = window.location.origin;
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'All Services', text: shareText(''), url });
        return;
      } catch {
        /* cancelled — fall through to WhatsApp */
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText(url))}`, '_blank', 'noopener');
  };
  return <button type="button" className={className} onClick={share}>📤 Share the app on WhatsApp</button>;
}

// Thin bar at the top when the phone has no internet.
export function OfflineBar() {
  const online = useOnline();
  if (online) return null;
  return <div className="offline-bar" role="status">📡 You're offline — orders and prices need internet. We'll reconnect automatically.</div>;
}
