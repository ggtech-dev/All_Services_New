import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import PhoneLogin from '../components/PhoneLogin.jsx';
import { VEHICLES } from '../orderStatus.jsx';
import { cityOf, useSettings } from '../settings.js';

// Also used by the admin "Add agent" form (with docsRequired=false and a custom submit).
export const AGENT_DOCS = [
  { field: 'aadhaar_doc', label: 'Aadhaar card', hint: 'Front side, all 12 digits visible' },
  { field: 'pan_doc', label: 'PAN card' },
  { field: 'dl_doc', label: 'Driving licence' },
  { field: 'photo_doc', label: 'Your photo', hint: 'Optional, clear face photo', optional: true },
];
// 🚗 Share Ride car owners: the car's papers (checked by the franchise admin). Only commercial (yellow-board) cars.
export const CAR_DOCS = [
  { field: 'rc_doc', label: 'RC (registration)', hint: 'Both sides in one photo, or a PDF' },
  { field: 'permit_doc', label: 'Taxi / contract-carriage permit' },
  { field: 'insurance_doc', label: 'Insurance (valid)' },
  { field: 'car_photo', label: 'Car photo', hint: 'Optional — front with the number plate', optional: true },
];

// Car model, number, colour and papers. car = { car_model_id, reg_number, car_color, yellow_board }, files: { rc_doc… }
export function CarFields({ car, setCar, files, setFiles, legend = 'Your car' }) {
  const [models, setModels] = useState([]);
  useEffect(() => {
    api('/share-ride/models').then(setModels).catch(() => {});
  }, []);
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="form-row">
        <label>Car model *
          <select value={car.car_model_id} onChange={(e) => setCar({ ...car, car_model_id: e.target.value })} required>
            <option value="">Choose…</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label>Car number *<input value={car.reg_number} onChange={(e) => setCar({ ...car, reg_number: e.target.value.toUpperCase().slice(0, 16) })} required placeholder="TS36T1234" /></label>
        <label>Colour<input value={car.car_color} onChange={(e) => setCar({ ...car, car_color: e.target.value.slice(0, 30) })} placeholder="White" /></label>
      </div>
      <small className="muted">Car model not in the list? Choose the closest one and tell your franchise admin — they can add it.</small>
      <label className="check-line">
        <input type="checkbox" checked={car.yellow_board} onChange={(e) => setCar({ ...car, yellow_board: e.target.checked })} />
        <span>My car has a <b>yellow (commercial) number plate</b> and a valid permit to carry passengers. *</span>
      </label>
      <div className="doc-grid">
        {CAR_DOCS.map((d) => (
          <DocInput key={d.field} doc={d} required={!d.optional} file={files[d.field]} onChange={(f) => setFiles({ ...files, [d.field]: f })} />
        ))}
      </div>
    </fieldset>
  );
}

// Chip picker for the types of work an agent does. Used by the application form and the admin agent page.
export function SkillPicker({ types, value, onChange }) {
  const toggle = (code) => onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
  return (
    <div className="skill-picker">
      {types.map((t) => (
        <button type="button" key={t.code} className={value.includes(t.code) ? 'active' : ''} onClick={() => toggle(t.code)} aria-pressed={value.includes(t.code)}>
          <span>{t.icon}</span> {t.name}{t.subscription && <span className="skill-sub" title="Subscription">💳</span>}
        </button>
      ))}
      {/* types of work with subscription-only services: tell the agent before they apply */}
      {types.filter((t) => t.subscription && value.includes(t.code)).map((t) => (
        <p key={t.code} className="skill-sub-note">
          💳 <b>{t.name}</b> orders need a subscription: {t.subscription.map((x) => `${x.service} ₹${Number(x.fee).toLocaleString('en-IN')} / ${x.days} days`).join(', ')}.
          The admin calls about the payment and switches it on.
        </p>
      ))}
    </div>
  );
}

// The agent logs in with the mobile number (+ OTP), so there is no username, password or email here.
// verified = { phone, proof } when the number was already checked by OTP (public application): shown locked.
// ownerType 'car': a 🚗 Share Ride car owner — no types of work or vehicle; the car and its papers instead.
export function AgentForm({ docsRequired = true, submitLabel, onSubmit, verified = null, ownerType = 'work' }) {
  const isCar = ownerType === 'car';
  const [car, setCar] = useState({ car_model_id: '', reg_number: '', car_color: '', yellow_board: false });
  const [localities, setLocalities] = useState([]);
  const [types, setTypes] = useState([]);
  const [skills, setSkills] = useState(['delivery']);
  const [form, setForm] = useState({
    full_name: '', phone: verified?.phone || '', vehicle_type: 'bike', vehicle_number: '',
    locality_id: '', aadhaar_number: '', pan_number: '', dl_number: '',
  });
  const [files, setFiles] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/localities').then(setLocalities).catch(() => {});
  }, []);
  // types of work, with the subscription terms of the chosen area's city (each franchise sets its own)
  const areaCity = localities.find((l) => String(l.id) === String(form.locality_id))?.franchise_id;
  useEffect(() => {
    api(`/service-types${areaCity ? `?franchise=${areaCity}` : ''}`).then(setTypes).catch(() => {});
  }, [areaCity]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!isCar && !skills.length) return setError('Choose at least one type of work');
    if (isCar && !car.yellow_board) return setError('Only commercial (yellow number plate) cars can carry paying passengers');
    const fd = new FormData();
    (isCar ? ['shared_car_agent'] : skills).forEach((s) => fd.append('skills', s));
    if (isCar) {
      fd.append('owner_type', 'car');
      Object.entries(car).forEach(([k, v]) => fd.append(k, String(v)));
    }
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    Object.entries(files).forEach(([k, f]) => f && fd.append(k, f));
    if (verified) fd.append('phone_proof', verified.proof);
    setBusy(true);
    try {
      await onSubmit(fd);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form className="form agent-form" onSubmit={submit}>
      <fieldset>
        <legend>1. Your details</legend>
        <div className="form-row">
          <label>Full name (as on Aadhaar) *<input value={form.full_name} onChange={set('full_name')} required /></label>
          <label>
            Mobile number * {verified && <span className="verified">✓ Verified</span>}
            <input value={form.phone} onChange={set('phone')} required inputMode="tel" placeholder="10-digit mobile — the agent's login" readOnly={!!verified} />
          </label>
        </div>
        <div className="form-row">
          <label>
            City & area you'll work in
            <select value={form.locality_id} onChange={set('locality_id')}>
              <option value="">Choose area…</option>
              {/* areas grouped by city: the city decides which franchise the agent works for */}
              {[...new Set(localities.map((l) => l.city || ''))].map((city) => {
                const opts = localities.filter((l) => (l.city || '') === city).map((l) => <option key={l.id} value={l.id}>{l.name}</option>);
                return city ? <optgroup key={city} label={city}>{opts}</optgroup> : opts;
              })}
            </select>
          </label>
        </div>
      </fieldset>

      {isCar ? <CarFields car={car} setCar={setCar} files={files} setFiles={setFiles} legend="2. Your car (commercial / yellow board)" /> : <>
      <fieldset>
        <legend>2. What work will you do? *</legend>
        <small className="muted">You will only get orders for the types you choose. Pick all that apply.</small>
        <SkillPicker types={types} value={skills} onChange={setSkills} />
      </fieldset>

      <fieldset>
        <legend>3. Vehicle</legend>
        <div className="form-row">
          <label>
            Vehicle type *
            <select value={form.vehicle_type} onChange={set('vehicle_type')}>
              {Object.entries(VEHICLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Vehicle number<input value={form.vehicle_number} onChange={set('vehicle_number')} placeholder="TS09 AB 1234" /></label>
        </div>
      </fieldset>
      </>}

      <fieldset>
        <legend>{isCar ? '3. Your documents' : '4. Documents'}</legend>
        <div className="form-row">
          <label>Aadhaar number {docsRequired && '*'}<input value={form.aadhaar_number} onChange={set('aadhaar_number')} required={docsRequired} inputMode="numeric" placeholder="1234 5678 9012" /></label>
          <label>PAN number {docsRequired && '*'}<input value={form.pan_number} onChange={set('pan_number')} required={docsRequired} placeholder="ABCDE1234F" style={{ textTransform: 'uppercase' }} /></label>
          <label>Driving licence no. {docsRequired && '*'}<input value={form.dl_number} onChange={set('dl_number')} required={docsRequired} placeholder="TS0920190012345" style={{ textTransform: 'uppercase' }} /></label>
        </div>
        <div className="doc-grid">
          {AGENT_DOCS.map((d) => (
            <DocInput key={d.field} doc={d} required={docsRequired && !d.optional} file={files[d.field]} onChange={(f) => setFiles({ ...files, [d.field]: f })} />
          ))}
        </div>
        <small className="muted">🔒 Documents are stored privately and only seen by our verification team. We keep only the last 4 digits of your Aadhaar number.</small>
      </fieldset>

      <p className="muted small">📱 Login for the agent app: this mobile number + an OTP by SMS (after approval).</p>

      {error && <div className="alert">{error}</div>}
      <button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : submitLabel}</button>
    </form>
  );
}

export function DocInput({ doc, required, file, onChange }) {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <label className={`doc-input ${file ? 'has-file' : ''}`}>
      <span className="doc-preview">
        {preview ? <img src={preview} alt="" /> : <span>{file ? '📄' : '📤'}</span>}
      </span>
      <span className="doc-text">
        <b>{doc.label}{required && ' *'}</b>
        <small className="muted">{file ? file.name : doc.hint || 'JPG, PNG or PDF, max 5 MB'}</small>
      </span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        required={required && !file}
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
    </label>
  );
}

// Public page: /agent/apply — share this link with people who want to deliver for us.
export default function AgentApply() {
  const [done, setDone] = useState(false);
  const [verified, setVerified] = useState(null); // { phone, proof } after the OTP check (step 1)
  const [ownerType, setOwnerType] = useState(''); // 'work' (deliveries & services) or 'car' (🚗 Share Ride car owner)
  const settings = useSettings();

  return (
    <div className="apply-page">
      <header className="apply-hero">
        <Link to="/login" className="brand brand-lg"><span className="brand-logo" translate="no" aria-hidden="true">A<span>S</span></span><span className="brand-name" translate="no">All <em>Services</em></span></Link>
        <h1>Work with All Services 🛵🔧⚡</h1>
        <p>Delivery partners, plumbers, electricians, technicians, cleaners and more — earn on every job across {cityOf(settings).split(',')[0]}. Choose your own hours, get paid to your wallet, work near home.</p>
        <div className="hero-chips">
          <span className="chip">💰 Earn per job</span>
          <span className="chip">🕒 Flexible hours</span>
          <span className="chip">📍 Work in your area</span>
        </div>
      </header>

      <main className="apply-card">
        {done ? (
          <div className="empty-state">
            <div className="empty-icon">✅</div>
            <h2>Application submitted!</h2>
            <p className="muted">Your city's franchise admin will check your details and documents{ownerType === 'car' ? ' and your car papers' : ''}, usually within 24–48 hours. Once approved, log in with your mobile number <b>+91 {verified?.phone}</b> and an OTP.</p>
            {ownerType === 'car' && <p className="muted small">🚗 Share Ride needs a subscription: your franchise admin will call you about it. Your journeys are shown to customers once your car is approved and the subscription is active.</p>}
            <Link to="/login?as=agent" className="btn btn-primary">Go to agent login</Link>
          </div>
        ) : (
          <>
            <h2>Apply to join as an agent</h2>
            <p className="muted">First check your mobile number, then tell us what work you do, fill in your details and upload your documents. Fields marked * are required.</p>
            {!verified ? (
              <fieldset className="form">
                <legend>Step 1. Your mobile number</legend>
                <PhoneLogin
                  portal="agent_apply"
                  submitLabel="Verify number"
                  login={async (path, body) => {
                    const d = await api(path, { method: 'POST', body });
                    setVerified({ phone: d.phone, proof: d.proof });
                  }}
                />
              </fieldset>
            ) : !ownerType ? (
              <fieldset className="form">
                <legend>Step 2. How will you work with us?</legend>
                <div className="owner-type">
                  <button type="button" onClick={() => setOwnerType('work')}>
                    <span>🛵🔧</span><b>Deliveries & services</b><small>Delivery, plumber, electrician, cleaning, events…</small>
                  </button>
                  <button type="button" onClick={() => setOwnerType('car')}>
                    <span>🚗</span><b>Share Ride car owner</b><small>I own a commercial (yellow-board) car and go between towns — sell seats</small>
                  </button>
                </div>
              </fieldset>
            ) : (
            <AgentForm
              ownerType={ownerType}
              verified={verified}
              submitLabel="Submit application"
              onSubmit={async (fd) => {
                await api('/agents/apply', { method: 'POST', body: fd });
                setDone(true);
                window.scrollTo(0, 0);
              }}
            />
            )}
            <p className="switch">Already approved? <Link to="/login?as=agent">Agent login</Link></p>
          </>
        )}
      </main>
    </div>
  );
}
