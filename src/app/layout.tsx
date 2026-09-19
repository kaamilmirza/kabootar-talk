import type { Metadata, Viewport } from 'next';
import { Nunito } from 'next/font/google';

import { KabootarProvider } from '@/lib/client/kabootar';

import './globals.css';

/**
 * Self-hosted at build time by next/font, which matters twice over: no request
 * to Google on any page load, and the Content Security Policy can keep
 * `font-src 'self'` with no exception carved out for a third party.
 */
const nunito = Nunito({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800', '900'],
  variable: '--font-nunito',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Kabootar Talk',
  description: 'One letter a day, carried by pigeon. End-to-end encrypted.',
  applicationName: 'Kabootar Talk',
  appleWebApp: { capable: true, title: 'Kabootar', statusBarStyle: 'default' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#fff9f0',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={nunito.variable}>
      <body>
        <KabootarProvider>{children}</KabootarProvider>
      </body>
    </html>
  );
}
