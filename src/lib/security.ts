// Security headers for every HTML response (plan.md §10).
//
// The CSP allows only our own files plus Cloudflare Turnstile (script + iframe). No inline
// scripts or styles: CSS is built as files (astro.config.mjs inlineStylesheets: 'never'),
// JS lives in /public/js, and JSON-LD <script type="application/ld+json"> blocks are data,
// which script-src doesn't govern.

const TURNSTILE = 'https://challenges.cloudflare.com';

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' ${TURNSTILE}`,
  `frame-src ${TURNSTILE}`,
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${TURNSTILE}`,
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

export function applySecurityHeaders(headers: Headers, options: { production: boolean; admin: boolean }) {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  // The dev server injects inline scripts (HMR, dev toolbar), so the CSP and HSTS only apply in production builds.
  if (options.production) {
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (options.admin) {
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
  }
}
