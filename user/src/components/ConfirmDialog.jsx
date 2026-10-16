import { createRoot } from 'react-dom/client';
import { Modal } from '../admin/ui.jsx';

// An in-app "Are you sure?" box, used instead of the browser's confirm(): browsers can silently block confirm()
// (after "prevent this page from creating more dialogs", and in some installed apps), which would make the button
// do nothing. Usage:  if (await askConfirm('Mark order #12 as delivered?', { okText: 'Yes, delivered' })) …
export function askConfirm(message, { title = 'Please confirm', okText = 'Yes', cancelText = 'No' } = {}) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (answer) => {
      root.unmount();
      host.remove();
      resolve(answer);
    };
    root.render(
      <Modal
        title={title}
        onClose={() => done(false)}
        footer={<>
          <button type="button" className="btn btn-ghost" onClick={() => done(false)}>{cancelText}</button>
          <button type="button" className="btn btn-primary" autoFocus onClick={() => done(true)}>{okText}</button>
        </>}
      >
        <p className="confirm-text">{message}</p>
      </Modal>
    );
  });
}
