import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, X, LoaderCircle, Heart, ArrowRight } from 'lucide-react';
import type { WeddingEvent } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${url}`, { credentials: 'same-origin', ...options, headers });
  const result = await response
    .json()
    .catch(() => ({ message: 'Server tidak dapat dijangkau. Coba kembali.' }));
  if (!response.ok)
    throw new ApiError(result.message || 'Permintaan gagal.', result.code, response.status);
  return result;
}
export const json = (method: string, data?: unknown, csrf?: string): RequestInit => ({
  method,
  headers: csrf ? { 'X-CSRF-Token': csrf } : {},
  body: data === undefined ? undefined : JSON.stringify(data),
});
export const number = (v: number) => v.toLocaleString('id-ID');
export const dateTime = (v: string) =>
  new Date(v).toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  });
export const weddingDate = (v: string) =>
  v
    ? new Date(`${v}T12:00:00`).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : 'A celebration of love';

const RouterContext = createContext({ path: '/', go: (_path: string) => {} });
export const scopedPath = (base: string, path: string) =>
  base && ['/', '/gallery', '/camera'].includes(path) ? base + (path === '/' ? '' : path) : path;
export const GuestScope = createContext('');
export function GuestRouter({
  base,
  path,
  children,
}: {
  base: string;
  path: string;
  children: ReactNode;
}) {
  const parent = useRouter();
  return (
    <GuestScope.Provider value={base}>
      <RouterContext.Provider value={{ path, go: (p) => parent.go(scopedPath(base, p)) }}>
        {children}
      </RouterContext.Provider>
    </GuestScope.Provider>
  );
}
export function Router({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const pop = () => setPath(location.pathname);
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, []);
  function go(next: string) {
    if (next === location.pathname) return;
    history.pushState({}, '', next);
    setPath(next);
    window.scrollTo({ top: 0 });
  }
  return <RouterContext.Provider value={{ path, go }}>{children}</RouterContext.Provider>;
}
export const useRouter = () => useContext(RouterContext);
export function Link({
  to,
  children,
  className = '',
  ...props
}: {
  to: string;
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}) {
  const { go } = useRouter();
  const base = useContext(GuestScope);
  return (
    <a
      href={scopedPath(base, to)}
      className={className}
      onClick={(e) => {
        if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          go(to);
        }
      }}
      {...props}
    >
      {children}
    </a>
  );
}
const EventContext = createContext<{
  event: WeddingEvent | null;
  refresh: () => Promise<void>;
  error: string;
}>({ event: null, refresh: async () => {}, error: '' });
export function EventProvider({
  children,
  endpoint = '/event',
}: {
  children: ReactNode;
  endpoint?: string;
}) {
  const [event, setEvent] = useState<WeddingEvent | null>(null),
    [error, setError] = useState('');
  async function refresh() {
    try {
      setEvent(await api<WeddingEvent>(endpoint));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
  }, [endpoint]);
  return (
    <EventContext.Provider value={{ event, refresh, error }}>{children}</EventContext.Provider>
  );
}
export const useEvent = () => useContext(EventContext);
const ToastContext = createContext((_message: string, _error?: boolean) => {});
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; error: boolean; key: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <ToastContext.Provider
      value={(message, error = false) => setToast({ message, error, key: Date.now() })}
    >
      {children}
      {toast && (
        <div
          className={`toast ${toast.error ? 'toast-error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <X size={18} /> : <Check size={18} />}
          <span>{toast.message}</span>
          <button className="icon-btn" aria-label="Tutup notifikasi" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}
export function Spinner({ text = 'Memuat…' }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} />
      <span>{text}</span>
    </div>
  );
}
export function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <p>{message}</p>
      {retry && (
        <button className="btn btn-small btn-outline" onClick={retry}>
          Coba kembali <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <Link to="/" className={`brand ${small ? 'brand-small' : ''}`}>
      <span className="brand-icon">
        <Heart size={21} strokeWidth={1.2} />
      </span>
      <span>
        vows <i>&</i> views<small>WEDDING MEMORIES</small>
      </span>
    </Link>
  );
}
export function Monogram() {
  const { event } = useEvent();
  return (
    <div className="monogram">
      {event?.partner_one[0] || 'V'}
      <Heart size={14} />
      {event?.partner_two[0] || 'V'}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = document.querySelector<HTMLDivElement>('[data-modal="true"]');
    dialog?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key !== 'Tab' || !dialog) return;
      const nodes = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select,textarea,[tabindex="0"]',
        ),
      );
      const first = nodes[0],
        last = nodes.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    addEventListener('keydown', handle);
    return () => {
      document.body.style.overflow = oldOverflow;
      removeEventListener('keydown', handle);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-modal="true"
        tabIndex={-1}
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header>
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="icon-btn" aria-label="Tutup dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
