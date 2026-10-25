import { api } from '../api.js';
import { PriceCell, useLoad, useToast } from '../admin/ui.jsx';

// 💰 Food & cook prices — HQ sets, for each city, the price of the tomorrow's-meal plates and of Book Your Cook
// (server: db/homefood.sql fn_home_food_prices / sp_set_home_food_price). A city without its own price uses the
// default (the master product price; the cook rates from System settings). Franchises ask for changes in Requests to HQ.
const ITEMS = [
  ['veg', '🥗 Veg meal', 'per plate'], ['chicken', '🍗 Chicken meal', 'per plate'], ['mutton', '🍖 Mutton meal', 'per plate'],
  ['fish', '🐟 Fish meal', 'per plate'], ['cook_hour', '👩‍🍳 Cook', 'per hour'], ['cook_half', '👩‍🍳 Cook', 'each extra ½ hour'],
];

export default function FoodPrices() {
  const toast = useToast();
  const data = useLoad(() => api('/super/home-food-prices'));
  const rows = data.data;
  if (!rows) return data.error ? <div className="alert">{data.error}</div> : <div className="center-block"><div className="spinner" /></div>;

  const save = async (f, item, price, msg) => {
    await api(`/super/home-food-prices/${f.franchise_id}`, { method: 'PUT', body: { item, price } });
    toast(msg);
    data.reload();
  };
  const name = (item) => ITEMS.find((i) => i[0] === item)?.[1];

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        Prices customers pay in each city for <b>Order Your Food for Tomorrow</b> (lunch and dinner are the same price) and
        <b> Book Your Cook</b> (e.g. 1½ hours = 1 hour + 1 extra half hour). Click a price to change it.
        Prices in <span className="own">blue</span> are the city's own; the others follow the default.
      </p>
      <div className="panel panel-pad">
        <div className="table-scroll">
          <table className="table food-prices">
            <thead><tr><th>City</th>{ITEMS.map(([k, label, unit]) => <th key={k}>{label}<br /><small className="muted">{unit}</small></th>)}</tr></thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.franchise_id}>
                  <td><b>{f.city}</b></td>
                  {ITEMS.map(([k]) => {
                    const p = f.prices[k];
                    return (
                      <td key={k} className={p.own ? 'own' : ''}>
                        <PriceCell value={p.price} onSave={(v) => save(f, k, v, `${name(k)} in ${f.city}: ₹${Number(v)}`)} />
                        {p.own && Number(p.price) !== Number(p.default) && (
                          <button className="link-btn small" onClick={() => save(f, k, null, `${name(k)} in ${f.city}: back to ₹${Number(p.default)}`)}
                            title={`Default ₹${Number(p.default)}`}>reset to ₹{Number(p.default)}</button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={ITEMS.length + 1} className="muted">No active franchises.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
