'use client';

/**
 * The mascot.
 *
 * Drawn as vector rather than generated or imported: she has to sit at 28px in
 * a header and 160px on the welcome screen, stay crisp at both, and use the
 * exact same palette as the rest of the interface. A flat illustration with
 * heavy shapes and no gradients is also the only style that survives being
 * shrunk to a favicon.
 *
 * Built back to front — tail, body, wing, head — so each shape overlaps the
 * last and the silhouette reads as one bird rather than a pile of parts. The
 * wing is a leaf tapering towards the tail, which is what makes it look like a
 * folded wing instead of a dark patch on her side.
 *
 * She has moods, and they match the ones the flight simulation uses, so the
 * bird in a list is doing what the bird on the globe is doing.
 */

export type KabootarMood = 'happy' | 'flying' | 'sleeping' | 'waiting' | 'worried';

interface KabootarProps {
  mood?: KabootarMood;
  className?: string;
  /** Adds the idle bob. Off inside lists, where it would be noise. */
  animated?: boolean;
}

/**
 * Folded along her side, or swept up on the downstroke.
 *
 * Each is a leaf with its tip at the tail end and its broad end at the
 * shoulder. The taper is what makes it read as a folded wing; an evenly round
 * shape in the same place just looks like a hole in the bird.
 */
const WING: Record<KabootarMood, string> = {
  happy: 'M36 70 Q56 45 84 45 Q82 66 60 76 Q46 79 36 70 Z',
  waiting: 'M36 70 Q56 45 84 45 Q82 66 60 76 Q46 79 36 70 Z',
  worried: 'M36 70 Q56 45 84 45 Q82 66 60 76 Q46 79 36 70 Z',
  // Tucked in tighter, as a sleeping bird holds it.
  sleeping: 'M42 70 Q58 50 82 50 Q80 68 62 75 Q50 77 42 70 Z',
  // Raised, as if caught mid-beat.
  flying: 'M40 46 Q46 18 70 14 Q86 22 80 42 Q64 52 40 46 Z',
};

export function Kabootar({
  mood = 'happy',
  className = 'size-24',
  animated = false,
}: KabootarProps) {
  return (
    <svg
      viewBox="0 0 124 120"
      className={`${className} ${animated ? 'bob' : ''}`}
      role="img"
      aria-label="A pigeon"
    >
      {/* tail, behind everything */}
      <path
        d="M50 60 L7 50 Q1 63 7 78 L52 82 Z"
        fill="var(--color-slate-600)"
      />

      {/* body */}
      <ellipse cx="62" cy="62" rx="35" ry="29" fill="var(--color-slate-400)" />

      {/* belly, so she has a light source and reads against a dark globe */}
      <ellipse cx="68" cy="71" rx="25" ry="18" fill="#ffffff" opacity="0.5" />

      {/* wing */}
      <path d={WING[mood]} fill="var(--color-slate-500)" />

      {/* head, overlapping the body so the neck is implied not drawn */}
      <circle cx="90" cy="38" r="18" fill="var(--color-slate-400)" />

      {/* the iridescent collar every rock dove has */}
      <path
        d="M75 46 Q79 55 90 56"
        stroke="#4fd4c2"
        strokeWidth="5.5"
        strokeLinecap="round"
        fill="none"
      />

      <path d="M106 35 L121 40 L106 45 Z" fill="var(--color-amber-500)" />

      <Eyes mood={mood} />

      {/* leg and the letter, always tied to her ankle */}
      <path
        d="M63 88 V99"
        stroke="var(--color-amber-600)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <rect
        x="50"
        y="98"
        width="27"
        height="18"
        rx="4"
        fill="#ffffff"
        stroke="var(--color-line-strong)"
        strokeWidth="2"
      />
      <path
        d="M51 102 L63.5 110 L76 102"
        stroke="var(--color-coral-500)"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function Eyes({ mood }: { mood: KabootarMood }) {
  if (mood === 'sleeping') {
    return (
      <path
        d="M89 36 Q95 41 101 36"
        stroke="var(--color-ink)"
        strokeWidth="3.2"
        strokeLinecap="round"
        fill="none"
      />
    );
  }

  return (
    <>
      <circle cx="95" cy="36" r="4.8" fill="var(--color-ink)" />
      <circle cx="96.8" cy="34.2" r="1.8" fill="#ffffff" />
      {mood === 'worried' ? (
        <path
          d="M88 26 Q95 23 101 26"
          stroke="var(--color-ink)"
          strokeWidth="2.8"
          strokeLinecap="round"
          fill="none"
        />
      ) : null}
    </>
  );
}
