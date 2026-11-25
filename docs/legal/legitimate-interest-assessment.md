# Legitimate interest assessment (LIA)

**Processing:** publishing teachers' names together with students' ratings and reviews of their teaching
**Legal basis relied on:** GDPR Art. 6(1)(f), legitimate interests
**Status:** draft for legal review (plan.md, week 8). Not yet approved.
**Last updated:** 2026-11-25

This assessment covers teachers, the people the published content is about. Reviewers are anonymous and the site stores no data about them (see section 5). Other processing (teacher replies, removal requests, CMS users) is covered by the privacy policy at `/privatuma-politika`.

---

## 1. Purpose test: is there a legitimate interest?

**The interests:**
- **Students and parents:** the right to receive information about the quality of teaching before choosing a school, university or course (freedom of expression and information, Charter Art. 11; ECHR Art. 10).
- **Students who review:** the right to share their own experience of a service they received.
- **Teachers and institutions:** feedback that can improve teaching.
- **The public:** transparency about the quality of publicly funded education.

**Assessment:** these are real, lawful and clearly stated interests. Similar services exist in other EU countries, and courts have accepted them under certain safeguards (for example the German Federal Court of Justice, *spickmich.de*, VI ZR 196/08, 2009).

## 2. Necessity test: is publishing names necessary?

- Ratings that can't be linked to a specific teacher don't serve the purpose. A student choosing a course needs to know who teaches it.
- **Data minimisation:**
  - Only the name, institution and subjects are published.
  - No photos, dates of birth, contact details or private-life information.
  - Free-text reviews are checked by a moderator before publication.
  - Dates are shown as month and year only.
- **Less intrusive alternatives considered:**
  - *Institution-only ratings:* rejected, because they don't tell students about the teachers they'll actually have.
  - *Opt-in teachers only:* rejected in planning (decision #15) because it would make the service unusable. It remains the fallback if this assessment doesn't hold.

## 3. Balancing test: do the teacher's rights override these interests?

**Factors that favour publication:**
- The content concerns only the teacher's **professional** role, which by its nature is performed in front of students and is of public interest.
- Rules prohibit content about private life, appearance or health, as well as insults and unverifiable accusations of crimes. Each review is **pre-moderated**.
- Teachers can **reply publicly** to any review.
- Teachers can **object, or request correction or removal**. Requests are answered within 30 days, and removal blocks the page from being re-created.
- Scores are shown together with the number of reviews, so a single review is visibly a single opinion.

**Factors that weigh against publication:**
- Negative public ratings can affect reputation and employment.
- Reviewers are anonymous, so fake or malicious reviews are possible. The safeguards are Turnstile, moderation and the rules.
- Reviewers may be **minors** (general schools). That affects the reliability of content, not the reviewers' own data, since none is stored.
- Teachers may not know the site exists until they find their page.

**Reasonable expectations:** teachers in Latvia may not yet expect to be rated online. This makes clear information and easy objection especially important.

**Conclusion (draft):** with the safeguards in section 4, the legitimate interests are not overridden. Final confirmation is needed from a lawyer, together with the open questions in section 6.

## 4. Safeguards in place

| Safeguard | Where |
|---|---|
| Pre-moderation of every review and every suggested teacher | CMS review queue |
| Published rules; moderation guidelines | `/noteikumi`, `/admin/palidziba` |
| Moderator redaction, with the original kept for 90 days and visible only in the CMS | `src/lib/moderation.ts`, `src/lib/retention.ts` |
| Public reply for teachers | `/atbildet/<id>` |
| Objection / removal process, answered within 30 days | `/dzesanas-pieprasijums`, `/admin/pieprasijumi` |
| Removed teachers can't be re-created by import or suggestion | `src/lib/teacher-import.ts`, `src/lib/reviews.ts` |
| No reviewer data stored (no IP, account, cookies); month-only dates | `src/lib/reviews.ts`, `src/lib/turnstile.ts` |
| Automatic deletion when retention periods end | `src/lib/retention.ts` (daily Cron Trigger) |
| Access control for the CMS (Cloudflare Access plus roles) | `src/middleware.ts` |

## 5. Reviewers

No personal data about reviewers is collected or stored:
- no accounts, IP addresses, user agents or cookies
- Turnstile is verified server-side without forwarding the visitor's IP address

Reviewers could still identify themselves in free text, so moderators remove such details. This should be confirmed in the legal review.

## 6. Open questions for the legal review

1. **DPIA:** is a data protection impact assessment required? The processing publicly evaluates the professional performance of identifiable people at national scale, and reviewers may be minors. Check the Data State Inspectorate's list of processing operations that require a DPIA. The working assumption should be that **a DPIA is likely required**.
2. **Informing teachers (Art. 14):** is the privacy policy enough, given that teachers are not told individually when their page is created? Or is another measure needed, for example a general notice to institutions?
3. **Defamation and platform liability** under Latvian law, and whether pre-moderation changes the site's liability for reviews.
4. **Minors as reviewers:** whether age-specific wording or measures are needed.
5. **Retention periods** in `src/lib/retention.ts`: are 12 months for rejected/removed reviews and resolved requests, and 90 days for redacted originals and unanswered reply emails, appropriate?
6. **Transfers:** whether Cloudflare's Data Processing Addendum covers the transfer mechanism, and whether that needs to be stated more specifically.
7. **Controller identity:** who the controller is and their contact details (`src/lib/site.ts` still has placeholders).
