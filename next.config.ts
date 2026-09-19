import type { NextConfig } from 'next';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Content Security Policy.
 *
 * This matters more here than in an ordinary app. Every key and every plaintext
 * letter exists only in the browser, so a single injected script is not a
 * defacement — it is a total compromise of the one place the encryption is
 * meant to protect.
 *
 * `script-src` allows inline, which is the weakest line here and deserves an
 * explanation rather than a silent shrug. The stronger form is a per-request
 * nonce, but a nonce has to be minted per request, and every page in this app
 * is a static shell served straight from a CDN — there is no request at render
 * time to mint one. The choice was a nonce plus a server round-trip on every
 * page load, or static delivery with inline allowed. For two people on
 * opposite sides of the planet, the CDN wins.
 *
 * What that costs is bounded by the rest of the policy. `connect-src 'self'`
 * means an injected script has nowhere to send anything: no third-party
 * origin, no beacon, no image ping, no form post. There is no `eval`, no
 * external script origin, and no framing. The app also never builds DOM from
 * strings — no `dangerouslySetInnerHTML` anywhere — so React's own escaping is
 * doing the real work of preventing injection in the first place.
 */
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isProduction ? '' : " 'unsafe-eval'"}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob:`,
  `font-src 'self'`,
  // The app talks to its own origin and nothing else. No analytics, no CDN,
  // no font host, no error reporter.
  `connect-src 'self'${isProduction ? '' : ' ws: http://localhost:*'}`,
  `worker-src 'self' blob:`,
  `object-src 'none'`,
  `base-uri 'none'`,
  `form-action 'none'`,
  `frame-ancestors 'none'`,
  ...(isProduction ? ['upgrade-insecure-requests'] : []),
].join('; ');

const securityHeaders = [
  { key: 'content-security-policy', value: csp },
  { key: 'referrer-policy', value: 'no-referrer' },
  { key: 'x-content-type-options', value: 'nosniff' },
  { key: 'x-frame-options', value: 'DENY' },
  { key: 'cross-origin-opener-policy', value: 'same-origin' },
  {
    key: 'permissions-policy',
    // The app needs none of these. Geolocation in particular: locations are
    // typed in and encrypted, never read from the device.
    value:
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()',
  },
  ...(isProduction
    ? [
        {
          key: 'strict-transport-security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },

  /*
   * Deliberately no `experimental.optimizePackageImports` for three.
   *
   * That transform exists to split barrel files that re-export hundreds of
   * modules. `three` is imported here as a namespace and already tree-shakes,
   * so it buys nothing, and it is an experimental transform that runs only in
   * production builds — exactly the kind of thing that yields a bug you cannot
   * reproduce in development. Not worth it for zero gain.
   */
};

export default nextConfig;
