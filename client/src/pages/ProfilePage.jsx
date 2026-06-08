import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import { Card, Button, Input } from '../components/ui/index.js';

// Self-serve account page shared by the client portal (/client/profile) and the admin /
// super-admin console (/profile). Edit name/phone (PATCH /auth/me), change your own password
// (POST /auth/change-password) — both already role-agnostic. Email is admin-managed (read-only).
const labelCls = 'block text-xs font-semibold text-fg-muted';

export default function ProfilePage() {
  const { user, activeMembership, updateProfile, changePassword, logout } = useAuth();

  useEffect(() => {
    document.title = 'Your account';
  }, []);

  const [profile, setProfile] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    phone: user?.phone || '',
  });
  const [profileMsg, setProfileMsg] = useState(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [savingPw, setSavingPw] = useState(false);

  const profileDirty =
    profile.firstName !== (user?.firstName || '') ||
    profile.lastName !== (user?.lastName || '') ||
    profile.phone !== (user?.phone || '');

  async function saveProfile(e) {
    e.preventDefault();
    setProfileMsg(null);
    if (!profile.firstName.trim() || !profile.lastName.trim()) {
      setProfileMsg({ type: 'error', text: 'First and last name are required.' });
      return;
    }
    setSavingProfile(true);
    try {
      await updateProfile({
        firstName: profile.firstName.trim(),
        lastName: profile.lastName.trim(),
        phone: profile.phone.trim() || null,
      });
      setProfileMsg({ type: 'success', text: 'Saved.' });
    } catch (err) {
      setProfileMsg({ type: 'error', text: err.message });
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePassword(e) {
    e.preventDefault();
    setPwMsg(null);
    if (pw.next.length < 8) {
      setPwMsg({ type: 'error', text: 'New password must be at least 8 characters.' });
      return;
    }
    if (pw.next !== pw.confirm) {
      setPwMsg({ type: 'error', text: 'New passwords do not match.' });
      return;
    }
    setSavingPw(true);
    try {
      await changePassword(pw.current, pw.next);
      setPw({ current: '', next: '', confirm: '' });
      setPwMsg({ type: 'success', text: 'Password changed.' });
    } catch (err) {
      setPwMsg({ type: 'error', text: err.message });
    } finally {
      setSavingPw(false);
    }
  }

  function Feedback({ msg }) {
    if (!msg) return null;
    return (
      <div className={`mt-3 text-sm ${msg.type === 'success' ? 'text-success' : 'text-danger'}`}>
        {msg.text}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">Your account</h1>
        {activeMembership?.organizationName && (
          <p className="mt-1 text-sm text-fg-muted">{activeMembership.organizationName}</p>
        )}
      </div>

      <Card as="form" onSubmit={saveProfile} className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-fg">Profile</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>First name</label>
            <Input
              value={profile.firstName}
              onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))}
              required
              className="mt-1"
            />
          </div>
          <div>
            <label className={labelCls}>Last name</label>
            <Input
              value={profile.lastName}
              onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))}
              required
              className="mt-1"
            />
          </div>
        </div>
        <div className="mt-3">
          <label className={labelCls}>Phone</label>
          <Input
            type="tel"
            value={profile.phone}
            onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
            placeholder="Optional"
            className="mt-1"
          />
        </div>
        <div className="mt-3">
          <label className={labelCls}>Email</label>
          <Input value={user?.email || ''} disabled className="mt-1" />
          <p className="mt-1 text-xs text-fg-muted">Email is managed by your admin.</p>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" loading={savingProfile} disabled={!profileDirty}>
            Save profile
          </Button>
          <Feedback msg={profileMsg} />
        </div>
      </Card>

      <Card as="form" onSubmit={savePassword} className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-fg">Change password</h2>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Current password</label>
            <div className="mt-1">
              <PasswordInput
                value={pw.current}
                onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))}
                autoComplete="current-password"
                required
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>New password (min 8 chars)</label>
            <div className="mt-1">
              <PasswordInput
                value={pw.next}
                onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
                autoComplete="new-password"
                required
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Confirm new password</label>
            <div className="mt-1">
              <PasswordInput
                value={pw.confirm}
                onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
                autoComplete="new-password"
                required
              />
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" loading={savingPw}>
            Change password
          </Button>
          <Feedback msg={pwMsg} />
        </div>
      </Card>

      <div className="flex justify-end">
        <Button variant="secondary" onClick={logout}>
          Sign out
        </Button>
      </div>
    </div>
  );
}
