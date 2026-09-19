'use client';

/**
 * Illustrations for the landing page.
 *
 * Hand-drawn vector rather than stock or generated images: every piece
 * inherits the app's own palette tokens, stays crisp at any size, costs a few
 * hundred bytes, and can be animated by animating its parts. A folder of PNGs
 * could do none of those things.
 *
 * Each one is built from the same shape language as the rest of the app —
 * heavy rounded forms, flat colour, no gradients — so the page that explains
 * the product looks like the product.
 */

import type { ReactNode } from 'react';

/** Shared wrapper so every illustration scales and centres the same way. */
function Art({ children, className = '', viewBox = '0 0 200 160', label }: {
  children: ReactNode;
  className?: string;
  viewBox?: string;
  label: string;
}) {
  return (
    <svg viewBox={viewBox} className={className} role="img" aria-label={label}>
      {children}
    </svg>
  );
}

/**
 * A phone under a hail of notifications.
 *
 * The one piece of art on the page making a point rather than describing a
 * feature — so it is drawn with some sympathy rather than as a scold. It is a
 * perfectly nice phone. There is just an awful lot going on.
 */
export function NoisyPhone({ className = 'w-full' }: { className?: string }) {
  return (
    <Art className={className} label="A phone buried in notifications">
      <rect x="66" y="26" width="68" height="112" rx="12" fill="var(--color-ink)" />
      <rect x="71" y="33" width="58" height="98" rx="7" fill="var(--color-mist)" />

      {/* stacked, overlapping, never-ending */}
      {[0, 1, 2, 3].map((i) => (
        <g key={i} className="jitter" style={{ animationDelay: `${i * 0.45}s` }}>
          <rect
            x={76}
            y={40 + i * 21}
            width={48}
            height={16}
            rx={5}
            fill="var(--color-paper)"
            stroke="var(--color-line)"
            strokeWidth="1.5"
          />
          <circle cx={84} cy={48 + i * 21} r={3.5} fill="var(--color-coral-500)" />
          <rect x={91} y={45 + i * 21} width={26} height={3} rx={1.5} fill="var(--color-line-strong)" />
          <rect x={91} y={50 + i * 21} width={18} height={3} rx={1.5} fill="var(--color-line)" />
        </g>
      ))}

      {/* the badge nobody has ever cleared */}
      <circle cx="132" cy="28" r="13" fill="var(--color-coral-500)" />
      <text
        x="132"
        y="33"
        textAnchor="middle"
        fontSize="12"
        fontWeight="800"
        fill="#ffffff"
        fontFamily="var(--font-display)"
      >
        99
      </text>

      {[
        { x: 34, y: 52, d: 0 },
        { x: 168, y: 70, d: 0.7 },
        { x: 40, y: 104, d: 1.3 },
      ].map((p, i) => (
        <g key={i} className="jitter" style={{ animationDelay: `${p.d}s` }}>
          <circle cx={p.x} cy={p.y} r="9" fill="var(--color-sky-400)" opacity="0.5" />
        </g>
      ))}
    </Art>
  );
}

/** A letter with airmail edging and a wax seal. */
export function LetterArt({ className = 'w-full' }: { className?: string }) {
  return (
    <Art className={className} label="A sealed letter">
      <g className="float">
        <rect
          x="30"
          y="38"
          width="140"
          height="88"
          rx="8"
          fill="var(--color-paper)"
          stroke="var(--color-line-strong)"
          strokeWidth="2.5"
        />

        {/* airmail border, drawn as dashes rather than a repeating fill */}
        {[
          { x: 30, y: 38, w: 140, h: 7, horizontal: true },
          { x: 30, y: 119, w: 140, h: 7, horizontal: true },
        ].map((bar, i) => (
          <g key={i}>
            {Array.from({ length: 14 }).map((_, j) => (
              <rect
                key={j}
                x={bar.x + j * 10}
                y={bar.y}
                width="10"
                height={bar.h}
                fill={j % 2 === 0 ? 'var(--color-coral-500)' : 'var(--color-sky-500)'}
                opacity="0.85"
              />
            ))}
          </g>
        ))}

        <rect x="46" y="58" width="76" height="4" rx="2" fill="var(--color-line-strong)" />
        <rect x="46" y="70" width="98" height="4" rx="2" fill="var(--color-line)" />
        <rect x="46" y="82" width="60" height="4" rx="2" fill="var(--color-line)" />
        <rect x="46" y="94" width="84" height="4" rx="2" fill="var(--color-line)" />

        {/* wax seal */}
        <circle cx="146" cy="96" r="15" fill="var(--color-coral-500)" />
        <circle cx="146" cy="96" r="10" fill="none" stroke="#ffffff" strokeWidth="1.6" opacity="0.7" />
        <path
          d="M141 96c2-4 7-4 9 0-1.5 4-7.5 4-9 0Z"
          fill="#ffffff"
          opacity="0.9"
        />
      </g>
    </Art>
  );
}

/** Two pins and an arc, over a curve of horizon. */
export function RouteArt({ className = 'w-full' }: { className?: string }) {
  return (
    <Art className={className} label="A route arcing between two places">
      <path d="M-10 150a120 120 0 0 1 220 0Z" fill="var(--color-sky-500)" opacity="0.18" />
      <path d="M-10 150a120 120 0 0 1 220 0" fill="none" stroke="var(--color-sky-500)" strokeWidth="3" />

      {/* land, suggested rather than mapped */}
      <path d="M26 128c14-9 26-4 38-9s20-12 32-9" fill="none" stroke="var(--color-grass-500)" strokeWidth="6" strokeLinecap="round" opacity="0.75" />
      <path d="M118 112c12 2 20 9 34 9" fill="none" stroke="var(--color-grass-500)" strokeWidth="6" strokeLinecap="round" opacity="0.75" />

      <path
        className="draw"
        d="M42 118C70 38 132 38 160 112"
        fill="none"
        stroke="var(--color-amber-500)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray="6 7"
      />

      {[
        { x: 42, y: 118, fill: 'var(--color-amber-500)' },
        { x: 160, y: 112, fill: 'var(--color-coral-500)' },
      ].map((pin, i) => (
        <g key={i}>
          <circle cx={pin.x} cy={pin.y} r="7" fill={pin.fill} />
          <circle cx={pin.x} cy={pin.y} r="13" fill="none" stroke={pin.fill} strokeWidth="2" opacity="0.4" className="ping" style={{ animationDelay: `${i * 0.9}s` }} />
        </g>
      ))}

      <g className="glide">
        <ellipse cx="101" cy="50" rx="11" ry="6" fill="var(--color-slate-400)" />
        <circle cx="110" cy="46" r="5" fill="var(--color-slate-400)" />
        <path d="M114 45l7 2-7 2.5Z" fill="var(--color-amber-500)" />
        <path d="M94 47c6-7 16-7 20 0-7 5-15 5-20 0Z" fill="var(--color-slate-600)" />
        <circle cx="112" cy="45" r="1.4" fill="var(--color-ink)" />
      </g>
    </Art>
  );
}

/** A handful of grain, offered. */
export function GrainArt({ className = 'w-full' }: { className?: string }) {
  return (
    <Art className={className} label="A hand offering grain">
      <path
        d="M52 98c-6-14 2-28 14-30 14-2 20 6 34 6s20-8 34-6c12 2 20 16 14 30-6 14-28 24-48 24s-42-10-48-24Z"
        fill="var(--color-paper-300, #d9c8ab)"
        opacity="0.35"
      />
      <path
        d="M52 98c-6-14 2-28 14-30 14-2 20 6 34 6s20-8 34-6c12 2 20 16 14 30"
        fill="none"
        stroke="var(--color-ink-faint)"
        strokeWidth="3"
        strokeLinecap="round"
      />

      {[
        { x: 78, y: 82, d: 0 },
        { x: 96, y: 74, d: 0.3 },
        { x: 114, y: 84, d: 0.6 },
        { x: 88, y: 92, d: 0.15 },
        { x: 106, y: 94, d: 0.45 },
      ].map((seed, i) => (
        <ellipse
          key={i}
          cx={seed.x}
          cy={seed.y}
          rx="5"
          ry="3.4"
          fill="var(--color-amber-500)"
          className="float"
          style={{ animationDelay: `${seed.d}s` }}
          transform={`rotate(${-25 + i * 14} ${seed.x} ${seed.y})`}
        />
      ))}
    </Art>
  );
}

/** Three birds, three moods. */
export function MoodTrio({ className = 'w-full' }: { className?: string }) {
  const birds = [
    { x: 34, body: 'var(--color-slate-400)', wing: 'var(--color-slate-500)', mood: 'happy' as const },
    { x: 100, body: 'var(--color-slate-400)', wing: 'var(--color-slate-600)', mood: 'sleep' as const },
    { x: 166, body: 'var(--color-slate-400)', wing: 'var(--color-slate-500)', mood: 'sulk' as const },
  ];

  return (
    <Art className={className} viewBox="0 0 200 120" label="Three pigeons in different moods">
      {birds.map((bird, i) => (
        <g key={i} className={bird.mood === 'sleep' ? 'breathe-soft' : 'float'} style={{ animationDelay: `${i * 0.5}s` }}>
          <ellipse cx={bird.x} cy="72" rx="24" ry="20" fill={bird.body} />
          <ellipse cx={bird.x + 4} cy="78" rx="17" ry="12" fill="#ffffff" opacity="0.45" />
          <path
            d={`M${bird.x - 20} 76 Q${bird.x - 6} 58 ${bird.x + 14} 58 Q${bird.x + 13} 74 ${bird.x - 1} 80 Q${bird.x - 12} 82 ${bird.x - 20} 76 Z`}
            fill={bird.wing}
          />
          <circle cx={bird.x + 18} cy="54" r="12" fill={bird.body} />
          <path d={`M${bird.x + 29} 52l10 3-10 3.5Z`} fill="var(--color-amber-500)" />

          {bird.mood === 'sleep' ? (
            <path
              d={`M${bird.x + 15} 53q4 4 8 0`}
              stroke="var(--color-ink)"
              strokeWidth="2.2"
              fill="none"
              strokeLinecap="round"
            />
          ) : (
            <>
              <circle cx={bird.x + 21} cy="53" r="3.2" fill="var(--color-ink)" />
              <circle cx={bird.x + 22} cy="52" r="1.1" fill="#ffffff" />
            </>
          )}

          {bird.mood === 'sulk' ? (
            <path
              d={`M${bird.x + 14} 44q7-3 13 0`}
              stroke="var(--color-ink)"
              strokeWidth="2.2"
              fill="none"
              strokeLinecap="round"
            />
          ) : null}

          {bird.mood === 'sleep' ? (
            <text x={bird.x + 34} y="40" fontSize="13" fontWeight="800" fill="var(--color-ink-faint)" fontFamily="var(--font-display)">
              z
            </text>
          ) : null}
        </g>
      ))}
    </Art>
  );
}

/** A wax seal that is also a lock. */
export function SealLock({ className = 'w-full' }: { className?: string }) {
  return (
    <Art className={className} viewBox="0 0 200 160" label="A sealed and locked letter">
      <g className="float">
        <circle cx="100" cy="86" r="44" fill="var(--color-coral-500)" />
        <circle cx="100" cy="86" r="34" fill="none" stroke="#ffffff" strokeWidth="2.5" opacity="0.6" />

        <path
          d="M86 82v-9a14 14 0 0 1 28 0v9"
          fill="none"
          stroke="#ffffff"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <rect x="80" y="82" width="40" height="30" rx="7" fill="#ffffff" />
        <circle cx="100" cy="95" r="4.5" fill="var(--color-coral-500)" />
        <rect x="98" y="95" width="4" height="10" rx="2" fill="var(--color-coral-500)" />
      </g>

      {[
        { x: 42, y: 42, d: 0 },
        { x: 158, y: 54, d: 0.6 },
        { x: 52, y: 126, d: 1.1 },
        { x: 152, y: 120, d: 1.6 },
      ].map((s, i) => (
        <path
          key={i}
          d={`M${s.x} ${s.y - 7}l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z`}
          fill="var(--color-amber-400)"
          className="twinkle"
          style={{ animationDelay: `${s.d}s` }}
        />
      ))}
    </Art>
  );
}

/** A postage stamp, perforations and all. */
export function StampArt({ className = 'size-20' }: { className?: string }) {
  return (
    <Art className={className} viewBox="0 0 100 100" label="A postage stamp">
      <path
        d="M8 8h84v84H8Z"
        fill="var(--color-cream)"
        stroke="var(--color-line-strong)"
        strokeWidth="2"
        strokeDasharray="5 4"
      />
      <rect x="18" y="18" width="64" height="64" rx="4" fill="var(--color-sky-100)" />
      <ellipse cx="46" cy="56" rx="17" ry="14" fill="var(--color-slate-400)" />
      <path d="M31 58q10-13 26-11-1 12-12 16-9 1-14-5Z" fill="var(--color-slate-600)" />
      <circle cx="60" cy="44" r="9" fill="var(--color-slate-400)" />
      <path d="M68 42l8 2-8 3Z" fill="var(--color-amber-500)" />
      <circle cx="62" cy="43" r="2.2" fill="var(--color-ink)" />
      <text x="50" y="78" textAnchor="middle" fontSize="10" fontWeight="800" fill="var(--color-ink-faint)" fontFamily="var(--font-display)">
        ONE DAY
      </text>
    </Art>
  );
}

/** A single drifting feather, for section breaks. */
export function Feather({ className = 'size-8' }: { className?: string }) {
  return (
    <Art className={className} viewBox="0 0 40 60" label="">
      <path
        d="M20 4c9 8 12 22 8 34-3 9-8 14-8 18-0-4-5-9-8-18-4-12-1-26 8-34Z"
        fill="var(--color-slate-400)"
      />
      <path d="M20 8v46" stroke="var(--color-slate-600)" strokeWidth="2" strokeLinecap="round" />
    </Art>
  );
}
