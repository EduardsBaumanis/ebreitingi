// Cloudflare Turnstile server-side verification.
// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
//
// The visitor's IP is deliberately not sent (the parameter is optional): the site stores no
// reviewer data and doesn't pass it on either.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileResult = { ok: true } | { ok: false; reason: 'missing' | 'invalid' | 'unavailable' | 'not-configured' };

export async function verifyTurnstile(token: string | null, secret: string | undefined): Promise<TurnstileResult> {
  if (!secret) return { ok: false, reason: 'not-configured' };
  if (!token) return { ok: false, reason: 'missing' };

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    const data = (await res.json()) as { success?: boolean };
    return data.success ? { ok: true } : { ok: false, reason: 'invalid' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export const TURNSTILE_MESSAGES: Record<Exclude<TurnstileResult, { ok: true }>['reason'], string> = {
  missing: 'Lūdzu, apstiprini, ka neesi robots (pārbaude zem formas).',
  invalid: 'Robotu pārbaude neizdevās vai ir novecojusi. Lūdzu, mēģini vēlreiz.',
  unavailable: 'Robotu pārbaudes serviss pašlaik nav pieejams. Lūdzu, mēģini pēc brīža.',
  'not-configured': 'Atsauksmju iesniegšana pašlaik nav pieejama.',
};
