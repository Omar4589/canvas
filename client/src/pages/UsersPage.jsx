import { Fragment, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import PasswordInput from '../components/PasswordInput.jsx';
import { useAuth } from '../auth/AuthContext.jsx';

export default function UsersPage() {
  const qc = useQueryClient();
  const { user: currentUser } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api('/admin/users'),
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    role: 'user',
  });

  const [resetTargetId, setResetTargetId] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetMessage, setResetMessage] = useState(null);

  const createUser = useMutation({
    mutationFn: (body) => api('/admin/users', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setShowForm(false);
      setForm({ firstName: '', lastName: '', email: '', password: '', role: 'user' });
    },
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, action }) =>
      api(`/admin/users/${id}/${action}`, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const resetPasswordM = useMutation({
    mutationFn: ({ id, password }) =>
      api(`/admin/users/${id}/password`, { method: 'PATCH', body: { password } }),
    onSuccess: (_, vars) => {
      const u = (data?.users || []).find((x) => x.id === vars.id);
      setResetTargetId(null);
      setResetPassword('');
      setResetMessage(`Password reset for ${u?.email || 'user'}.`);
      setTimeout(() => setResetMessage(null), 4000);
    },
  });

  const updateRole = useMutation({
    mutationFn: ({ id, role }) =>
      api(`/admin/users/${id}`, { method: 'PATCH', body: { role } }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      const u = (data?.users || []).find((x) => x.id === vars.id);
      setResetMessage(
        `${u?.email || 'User'} is now ${vars.role === 'admin' ? 'an admin' : 'a canvasser'}.`
      );
      setTimeout(() => setResetMessage(null), 4000);
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          {showForm ? 'Cancel' : 'New user'}
        </button>
      </div>

      {resetMessage && (
        <div className="mb-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {resetMessage}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createUser.mutate(form);
          }}
          className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-5 md:grid-cols-3"
        >
          {['firstName', 'lastName', 'email'].map((field) => (
            <div key={field}>
              <label className="block text-xs font-medium text-gray-700">
                {field}
              </label>
              <input
                value={form[field]}
                type={field === 'email' ? 'email' : 'text'}
                required
                onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-gray-700">password</label>
            <div className="mt-1">
              <PasswordInput
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                required
                autoComplete="new-password"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">role</label>
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={createUser.isPending}
              className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {createUser.isPending ? 'Creating…' : 'Create user'}
            </button>
            {createUser.error && (
              <span className="ml-3 text-sm text-red-600">
                {createUser.error.message}
              </span>
            )}
          </div>
        </form>
      )}

      {isLoading ? (
        <div>Loading…</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Email</th>
                <th className="px-4 py-2 text-left">Role</th>
                <th className="px-4 py-2 text-left">Active</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(data?.users || []).map((u) => (
                <Fragment key={u.id}>
                  <tr className="border-t border-gray-100">
                    <td className="px-4 py-2">
                      {u.firstName} {u.lastName}
                    </td>
                    <td className="px-4 py-2">{u.email}</td>
                    <td className="px-4 py-2">{u.role}</td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          u.isActive
                            ? 'rounded bg-green-100 px-2 py-0.5 text-xs text-green-700'
                            : 'rounded bg-red-100 px-2 py-0.5 text-xs text-red-700'
                        }
                      >
                        {u.isActive ? 'active' : 'inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => {
                          setResetTargetId(resetTargetId === u.id ? null : u.id);
                          setResetPassword('');
                        }}
                        className="mr-3 text-xs text-brand-700 hover:underline"
                      >
                        Reset password
                      </button>
                      {currentUser?.id !== u.id && (
                        <button
                          onClick={() => {
                            const nextRole = u.role === 'admin' ? 'user' : 'admin';
                            const verb = nextRole === 'admin' ? 'make admin' : 'demote to canvasser';
                            if (window.confirm(`Are you sure you want to ${verb} ${u.email}?`)) {
                              updateRole.mutate({ id: u.id, role: nextRole });
                            }
                          }}
                          disabled={updateRole.isPending}
                          className="mr-3 text-xs text-brand-700 hover:underline disabled:opacity-50"
                        >
                          {u.role === 'admin' ? 'Make canvasser' : 'Make admin'}
                        </button>
                      )}
                      <button
                        onClick={() =>
                          toggleActive.mutate({
                            id: u.id,
                            action: u.isActive ? 'deactivate' : 'reactivate',
                          })
                        }
                        className="text-xs text-brand-700 hover:underline"
                      >
                        {u.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                  {resetTargetId === u.id && (
                    <tr className="border-t border-gray-100 bg-gray-50">
                      <td colSpan="5" className="px-4 py-3">
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (resetPassword.length < 8) return;
                            resetPasswordM.mutate({ id: u.id, password: resetPassword });
                          }}
                          className="flex flex-wrap items-end gap-3"
                        >
                          <div className="flex-1 min-w-[240px]">
                            <label className="mb-1 block text-xs font-medium text-gray-700">
                              New password for {u.email} (min 8 chars)
                            </label>
                            <PasswordInput
                              value={resetPassword}
                              onChange={(e) => setResetPassword(e.target.value)}
                              autoComplete="new-password"
                              required
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={resetPasswordM.isPending || resetPassword.length < 8}
                            className="rounded bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                          >
                            {resetPasswordM.isPending ? 'Saving…' : 'Save password'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setResetTargetId(null);
                              setResetPassword('');
                            }}
                            className="rounded border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                          {resetPasswordM.error && (
                            <span className="text-sm text-red-600">
                              {resetPasswordM.error.message}
                            </span>
                          )}
                        </form>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
