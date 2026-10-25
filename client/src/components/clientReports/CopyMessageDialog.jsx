import { useState } from 'react';
import { Button, Modal, Select } from '../ui/index.js';
import { copyMessageFor } from './copyMessage.js';
import { noUsableLinkReason, usableLinks } from './linkState.js';
import { useCopy } from './hooks.js';

// The copy-ready message (docs/PROPOSAL_CLIENT_REPORTS_UPGRADE.md §G6): for a report your client can
// see, on a link they can open. With several usable links you pick which one the message points to.
// You send it yourself; it never contains the password.

const CopyMessageDialog = ({ report, shares, onClose }) => {
  const links = usableLinks(shares);
  const [linkId, setLinkId] = useState(links[0]?.id || '');
  const link = links.find((l) => l.id === linkId) || links[0] || null;
  const { copied, copy } = useCopy();
  const text = link ? copyMessageFor({ report, link, origin: window.location.origin }) : '';
  return (
    <Modal
      size="lg"
      title="Message for your client"
      subtitle="Paste it into your own email or text. It never includes the password — send that separately."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button disabled={!link} onClick={() => copy(text, 'msg')}>
            {copied === 'msg' ? 'Copied!' : 'Copy message'}
          </Button>
        </>
      }
    >
      {!link ? (
        <p className="text-sm text-fg-muted">{noUsableLinkReason(shares)?.text}</p>
      ) : (
        <div className="space-y-3 text-sm">
          {links.length > 1 && (
            <label className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              Link
              <Select value={link.id} onChange={(e) => setLinkId(e.target.value)} className="py-1 text-sm">
                {links.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label || 'Unlabelled link'}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <textarea
            readOnly
            value={text}
            rows={5}
            onFocus={(e) => e.target.select()}
            aria-label="Message"
            className="w-full rounded-lg border border-border bg-sunken px-3 py-2 text-sm text-fg"
          />
          {String(copied || '').endsWith(':failed') && <p className="text-xs text-danger-fg">Couldn’t copy — select the text and copy it yourself.</p>}
        </div>
      )}
    </Modal>
  );
};

export default CopyMessageDialog;
