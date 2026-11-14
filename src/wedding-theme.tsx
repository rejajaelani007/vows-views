import type { CSSProperties } from 'react';
import themes from '../server/wedding-themes.json';
import type { Appearance, WeddingEvent } from './types';
import editorial from './assets/wedding-editorial.webp';

export { editorial, themes };
export const original: Appearance = {
  preset: 'original',
  background: '#fbf8f3',
  font: 'classic',
  ornament: 'signature',
  scale: 100,
  button: 'soft',
  buttonLabel: 'Take your photo',
};
export function pageTheme(event: WeddingEvent | null) {
  const a = event?.appearance ?? original;
  if (
    a.preset === 'original' &&
    Object.entries(original).every(([k, v]) => a[k as keyof Appearance] === v)
  )
    return 'w-original';
  return 'w-page w-' + a.preset;
}
export function withPreset(d: WeddingEvent, id: string): WeddingEvent {
  const t = themes.find((t) => t.id === id);
  return {
    ...d,
    theme: t?.accent ?? '#9c5363',
    position: (t?.position ?? 'left') as WeddingEvent['position'],
    appearance: t
      ? {
          ...original,
          preset: id,
          background: t.background,
          font: t.font as Appearance['font'],
          button: t.button as Appearance['button'],
        }
      : { ...original },
  };
}
function ink(hex: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179 ? '#171411' : '#fff';
}
export function themeStyle(e: WeddingEvent | null): CSSProperties {
  const a = e?.appearance ?? original;
  return {
    '--rose': e?.theme,
    '--w-bg': a.background,
    '--w-ink': ink(a.background),
    '--on-accent': ink(e?.theme ?? '#9c5363'),
    '--w-scale': a.scale / 100,
    '--w-font': {
      classic: 'Georgia, serif',
      book: 'Palatino Linotype, Palatino, Georgia, serif',
      modern: 'Arial, sans-serif',
      retro: 'Courier New, monospace',
    }[a.font],
    '--w-radius': { soft: '8px', square: '0px', pill: '100px' }[a.button],
  } as CSSProperties;
}

// Small engraved vignettes; the same artwork appears in the swatch and the invitation.
export function Motif({ id }: { id: string }) {
  const leaf = <path d="M0 0Q0 -14 13 -17Q14 -4 0 0ZM1 -1L10 -13" />;
  const flower = (x: number, y: number, r: number, n = 7) => (
    <g transform={`translate(${x} ${y})`}>
      {Array.from({ length: n }, (_, i) => (
        <ellipse
          key={i}
          cx="0"
          cy={-r * 0.52}
          rx={r * 0.28}
          ry={r * 0.54}
          transform={`rotate(${(i * 360) / n})`}
        />
      ))}
      <circle r={r * 0.18} />
    </g>
  );
  const branch = (
    <g>
      <path d="M1 46Q30 39 61 8" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i} transform={`translate(${12 + i * 11} ${42 - i * 7}) scale(.68)`}>
          {leaf}
          <g transform="rotate(72)">{leaf}</g>
        </g>
      ))}
    </g>
  );
  return (
    <svg
      viewBox="0 0 150 54"
      className="w-motif"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      aria-hidden="true"
    >
      {id === 'javanese-modern' ? (
        <>
          {[27, 51, 75, 99, 123].map((x, i) => (
            <g key={x}>{flower(x, 29, i === 2 ? 16 : 11, 4)}</g>
          ))}
          <path d="M5 47H145M12 50H138" />
        </>
      ) : id === 'royal-javanese' ? (
        <>
          <path d="M8 39Q30 43 39 23Q52 34 60 18L65 24L75 4L85 24L90 18Q98 34 111 23Q120 43 142 39L128 46H22ZM27 50H123M41 40L54 34L64 39L75 22L86 39L96 34L109 40" />
          <circle cx="75" cy="12" r="2" />
        </>
      ) : id === 'minang-royal' ? (
        <>
          <path d="M5 10Q29 38 50 30L55 13Q64 32 75 34Q86 32 95 13L100 30Q121 38 145 10L131 39H19ZM25 42H125M36 48H114" />
          {[47, 61, 75, 89, 103].map((x) => (
            <path key={x} d={`M${x} 36l4 3 -4 3 -4 -3Z`} />
          ))}
        </>
      ) : id === 'sundanese' ? (
        <>
          <path d="M18 34Q38 36 48 15L61 29L75 7L89 29L102 15Q112 36 132 34M27 38Q75 49 123 38" />
          {[19, 29, 121, 131].map((x, i) => (
            <g key={x}>
              <path d={`M${x} 34v9`} />
              {flower(x, 45 + (i % 2) * 2, 4, 5)}
            </g>
          ))}
        </>
      ) : id === 'modern-luxury' ? (
        <>
          <path d="M6 28H55L75 9L95 28H144M23 33H59L75 49L91 33H127M61 28L75 14L89 28L75 42Z" />
          {flower(75, 28, 8, 6)}
        </>
      ) : id === 'minimalist' ? (
        <>
          <path d="M15 29H62M88 29H135" />
          <circle cx="75" cy="29" r="4" />
        </>
      ) : id === 'romantic-floral' || id === 'floral' ? (
        <>
          {branch}
          <g transform="translate(150) scale(-1 1)">{branch}</g>
          {flower(72, 26, 17, 9)}
          {flower(55, 32, 8)}
          {flower(93, 34, 10)}
        </>
      ) : id === 'garden' ? (
        <>
          {branch}
          <g transform="translate(150) scale(-1 1)">{branch}</g>
          <path d="M58 46Q75 35 89 44" />
          {flower(75, 38, 6, 5)}
        </>
      ) : id === 'vintage-classic' ? (
        <>
          <path d="M8 23H48Q60 23 63 14Q67 27 75 19Q83 27 87 14Q90 23 102 23H142M18 32H50Q65 32 75 43Q85 32 100 32H132" />
          <path d="M69 30l6 -7 6 7 -6 7Z" />
        </>
      ) : (
        <>
          {flower(60, 24, 9, 5)}
          {flower(79, 32, 6, 5)}
          {flower(92, 18, 4, 5)}
          <path d="M17 33H43M106 33H133" />
        </>
      )}
    </svg>
  );
}
