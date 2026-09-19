'use client';

/**
 * The pieces every screen is built from.
 *
 * All of them share one idea: a solid face on a darker lip that compresses
 * when you press it. Keeping that in a handful of components is what stops the
 * app drifting into a different visual language on every screen.
 */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

export type Tone = 'grass' | 'sky' | 'amber' | 'coral' | 'plain';

const FACE: Record<Tone, string> = {
  grass: 'bg-grass-500 text-white shadow-[0_var(--lip)_0_var(--color-grass-600)]',
  sky: 'bg-sky-500 text-white shadow-[0_var(--lip)_0_var(--color-sky-600)]',
  amber: 'bg-amber-500 text-ink shadow-[0_var(--lip)_0_var(--color-amber-600)]',
  coral: 'bg-coral-500 text-white shadow-[0_var(--lip)_0_var(--color-coral-600)]',
  plain: 'bg-paper text-ink-soft border-2 border-line shadow-[0_var(--lip)_0_var(--color-line)]',
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: Tone;
  busy?: boolean;
  full?: boolean;
};

export function Button({
  tone = 'grass',
  busy = false,
  full = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`press inline-flex items-center justify-center gap-2 px-6 py-3.5 text-[1.0625rem] uppercase tracking-wide ${FACE[tone]} ${full ? 'w-full' : ''} ${className}`}
      disabled={disabled || busy}
      {...rest}
    >
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

/** A quiet action. No lip, because nothing here is the main thing to do. */
export function TextButton({
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`rounded-xl px-4 py-2.5 text-[0.95rem] font-extrabold uppercase tracking-wide text-ink-faint transition-colors hover:text-sky-500 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="size-[1.1em] shrink-0 animate-spin rounded-full border-[3px] border-current border-t-transparent opacity-80"
    />
  );
}

export function Panel({
  children,
  className = '',
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: 'sky' | 'amber' | 'coral' | 'grass';
}) {
  const tinted = tone
    ? {
        sky: 'bg-sky-100 border-sky-400',
        amber: 'bg-amber-100 border-amber-400',
        coral: 'bg-coral-100 border-coral-500',
        grass: 'bg-grass-100 border-grass-500',
      }[tone]
    : '';

  return <div className={`panel p-5 ${tinted} ${className}`}>{children}</div>;
}

export function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="shell flex min-h-dvh flex-col pt-[max(1.25rem,env(safe-area-inset-top))]">
      {children}
    </main>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-[1.85rem] leading-[1.15] font-extrabold tracking-tight text-ink">
        {children}
      </h1>
      {sub ? (
        <p className="mt-2.5 text-[1rem] leading-relaxed font-semibold text-ink-faint">{sub}</p>
      ) : null}
    </header>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <span className="mb-2 block text-[0.8rem] font-extrabold tracking-[0.1em] text-ink-faint uppercase">
      {children}
    </span>
  );
}

const FIELD =
  'w-full rounded-2xl border-2 border-line bg-mist px-4 py-3.5 text-[1.0625rem] font-bold text-ink outline-none transition-colors placeholder:font-semibold placeholder:text-ink-faint focus:border-sky-500 focus:bg-paper';

export function Field(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props;
  return <input className={`${FIELD} ${className}`} {...rest} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props;
  return <textarea className={`${FIELD} resize-none ${className}`} {...rest} />;
}

export function Notice({
  tone = 'sky',
  children,
}: {
  tone?: 'sky' | 'amber' | 'coral' | 'grass';
  children: ReactNode;
}) {
  const tones = {
    sky: 'bg-sky-100 border-sky-400 text-sky-600',
    amber: 'bg-amber-100 border-amber-400 text-amber-600',
    coral: 'bg-coral-100 border-coral-500 text-coral-600',
    grass: 'bg-grass-100 border-grass-500 text-grass-600',
  };

  return (
    <div
      className={`rounded-2xl border-2 px-4 py-3.5 text-[0.95rem] leading-relaxed font-bold ${tones[tone]}`}
    >
      {children}
    </div>
  );
}

/** "6 hours", "12 minutes", "30 seconds", "now". */
export function relativeTime(ms: number): string {
  if (ms <= 0) return 'now';

  // Seconds matter here: a thirty-second lockout described as "0 minutes"
  // reads as a bug, and a bird landing "in 0 minutes" reads as broken.
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    if (seconds <= 5) return 'a moment';
    return `${seconds} seconds`;
  }

  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;

  const hours = ms / 3_600_000;
  if (hours < 24) {
    const whole = Math.floor(hours);
    const rest = Math.round((hours - whole) * 60);
    if (whole < 6 && rest >= 5) return `${whole}h ${rest}m`;
    return `${Math.round(hours)} hour${Math.round(hours) === 1 ? '' : 's'}`;
  }

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}
