import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GuestHeader, LandingContent } from './guest';
import { themeStyle, pageTheme } from './wedding-theme';
import type { WeddingEvent } from './types';

export function ThemePreview({ event }: { event: WeddingEvent }) {
  const [width, setWidth] = useState(390),
    [available, setAvailable] = useState(390);
  const wrap = useRef<HTMLDivElement>(null),
    [doc, setDoc] = useState<Document | null>(null);
  useEffect(() => {
    const el = wrap.current!;
    const observer = new ResizeObserver((entries) => setAvailable(entries[0].contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(1, available / width);
  function frame(el: HTMLIFrameElement | null) {
    const d = el?.contentDocument;
    if (!d || d === doc) return;
    if (!d.head.querySelector('base')) {
      const base = d.createElement('base');
      base.href = location.origin + '/';
      d.head.append(base);
      document
        .querySelectorAll('style,link[rel="stylesheet"]')
        .forEach((s) => d.head.append(s.cloneNode(true)));
      d.documentElement.lang = 'id';
    }
    setDoc(d);
  }
  return (
    <section id="live-preview" className="proof">
      <div className="proof-head">
        <div>
          <small>PRATINJAU PROJECT</small>
          <h2>Live Preview</h2>
        </div>
        <div className="proof-devices">
          {[
            [390, 'Mobile'],
            [768, 'Tablet'],
            [1200, 'Desktop'],
          ].map(([w, label]) => (
            <button
              key={w}
              type="button"
              aria-pressed={width === w}
              onClick={() => setWidth(Number(w))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="proof-wrap" ref={wrap}>
        <div
          className="proof-window"
          style={{ width: width * scale, height: (width === 390 ? 650 : 850) * scale }}
        >
          <iframe
            title="Pratinjau halaman tamu"
            ref={frame}
            style={{ width, height: width === 390 ? 650 : 850, transform: `scale(${scale})` }}
          />
        </div>
      </div>
      <p>Gulir untuk melihat halaman. Perubahan hanya terlihat oleh Anda sampai disimpan.</p>
      {doc &&
        createPortal(
          <div className={'guest-app ' + pageTheme(event)} style={themeStyle(event)} inert>
            <GuestHeader event={event} preview />
            <LandingContent event={event} latest={{ photos: [], total: 0, page: 1, pages: 1 }} />
          </div>,
          doc.body,
        )}
    </section>
  );
}
