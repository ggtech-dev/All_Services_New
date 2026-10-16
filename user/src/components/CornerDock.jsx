import { InstallButton } from './InstallApp.jsx';
import LangToggle from './LangToggle.jsx';

// Small floating box in the bottom-left corner: language (A · అ) and "Install app" — keeps the top bar uncluttered.
export default function CornerDock() {
  return (
    <div className="corner-dock">
      <LangToggle />
      <InstallButton className="dock-install" label={<>📲 <span className="dock-label">Install app</span></>} />
    </div>
  );
}
