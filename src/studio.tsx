import { useState, useEffect, type FormEvent } from 'react';
import { api, json, ErrorBox, Spinner, Modal, useToast } from './lib';
import type { Auth, Project, StudioUser } from './types';
export function Accounts({ auth }: { auth: Auth }) {
  const [users, setUsers] = useState<StudioUser[]>([]),
    [draft, setDraft] = useState<StudioUser | null>(null),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const toast = useToast();
  async function load() {
    setUsers(await api<StudioUser[]>('/admin/users'));
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  function edit(user: StudioUser) {
    setDraft({ ...user });
    setPassword('');
    setError('');
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft || busy) return;
    setBusy(true);
    setError('');
    try {
      await api(
        '/admin/users' + (draft.id ? '/' + draft.id : ''),
        json(
          draft.id ? 'PUT' : 'POST',
          {
            email: draft.email,
            username: draft.username,
            active: Boolean(draft.active),
            ...(password ? { password } : {}),
          },
          auth.csrf,
        ),
      );
      await load();
      setDraft(null);
      toast('Akun tersimpan.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-title">
        <h1>User Management</h1>
        <button
          className="btn btn-primary"
          onClick={() => edit({ id: '', username: '', email: '', role: 'project', active: 1 })}
        >
          Buat user
        </button>
      </div>
      {error && !draft && <ErrorBox message={error} />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Email</th>
              <th>Peran</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.email}</td>
                <td>{u.role === 'super' ? 'Admin Utama' : 'Admin Project'}</td>
                <td>{u.active ? 'Aktif' : 'Nonaktif'}</td>
                <td>
                  <button className="btn btn-small btn-outline" onClick={() => edit(u)}>
                    Edit akun
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {draft && (
        <Modal title={draft.id ? 'Edit akun' : 'Buat akun studio'} onClose={() => setDraft(null)}>
          <form className="modal-form" onSubmit={save}>
            <label>
              Username
              <input
                value={draft.username}
                autoComplete="off"
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                maxLength={64}
                onChange={(e) => setDraft({ ...draft, username: e.target.value })}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={draft.email}
                required
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </label>
            <label>
              {draft.id ? 'Password baru (opsional)' : 'Password'}
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required={!draft.id}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                disabled={draft.id === auth.user_id}
                checked={Boolean(draft.active)}
                onChange={(e) => setDraft({ ...draft, active: Number(e.target.checked) })}
              />
              Akun aktif
            </label>
            {error && <ErrorBox message={error} />}
            <button className="btn btn-primary" disabled={busy}>
              Simpan akun
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
export function Projects({
  auth,
  projects,
  reload,
}: {
  auth: Auth;
  projects: Project[];
  reload: () => Promise<void>;
}) {
  const [users, setUsers] = useState<StudioUser[]>([]),
    [editing, setEditing] = useState<string | null>(null),
    [name, setName] = useState(''),
    [owner, setOwner] = useState(auth.user_id || ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (auth.role === 'super')
      api<StudioUser[]>('/admin/users')
        .then(setUsers)
        .catch((e) => setError(e.message));
  }, [auth.role]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api(
        '/admin/projects' + (editing ? '/' + editing : ''),
        json(editing ? 'PUT' : 'POST', editing ? { name } : { name, owner_id: owner }, auth.csrf),
      );
      await reload();
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(p: Project) {
    if (!confirm('Hapus project kosong ' + p.name + '?')) return;
    try {
      await api('/admin/projects/' + p.id, json('DELETE', undefined, auth.csrf));
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="panel">
      <div className="panel-title">
        <h1>{auth.role === 'super' ? 'Project Management' : 'My Projects'}</h1>
        <button
          className="btn btn-primary"
          onClick={() => {
            setEditing('');
            setName('');
            setError('');
          }}
        >
          Buat project
        </button>
      </div>
      {error && editing === null && <ErrorBox message={error} />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Studio</th>
              <th>QR</th>
              <th>Foto</th>
              <th>Kelola</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.username}</td>
                <td>{p.qr_count}</td>
                <td>{p.photo_count || 0}</td>
                <td>
                  <button
                    className="text-link"
                    onClick={() => {
                      setEditing(p.id);
                      setName(p.name);
                      setError('');
                    }}
                  >
                    Edit
                  </button>{' '}
                  {p.id !== 'legacy' && !p.qr_count && (
                    <button className="text-link" onClick={() => remove(p)}>
                      Hapus
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing !== null && (
        <Modal title={editing ? 'Edit project' : 'Project baru'} onClose={() => setEditing(null)}>
          <form className="modal-form" onSubmit={save}>
            <label>
              Nama project
              <input
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {!editing && auth.role === 'super' && (
              <label>
                Pemilik
                <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                  {users
                    .filter((u) => u.active)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.username}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {error && <ErrorBox message={error} />}
            <button className="btn btn-primary" disabled={busy}>
              Simpan project
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
export function SystemSettings({ csrf }: { csrf: string }) {
  const [data, setData] = useState<{ default_total: number; default_per: number } | null>(null),
    [error, setError] = useState('');
  const toast = useToast();
  useEffect(() => {
    api<NonNullable<typeof data>>('/admin/system')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/admin/system', json('PUT', data, csrf));
      setError('');
      toast('Kuota bawaan disimpan.');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="panel settings-panel">
      <h1>System Settings</h1>
      <p>Kuota bawaan berlaku untuk QR baru yang dibuat admin project.</p>
      {error && <ErrorBox message={error} />}
      {data ? (
        <form className="settings-form" onSubmit={save}>
          <label>
            Kuota total per QR
            <input
              type="number"
              min={1}
              max={1000000}
              required
              value={data.default_total}
              onChange={(e) => setData({ ...data, default_total: Number(e.target.value) })}
            />
          </label>
          <label>
            Kuota per sesi
            <input
              type="number"
              min={1}
              max={data.default_total}
              required
              value={data.default_per}
              onChange={(e) => setData({ ...data, default_per: Number(e.target.value) })}
            />
          </label>
          <button className="btn btn-primary">Simpan kuota bawaan</button>
        </form>
      ) : (
        !error && <Spinner />
      )}
    </section>
  );
}
