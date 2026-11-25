# Legal review brief

The plan (plan.md §9 and week 8) requires a legal review before launch. This page lists what to send the reviewer and what to ask.

## What the site does

A Latvian-language website where students anonymously rate and review their teachers and professors at the 1,443 Latvian education institutions in the official register (preschools are excluded).
- **No accounts:** students don't register.
- **Pre-moderation:** every review, and every teacher students suggest, is checked by a moderator before it is published.
- **Teacher rights:** teachers can reply publicly and can request correction or removal.

## Documents to review

| Document | Where |
|---|---|
| Review rules (public) | `/noteikumi`, source `src/pages/noteikumi.astro` |
| Privacy policy (public) | `/privatuma-politika`, source `src/pages/privatuma-politika.astro` |
| Legitimate interest assessment | [legitimate-interest-assessment.md](legitimate-interest-assessment.md) |
| Moderation guidelines and reply templates | `/admin/palidziba`, source `src/pages/admin/palidziba.astro` |
| Removal request form and its consent text | `/dzesanas-pieprasijums` |
| Retention periods | `src/lib/retention.ts` |

To get the pages as the reviewer will see them, run `npm run dev` and print `/noteikumi` and `/privatuma-politika` to PDF.

## Questions for the reviewer

These are the seven open questions from section 6 of the LIA:
1. Is a DPIA required? It probably is.
2. How should teachers be informed (GDPR Art. 14)?
3. Defamation and the site's liability for reviews.
4. Wording or measures needed for minors as reviewers.
5. Are the retention periods appropriate?
6. Is the wording about transfers to Cloudflare correct?
7. Who is the controller, and what are their details?

Also ask the reviewer to check:
- the rule list in `/noteikumi`, and whether the moderation guidelines are enough to prevent defamation
- the legal bases stated in the privacy policy for each type of processing
- the 30-day response promise and the removal process

## After the review

1. Update the texts in `src/pages/noteikumi.astro` and `src/pages/privatuma-politika.astro`.
2. Fill in the controller in `src/lib/site.ts`, and change `privacyPolicyUpdated` to the date the text takes effect.
3. If retention periods change, edit `src/lib/retention.ts` only; the privacy policy reads its values from there.
4. Mark the LIA as approved, with the date and the reviewer's name.
