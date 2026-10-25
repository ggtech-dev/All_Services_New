import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Search } from 'lucide-react';
import { api } from '../api.js';
import { searchAlso } from '../searchWords.js';
import Skeleton from '../components/Skeleton.jsx';
import { CategoryIcon } from '../components/icons.jsx';

// 🔍 Search from the home page: services (plumber, water tanker, kirana…) and items (rice, tomato, bulb…).
// Categories with a page of their own (Share Ride, Daily Workers, Digital Services) open that page.
const OWN_PAGE = ['share-ride', 'daily-workers', 'digital-services'];
const serviceLink = (s) =>
  s.category_slug === 'tomorrow-food' ? '/meal' // 🍱 tomorrow's menu
  : s.category_slug === 'offers' ? '/offers' // 📢 local shops' offers
  : s.category_slug === 'goods-transport' ? '/transport' // 🚚 goods vehicles
    : OWN_PAGE.includes(s.category_slug) ? `/category/${s.category_slug}`
    : s.type_count > 0 ? `/care/${s.slug}`
    : s.product_count > 0 || s.allows_list ? `/service/${s.slug}`
    : `/checkout?service=${s.slug}`;

export default function SearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const term = params.get('q') || '';
  const [q, setQ] = useState(term);
  const [res, setRes] = useState(null);

  useEffect(() => {
    setQ(term);
    if (term.trim().length < 2) return setRes({ services: [], products: [] });
    setRes(null);
    // Telugu / Hindi / spoken-Telugu words also search the English names they stand for
    const also = searchAlso(term);
    api(`/search?q=${encodeURIComponent(term)}${also.length ? `&also=${encodeURIComponent(also.join('|'))}` : ''}`).then(setRes).catch(() => setRes({ services: [], products: [] }));
  }, [term]);

  const submit = (e) => {
    e.preventDefault();
    if (q.trim().length >= 2) navigate(`/search?q=${encodeURIComponent(q.trim())}`, { replace: true });
  };
  const none = res && !res.services.length && !res.products.length;

  return (
    <div className="search-page">
      <Link to="/" className="back-link">← Home</Link>
      <form className="home-search" onSubmit={submit} role="search">
        <Search size={18} aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search water, kirana, plumber, cars…" aria-label="Search" autoFocus enterKeyHint="search" />
      </form>
      {!res ? <Skeleton variant="list" /> : none ? (
        <div className="empty-state">
          <div className="empty-icon">🔍</div>
          <h3>Nothing found for “{term}”</h3>
          <p className="muted">Try another word — or use <Link to="/category/shop-for-me" className="link">Shop For Me</Link> and write what you need.</p>
        </div>
      ) : (
        <>
          {res.services.length > 0 && (
            <section className="search-group">
              <h2>Services</h2>
              {res.services.map((s) => (
                <Link key={s.slug} to={serviceLink(s)} className="search-row">
                  <CategoryIcon slug={s.category_slug} size={44} />
                  <span className="search-text"><b>{s.name}</b><small>{s.category_name}</small></span>
                  <ChevronRight size={18} className="search-go" />
                </Link>
              ))}
            </section>
          )}
          {res.products.length > 0 && (
            <section className="search-group">
              <h2>Items</h2>
              {res.products.map((p, i) => (
                <Link key={`${p.service_slug}-${p.name}-${i}`} to={`/service/${p.service_slug}`} className="search-row">
                  <span className="search-text">
                    <b>{p.name}{p.brand ? ` · ${p.brand}` : ''}</b>
                    <small>{p.service_name} · {p.unit}</small>
                  </span>
                  <span className="search-price">{p.price_on_bill ? 'Market price' : `₹${Number(p.price).toLocaleString('en-IN')}`}</span>
                  <ChevronRight size={18} className="search-go" />
                </Link>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
