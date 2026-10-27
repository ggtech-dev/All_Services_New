import { useState } from 'react';
import { api } from '../api.js';
import { timeAgo, useLoad } from '../admin/ui.jsx';

// 🔎 What customers ask for, city by city: words searched with nothing found, and items customers wrote themselves
// (Shop For Me, Instant "Others", Village "Other things", own lists). The most asked first — ideas for new services
// and products in that city. Only the words are kept (no names or phone numbers).
const PERIODS = [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 3 months'], [365, 'Last year']];

export default function Demand() {
  const [city, setCity] = useState('');
  const [days, setDays] = useState(30);
  const cities = useLoad(() => api('/super/franchise-options'));
  const data = useLoad(() => api(`/super/demand?days=${days}${city ? `&franchise=${city}` : ''}`), [city, days]);
  const d = data.data;
  const all = !city;
  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        What customers looked for — so you know what to add next in each city. <b>Searched but not found</b>: words people searched and got nothing.
        <b> Written by customers</b>: things people typed themselves (Shop For Me, “Others”, own lists). The most asked are on top.
        Only the words are kept — no names or phone numbers.
      </p>
      <div className="toolbar">
        <select value={city} onChange={(e) => setCity(e.target.value)} aria-label="City">
          <option value="">All cities</option>
          {(cities.data || []).map((c) => <option key={c.id} value={c.id}>{c.city} ({c.code})</option>)}
        </select>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {data.error && <div className="alert">{data.error}</div>}
      {!d ? <div className="center-block"><div className="spinner" /></div> : (
        <>
          <div className="stat-row">
            <div className="panel stat"><b>{d.summary.searches}</b><small>Searches with nothing found</small></div>
            <div className="panel stat"><b>{d.summary.words}</b><small>Different words</small></div>
            <div className="panel stat"><b>{d.summary.written}</b><small>Items written by customers</small></div>
            <div className="panel stat"><b>{d.summary.items}</b><small>Different items</small></div>
          </div>

          <section className="panel">
            <h3 style={{ marginTop: 0 }}>🔎 Searched but not found</h3>
            {d.misses.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Customers searched</th><th>Times</th>{all && <th>City</th>}<th>Last</th></tr></thead>
                  <tbody>
                    {d.misses.map((m) => (
                      <tr key={m.term}><td><b>{m.term}</b></td><td>{m.times}</td>{all && <td>{m.cities}</td>}<td>{timeAgo(m.last_at)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted">Nothing yet — every search found something.</p>}
          </section>

          <section className="panel">
            <h3 style={{ marginTop: 0 }}>✍️ Written by customers</h3>
            {d.written.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Item</th><th>Times</th><th>Where they wrote it</th>{all && <th>City</th>}<th>Last</th></tr></thead>
                  <tbody>
                    {d.written.map((w) => (
                      <tr key={w.item}><td><b>{w.item}</b></td><td>{w.times}</td><td className="small">{w.shops}</td>{all && <td>{w.cities}</td>}<td>{timeAgo(w.last_at)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted">No written items in this period.</p>}
          </section>
        </>
      )}
    </div>
  );
}
