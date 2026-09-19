'use client';

/**
 * The eight words that make the server untrusted.
 *
 * Everything else in this app protects against an attacker who steals the
 * database. This protects against the server itself — a malicious one could
 * hand each of you keys it controls and read everything, and the only thing
 * that catches it is the two of you comparing these words somewhere it cannot
 * reach. It is worth one phone call, once.
 */

import { useKabootar, type Nest } from '@/lib/client/kabootar';

export function SafetyWords({ nest, compact = false }: { nest: Nest; compact?: boolean }) {
  const { safetyFor } = useKabootar();
  const check = safetyFor(nest);

  if (!check) return null;

  if (compact) {
    return (
      <p className="text-[0.85rem] font-extrabold text-ink-faint">{check.words.join(' · ')}</p>
    );
  }

  return (
    <div>
      <ol className="grid grid-cols-2 gap-2">
        {check.words.map((word, i) => (
          <li
            key={word + i}
            className="flex items-baseline gap-2 rounded-xl border-2 border-line bg-paper px-3 py-2"
          >
            <span className="w-3 shrink-0 text-right text-[0.65rem] font-extrabold text-ink-faint">
              {i + 1}
            </span>
            <span className="text-[0.95rem] font-extrabold text-ink">{word}</span>
          </li>
        ))}
      </ol>

      <details className="mt-3">
        <summary className="cursor-pointer text-[0.8rem] font-extrabold text-ink-faint uppercase">
          Show the number instead
        </summary>
        <p className="mt-2 font-mono text-[0.8rem] leading-relaxed font-bold tracking-wider text-ink-soft">
          {check.digits.join(' ')}
        </p>
      </details>
    </div>
  );
}
