import { useEffect, useRef } from 'react';
import { names, renderFrame, type FilterName } from './camera-filters';
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
  video,
}: {
  value: FilterName;
  enabled: string[];
  onChange: (v: FilterName) => void;
  disabled: boolean;
  video: HTMLVideoElement | null;
}) {
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sample = document.createElement('canvas');
    sample.width = 96;
    sample.height = 64;
    const ctx = sample.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 96, 64);
    gradient.addColorStop(0, '#688778');
    gradient.addColorStop(0.6, '#e4b19f');
    gradient.addColorStop(1, '#eadbb6');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 96, 64);
    ctx.fillStyle = '#fff1df';
    ctx.font = '42px Georgia';
    ctx.fillText('♥', 30, 48);
    function draw() {
      group.current
        ?.querySelectorAll('canvas')
        .forEach((c) =>
          renderFrame(
            c,
            video && video.readyState >= 2 ? video : sample,
            c.dataset.filter as FilterName,
          ),
        );
    }
    draw();
    const timer = window.setInterval(draw, 1800);
    return () => clearInterval(timer);
  }, [video, enabled]);
  return (
    <div ref={group} className="filter-strip" aria-label="Pilihan filter kamera">
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
            <canvas width={80} height={54} data-filter={n} />
            <span>{n}</span>
          </button>
        ))}
    </div>
  );
}
