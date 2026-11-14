import { FilterPicker, LiveFilter } from './filter-picker';
import { names, renderFrame, type FilterName } from './camera-filters';
import { useContext, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDown,
  ArrowRight,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Expand,
  Heart,
  Image as ImageIcon,
  LockKeyhole,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  SwitchCamera,
  Upload,
} from 'lucide-react';
import {
  api,
  ApiError,
  GuestScope,
  Brand,
  ErrorBox,
  json,
  Link,
  Modal,
  Monogram,
  number,
  Spinner,
  useEvent,
  useRouter,
  useToast,
  weddingDate,
  dateTime,
} from './lib';
import type { WeddingEvent, GuestSession, Photo, PhotoList } from './types';
import { prepareUpload } from './upload-image';

const hero =
  'https://images.unsplash.com/photo-1617202000199-15fab1b09935?auto=format&fit=crop&w=1600&q=85';
export function GuestApp() {
  const { path } = useRouter();
  const { event } = useEvent();
  return (
    <div className="guest-app" style={{ '--rose': event?.theme } as React.CSSProperties}>
      <GuestHeader />
      {path === '/' ? (
        <Landing />
      ) : path === '/gallery' ? (
        <Gallery />
      ) : path.startsWith('/camera') ? (
        <CameraPage key={path} />
      ) : (
        <main className="page narrow">
          <h1>Halaman tidak ditemukan</h1>
          <Link to="/" className="btn btn-primary">
            Kembali ke beranda
          </Link>
        </main>
      )}
      <footer className="guest-footer">
        <Brand small />
        <p>Little moments. Forever memories.</p>
        <Link to="/admin">
          <LockKeyhole size={13} /> Admin
        </Link>
      </footer>
    </div>
  );
}
function GuestHeader() {
  const { path } = useRouter(),
    { event } = useEvent();
  return (
    <header className="guest-header">
      <div className="header-inner">
        {event?.images.logo ? (
          <Link to="/">
            <img className="event-logo" src={event.images.logo} alt="Logo acara" />
          </Link>
        ) : (
          <Brand />
        )}
        <nav aria-label="Navigasi tamu">
          <Link to="/" className={path === '/' ? 'active' : ''}>
            Beranda
          </Link>
          <Link to="/gallery" className={path === '/gallery' ? 'active' : ''}>
            Galeri foto
          </Link>
        </nav>
        <Link to="/camera" className="btn btn-small btn-primary">
          <Camera size={16} />
          <span>Take your photo</span>
        </Link>
      </div>
      <div className="event-ribbon">
        <span>{event ? `${event.partner_one} & ${event.partner_two}` : 'Our wedding'}</span>
        <span className="ribbon-dot" />
        <span>{event ? weddingDate(event.wedding_date) : 'A celebration of love'}</span>
      </div>
    </header>
  );
}
function Landing() {
  const { event, error, refresh } = useEvent();
  const base = useContext(GuestScope);
  const [quota, setQuota] = useState<number | null>(null);
  useEffect(() => {
    if (!base) return;
    const c = new AbortController();
    api<QrStatus>('/qr/' + base.split('/')[2], { signal: c.signal })
      .then((q) => setQuota(q.session?.remaining ?? Math.min(q.remaining, q.per_session_limit)))
      .catch((e) => {
        if (!c.signal.aborted) setPhotoError(e.message);
      });
    return () => c.abort();
  }, [base]);
  const [latest, setLatest] = useState<PhotoList | null>(null),
    [photoError, setPhotoError] = useState('');
  const [selected, setSelected] = useState<Photo | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<PhotoList>((base ? '/invites' + base : '') + '/photos?limit=4', {
      signal: controller.signal,
    })
      .then(setLatest)
      .catch((e) => {
        if (e.name !== 'AbortError') setPhotoError(e.message);
      });
    return () => controller.abort();
  }, []);
  return (
    <main>
      <LandingHero
        event={event}
        notice={
          quota === null
            ? ''
            : quota === 0
              ? quotaDone
              : `Selamat datang! Anda mendapatkan kesempatan mengambil maksimal ${quota} foto.`
        }
      />
      {error && <ErrorBox message={error} retry={refresh} />}
      {event?.images.banner && (
        <img className="event-banner" src={event.images.banner} alt="Banner acara" />
      )}
      <section id="how-it-works" className="how-section">
        <div className="section-heading">
          <p className="eyebrow">MADE FOR EVERYONE</p>
          <h2>
            Hadir. Tersenyum. <em>Abadikan.</em>
          </h2>
          <p>Kenangan indah hanya berjarak tiga langkah sederhana.</p>
        </div>
        <div className="steps">
          {[
            {
              icon: QrCode,
              title: 'Scan your invitation',
              text: 'Pindai QR Code dari penyelenggara untuk membuka photo booth.',
            },
            {
              icon: Camera,
              title: 'Capture the happiness',
              text: 'Izinkan kamera, temukan pose terbaik, dan ambil foto Anda.',
            },
            {
              icon: Heart,
              title: 'Keep it forever',
              text: 'Simpan foto dan temukan momen bersama di galeri pernikahan.',
            },
          ].map((step, i) => (
            <div className="step" key={step.title}>
              <span className="step-number">0{i + 1}</span>
              <div className="step-icon">
                <step.icon size={24} strokeWidth={1.3} />
              </div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="memory-section">
        <div className="section-row">
          <div>
            <p className="eyebrow">THROUGH YOUR EYES</p>
            <h2>
              A gallery of <em>happy little moments.</em>
            </h2>
          </div>
          <Link to="/gallery" className="text-link">
            Lihat semua foto <ArrowRight size={17} />
          </Link>
        </div>
        {photoError ? (
          <ErrorBox message={photoError} />
        ) : latest === null ? (
          <Spinner />
        ) : latest.photos.length ? (
          <PhotoGrid photos={latest.photos} onSelect={setSelected} />
        ) : (
          <div className="empty-gallery-preview">
            <ImageIcon size={34} strokeWidth={1} />
            <h3>Kenangan pertama dimulai dari Anda</h3>
            <p>Foto yang disimpan tamu akan hadir di sini secara otomatis.</p>
            <Link to="/camera" className="text-link">
              Abadikan momen pertama <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </section>
      <section className="love-note">
        <Monogram />
        <h2>
          Terima kasih telah menjadi
          <br />
          bagian dari <em>cerita kami.</em>
        </h2>
        <p>
          With love, {event?.partner_one || 'Amelia'} & {event?.partner_two || 'Rafael'}
        </p>
        <Heart size={17} strokeWidth={1.2} />
      </section>
      {selected && <PhotoViewer photo={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}

export function LandingHero({ event, notice }: { event: WeddingEvent | null; notice?: string }) {
  return (
    <section
      className={'hero-section position-' + (event?.position || 'left')}
      style={{
        backgroundImage: event?.images.background
          ? `linear-gradient(#ffffffb3,#ffffffb3),url("${event.images.background}")`
          : undefined,
      }}
    >
      <div className="hero-copy">
        <div className="eyebrow">
          <span /> {event?.title || 'The wedding of'} <span />
        </div>
        <h1>
          {event?.partner_one || 'Amelia'} <em>&</em>
          <br />
          {event?.partner_two || 'Rafael'}
          <span className="hero-title-heart">
            <Heart size={24} strokeWidth={1} />
          </span>
        </h1>
        <p className="hero-tagline">Our day. Your perspective.</p>
        <p className="hero-description">
          {event?.welcome_message ||
            'Setiap senyum, setiap pelukan, setiap momen kecil. Abadikan kebahagiaan hari ini bersama kami.'}
        </p>
        <div className="hero-actions">
          <Link to="/camera" className="btn btn-primary">
            <Camera size={18} /> Take your photo <ArrowRight size={17} />
          </Link>
          <Link to="/gallery" className="btn btn-outline">
            <ImageIcon size={17} /> View gallery
          </Link>
        </div>
        <div className="hero-note">
          <ShieldCheck size={15} />
          <span>Tanpa aplikasi. Cukup senyum & abadikan.</span>
        </div>
        {notice && (
          <p role="status" className="quota-notice">
            {notice}
          </p>
        )}
      </div>
      <div className="hero-visual">
        <div className="photo-arch">
          <img
            src={event?.images.hero || hero}
            alt="Pasangan pengantin berbagi momen bahagia di taman"
            fetchPriority="high"
          />
          <div className="hero-photo-shade" />
          <div className="photo-caption">
            a little love,
            <br />
            <i>a lifetime of memories.</i>
          </div>
        </div>
        {event?.images.decoration ? (
          <img className="event-decoration" src={event.images.decoration} alt="" />
        ) : (
          <div className="forever-seal">
            <Heart size={20} />
            <span>
              TOGETHER
              <br />
              IS A BEAUTIFUL
              <br />
              PLACE TO BE
            </span>
          </div>
        )}
        <span className="hero-side-note">EST. A LIFETIME OF LOVE</span>
      </div>
      <a className="scroll-hint" href="#how-it-works">
        <ArrowDown size={15} /> A little moment, made forever
      </a>
    </section>
  );
}
export function PhotoGrid({ photos, onSelect }: { photos: Photo[]; onSelect: (p: Photo) => void }) {
  return (
    <div className="photo-grid">
      {photos.map((p, i) => (
        <figure className="photo-card" key={p.id}>
          <button
            className="photo-tile"
            onClick={() => onSelect(p)}
            aria-label={`Lihat foto ${i + 1}, ${dateTime(p.created_at)}`}
          >
            <img
              src={p.thumbnail}
              loading="lazy"
              alt={`Momen pernikahan, ${dateTime(p.created_at)}`}
              width={p.width}
              height={p.height}
            />
            <span className="photo-overlay">
              <Expand size={22} />
              <span>
                {new Date(p.created_at).toLocaleDateString('id-ID', {
                  day: 'numeric',
                  month: 'short',
                  timeZone: 'Asia/Jakarta',
                })}
              </span>
            </span>
          </button>
          {p.message && <figcaption className="photo-message">{p.message}</figcaption>}
        </figure>
      ))}
    </div>
  );
}
export function PhotoViewer({
  photo,
  onClose,
  onDelete,
  onEdit,
}: {
  photo: Photo;
  onClose: () => void;
  onDelete?: () => void;
  onEdit?: (text: string, rotate: number) => Promise<void>;
}) {
  const [edit, setEdit] = useState(false),
    [caption, setCaption] = useState(photo.message),
    [rotation, setRotation] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal title="A moment to remember" onClose={onClose} wide>
      <div className="lightbox-image">
        <img
          src={photo.url}
          style={{ transform: `rotate(${rotation}deg)` }}
          alt="Foto pernikahan dalam ukuran penuh"
        />
      </div>
      {photo.message && <p className="lightbox-message">{photo.message}</p>}
      {onEdit &&
        (edit ? (
          <form
            className="settings-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await onEdit(caption, rotation);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Pesan foto
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                maxLength={500}
              />
            </label>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setRotation((v) => (v + 90) % 360)}
            >
              Putar 90°
            </button>
            {error && <ErrorBox message={error} />}
            <button className="btn btn-primary" disabled={busy}>
              Simpan perubahan foto
            </button>
          </form>
        ) : (
          <button className="btn btn-outline" onClick={() => setEdit(true)}>
            Edit foto
          </button>
        ))}
      <div className="lightbox-meta">
        <div>
          <p>{dateTime(photo.created_at)} WIB</p>
          {photo.qr_label && (
            <small>
              {photo.qr_label} · Sesi {photo.session_id?.slice(0, 8)}
              <br />
              {photo.original_filename} · {((photo.file_size || 0) / 1024).toFixed(0)} KB
            </small>
          )}
        </div>
        <a
          href={`${photo.url}?download=1`}
          download={`wedding-${photo.id}.jpg`}
          className="btn btn-small btn-outline"
        >
          <Download size={16} /> Unduh foto
        </a>
        {onDelete && (
          <button className="btn btn-small btn-danger" onClick={onDelete}>
            Hapus foto
          </button>
        )}
      </div>
    </Modal>
  );
}
function Gallery() {
  const base = useContext(GuestScope);
  const [result, setResult] = useState<PhotoList | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState<Photo | null>(null);
  const reload = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setResult(
          await api<PhotoList>(`${base ? '/invites' + base : ''}/photos?page=${page}&limit=24`, {
            signal,
          }),
        );
        setError('');
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [page, base],
  );
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    void reload(c.signal);
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void reload(c.signal);
    }, 15000);
    return () => {
      c.abort();
      clearInterval(t);
    };
  }, [reload]);
  return (
    <main className="page gallery-page">
      <div className="page-intro">
        <Monogram />
        <p className="eyebrow">OUR SHARED MEMORIES</p>
        <h1>
          Our photo <em>gallery.</em>
        </h1>
        <p>Sudut pandang Anda, kenangan indah kita bersama.</p>
      </div>
      <div className="gallery-toolbar">
        <span className="count-badge">
          <ImageIcon size={16} />
          {number(result?.total || 0)} foto
        </span>
        <span className="live-indicator">
          <span /> Terbaru ditampilkan lebih dulu
        </span>
        <Link to="/camera" className="text-link">
          <Camera size={17} /> Tambahkan momen
        </Link>
      </div>
      {error && <ErrorBox message={error} retry={() => void reload()} />}{' '}
      {loading ? (
        <Spinner />
      ) : result?.photos.length ? (
        <PhotoGrid photos={result.photos} onSelect={setSelected} />
      ) : (
        !error && (
          <div className="empty-state">
            <Heart size={40} strokeWidth={1} />
            <h2>Galeri menunggu senyum pertama</h2>
            <p>Gunakan QR Code acara untuk mengambil dan membagikan foto Anda.</p>
            <Link to="/camera" className="btn btn-primary">
              <Camera size={17} /> Take your photo
            </Link>
          </div>
        )
      )}
      {result && result.pages > 1 && (
        <Pagination page={page} pages={result.pages} onChange={setPage} />
      )}
      <p className="gallery-footnote">
        <Heart size={13} /> Thank you for sharing your beautiful moments.
      </p>
      {selected && <PhotoViewer photo={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}
export function Pagination({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (p: number) => void;
}) {
  return (
    <div className="pagination">
      <button
        className="icon-btn"
        aria-label="Halaman sebelumnya"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeft size={18} />
      </button>
      <span>
        Halaman {page} dari {pages}
      </span>
      <button
        className="icon-btn"
        aria-label="Halaman berikutnya"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

function QrAccess() {
  const [value, setValue] = useState(''),
    [error, setError] = useState(''),
    { go } = useRouter();
  function submit(e: FormEvent) {
    e.preventDefault();
    let code = value.trim();
    try {
      if (code.includes('://')) {
        const url = new URL(code);
        if (url.origin !== location.origin) throw Error();
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length !== 2) throw Error();
        if (parts[0] !== 'camera') {
          go(url.pathname + '/camera');
          return;
        }
        code = parts[1];
      }
    } catch {
      code = '';
    }
    if (!/^[\w-]{1,64}$/.test(code)) {
      setError('Masukkan kode atau tautan QR yang diberikan penyelenggara.');
      return;
    }
    go(`/camera/${code}`);
  }
  return (
    <div className="qr-access">
      <div className="access-icon">
        <ScanLine size={42} strokeWidth={1} />
      </div>
      <h2>Your invitation to make memories</h2>
      <p>Pindai QR Code yang tersedia di lokasi acara menggunakan kamera ponsel Anda.</p>
      <div className="divider-text">atau masukkan tautan QR</div>
      <form onSubmit={submit}>
        <label htmlFor="qr-code">Kode / tautan undangan</label>
        <input
          id="qr-code"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Tempel tautan QR Code di sini"
          required
          autoComplete="off"
        />
        {error && <p className="field-error">{error}</p>}
        <button className="btn btn-primary" type="submit">
          Buka photo booth <ArrowRight size={16} />
        </button>
      </form>
      <p className="access-help">
        <ShieldCheck size={15} /> Akses khusus tamu dengan QR Code acara.
      </p>
    </div>
  );
}
interface QrStatus {
  label: string;
  remaining: number;
  per_session_limit: number;
  session: GuestSession | null;
  path: string;
}
const quotaDone =
  'Kuota foto Anda telah habis. Terima kasih telah menggunakan Wedding Photography!';
function CameraPage() {
  const base = useContext(GuestScope),
    { event } = useEvent();
  const [filter, setFilter] = useState<FilterName>('Original');
  const { path, go } = useRouter(),
    code = (base || path).split('/')[2];
  const [qr, setQr] = useState<{
      label: string;
      remaining: number;
      per_session_limit: number;
    } | null>(null),
    [session, setSession] = useState<GuestSession | null>(null),
    [error, setError] = useState(''),
    [cameraError, setCameraError] = useState(''),
    [validating, setValidating] = useState(Boolean(code)),
    [starting, setStarting] = useState(false),
    [ready, setReady] = useState(false),
    [facing, setFacing] = useState<'user' | 'environment'>('user'),
    [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null),
    [message, setMessage] = useState(''),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false),
    [countdown, setCountdown] = useState<number | null>(null),
    [timer, setTimer] = useState(true);
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    mounted = useRef(true),
    previewUrl = useRef(''),
    requestKey = useRef(''),
    sessionChange = useRef(0),
    inFlight = useRef(false),
    cameraRequest = useRef(0),
    countTimer = useRef<ReturnType<typeof setInterval> | null>(null),
    toast = useToast();
  const stop = useCallback(() => {
    cameraRequest.current++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setReady(false);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const hidden = () => {
      if (document.visibilityState === 'hidden') {
        stop();
        if (countTimer.current) clearInterval(countTimer.current);
        setCountdown(null);
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      mounted.current = false;
      stream.current?.getTracks().forEach((t) => t.stop());
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      if (countTimer.current) clearInterval(countTimer.current);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [stop]);
  const validate = useCallback(
    async (signal?: AbortSignal) => {
      if (!code) return;
      setValidating(true);
      setError('');
      try {
        const status = await api<QrStatus>(`/qr/${encodeURIComponent(code)}`, { signal });
        if (!base) {
          go(status.path + '/camera');
          return;
        }
        if (status.path !== base) throw Error('Undangan tidak ditemukan.');
        setQr(status);
        setSession(status.session);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      } finally {
        if (!signal?.aborted) setValidating(false);
      }
    },
    [code],
  );
  useEffect(() => {
    const c = new AbortController();
    void validate(c.signal);
    return () => c.abort();
  }, [validate]);
  useEffect(() => {
    if (!base || !code) return;
    const c = new AbortController();
    let revision = 0;
    async function sync() {
      if (document.hidden || inFlight.current) return;
      const seq = ++revision,
        localVersion = sessionChange.current;
      try {
        const status = await api<QrStatus>('/qr/' + code, { signal: c.signal });
        if (
          c.signal.aborted ||
          seq !== revision ||
          sessionChange.current !== localVersion ||
          inFlight.current
        )
          return;
        if (status.path !== base) throw Error('Undangan tidak ditemukan.');
        setQr(status);
        setSession(status.session);
        if ((status.session?.remaining ?? status.remaining) <= 0) stop();
      } catch (e) {
        if (!c.signal.aborted) {
          setError((e as Error).message);
          if (e instanceof ApiError && [403, 404].includes(e.status)) {
            stop();
            setQr(null);
          }
        }
      }
    }
    const timer = setInterval(sync, 5000);
    window.addEventListener('focus', sync);
    return () => {
      c.abort();
      clearInterval(timer);
      window.removeEventListener('focus', sync);
    };
  }, [base, code, stop]);
  async function openCamera(nextFacing = facing) {
    stop();
    setCameraError('');
    setStarting(true);
    const generation = cameraRequest.current;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        'Kamera memerlukan HTTPS dan browser yang mendukung. Anda tetap dapat memilih foto dari perangkat.',
      );
      setStarting(false);
      return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: nextFacing },
          width: { ideal: 2560 },
          height: { ideal: 1920 },
        },
        audio: false,
      });
      if (!mounted.current || generation !== cameraRequest.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
      setReady(true);
      setFacing(nextFacing);
    } catch (e) {
      if (!mounted.current || generation !== cameraRequest.current) return;
      stop();
      const name = (e as DOMException).name;
      setCameraError(
        name === 'NotAllowedError'
          ? 'Izin kamera belum diberikan. Izinkan kamera melalui pengaturan browser, lalu coba kembali, atau pilih foto dari perangkat.'
          : name === 'NotFoundError'
            ? 'Kamera tidak ditemukan. Pilih foto dari perangkat untuk melanjutkan.'
            : 'Kamera belum dapat dibuka. Tutup aplikasi lain yang menggunakan kamera lalu coba kembali.',
      );
      setStarting(false);
    } finally {
      if (mounted.current && generation === cameraRequest.current) setStarting(false);
    }
  }
  async function start(useCamera = true) {
    if (inFlight.current) return;
    inFlight.current = true;
    sessionChange.current++;
    setStarting(true);
    setError('');
    try {
      const s = await api<GuestSession>(`/guest/${code}/session`, json('POST'));
      if (!mounted.current) return;
      setSession(s);
      inFlight.current = false;
      if (useCamera && s.remaining > 0) await openCamera();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      inFlight.current = false;
      if (mounted.current) setStarting(false);
    }
  }
  function setPhoto(blob: Blob) {
    stop();
    setStarting(false);
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    const url = URL.createObjectURL(blob);
    previewUrl.current = url;
    requestKey.current = crypto.randomUUID();
    setPreview({ blob, url });
    setSaved(false);
    setMessage('');
  }
  async function selectFile(file: File) {
    if (file.size > 12 * 1024 * 1024) {
      toast('Ukuran foto maksimal 12 MB.', true);
      return;
    }
    if (filter === 'Original') {
      setPhoto(file);
      return;
    }
    const url = URL.createObjectURL(file);
    setStarting(true);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      renderFrame(canvas, image, filter);
      const blob = await new Promise<Blob | null>((done) =>
        canvas.toBlob(done, 'image/jpeg', 0.94),
      );
      if (!blob) throw Error('Gagal memproses foto.');
      if (mounted.current) setPhoto(blob);
    } catch {
      if (mounted.current) toast('Foto tidak dapat diproses. Pilih gambar lain.', true);
    } finally {
      URL.revokeObjectURL(url);
      if (mounted.current) setStarting(false);
    }
  }
  function capture() {
    if (!video.current?.videoWidth || !ready) return;
    const canvas = document.createElement('canvas'),
      v = video.current;
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    renderFrame(canvas, v, filter, facing === 'user');
    canvas.toBlob(
      (blob) => {
        if (blob && mounted.current) setPhoto(blob);
      },
      'image/jpeg',
      0.94,
    );
  }
  function shoot() {
    if (countdown !== null || !ready) return;
    if (!timer) {
      capture();
      return;
    }
    let count = 3;
    setCountdown(count);
    countTimer.current = setInterval(() => {
      count--;
      if (count <= 0) {
        if (countTimer.current) clearInterval(countTimer.current);
        setCountdown(null);
        capture();
      } else setCountdown(count);
    }, 1000);
  }
  function retake() {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = '';
    setPreview(null);
    setSaved(false);
    if (!stream.current && session && session.remaining > 0) void openCamera();
  }
  async function save() {
    if (!preview || !session || inFlight.current) return;
    inFlight.current = true;
    sessionChange.current++;
    setSaving(true);
    setError('');
    try {
      const blob = await prepareUpload(preview.blob);
      const form = new FormData();
      form.append(
        'photo',
        blob,
        `wedding-${Date.now()}.${blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'}`,
      );
      form.append('message', message.trim());
      const result = await api<{ photo: Photo; session: GuestSession }>(`/guest/${code}/photos`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrf, 'Idempotency-Key': requestKey.current },
        body: form,
      });
      if (mounted.current) {
        setSession(result.session);
        setMessage(result.photo.message);
        setSaved(true);
        stop();
        toast(
          result.session.remaining
            ? `Foto berhasil diambil. Sisa kesempatan Anda: ${result.session.remaining} foto.`
            : quotaDone,
        );
      }
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        if (
          e instanceof ApiError &&
          ['SESSION_QUOTA_EXHAUSTED', 'QUOTA_EXHAUSTED'].includes(e.code)
        ) {
          setSession({ ...session, remaining: 0 });
          stop();
        }
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  const remaining = session?.remaining ?? Math.min(qr?.remaining ?? 0, qr?.per_session_limit ?? 0);
  const exhausted = remaining <= 0;
  return (
    <main className="page camera-page">
      <div className="page-intro">
        <Monogram />
        <p className="eyebrow">A MOMENT, JUST FOR YOU</p>
        <h1>
          Let’s make a <em>memory.</em>
        </h1>
        <p>Smile, capture, and make it memorable.</p>
      </div>
      {!code ? (
        <QrAccess />
      ) : validating ? (
        <Spinner text="Memvalidasi undangan Anda…" />
      ) : !qr ? (
        <div className="camera-error-state">
          <ErrorBox message={error} retry={() => void validate()} />
          <Link to="/camera" className="text-link">
            Gunakan QR Code lain <ArrowRight size={16} />
          </Link>
        </div>
      ) : (
        <div className="booth">
          <p className="quota-notice" role="status">
            {exhausted
              ? quotaDone
              : session?.photo_count
                ? `Sisa kesempatan Anda: ${remaining} foto.`
                : `Selamat datang! Anda mendapatkan kesempatan mengambil maksimal ${remaining} foto.`}
          </p>
          <div className="booth-top">
            <span>
              <span className="live-dot" />
              {qr.label}
            </span>
            <span>
              {session
                ? `${session.remaining} dari ${session.photo_limit} foto tersisa`
                : `${qr.per_session_limit} foto per sesi`}
            </span>
          </div>
          <div className={`camera-stage ${facing === 'user' ? 'front-camera' : ''}`}>
            <video
              ref={video}
              autoPlay
              playsInline
              muted
              className={ready && !preview ? 'visible' : ''}
            />
            <LiveFilter
              video={video}
              ready={ready && !preview}
              filter={filter}
              mirror={facing === 'user'}
            />
            {preview && (
              <img
                className="capture-preview"
                src={preview.url}
                alt="Pratinjau foto Anda sebelum disimpan"
              />
            )}
            {!ready && !preview && (
              <div className="camera-placeholder">
                <div className="camera-placeholder-icon">
                  {exhausted ? (
                    <Check size={40} strokeWidth={1} />
                  ) : (
                    <Camera size={40} strokeWidth={1} />
                  )}
                </div>
                <h2>{exhausted ? 'Thank you for the memories!' : 'Your best smile goes here'}</h2>
                <p>
                  {exhausted
                    ? 'Kuota sesi Anda telah selesai. Temukan foto Anda di galeri.'
                    : 'Temukan cahaya yang indah, ajak orang tersayang, dan abadikan kebahagiaan.'}
                </p>
                {!exhausted && (
                  <button
                    className="btn btn-primary"
                    disabled={starting}
                    onClick={() => (session ? void openCamera() : void start())}
                  >
                    {starting ? <RefreshCw size={17} className="spin" /> : <Camera size={17} />}{' '}
                    {starting ? 'Menyiapkan sesi…' : session ? 'Buka kamera' : 'Aktifkan kamera'}
                  </button>
                )}
                {exhausted && (
                  <Link to="/gallery" className="btn btn-primary">
                    Lihat galeri <ArrowRight size={16} />
                  </Link>
                )}
              </div>
            )}
            <span className="corner corner-tl" />
            <span className="corner corner-tr" />
            <span className="corner corner-bl" />
            <span className="corner corner-br" />
            {ready && !preview && (
              <button
                className="camera-switch icon-btn"
                aria-label="Ganti kamera"
                disabled={countdown !== null || starting}
                onClick={() => void openCamera(facing === 'user' ? 'environment' : 'user')}
              >
                <SwitchCamera size={23} />
              </button>
            )}
            {countdown !== null && (
              <div className="countdown" role="status">
                {countdown}
              </div>
            )}
            {saved && (
              <div className="saved-banner">
                <Check size={17} /> Foto berhasil disimpan
              </div>
            )}
          </div>
          {!preview && !exhausted && (
            <FilterPicker
              value={filter}
              enabled={event?.filters ?? names}
              onChange={setFilter}
              disabled={countdown !== null}
              video={video.current}
            />
          )}
          {cameraError && (
            <div className="camera-advice" role="alert">
              {cameraError}
            </div>
          )}
          {error && <ErrorBox message={error} />}
          {preview && (
            <div className="photo-message-field">
              <label htmlFor="photo-message">
                Pesan untuk pengantin <span>(opsional)</span>
              </label>
              <textarea
                id="photo-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Tulis ucapan atau cerita di balik momen ini…"
                maxLength={500}
                rows={3}
                disabled={saving || saved}
                aria-describedby="photo-message-hint photo-message-count"
              />
              <div className="photo-message-help">
                <small id="photo-message-hint">
                  Pesan akan tampil di bawah foto pada galeri publik.
                </small>
                <small id="photo-message-count">{message.length}/500</small>
              </div>
            </div>
          )}
          <div className="booth-controls">
            {preview ? (
              <>
                <button
                  className="btn btn-outline"
                  onClick={retake}
                  disabled={saving || Boolean(exhausted)}
                >
                  <RefreshCw size={16} />
                  {saved ? 'Foto lagi' : 'Retake'}
                </button>
                {saved ? (
                  <Link to="/gallery" className="btn btn-primary">
                    <ImageIcon size={17} /> View gallery
                  </Link>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={() => void save()}
                    disabled={saving || Boolean(exhausted)}
                  >
                    {saving ? <RefreshCw size={17} className="spin" /> : <Upload size={17} />}{' '}
                    {saving ? 'Menyimpan foto…' : 'Save photo'}
                  </button>
                )}
              </>
            ) : (
              <>
                <label className="timer-toggle">
                  <input
                    type="checkbox"
                    checked={timer}
                    onChange={(e) => setTimer(e.target.checked)}
                  />{' '}
                  Timer 3 detik
                </label>
                <button
                  className="shutter"
                  aria-label="Ambil foto"
                  onClick={shoot}
                  disabled={!ready || countdown !== null || Boolean(exhausted)}
                >
                  <Camera size={28} strokeWidth={1.5} />
                </button>
                <span className="shutter-hint">Capture the joy</span>
              </>
            )}
          </div>
          {!session && (
            <button
              className="upload-fallback"
              disabled={starting || exhausted}
              onClick={() => void start(false)}
            >
              <Upload size={14} /> Gunakan foto dari perangkat
            </button>
          )}
          {session && !saved && !exhausted && (
            <label className="upload-fallback">
              <Upload size={14} /> Atau pilih foto dari perangkat
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={saving || starting || countdown !== null}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void selectFile(file);
                  e.target.value = '';
                }}
              />
            </label>
          )}
          <p className="booth-privacy">
            <ShieldCheck size={13} /> Foto yang disimpan akan dibagikan ke galeri publik acara.{' '}
            <span>JPEG, PNG, WebP · Maks. 12 MB</span>
          </p>
        </div>
      )}
      <div className="camera-bottom-note">
        <Sparkles size={17} strokeWidth={1.2} />
        <span>The best photos are the ones filled with joy.</span>
      </div>
    </main>
  );
}
