import type { Metadata } from 'next';

import { Landing } from '@/components/landing/Landing';

/**
 * The shareable explanation.
 *
 * Deliberately a separate route from the app's own first-run screen. The
 * in-app version only appears after the device has checked whether a vault
 * exists, which means it cannot be rendered on the server — fine for somebody
 * already holding the app, useless for a link sent to somebody who has never
 * heard of it. This page is static HTML: it reads with JavaScript switched
 * off, and it is the one page here worth letting a search engine see.
 */
export const metadata: Metadata = {
  title: 'Kabootar Talk — one letter a day, carried by a bird',
  description:
    'A slow messaging app. One letter a day, carried by a pigeon that has to fly the real distance, end-to-end encrypted, with nothing readable stored on the server.',
  robots: { index: true, follow: true },
};

export default function AboutPage() {
  return <Landing />;
}
