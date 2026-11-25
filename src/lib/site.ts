// Site-wide settings shown on public pages.
//
// TODO before launch: fill in the data controller (the person or organisation responsible for
// the site under GDPR). Values in [square brackets] are placeholders and are shown as-is on
// /privatuma-politika, so they're easy to spot. See README "Before launch".
export const SITE = {
  name: 'Pedagogu vērtējumi',
  controller: {
    name: '[Pārziņa nosaukums]',
    registrationNumber: '[Reģistrācijas numurs]',
    address: '[Juridiskā adrese]',
    email: '[kontakti@example.lv]',
  },
  /** Date the privacy policy text last changed (YYYY-MM-DD). */
  privacyPolicyUpdated: '2026-11-25',
} as const;

export function isPlaceholder(value: string): boolean {
  return /^\[.*\]$/.test(value);
}
