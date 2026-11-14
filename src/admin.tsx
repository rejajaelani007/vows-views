import { Projects, Accounts, SystemSettings } from './studio';
import { ProjectSettings } from './landing-editor';
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Camera,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Heart,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Plus,
  Printer,
  QrCode,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X,
  Pencil,
  Trash2,
  Menu,
} from 'lucide-react';
import {
  api,
  Brand,
  dateTime,
  ErrorBox,
  EventProvider,
  json,
  Link,
  Modal,
  number,
  Spinner,
  useEvent,
  useRouter,
  useToast,
  weddingDate,
} from './lib';
import { Pagination, PhotoGrid, PhotoViewer } from './guest';
import type { Auth, Overview, Photo, PhotoList, Qr, Usage, Project, WeddingEvent } from './types';

export function AdminApp() {
  const [auth, setAuth] = useState<Auth | null>(null),
    [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      setAuth(await api<Auth>('/auth'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const onFocus = () => {
      void load();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);
  if (error)
    return (
      <div className="auth-page">
        <ErrorBox message={error} retry={() => void load()} />
      </div>
    );
  if (!auth)
    return (
      <div className="auth-page">
        <Spinner text="Memeriksa sesi admin…" />
      </div>
    );
  if (!auth.authenticated) return <Login auth={auth} onLogin={setAuth} />;
  return <Workspace key={auth.user_id} auth={auth} onLogout={() => void load()} />;
}
const WorkspaceContext = createContext<{
  projects: Project[];
  current?: Project;
  select: (id: string) => void;
  reload: () => Promise<void>;
  superAdmin: boolean;
}>({ projects: [], select: () => {}, reload: async () => {}, superAdmin: false });
function Workspace({ auth, onLogout }: { auth: Auth; onLogout: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]),
    [selected, select] = useState(''),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    const items = await api<Project[]>('/admin/projects');
    setProjects(items);
    setLoaded(true);
    setError('');
  }, []);
  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, [reload]);
  if (error)
    return <ErrorBox message={error} retry={() => reload().catch((e) => setError(e.message))} />;
  if (!loaded) return <Spinner />;
  const current = projects.find((p) => p.id === selected) || projects[0];
  const layout = <AdminLayout auth={auth} onLogout={onLogout} />;
  return (
    <WorkspaceContext.Provider
      value={{ projects, current, select, reload, superAdmin: auth.role === 'super' }}
    >
      {current ? (
        <EventProvider key={current.id} endpoint={'/admin/projects/' + current.id + '/event'}>
          {layout}
        </EventProvider>
      ) : (
        layout
      )}
    </WorkspaceContext.Provider>
  );
}
function Login({ auth, onLogin }: { auth: Auth; onLogin: (a: Auth) => void }) {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      onLogin(await api<Auth>('/auth/login', json('POST', { email, password }, auth.csrf)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-art">
        <Brand />
        <div>
          <p className="eyebrow">BEHIND EVERY BEAUTIFUL MOMENT</p>
          <h1>
            A little care.
            <br />A lifetime of <em>memories.</em>
          </h1>
          <p>Satu tempat untuk mengelola setiap momen bahagia.</p>
        </div>
        <span>VOWS & VIEWS · WEDDING PHOTO BOOTH</span>
      </div>
      <div className="auth-panel">
        <Link to="/" className="text-link">
          <ArrowLeft size={15} /> Kembali ke website
        </Link>
        <div className="login-card">
          <div className="access-icon">
            <ShieldCheck size={29} strokeWidth={1.2} />
          </div>
          <p className="eyebrow">THE WEDDING STUDIO</p>
          <h1>Welcome back.</h1>
          <p>Masuk untuk mengelola kenangan pernikahan Anda.</p>
          {auth.setup_required && (
            <div className="info-box">
              Belum ada akun admin. Jalankan <code>npm run admin:create</code> pada server untuk
              membuat akun pertama.
            </div>
          )}
          <form onSubmit={submit}>
            <label htmlFor="email">Username atau email</label>
            <input
              id="email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              placeholder="admin@yourwedding.com"
              required
              maxLength={254}
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Masukkan password Anda"
              required
              maxLength={128}
            />
            {error && <ErrorBox message={error} />}
            <button className="btn btn-primary" disabled={busy || auth.setup_required}>
              {busy ? 'Memeriksa…' : 'Masuk ke dashboard'}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="secure-note">
            <ShieldCheck size={14} /> Akses aman khusus administrator
          </p>
        </div>
      </div>
    </main>
  );
}
const menuItems = [
  { path: '/admin', label: 'Overview', icon: LayoutDashboard },
  { path: '/admin/users', label: 'User Management', icon: Users },
  { path: '/admin/projects', label: 'Project Management', icon: Heart },
  { path: '/admin/qrs', label: 'QR codes', icon: QrCode },
  { path: '/admin/usage', label: 'Usage & sessions', icon: Activity },
  { path: '/admin/photos', label: 'Photo library', icon: ImageIcon },
  { path: '/admin/settings', label: 'Landing Page Settings', icon: Settings },
  { path: '/admin/themes', label: 'Theme Settings', icon: Pencil },
  { path: '/admin/filters', label: 'Camera Filter Settings', icon: Camera },
  { path: '/admin/system', label: 'System Settings', icon: Settings },
];
function AdminLayout({ auth, onLogout }: { auth: Auth; onLogout: () => void }) {
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const { path } = useRouter(),
    { event } = useEvent(),
    toast = useToast(),
    [open, setOpen] = useState(false);
  const { projects, current, select, reload, superAdmin } = useContext(WorkspaceContext);
  const publicBase = current?.code
    ? `/${current.username}/${current.code}`
    : current?.id === 'legacy'
      ? '/'
      : '';
  const menu = menuItems
    .filter((i) => superAdmin || !['/admin/users', '/admin/system'].includes(i.path))
    .map((i) => (!superAdmin && i.path === '/admin/projects' ? { ...i, label: 'My Projects' } : i));
  const active = menu.find((i) => i.path === path);
  async function logout() {
    try {
      await api('/auth/logout', json('POST', undefined, auth.csrf));
      onLogout();
    } catch (e) {
      toast((e as Error).message, true);
    }
  }
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    sidebar.current?.querySelector<HTMLAnchorElement>('nav a')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (path.startsWith('/admin/print/')) return <PrintQr id={path.split('/')[3]} />;
  return (
    <div className="admin-layout">
      <aside
        id="admin-navigation"
        ref={sidebar}
        className={`sidebar ${open ? 'sidebar-open' : ''}`}
      >
        <Brand />
        <div className="studio-label">THE WEDDING STUDIO</div>
        <nav aria-label="Navigasi admin">
          {menu.map((item) => (
            <Link key={item.path} to={item.path} className={path === item.path ? 'active' : ''}>
              <item.icon size={19} strokeWidth={1.6} />
              {item.label}
              {path === item.path && <span className="nav-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-event">
          <span className="sidebar-heart">
            <Heart size={21} strokeWidth={1} />
          </span>
          <small>A CELEBRATION OF LOVE</small>
          <h3>
            {event?.partner_one} <i>&</i> {event?.partner_two}
          </h3>
          <p>{event ? weddingDate(event.wedding_date) : ''}</p>
          {publicBase && (
            <Link to={publicBase} className="text-link">
              Buka website tamu <ExternalLink size={13} />
            </Link>
          )}
        </div>
        <button className="logout" onClick={() => void logout()}>
          <LogOut size={17} /> Keluar
        </button>
        <p className="sidebar-foot">Made for moments that matter.</p>
      </aside>
      {open && (
        <button
          className="sidebar-scrim"
          aria-label="Tutup navigasi"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="admin-main">
        <header className="admin-header">
          <button
            className="icon-btn mobile-menu"
            aria-label="Buka navigasi"
            ref={menuButton}
            aria-controls="admin-navigation"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <Menu size={22} />
          </button>
          <div className="breadcrumb">
            Studio <ChevronRight size={14} />
            <strong>{active?.label || 'Dashboard'}</strong>
          </div>
          <div className="admin-header-right">
            {publicBase && (
              <Link to={publicBase.replace(/\/$/, '') + '/gallery'} className="text-link">
                Live gallery <ExternalLink size={14} />
              </Link>
            )}
            <div className="avatar">{auth.email?.[0].toUpperCase()}</div>
            <div className="admin-user">
              <strong>{superAdmin ? 'Admin Utama' : 'Admin Project'}</strong>
              <small>{auth.email}</small>
            </div>
          </div>
        </header>
        <main className="admin-content">
          {['/admin/settings', '/admin/themes', '/admin/filters'].includes(path) && projects.length > 0 && (
            <label className="project-switch">
              Project
              <select value={current?.id} onChange={(e) => select(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.username}
                  </option>
                ))}
              </select>
            </label>
          )}
          {path === '/admin/projects' ? (
            <Projects auth={auth} projects={projects} reload={reload} />
          ) : path === '/admin/users' && superAdmin ? (
            <Accounts auth={auth} />
          ) : path === '/admin/system' && superAdmin ? (
            <SystemSettings csrf={auth.csrf} />
          ) : path === '/admin' ? (
            <Dashboard />
          ) : path === '/admin/qrs' ? (
            <QrManagement csrf={auth.csrf} />
          ) : path === '/admin/usage' ? (
            <UsagePage />
          ) : path === '/admin/photos' ? (
            <PhotoManagement csrf={auth.csrf} />
          ) : ['/admin/settings', '/admin/themes', '/admin/filters'].includes(path) ? (
            current ? (
              <ProjectSettings
                key={path + current.id}
                project={current.id}
                csrf={auth.csrf}
                camera={path === '/admin/filters'}
                themeEditor={path === '/admin/themes'}
              />
            ) : (
              <Link to="/admin/projects">Buat project pertama Anda</Link>
            )
          ) : (
            <div className="empty-state">
              <h1>Halaman tidak ditemukan</h1>
              <Link to="/admin">Kembali ke overview</Link>
            </div>
          )}
        </main>
        <footer className="admin-footer">
          <span>© {new Date().getFullYear()} Vows & Views</span>
          <span>
            <span className="live-dot" /> Your memories, beautifully managed.
          </span>
        </footer>
      </div>
    </div>
  );
}
function PageTitle({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="admin-page-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
function Dashboard() {
  const [data, setData] = useState<Overview | null>(null),
    [qrs, setQrs] = useState<Qr[]>([]),
    [error, setError] = useState(''),
    { event } = useEvent();
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [stats, codes] = await Promise.all([
        api<Overview>('/admin/overview', { signal }),
        api<Qr[]>('/admin/qrs', { signal }),
      ]);
      setData(stats);
      setQrs(codes);
      setError('');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load(c.signal);
    }, 30000);
    return () => {
      c.abort();
      clearInterval(t);
    };
  }, [load]);
  return (
    <>
      <PageTitle
        eyebrow="YOUR WEDDING, AT A GLANCE"
        title="Every moment, beautifully captured."
        description="Pantau photo booth dan kenangan yang dibagikan oleh para tamu."
      >
        <Link to="/admin/qrs" className="btn btn-primary">
          <Plus size={17} /> Buat QR code
        </Link>
      </PageTitle>
      <div className="dashboard-welcome">
        <div>
          <span className="count-badge">
            <Heart size={12} /> THE BIG DAY
          </span>
          <h2>
            {event?.partner_one} <em>&</em> {event?.partner_two}
          </h2>
          <p>
            {event ? weddingDate(event.wedding_date) : ''}
            {event?.venue && ` · ${event.venue}`}
          </p>
        </div>
        <div className="welcome-script">
          Let love
          <br />
          <i>be the memory.</i>
        </div>
        <Heart className="welcome-heart" size={150} strokeWidth={0.5} />
      </div>
      {error && <ErrorBox message={error} retry={() => void load()} />}{' '}
      {!data ? (
        !error && <Spinner />
      ) : (
        <>
          <div className="stats-grid">
            {[
              {
                icon: QrCode,
                label: 'Total QR codes',
                value: data.total_qr,
                note: `${data.active_qr} QR code aktif`,
                color: 'rose',
              },
              {
                icon: Camera,
                label: 'Foto diunggah',
                value: data.uploaded,
                note: `${data.published} tampil di galeri`,
                color: 'gold',
              },
              {
                icon: ImageIcon,
                label: 'Total kuota foto',
                value: data.total_quota,
                note: `${number(data.used_quota)} foto telah diambil`,
                color: 'sage',
              },
              {
                icon: Users,
                label: 'Sesi pengunjung',
                value: data.sessions,
                note: 'Seluruh sesi yang tercatat',
                color: 'lilac',
              },
            ].map((s) => (
              <article className="stat-card" key={s.label}>
                <div className="stat-top">
                  <span>{s.label}</span>
                  <div className={`stat-icon ${s.color}`}>
                    <s.icon size={20} strokeWidth={1.5} />
                  </div>
                </div>
                <strong>{number(s.value)}</strong>
                <p>{s.note}</p>
              </article>
            ))}
          </div>
          <section className="panel">
            <div className="panel-title">
              <h2>Foto per project</h2>
              <span>
                {data.projects.length} project
                {data.users !== undefined && ' · ' + data.users + ' user'}
              </span>
            </div>
            {data.projects.map((p) => (
              <p key={p.id}>
                {p.name} · {number(p.total)} foto
              </p>
            ))}
          </section>
          <section className="panel">
            <h2>Aktivitas terbaru</h2>
            {data.recent.length ? (
              data.recent.map((a) => (
                <p key={a.id}>
                  {dateTime(a.created_at)} · {a.name} · {a.label}
                </p>
              ))
            ) : (
              <p>Belum ada foto yang diambil.</p>
            )}
          </section>
          <div className="dashboard-charts">
            <section className="panel chart-panel">
              <div className="panel-title">
                <div>
                  <h2>Photo activity</h2>
                  <p>Foto yang berhasil disimpan, berdasarkan tanggal</p>
                </div>
                <span className="period-chip">14 hari terakhir</span>
              </div>
              <ActivityChart days={data.days} />
              <div className="chart-legend">
                <span /> Foto diunggah <small>Waktu Indonesia Barat</small>
              </div>
            </section>
            <section className="panel quota-panel">
              <div className="panel-title">
                <div>
                  <h2>A little more room for joy</h2>
                  <p>Sisa kuota pengambilan foto</p>
                </div>
              </div>
              <div
                className="quota-ring"
                style={
                  {
                    '--progress': `${data.total_quota ? (data.used_quota / data.total_quota) * 100 : 0}%`,
                  } as React.CSSProperties
                }
              >
                <div>
                  <strong>
                    {data.total_quota
                      ? Math.round((data.remaining_quota / data.total_quota) * 100)
                      : 0}
                    <small>%</small>
                  </strong>
                  <span>kuota tersedia</span>
                </div>
              </div>
              <h3>
                {number(data.remaining_quota)} <span>foto tersisa</span>
              </h3>
              <div className="quota-key">
                <span>
                  <i />
                  {number(data.used_quota)} digunakan
                </span>
                <span>
                  <i />
                  {number(data.total_quota)} total
                </span>
              </div>
            </section>
          </div>
          <section className="panel">
            <div className="panel-title">
              <div>
                <h2>Your QR invitations</h2>
                <p>Kuota dan aktivitas setiap titik photo booth</p>
              </div>
              <Link to="/admin/qrs" className="text-link">
                Kelola semua <ArrowRight size={15} />
              </Link>
            </div>
            {qrs.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Nama QR code</th>
                      <th>Status</th>
                      <th>Penggunaan kuota</th>
                      <th>Sesi</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {qrs.slice(0, 5).map((q) => (
                      <tr key={q.id}>
                        <td>
                          <div className="table-qr-name">
                            <span className="table-icon">
                              <QrCode size={20} />
                            </span>
                            <div>
                              <strong>{q.label}</strong>
                              <small>{q.per_session_limit} foto per sesi</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <Status active={q.active} />
                        </td>
                        <td>
                          <QuotaBar qr={q} />
                        </td>
                        <td>{number(q.sessions)}</td>
                        <td>
                          <Link
                            to="/admin/usage"
                            className="icon-btn"
                            aria-label={`Lihat penggunaan ${q.label}`}
                          >
                            <ArrowRight size={16} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <SmallEmpty
                icon={<QrCode size={28} strokeWidth={1.2} />}
                title="Undangan pertama untuk kenangan indah"
                text="Buat QR code untuk mulai menerima foto dari tamu."
                action={
                  <Link to="/admin/qrs" className="btn btn-small btn-primary">
                    <Plus size={15} /> Buat QR code pertama
                  </Link>
                }
              />
            )}
          </section>
          <div className="dashboard-tip">
            <ShieldCheck size={21} strokeWidth={1.2} />
            <p>
              <strong>Every memory counts.</strong> Kuota hanya terpakai setelah foto berhasil
              disimpan. Foto tamu langsung ditampilkan di galeri.
            </p>
            <Link to="/admin/photos" aria-label="Lihat foto">
              <ExternalLink size={17} />
            </Link>
          </div>
        </>
      )}
    </>
  );
}
function ActivityChart({ days }: { days: Overview['days'] }) {
  const all = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(Date.now() - (13 - i) * 86400000);
    const key = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    return {
      key,
      label: date.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        timeZone: 'Asia/Jakarta',
      }),
      count: days.find((d) => d.day === key)?.count || 0,
    };
  });
  const max = Math.max(4, ...all.map((d) => d.count)),
    points = all.map((d, i) => `${48 + i * 39},${175 - (d.count / max) * 140}`).join(' ');
  return (
    <div className="activity-chart">
      <svg
        viewBox="0 0 590 215"
        role="img"
        aria-label={`Grafik unggahan 14 hari. ${all.map((d) => `${d.label}: ${d.count} foto`).join(', ')}`}
      >
        <defs>
          <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#ac697a" stopOpacity=".22" />
            <stop offset="100%" stopColor="#ac697a" stopOpacity=".01" />
          </linearGradient>
        </defs>
        {Array.from({ length: 5 }, (_, i) => (
          <g key={i}>
            <line
              x1="45"
              y1={35 + i * 35}
              x2="557"
              y2={35 + i * 35}
              stroke="#eee8e2"
              strokeDasharray="3 4"
            />
            <text x="28" y={39 + i * 35} textAnchor="end">
              {Math.round((max * (4 - i)) / 4)}
            </text>
          </g>
        ))}
        <polygon points={`48,175 ${points} 555,175`} fill="url(#chart-fill)" />
        <polyline
          points={points}
          fill="none"
          stroke="#a35b6c"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {all.map((d, i) => (
          <g key={d.key}>
            <circle cx={48 + i * 39} cy={175 - (d.count / max) * 140} r="3.2" fill="#a35b6c">
              <title>
                {d.label}: {d.count} foto
              </title>
            </circle>
            {i % 3 === 0 || i === 13 ? (
              <text x={48 + i * 39} y="203" textAnchor="middle">
                {d.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}
function Status({ active }: { active: boolean }) {
  return (
    <span className={`status ${active ? 'status-active' : 'status-inactive'}`}>
      <span />
      {active ? 'Aktif' : 'Nonaktif'}
    </span>
  );
}
function QuotaBar({ qr }: { qr: Qr }) {
  const pct = (qr.used_count / qr.total_limit) * 100;
  return (
    <div className="quota-bar-wrap">
      <div>
        <strong>
          {number(qr.used_count)} <span>/ {number(qr.total_limit)} foto</span>
        </strong>
        <small>{Math.round(pct)}%</small>
      </div>
      <progress value={qr.used_count} max={qr.total_limit} aria-label={`Kuota ${qr.label}`} />
    </div>
  );
}
function SmallEmpty({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="small-empty">
      <div className="access-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

function useQrs() {
  const [qrs, setQrs] = useState<Qr[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setQrs(await api<Qr[]>('/admin/qrs', { signal }));
      setError('');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    return () => c.abort();
  }, [load]);
  return { qrs, loading, error, load };
}
function QrManagement({ csrf }: { csrf: string }) {
  const { qrs, loading, error, load } = useQrs(),
    [search, setSearch] = useState(''),
    [editor, setEditor] = useState<Qr | 'new' | null>(null),
    [detail, setDetail] = useState<Qr | null>(null),
    [busy, setBusy] = useState(''),
    toast = useToast();
  const { superAdmin, projects, reload } = useContext(WorkspaceContext);
  const filtered = qrs.filter((q) =>
    `${q.label} ${q.code} ${q.project_name} ${q.username}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  async function toggle(q: Qr) {
    setBusy(q.id);
    try {
      await api(
        `/admin/qrs/${q.id}`,
        json(
          'PUT',
          {
            label: q.label,
            ...(superAdmin
              ? { total_limit: q.total_limit, per_session_limit: q.per_session_limit }
              : {}),
            active: !q.active,
          },
          csrf,
        ),
      );
      toast(q.active ? 'QR Code dinonaktifkan.' : 'QR Code diaktifkan.');
      await load();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy('');
    }
  }
  async function remove(q: Qr) {
    if (
      !confirm(`Hapus QR Code “${q.label}”? Hanya QR tanpa riwayat penggunaan yang dapat dihapus.`)
    )
      return;
    setBusy(q.id);
    try {
      await api(`/admin/qrs/${q.id}`, json('DELETE', undefined, csrf));
      toast('QR Code dihapus.');
      await load();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy('');
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="INVITATIONS TO MAKE MEMORIES"
        title="QR code management"
        description="Buat akses photo booth dan atur kuota untuk setiap undangan."
      >
        <button
          className="btn btn-primary"
          disabled={!projects.length}
          onClick={() => setEditor('new')}
        >
          <Plus size={17} /> Buat QR code
        </button>
      </PageTitle>
      {!projects.length && (
        <Link to="/admin/projects" className="text-link">
          Buat project terlebih dahulu
        </Link>
      )}
      <div className="summary-strip">
        <span>
          <QrCode size={18} />
          <strong>{qrs.length}</strong> QR codes
        </span>
        <span>
          <span className="live-dot" />
          <strong>{qrs.filter((q) => q.active).length}</strong> aktif
        </span>
        <span>
          <Camera size={18} />
          <strong>{number(qrs.reduce((a, q) => a + q.total_limit, 0))}</strong> total kuota foto
        </span>
      </div>
      <section className="panel">
        <div className="panel-title">
          <h2>All invitations</h2>
          <label className="search-input">
            <Search size={16} />
            <input
              aria-label="Cari QR Code"
              placeholder="Cari nama atau kode…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {error && <ErrorBox message={error} retry={() => void load()} />}{' '}
        {loading ? (
          <Spinner />
        ) : filtered.length ? (
          <div className="table-wrap">
            <table className="qr-table">
              <thead>
                <tr>
                  <th>Nama QR code</th>
                  <th>Kuota foto</th>
                  <th>Per sesi</th>
                  <th>Maks. sesi</th>
                  <th>Status</th>
                  <th className="align-right">Kelola</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <button className="table-qr-name plain-button" onClick={() => setDetail(q)}>
                        <span className="table-icon">
                          <QrCode size={23} strokeWidth={1.3} />
                        </span>
                        <span>
                          <strong>{q.label}</strong>
                          <small>
                            {q.project_name} · {q.username}
                          </small>
                          <small className="code-label">{q.code.slice(0, 14)}…</small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <QuotaBar qr={q} />
                    </td>
                    <td>
                      <strong>{q.per_session_limit}</strong>
                      <small className="table-sub">foto / tamu</small>
                    </td>
                    <td>
                      {number(q.max_sessions)}
                      <small className="table-sub">{q.allocated_sessions} teralokasi</small>
                    </td>
                    <td>
                      <button
                        className="plain-button"
                        onClick={() => void toggle(q)}
                        disabled={busy === q.id}
                        title={q.active ? 'Nonaktifkan QR' : 'Aktifkan QR'}
                      >
                        <Status active={q.active} />
                      </button>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="icon-btn"
                          aria-label={`Lihat QR ${q.label}`}
                          onClick={() => setDetail(q)}
                        >
                          <Eye size={16} />
                        </button>
                        <a
                          className="icon-btn"
                          href={`/api/admin/qrs/${q.id}/png`}
                          download={`${q.label}.png`}
                          aria-label={`Unduh QR ${q.label}`}
                        >
                          <Download size={16} />
                        </a>
                        <button
                          className="icon-btn"
                          aria-label={`Edit QR ${q.label}`}
                          onClick={() => setEditor(q)}
                          disabled={busy === q.id}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="icon-btn danger-icon"
                          aria-label={`Hapus QR ${q.label}`}
                          onClick={() => void remove(q)}
                          disabled={busy === q.id}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <SmallEmpty
            icon={<QrCode size={28} />}
            title={search ? 'Tidak ada QR yang cocok' : 'Create a little invitation to happiness'}
            text={
              search
                ? 'Coba kata pencarian yang lain.'
                : 'QR Code pertama Anda akan membuka pintu menuju kenangan bersama.'
            }
            action={
              !search && (
                <button
                  className="btn btn-primary btn-small"
                  disabled={!projects.length}
                  onClick={() => setEditor('new')}
                >
                  <Plus size={16} /> Buat QR code
                </button>
              )
            }
          />
        )}
        <div className="table-footer">
          Menampilkan {filtered.length} dari {qrs.length} QR codes
          <span>
            <ShieldCheck size={14} /> Validasi kuota oleh server
          </span>
        </div>
      </section>
      <div className="info-box quota-explainer">
        <CircleHelp size={20} />
        <div>
          <strong>Kuota yang pas untuk setiap tamu</strong>
          <p>
            Maksimal sesi = kuota total ÷ kuota per sesi, dibulatkan ke bawah. Contoh: 100 foto ÷ 3
            = 33 sesi, dengan 1 foto tidak teralokasi. Slot dipesan saat sesi dimulai, kuota foto
            dipakai saat berhasil disimpan.
          </p>
        </div>
      </div>
      {editor && (
        <QrEditor
          qr={editor === 'new' ? undefined : editor}
          csrf={csrf}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void load();
            void reload().catch((e) => toast(e.message, true));
          }}
        />
      )}{' '}
      {detail && <QrDetail qr={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
function QrEditor({
  qr,
  csrf,
  onClose,
  onSaved,
}: {
  qr?: Qr;
  csrf: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { projects, current, superAdmin } = useContext(WorkspaceContext);
  const [project, setProject] = useState(qr?.project_id || current?.id || ''),
    [code, setCode] = useState('');
  const [label, setLabel] = useState(qr?.label || ''),
    [total, setTotal] = useState(qr?.total_limit || 100),
    [per, setPer] = useState(qr?.per_session_limit || 2),
    [active, setActive] = useState(qr?.active ?? true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    toast = useToast();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api(
        qr ? `/admin/qrs/${qr.id}` : '/admin/qrs',
        json(
          qr ? 'PUT' : 'POST',
          {
            label,
            ...(superAdmin ? { total_limit: total, per_session_limit: per } : {}),
            ...(!qr ? { project_id: project, code } : {}),
            active,
          },
          csrf,
        ),
      );
      toast(qr ? 'Pengaturan QR Code disimpan.' : 'QR Code baru berhasil dibuat.');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={qr ? 'Edit QR invitation' : 'Create a QR invitation'} onClose={onClose}>
      <form onSubmit={submit} className="modal-form">
        <p className="form-description">Berikan tamu akses untuk mengabadikan momen bahagia.</p>
        {!qr && (
          <>
            <label>
              Project
              <select required value={project} onChange={(e) => setProject(e.target.value)}>
                {projects.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name} · {p.username}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Kode URL (opsional)
              <input
                value={code}
                maxLength={64}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder="wedding-andi-sarah"
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <p className="form-hint">Kosongkan untuk membuat kode acak.</p>
          </>
        )}
        <label htmlFor="qr-label">Nama / label QR code</label>
        <input
          id="qr-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
          maxLength={100}
          placeholder="Contoh: Main wedding booth"
          autoFocus
        />
        {superAdmin && (
          <>
            <div className="form-grid">
              <div>
                <label htmlFor="qr-total">Total photo limit</label>
                <input
                  id="qr-total"
                  type="number"
                  min={1}
                  max={1000000}
                  value={total || ''}
                  onChange={(e) => setTotal(Number(e.target.value))}
                  required
                />
              </div>
              <div>
                <label htmlFor="qr-per">Photo limit per session</label>
                <input
                  id="qr-per"
                  type="number"
                  min={1}
                  max={Math.max(1, total)}
                  value={per || ''}
                  onChange={(e) => setPer(Number(e.target.value))}
                  required
                  disabled={Boolean(qr?.sessions)}
                />
              </div>
            </div>
            <div className="quota-calculator">
              <Users size={21} />
              <div>
                <strong>
                  {per > 0 && total >= per ? number(Math.floor(total / per)) : 0} sesi pengunjung
                </strong>
                <span>
                  {per > 0 ? total % per : 0} foto tidak teralokasi · {per || 0} foto per sesi
                </span>
              </div>
            </div>
            {Boolean(qr?.sessions) && (
              <p className="form-hint">
                Kuota per sesi dikunci karena QR sudah memiliki riwayat penggunaan.
              </p>
            )}
          </>
        )}
        {!superAdmin && <p className="form-hint">Kuota QR ditentukan oleh Admin Utama.</p>}
        <label className="checkbox-label">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{' '}
          Aktifkan QR code untuk tamu
        </label>
        {error && <ErrorBox message={error} />}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Menyimpan…' : qr ? 'Simpan perubahan' : 'Buat QR code'}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function QrDetail({ qr, onClose }: { qr: Qr; onClose: () => void }) {
  const toast = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(qr.url);
      toast('Tautan QR Code disalin.');
    } catch {
      toast('Salin tautan secara manual dari kolom di bawah.', true);
    }
  }
  return (
    <Modal title={qr.label} onClose={onClose}>
      <div className="qr-detail">
        <div className="qr-preview">
          <img src={`/api/admin/qrs/${qr.id}/png`} alt={`QR Code untuk ${qr.label}`} />
        </div>
        <Status active={qr.active} />
        <p>
          {qr.per_session_limit} foto per sesi · {number(qr.total_limit)} total foto
        </p>
        <label htmlFor="qr-url">Tautan photo booth</label>
        <div className="copy-field">
          <input id="qr-url" value={qr.url} readOnly onFocus={(e) => e.target.select()} />
          <button className="icon-btn" aria-label="Salin tautan" onClick={() => void copy()}>
            <Copy size={17} />
          </button>
        </div>
        <div className="qr-detail-actions">
          <a
            className="btn btn-primary btn-small"
            href={`/api/admin/qrs/${qr.id}/png`}
            download={`${qr.label}.png`}
          >
            <Download size={16} /> Unduh PNG
          </a>
          <a
            className="btn btn-outline btn-small"
            href={`/admin/print/${qr.id}`}
            target="_blank"
            rel="noopener"
          >
            <Printer size={16} /> Cetak
          </a>
          <a className="btn btn-outline btn-small" href={qr.url} target="_blank" rel="noopener">
            <ExternalLink size={16} /> Buka
          </a>
        </div>
        <div className="qr-detail-stats">
          <span>
            <strong>{qr.max_sessions}</strong>maksimal sesi
          </span>
          <span>
            <strong>{qr.remaining}</strong>foto tersisa
          </span>
          <span>
            <strong>{qr.sessions}</strong>sesi tercatat
          </span>
        </div>
        <small>QR code unduhan berukuran 1200 × 1200 piksel, siap cetak.</small>
      </div>
    </Modal>
  );
}
function PrintQr({ id }: { id: string }) {
  const { qrs, loading, error } = useQrs(),
    qr = qrs.find((q) => q.id === id);
  const [event, setEvent] = useState<WeddingEvent | null>(null),
    [eventError, setEventError] = useState('');
  useEffect(() => {
    if (!qr) return;
    const c = new AbortController();
    api<WeddingEvent>('/admin/projects/' + qr.project_id + '/event', { signal: c.signal })
      .then(setEvent)
      .catch((e) => {
        if (!c.signal.aborted) setEventError(e.message);
      });
    return () => c.abort();
  }, [qr?.project_id]);
  if (eventError) return <ErrorBox message={eventError} />;
  if (loading || (qr && !event)) return <Spinner />;
  return (
    <main className="print-page">
      <div className="no-print">
        <Link to="/admin/qrs" className="btn btn-outline">
          <ArrowLeft size={17} /> QR Codes
        </Link>
        <button className="btn btn-primary" onClick={() => window.print()} disabled={!qr}>
          <Printer size={17} /> Cetak QR code
        </button>
      </div>
      {error ? (
        <ErrorBox message={error} />
      ) : qr ? (
        <article className="print-card">
          <p className="eyebrow">CAPTURE THE LOVE</p>
          <h1>
            {event?.partner_one} <em>&</em> {event?.partner_two}
          </h1>
          <p>Our day. Your perspective.</p>
          <img src={`/api/admin/qrs/${qr.id}/png`} alt={`QR Code ${qr.label}`} />
          <h2>Scan, smile & make a memory.</h2>
          <p>
            {qr.label} · {qr.per_session_limit} foto per sesi
          </p>
          <small>{qr.url}</small>
          <Heart size={23} strokeWidth={1} />
        </article>
      ) : (
        <ErrorBox message="QR Code tidak ditemukan." />
      )}
    </main>
  );
}

function UsagePage() {
  const { qrs, loading, error } = useQrs(),
    [selected, setSelected] = useState('');
  const current = selected || qrs[0]?.id;
  return (
    <>
      <PageTitle
        eyebrow="EVERY SMILE, ACCOUNTED FOR"
        title="Usage & guest sessions"
        description="Pantau alokasi kuota dan riwayat sesi dari setiap QR Code."
      />
      {error && <ErrorBox message={error} />}{' '}
      {loading ? (
        <Spinner />
      ) : !qrs.length ? (
        <section className="panel">
          <SmallEmpty
            icon={<Activity size={28} />}
            title="Belum ada aktivitas"
            text="Buat QR Code untuk mulai mencatat sesi tamu."
            action={
              <Link to="/admin/qrs" className="btn btn-primary btn-small">
                Kelola QR codes <ArrowRight size={15} />
              </Link>
            }
          />
        </section>
      ) : (
        <>
          <label className="select-qr-label" htmlFor="usage-qr">
            Pilih QR code
          </label>
          <select
            id="usage-qr"
            className="qr-select"
            value={current}
            onChange={(e) => setSelected(e.target.value)}
          >
            {qrs.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </select>
          <UsageDetail key={current} id={current} />
        </>
      )}
    </>
  );
}
function UsageDetail({ id }: { id: string }) {
  const [data, setData] = useState<Usage | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState('');
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setData(await api<Usage>(`/admin/qrs/${id}/usage?page=${page}`, { signal }));
        setError('');
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      }
    },
    [id, page],
  );
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load(c.signal);
    }, 15000);
    return () => {
      c.abort();
      clearInterval(t);
    };
  }, [load]);
  if (error) return <ErrorBox message={error} retry={() => void load()} />;
  if (!data) return <Spinner />;
  const q = data.qr;
  return (
    <>
      <div className="usage-summary panel">
        <div>
          <h2>
            {q.label} <Status active={q.active} />
          </h2>
          <code>{q.code}</code>
          <QuotaBar qr={q} />
        </div>
        <div className="usage-numbers">
          <span>
            <strong>{number(q.total_limit)}</strong>total kuota
          </span>
          <span>
            <strong>{number(q.used_count)}</strong>foto diambil
          </span>
          <span>
            <strong>{number(q.remaining)}</strong>foto tersisa
          </span>
          <span>
            <strong>
              {q.allocated_sessions}/{q.max_sessions}
            </strong>
            slot teralokasi
          </span>
        </div>
      </div>
      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>Guest session history</h2>
            <p>
              {data.total} sesi tercatat · {q.per_session_limit} foto per sesi · {q.unallocated}{' '}
              foto tidak teralokasi
            </p>
          </div>
          <span className="live-indicator">
            <span /> Pembaruan otomatis
          </span>
        </div>
        {data.sessions.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID sesi</th>
                  <th>Waktu mulai (WIB)</th>
                  <th>Foto diambil</th>
                  <th>Status sesi</th>
                  <th>Berakhir (WIB)</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <code>{s.id.slice(0, 8)}</code>
                    </td>
                    <td>{dateTime(s.created_at)}</td>
                    <td>
                      {s.photo_count} / {s.photo_limit}
                    </td>
                    <td>
                      <span
                        className={`status ${s.status === 'active' ? 'status-active' : 'status-inactive'}`}
                      >
                        {s.status === 'completed'
                          ? 'Selesai'
                          : s.status === 'expired'
                            ? 'Kedaluwarsa'
                            : 'Aktif'}
                      </span>
                    </td>
                    <td>{dateTime(s.expires_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <SmallEmpty
            icon={<Users size={28} />}
            title="Waiting for the first smile"
            text="Sesi tamu akan tercatat ketika QR digunakan untuk memulai photo booth."
          />
        )}
        {data.pages > 1 && <Pagination page={page} pages={data.pages} onChange={setPage} />}
      </section>
    </>
  );
}

function PhotoManagement({ csrf }: { csrf: string }) {
  const { current } = useContext(WorkspaceContext);
  const { qrs } = useQrs(),
    [result, setResult] = useState<PhotoList | null>(null),
    [search, setSearch] = useState(''),
    [qr, setQr] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [page, setPage] = useState(1),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<Photo | null>(null),
    [revision, setRevision] = useState(0),
    [deleting, setDeleting] = useState(false),
    toast = useToast();
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    const timeout = setTimeout(() => {
      const params = new URLSearchParams({ page: String(page), limit: '24' });
      if (search) params.set('search', search);
      if (qr) params.set('qr', qr);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      api<PhotoList>(`/admin/photos?${params}`, { signal: c.signal })
        .then((data) => {
          setResult(data);
          setError('');
        })
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message);
        })
        .finally(() => {
          if (!c.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timeout);
      c.abort();
    };
  }, [search, qr, from, to, page, revision]);
  async function remove() {
    if (
      !selected ||
      deleting ||
      !confirm(
        'Hapus foto ini dari galeri? Riwayat dan kuota yang sudah terpakai akan dipertahankan.',
      )
    )
      return;
    setDeleting(true);
    try {
      await api(`/admin/photos/${selected.id}`, json('DELETE', undefined, csrf));
      setSelected(null);
      toast('Foto telah dihapus dari galeri.');
      setPage(1);
      setRevision((v) => v + 1);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setDeleting(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="A COLLECTION OF LITTLE HAPPINESSES"
        title="Photo library"
        description="Lihat dan kelola semua momen yang dibagikan para tamu."
      >
        {current?.code && (
          <Link to={`/${current.username}/${current.code}/gallery`} className="btn btn-outline">
            Buka galeri <ExternalLink size={16} />
          </Link>
        )}
      </PageTitle>
      <section className="panel photo-management-panel">
        <div className="photo-filters">
          <label>
            <span>QR code</span>
            <select
              value={qr}
              onChange={(e) => {
                setQr(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Semua QR codes</option>
              {qrs.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Dari tanggal (WIB)</span>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            <span>Sampai tanggal (WIB)</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="photo-search">
            <span>Cari foto</span>
            <span className="search-input">
              <Search size={16} />
              <input
                value={search}
                placeholder="Nama file, QR, atau ID foto…"
                maxLength={100}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </span>
          </label>
        </div>
        <div className="photo-count">
          <span>
            <ImageIcon size={16} /> {number(result?.total || 0)} foto ditemukan
          </span>
          <button
            className="text-link"
            onClick={() => {
              setSearch('');
              setQr('');
              setFrom('');
              setTo('');
              setPage(1);
              setRevision((v) => v + 1);
            }}
          >
            Reset filter <X size={13} />
          </button>
        </div>
        {error && <ErrorBox message={error} retry={() => setRevision((v) => v + 1)} />}{' '}
        {loading ? (
          <Spinner />
        ) : result?.photos.length ? (
          <PhotoGrid photos={result.photos} onSelect={setSelected} />
        ) : (
          !error && (
            <SmallEmpty
              icon={<ImageIcon size={30} strokeWidth={1} />}
              title="Belum ada foto untuk ditampilkan"
              text="Foto yang berhasil disimpan tamu akan muncul di sini. Coba ubah filter bila diperlukan."
            />
          )
        )}
        {result && result.pages > 1 && (
          <Pagination page={page} pages={result.pages} onChange={setPage} />
        )}
      </section>
      {selected && (
        <PhotoViewer
          onEdit={async (message, rotate) => {
            await api('/admin/photos/' + selected.id, json('PUT', { message, rotate }, csrf));
            setSelected(null);
            setRevision((v) => v + 1);
            toast('Foto diperbarui.');
          }}
          photo={selected}
          onClose={() => setSelected(null)}
          onDelete={deleting ? undefined : () => void remove()}
        />
      )}
    </>
  );
}
