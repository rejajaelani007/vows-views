import { useEffect, useRef } from 'react';
import { names, renderFrame, type FilterName } from './camera-filters';
const samples = import.meta.glob<string>('./assets/filter-samples/*.webp', {
  eager: true,
  import: 'default',
  query: '?url&no-inline',
});
export function LiveFilter({
  video,
  ready,
  filter,
  mirror,
}: {
  video: React.RefObject<HTMLVideoElement | null>;
  ready: boolean;
  filter: FilterName;
  mirror: boolean;
}) {
  const output = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ready || filter === 'Original') return;
    let timer = 0;
    const draw = () => {
      const v = video.current,
        c = output.current;
      if (v && c && v.readyState >= 2 && v.videoWidth) {
        const scale = Math.min(1, 560 / Math.max(v.videoWidth, v.videoHeight));
        const w = Math.round(v.videoWidth * scale),
          h = Math.round(v.videoHeight * scale);
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
        }
        renderFrame(c, v, filter, mirror);
      }
      timer = window.setTimeout(draw, 60);
    };
    draw();
    return () => clearTimeout(timer);
  }, [ready, filter, mirror, video]);
  return ready && filter !== 'Original' ? <canvas className="live-filter" ref={output} /> : null;
}
export function FilterPicker({
  value,
  enabled,
  onChange,
  disabled,
}: {
  value: FilterName;
  enabled: string[];
  onChange: (v: FilterName) => void;
  disabled: boolean;
}) {
  return (
    <div className="filter-strip" role="group" aria-label="Pilihan filter kamera">
      {names
        .filter((n) => n === 'Original' || enabled.includes(n))
        .map((n) => (
          <button
            type="button"
            disabled={disabled}
            key={n}
            aria-pressed={value === n}
            onClick={() => onChange(n)}
          >
            <img
              src={
                samples[
                  './assets/filter-samples/' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.webp'
                ]
              }
              width={144}
              height={96}
              decoding="async"
              alt=""
            />
            <span>{n}</span>
          </button>
        ))}
    </div>
  );
}
