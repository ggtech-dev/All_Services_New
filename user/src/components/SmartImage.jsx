import { useState } from 'react';

// Shows the photo, or a colored tile with an emoji if the image can't load (offline, blocked, etc.).
// Photo credits are not drawn on the photo: they are all listed on the Photo credits page (/credits).
export default function SmartImage({ src, alt, fallbackIcon, color }) {
  const [failed, setFailed] = useState(!src);
  if (failed) {
    return (
      <div className="img-fallback" style={{ background: `linear-gradient(135deg, ${color}, ${color}99)` }}>
        <span>{fallbackIcon}</span>
      </div>
    );
  }
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}
