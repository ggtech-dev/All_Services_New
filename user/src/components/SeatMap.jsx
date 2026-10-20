// 🚗 Share Ride seat map, drawn from the car model's real layout (rows from front to back; S = seat, D = driver,
// _ = gap/aisle). Seat code = "<row>-<column>", the same as the server (db/share_ride.sql fn_layout_seats).
// Used by customers (pick seats), car owners (mark seats "not for sale", see who booked) and admins (view).
//   layout:   [{ name: 'Front', cells: 'S_D' }, …]
//   prices:   price per row (same order as layout) — shown on each seat
//   taken:    seat codes already booked / held      blocked: seat codes the owner does not sell
//   selected: seat codes chosen now                 onToggle(code): tap on a free seat (no onToggle = view only)
//   names:    { code: 'Ravi' } — who sits there (owner view)
export default function SeatMap({ layout = [], prices = [], taken = [], blocked = [], selected = [], onToggle, names = {}, blockMode = false }) {
  const rupee = (n) => (n == null ? '' : `₹${Number(n).toLocaleString('en-IN')}`);
  return (
    <div className="seatmap" role="group" aria-label="Seat map">
      <div className="seatmap-front">▲ Front of the car</div>
      {layout.map((row, r) => (
        <div className="seat-row" key={r}>
          <span className="seat-row-name">{row.name}</span>
          <div className="seat-cells">
            {[...row.cells].map((ch, c) => {
              const code = `${r + 1}-${c + 1}`;
              if (ch === 'D') return <span key={code} className="seat seat-driver" title="Driver">🚘<small>Driver</small></span>;
              if (ch !== 'S') return <span key={code} className="seat seat-gap" aria-hidden="true" />;
              const isBlocked = blocked.includes(code);
              const isTaken = taken.includes(code);
              const isSel = selected.includes(code);
              const state = isSel ? 'sel' : isBlocked ? 'blocked' : isTaken ? 'taken' : 'free';
              // owners in "not for sale" mode may toggle any seat that is not booked
              const canTap = onToggle && (blockMode ? !isTaken : !isBlocked && !isTaken);
              const window = c === 0 || c === row.cells.length - 1;
              return (
                <button
                  type="button" key={code} className={`seat seat-${state}`} disabled={!canTap}
                  onClick={() => canTap && onToggle(code)} aria-pressed={isSel}
                  aria-label={`${row.name} seat ${c + 1}${window ? ', window' : ''}: ${state === 'free' ? 'free' : state === 'sel' ? 'chosen' : state === 'blocked' ? 'not for sale' : 'booked'}`}
                >
                  <span className="seat-icon">{state === 'blocked' ? '✖' : state === 'taken' ? '👤' : window ? '🪟' : '💺'}</span>
                  <small>{names[code] ? names[code].split(' ')[0] : state === 'blocked' ? 'Not for sale' : state === 'taken' ? 'Booked' : rupee(prices[r])}</small>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="seat-legend">
        <span><i className="seat-dot free" /> Free</span>
        <span><i className="seat-dot sel" /> {blockMode ? 'Not for sale' : 'Your choice'}</span>
        <span><i className="seat-dot taken" /> Booked</span>
        <span>🪟 Window</span>
      </div>
    </div>
  );
}
