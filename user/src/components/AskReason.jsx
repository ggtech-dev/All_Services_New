import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '../admin/ui.jsx';

// An in-app "why?" box, used instead of the browser's prompt(): browsers can silently block prompt() (after
// "prevent this page from creating more dialogs", and in some installed apps), which made Cancel do nothing.
// const [askReason, reasonBox] = useAskReason();  …  const reason = await askReason({ title, required });  (null = closed)
export function useAskReason() {
  const [open, setOpen] = useState(null); // { title, text, placeholder, okText, required }
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const done = useRef(null);

  const ask = (opts) => new Promise((resolve) => {
    done.current = resolve;
    setValue('');
    setError('');
    setOpen(opts);
  });
  const finish = (result) => {
    setOpen(null);
    done.current?.(result);
    done.current = null;
  };
  const submit = (e) => {
    e.preventDefault();
    if (open.required && !value.trim()) return setError('Please write the reason');
    finish(value.trim());
  };

  // drawn on <body>, so it sits above everything (page animations make their own layers)
  const box = open && createPortal(
    <Modal
      title={open.title}
      onClose={() => finish(null)}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={() => finish(null)}>{open.cancelText || 'Go back'}</button>
        <button className="btn btn-primary" form="ask-reason-form">{open.okText || 'OK'}</button>
      </>}
    >
      <form id="ask-reason-form" className="stack" onSubmit={submit}>
        {open.text && <p className="muted small">{open.text}</p>}
        <label>{open.required ? 'Reason *' : 'Reason (optional)'}
          <textarea rows={3} maxLength={300} autoFocus value={value} placeholder={open.placeholder || ''}
            onChange={(e) => { setValue(e.target.value); setError(''); }} />
        </label>
        {error && <div className="alert">{error}</div>}
      </form>
    </Modal>,
    document.body
  );
  return [ask, box];
}
