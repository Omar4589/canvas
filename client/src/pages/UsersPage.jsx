import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import PasswordInput from '../components/PasswordInput.jsx';
import UserProfileModal from '../components/UserProfileModal.jsx';

const FORM_INPUT_CLS =
  'mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600';

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  password: '',
  role: 'user',
};

export default function UsersPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api('/admin/users'),
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selectedUserId, setSelectedUserId] = useState(null);

  const createUser = useMutation({
    mutationFn: (body) => api('/admin/users', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setShowForm(false);
      setForm(EMPTY_FORM);
    },
  });

  const users = data?.users || [];
  const selectedUser = selectedUserId
    ? users.find((u) => u.id === selectedUserId) || null
    : null;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
        >
          {showForm ? 'Cancel' : 'New user'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createUser.mutate(form);
          }}
          className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-5 md:grid-cols-3"
        >
          <div>
            <label className="block text-xs font-medium text-gray-700">
              First name
            </label>
            <input
              value={form.firstName}
              onChange={(e) =>
                setForm((s) => ({ ...s, firstName: e.target.value }))
              }
              required
              className={FORM_INPUT_CLS}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">
              Last name
            </label>
            <input
              value={form.lastName}
              onChange={(e) =>
                setForm((s) => ({ ...s, lastName: e.target.value }))
              }
              required
              className={FORM_INPUT_CLS}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">
              Email
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
              required
              className={FORM_INPUT_CLS}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">
              Phone <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))}
              className={FORM_INPUT_CLS}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">
              Password
            </label>
            <div className="mt-1">
              <PasswordInput
                value={form.password}
                onChange={(e) =>
                  setForm((s) => ({ ...s, password: e.target.value }))
                }
                required
                autoComplete="new-password"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">
              Role
            </label>
            <select
              value={form.role}
              onChange={(e) => setForm((s) => ({ ...s, role: e.target.value }))}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
            >
              <option value="user">Canvasser</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={createUser.isPending}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
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
        <div className="text-sm text-gray-500">Loading…</div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Email</th>
                <th className="px-4 py-2 text-left">Role</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="w-8 px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  onClick={() => setSelectedUserId(u.id)}
                  className="cursor-pointer border-t border-gray-100 transition-colors hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {u.firstName} {u.lastName}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{u.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        u.role === 'admin'
                          ? 'rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700'
                          : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700'
                      }
                    >
                      {u.role === 'admin' ? 'Admin' : 'Canvasser'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        u.isActive
                          ? 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700'
                          : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500'
                      }
                    >
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-lg leading-none text-gray-400">
                    ›
                  </td>
                </tr>
              ))}
              {!users.length && (
                <tr>
                  <td colSpan="5" className="px-4 py-10 text-center text-gray-500">
                    No users yet. Click <strong>New user</strong> to add one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedUser && (
        <UserProfileModal
          user={selectedUser}
          onClose={() => setSelectedUserId(null)}
        />
      )}
    </div>
  );
}
