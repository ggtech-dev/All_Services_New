import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import Skeleton from '../components/Skeleton.jsx';

// Photo credits: many photos in the app are shared by their photographers under free (Creative Commons) licences,
// which ask for their name and licence to be shown. They are all listed here instead of on the photos.
export default function Credits() {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    api('/credits').then(setList).catch(() => setList([]));
  }, []);
  const shown = (list || []).filter((c) => `${c.credit} ${c.used_for.join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="credits-page">
      <Link to="/" className="back-link">← Home</Link>
      <h1 className="page-title">📷 Photo credits</h1>
      <p className="muted">
        Many photos in All Services are shared by photographers under free Creative Commons licences. Thank you to each of them —
        here is who took each photo and its licence.
      </p>
      <input className="search credits-search" type="search" placeholder="Search a photo, service or photographer…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!list && <Skeleton variant="list" />}
      {/* the licence texts stay exactly as the photographers wrote them */}
      <ul className="credits-list" translate="no">
        {shown.map((c) => (
          <li key={c.credit}>
            <b>{c.used_for.slice(0, 4).join(', ')}{c.used_for.length > 4 ? ` +${c.used_for.length - 4}` : ''}</b>
            <span className="small muted">{c.credit}</span>
          </li>
        ))}
      </ul>
      {list && !shown.length && <p className="muted">Nothing found.</p>}
    </div>
  );
}
