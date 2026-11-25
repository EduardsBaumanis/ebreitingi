// Shared POST handling for the two review pages.
import { hasErrors, parseReviewForm, submitReview, type ReviewErrors, type ReviewFormOptions, type ReviewValues, type SubmitTarget } from './reviews';
import { TURNSTILE_MESSAGES, verifyTurnstile } from './turnstile';

export interface ReviewPostResult {
  redirect?: string;
  values: ReviewValues;
  errors: ReviewErrors;
}

/**
 * Validates the form, then Turnstile, then saves. `extraErrors` lets the page add its own
 * field errors (institution choice, suggested name) so everything is reported at once.
 */
export async function handleReviewPost(
  env: Env,
  form: FormData,
  options: ReviewFormOptions,
  target: SubmitTarget | null,
  extraErrors: ReviewErrors = {},
): Promise<ReviewPostResult> {
  const { values, errors } = parseReviewForm(form, options);
  Object.assign(errors, extraErrors);
  if (hasErrors(errors) || !target) return { values, errors };

  // Only call Turnstile once the form is otherwise valid: a token can be verified only once.
  const turnstile = await verifyTurnstile(
    String(form.get('cf-turnstile-response') ?? '') || null,
    (env as { TURNSTILE_SECRET_KEY?: string }).TURNSTILE_SECRET_KEY,
  );
  if (!turnstile.ok) return { values, errors: { form: TURNSTILE_MESSAGES[turnstile.reason] } };

  const result = await submitReview(env.DB, target, values);
  if (!result.ok) return { values, errors: { form: result.error } };

  const params = new URLSearchParams();
  if (result.teacherIsPublic) params.set('pedagogs', result.teacherSlug);
  else params.set('ieteikts', '1');
  return { redirect: `/vertet/paldies?${params}`, values, errors: {} };
}
