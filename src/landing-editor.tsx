import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useEvent, api, json, useToast, Modal, ErrorBox, Spinner } from './lib';
import { LandingHero } from './guest';
import { names } from './camera-filters';
import type { ImageSlot, WeddingEvent } from './types';
const slots: Record<ImageSlot, { label: string; ratio: number }> = {
  hero: { label: 'Cover / hero', ratio: 0.8 },
  background: { label: 'Background', ratio: 1.8 },
  banner: { label: 'Banner', ratio: 3 },
  decoration: { label: 'Dekorasi', ratio: 1 },
  logo: { label: 'Logo', ratio: 1 },
};
function CropControl({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
export function CropImage({
  file,
  ratio,
  label,
  onClose,
  onApply,
}: {
  file: Blob;
  ratio: number;
  label: string;
  onClose: () => void;
  onApply: (b: Blob) => void;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null),
    [zoom, setZoom] = useState(1),
    [x, setX] = useState(50),
    [y, setY] = useState(50),
    [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file),
      img = new Image();
    img.onload = () => setImage(img);
    img.onerror = () => setError('Gambar tidak dapat dibaca.');
    img.src = url;
    return () => {
      img.onload = null;
      img.onerror = null;
      URL.revokeObjectURL(url);
    };
  }, [file]);
  useEffect(() => {
    const c = canvas.current;
    if (!image || !c) return;
    const w = Math.min(image.width, image.height * ratio) / zoom,
      h = w / ratio;
    c.width = Math.max(1, Math.round(Math.min(1500, w)));
    c.height = Math.max(1, Math.round(c.width / ratio));
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(
      image,
      ((image.width - w) * x) / 100,
      ((image.height - h) * y) / 100,
      w,
      h,
      0,
      0,
      c.width,
      c.height,
    );
  }, [image, ratio, zoom, x, y]);
  async function apply() {
    const c = canvas.current;
    if (!c) return;
    for (const quality of [0.88, 0.75, 0.57, 0.38]) {
      const blob = await new Promise<Blob | null>((done) => c.toBlob(done, 'image/jpeg', quality));
      if (blob && blob.size < 690000) {
        onApply(blob);
        return;
      }
    }
    setError('Gambar terlalu besar. Perbesar crop atau pilih gambar lain.');
  }
  return (
    <Modal title={'Crop ' + label} onClose={onClose}>
      <canvas className="crop-preview" ref={canvas} />
      <div className="settings-form">
        <CropControl label="Zoom" value={zoom} min={1} max={3} step={0.05} onChange={setZoom} />
        <CropControl label="Posisi horizontal" value={x} min={0} max={100} onChange={setX} />
        <CropControl label="Posisi vertikal" value={y} min={0} max={100} onChange={setY} />
        {error && <ErrorBox message={error} />}
        <button className="btn btn-primary" disabled={!image} onClick={apply}>
          Gunakan hasil crop
        </button>
      </div>
    </Modal>
  );
}
export function ProjectSettings({
  project,
  csrf,
  camera,
}: {
  project: string;
  csrf: string;
  camera: boolean;
}) {
  const { event, refresh, error: loadError } = useEvent(),
    [draft, setDraft] = useState(event),
    [files, setFiles] = useState<Partial<Record<ImageSlot, Blob | null>>>({}),
    [crop, setCrop] = useState<{ slot: ImageSlot; file: File } | null>(null),
    [preview, setPreview] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const urls = useRef<string[]>([]),
    toast = useToast();
  useEffect(() => {
    setDraft(event);
    setFiles({});
    return () => {
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      urls.current = [];
    };
  }, [event]);
  if (loadError) return <ErrorBox message={loadError} retry={refresh} />;
  if (!draft) return <Spinner />;
  const d = draft;
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const base = '/admin/projects/' + project;
    try {
      if (camera) await api(base + '/filters', json('PUT', { filters: d.filters }, csrf));
      else {
        const body = new FormData();
        body.set(
          'settings',
          JSON.stringify({
            ...d,
            remove: Object.keys(files).filter((k) => files[k as ImageSlot] === null),
          }),
        );
        for (const [slot, blob] of Object.entries(files))
          if (blob) body.set(slot, blob, slot + '.jpg');
        await api(base + '/event', { method: 'PUT', headers: { 'X-CSRF-Token': csrf }, body });
      }
      await refresh();
      toast('Pengaturan project tersimpan.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function asset(slot: ImageSlot, blob: Blob | null) {
    const url = blob ? URL.createObjectURL(blob) : undefined;
    if (url) urls.current.push(url);
    setFiles((p) => ({ ...p, [slot]: blob }));
    setDraft((p) => p && { ...p, images: { ...p.images, [slot]: url } });
    setCrop(null);
  }
  return (
    <section className="panel settings-panel">
      <h1>{camera ? 'Camera Filter Settings' : 'Landing Page Settings'}</h1>
      <form className="settings-form" onSubmit={save}>
        {camera ? (
          <>
            <p>Pilih filter yang tersedia untuk tamu. Original selalu tersedia.</p>
            <div className="filter-checks">
              {names
                .filter((n) => n !== 'Original')
                .map((n) => (
                  <label className="checkbox-label" key={n}>
                    <input
                      type="checkbox"
                      checked={d.filters.includes(n)}
                      onChange={(e) =>
                        setDraft({
                          ...d,
                          filters: e.target.checked
                            ? [...d.filters, n]
                            : d.filters.filter((v) => v !== n),
                        })
                      }
                    />
                    {n}
                  </label>
                ))}
            </div>
          </>
        ) : (
          <>
            <div className="form-grid">
              {(
                [
                  ['title', 'Judul acara', 100],
                  ['partner_one', 'Nama pasangan pertama', 50],
                  ['partner_two', 'Nama pasangan kedua', 50],
                  ['wedding_date', 'Tanggal acara', 10],
                  ['venue', 'Lokasi acara', 160],
                ] as const
              ).map(([key, label, max]) => (
                <label key={key}>
                  {label}
                  <input
                    type={key === 'wedding_date' ? 'date' : 'text'}
                    required={!['venue', 'wedding_date'].includes(key)}
                    value={d[key]}
                    maxLength={max}
                    onChange={(e) => setDraft({ ...d, [key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <label>
              Teks sambutan
              <textarea
                value={d.welcome_message}
                maxLength={500}
                required
                onChange={(e) => setDraft({ ...d, welcome_message: e.target.value })}
              />
            </label>
            <div className="form-grid">
              <label>
                Warna tema
                <input
                  type="color"
                  value={d.theme}
                  onChange={(e) => setDraft({ ...d, theme: e.target.value })}
                />
              </label>
              <label>
                Posisi teks hero
                <select
                  value={d.position}
                  onChange={(e) =>
                    setDraft({ ...d, position: e.target.value as WeddingEvent['position'] })
                  }
                >
                  <option value="left">Kiri</option>
                  <option value="center">Tengah</option>
                  <option value="right">Kanan</option>
                </select>
              </label>
            </div>
            <div className="asset-grid">
              {(Object.keys(slots) as ImageSlot[]).map((slot) => (
                <div key={slot}>
                  <label>
                    {slots[slot].label}
                    {d.images[slot] && <img src={d.images[slot]} alt={slots[slot].label} />}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file && file.size <= 12 * 1024 * 1024) setCrop({ slot, file });
                        else if (file) setError('Ukuran gambar maksimal 12 MB.');
                        e.target.value = '';
                      }}
                    />
                  </label>
                  {d.images[slot] && (
                    <button type="button" className="text-link" onClick={() => asset(slot, null)}>
                      Hapus gambar
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-outline" onClick={() => setPreview(true)}>
              Pratinjau halaman
            </button>
          </>
        )}
        {error && <ErrorBox message={error} />}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Menyimpan…' : 'Simpan pengaturan'}
        </button>
      </form>
      {crop && (
        <CropImage
          file={crop.file}
          ratio={slots[crop.slot].ratio}
          label={slots[crop.slot].label}
          onClose={() => setCrop(null)}
          onApply={(b) => asset(crop.slot, b)}
        />
      )}
      {preview && (
        <Modal wide title="Pratinjau landing page" onClose={() => setPreview(false)}>
          <div
            className="landing-preview"
            inert
            style={{ '--rose': d.theme } as React.CSSProperties}
          >
            {d.images.logo && <img className="event-logo" src={d.images.logo} alt="Logo" />}
            <LandingHero event={d} />
            {d.images.banner && <img className="event-banner" src={d.images.banner} alt="Banner" />}
          </div>
        </Modal>
      )}
    </section>
  );
}
