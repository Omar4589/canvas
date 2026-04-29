import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

export default function UsersPage() {
  const qc = useQueryClient();
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

      {showForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createUser.mutate(form);
          }}
          className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-5 md:grid-cols-3"
        >
          {['firstName', 'lastName', 'email', 'password'].map((field) => (
            <div key={field}>
              <label className="block text-xs font-medium text-gray-700">
                {field}
              </label>
              <input
                value={form[field]}
                type={field === 'password' ? 'password' : field === 'email' ? 'email' : 'text'}
                required
                onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          ))}
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
                <tr key={u.id} className="border-t border-gray-100">
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
