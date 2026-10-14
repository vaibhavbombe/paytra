<img src="web/src/app/icon.svg" alt="PayTra logo" width="64" height="64">

# PayTra: personal finance tracker

PayTra brings all of a person's payments into one place, including UPI payments
made through GPay, PhonePe and Paytm. Users can track spending by day, week,
month and year, set budgets with live alerts, and see analytics and recurring
payments. AI-assisted insights are planned (see [Roadmap](#roadmap)).

It is built the way a bank or fintech would expect. Money is stored as exact
integers, imports never create duplicates, data is accessed only with consent,
and every change is audited.

**Live demo:** https://paytra-web-983935958947.asia-south1.run.app
(sign in with Google, or create an email account and verify it)

> **Status (14 Oct 2026):** Phases 1–4 (foundation, statement imports, categories + budgets + alerts,
> analytics) and privacy controls are live. Reconciliation of bank alerts and the Account Aggregator
> (Setu sandbox) are built on a branch and not yet deployed. The demo runs on free tiers and
> development infrastructure. See [Honest limitations](#honest-limitations).
>
> **How to test every feature, with expected results:** [docs/TESTING.md](docs/TESTING.md)

---

## Why there is no "GPay / PhonePe integration"

GPay, PhonePe and Paytm **have no public API for reading a user's transaction
history**, and PayTra does not pretend otherwise. A UPI payment debits the
user's **bank account**, so PayTra captures it from legitimate bank-side sources:

| Source | How | Status |
|---|---|---|
| Manual entry | Cash and anything else | ✅ Phase 1 |
| Bank statement upload | CSV / PDF (incl. password-protected), parsed into transactions | ✅ Phase 2 |
| Bank alert emails | Gmail API, read-only scope, with user permission | Phase 6 |
| Account Aggregator (RBI framework) | Setu AA **sandbox with mock data** | Phase 5 |
| Bank SMS (Android app) | Only bank sender IDs, with explicit consent | Mobile M4 |

---

## What works today (Phases 1–2)

- **Sign-in:** Google, or email + password.
  - Sign-up enforces password rules and a confirm field.
  - Email must be verified before first sign-in.
  - Forgot password is available.
- **Sessions:** the browser holds only an **httpOnly, Secure, SameSite** session
  cookie. No tokens are kept in `localStorage` or IndexedDB.
- **Manual transactions:**
  - Debit or credit, amount, date, category, account, notes.
  - Double-submits and retries are saved **exactly once**.
- **Transaction list:**
  - Day / week / month / year views. Weeks run Monday–Sunday, using India's calendar day.
  - Filters for direction, category, account and text search.
  - Money in / money out / net for the whole period, calculated in SQL.
  - Paging that stays stable when new entries are added.
- **25 built-in categories:** expense, income and transfer.
  - Transfers between your own accounts are excluded from money in/out, so
    they aren't counted as both spending and income.
- **Bank statement import (CSV and PDF):**
  - Header-driven parser for HDFC-, SBI- and ICICI-style layouts: separate
    Withdrawal/Deposit columns, or Amount + Dr/Cr.
  - Text PDFs are rebuilt into tables from text positions. Password-protected
    PDFs are supported; the password is used once and never stored.
  - Each narration yields the channel (UPI/NEFT/IMPS/ATM/card/NACH), the payee
    and the UPI RRN or NEFT UTR. UPI IDs are not stored.
  - A preview shows new rows, duplicates and errors with line numbers, plus a
    **running-balance check**: each row's closing balance must equal the
    previous balance ± the amount.
  - **Idempotent:** re-importing a file, an overlapping statement, or the PDF
    of an already-imported CSV adds zero duplicates (tested).
  - Every row is linked to the import it came from, as groundwork for
    cross-source reconciliation.
- **Light / dark / system theme,** with no flash on load.
- **Automatic deploys:** every merge to `master` builds, migrates and deploys
  to Cloud Run.

---

## Architecture

```
 Browser ──HTTPS──▶ Cloud Run: paytra-web (Next.js 16, asia-south1 Mumbai)
   │                  │  runs as service account paytra-web (2 roles only)
   │                  │
   │                  ├──▶ Neon PostgreSQL (Prisma 7, pooled URL from Secret Manager)
   │                  └──▶ Firebase Admin: verify / create / revoke session cookies
   │
   ├──▶ Firebase Auth (Google / email sign-in, client SDK kept in memory only)
   │
   └──PUT (V4 signed URL, 10 min, ≤1 MB)──▶ Cloud Storage: private statements bucket
                                              │ OBJECT_FINALIZE
                                              ▼
                                           Pub/Sub ──push (OIDC)──▶ Cloud Run: paytra-worker (private)
                                                                     parse → store preview → delete file

 GitHub master ──push──▶ Cloud Build trigger (runs as paytra-build)
                           1. docker build (runtime + migrate images)
                           2. push to Artifact Registry (asia-south1)
                           3. prisma migrate deploy (direct URL from Secret Manager)
                           4. gcloud run deploy (only if migrations succeeded)
```

**Planned additions** (later phases):
- The worker also handles categorisation and budget checks.
- Python FastAPI AI service.
- FCM push alerts and SSE live updates.
- React Native (Expo) mobile app on the same API.

---

## Design decisions (and why)

### Money
- **Amounts are `BIGINT` paise, never floats.** `parseFloat("0.29") * 100` is
  `28.999…`, so rupee input is parsed with integer/string maths only. For
  example, `"₹1,23,456.78"` becomes `12345678n`. Anything that would need
  rounding (`12.345`) is **rejected, not rounded**.
- **Amounts are always positive; a separate `direction` (DEBIT / CREDIT) holds
  the sign.** This matches the Dr/Cr columns of a bank statement and makes
  sign errors impossible.
- **The database enforces the rules itself,** whatever code writes to it:
  - `CHECK (amount_paise > 0)`
  - INR only
  - `last4` must be exactly 4 digits
  - the consent date range must be valid
- **Totals are calculated by Postgres** (`SUM` over `BIGINT`), never by an LLM
  and never with JavaScript floats.

### Correctness
- **Imports are idempotent.** A `UNIQUE(account_id, fingerprint)` key prevents
  duplicates.
  - Manual entries use a client-generated request ID as the fingerprint, so a
    double-click or a network retry inserts once.
  - Statement imports (Phase 2) will hash account + date + amount + reference.
- **Dates are date-only (`DATE`) in IST.** Statements have no time of day, and a
  timestamp would shift late-night transactions into the wrong day across
  UTC/IST. "Today" is the Indian calendar day, even before 05:30 IST.
- **Period ranges are half-open (`[start, end)`).** This means there are no
  `23:59:59.999` edge cases, and month maths never overflows (Jan 31 + 1 month
  does not land in March).
- **Related rows change together in one database transaction.** For example, a
  transaction and its audit log entry are always written together.
- **Race-safe account creation:** a per-user Postgres advisory lock ensures one
  "Cash" account per user. Measured: 10 concurrent requests created 10 accounts
  without the lock and 1 with it.

### Statement-import pipeline
- **Signed upload URLs:** they allow only one object, one content type and at
  most 1 MB, for 10 minutes. Cloud Storage itself rejects anything else
  (measured: oversized → 400, wrong type → 403).
- **The worker is private.** Only the Pub/Sub push identity has `run.invoker`;
  anonymous requests get 403.
  - It trusts only the object path (`uploads/<user>/<job>`), never data from
    the client.
  - It claims each job atomically, because Pub/Sub delivers at least once.
- **Files are deleted as soon as they're parsed.** The bucket has no
  soft-delete retention and a 1-day auto-delete as a backstop.
- **Password-protected PDFs** are parsed inside the web request instead, so a
  password never sits in a queue or the database.
- **Measured:** upload → preview ready took 2.2–7.5 s over 5 runs on 2026-10-12.
  The worker's own processing took 0.7–1.5 s; the slower runs include starting
  from zero instances.

### Security
- **Session cookie:** `__Host-` prefix, httpOnly, Secure, SameSite=Lax, 5 days.
  - It is minted only from a sign-in less than 5 minutes old.
  - It is checked for **revocation on every request**.
  - Signing out revokes all of the user's sessions.
- **CSRF:** the Origin header is checked on cookie-authenticated state changes,
  in addition to SameSite.
- **Rate limiting** on the login endpoint (10 attempts per minute per IP).
- **Zod validation** on every API and Server Action input.
- **Authorisation on every query:**
  - Data is always scoped to the signed-in user.
  - Account and category IDs sent by the browser are checked for ownership,
    to prevent insecure direct object references (IDOR).
- **No account enumeration:** sign-in, sign-up and password-reset messages
  don't reveal whether an email is registered.
- **Account numbers are masked to the last 4 digits** in the UI. The full
  number column is reserved for KMS envelope encryption (Phase 8).
- **Append-only audit log:** a Postgres trigger blocks UPDATE, DELETE and
  TRUNCATE.
  - The one allowed change is `user_id → NULL` when a user deletes their data.
  - This keeps the trail of what happened without keeping personal data.
- **Least-privilege cloud identities:**
  - The runtime account can read only the pooled DB secret and manage Firebase
    sessions.
  - The build account can read only the migration secret, push to one
    repository, and deploy as the runtime account.
  - The runtime has no key files; it gets short-lived tokens from the metadata
    server.
- **Secrets** live in Secret Manager (production) or `.env.local` (development,
  git-ignored) and are never baked into images. The Docker image runs as a
  non-root user.

---

## Tech stack

| Layer | Choice |
|---|---|
| Web | Next.js 16 (App Router, Cache Components), React 19, TypeScript, Tailwind CSS 4 |
| Data | PostgreSQL on Neon, Prisma 7 (`@prisma/adapter-pg`) |
| Auth | Firebase Authentication + Firebase Admin session cookies |
| Validation | Zod 4 |
| Tests | Vitest |
| Cloud (GCP, asia-south1) | Cloud Run, Cloud Build, Artifact Registry, Secret Manager |

---

## Run locally

Requirements: Node.js 20.19+ (developed on 24 LTS), a Neon database and a
Firebase project.

```powershell
cd web
npm ci
Copy-Item .env.example .env.local   # then fill in the values, see comments inside
npx prisma migrate deploy           # create tables
npx prisma db seed                  # built-in categories (safe to re-run)
npm run dev                         # http://localhost:3000
```

| Command | Purpose |
|---|---|
| `npm test` | Unit tests |
| `npx tsc --noEmit` | Type-check |
| `npx eslint .` | Lint |

## Tests

`npm test` runs **146 tests in 19 files** (all passing, Vitest, measured on
2026-10-14 on the `feature/account-aggregator` branch; master has fewer because
reconciliation and AA are not merged yet: 120 tests). Step-by-step manual checks are in
[docs/TESTING.md](docs/TESTING.md). They cover:
- rupee → paise parsing and formatting, including float-trap values
- IST dates
- day/week/month/year period ranges, including leap years and year boundaries
- transaction input validation
- URL filter parsing
- password rules
- CSV parsing
- narration parsing
- statement parsing, including the running-balance check
- PDF table rebuilding, including encrypted PDFs, and a test that a PDF and a
  CSV of the same statement produce identical fingerprints

The database constraints and the audit-log trigger were also checked by
running the migration against a throwaway Postgres (PGlite) with 22
accept/reject cases. That check isn't in the automated suite yet.

---

## Honest limitations

- **Free-tier / development setup:**
  - Neon free plan, in **AWS Singapore**, while Cloud Run runs in Mumbai.
  - Firebase stores user identities (email, name) outside India.
  - A production deployment would move the database to Cloud SQL in
    asia-south1 to meet RBI data-localisation expectations.
- **Account Aggregator** (Phase 5) will use the **Setu sandbox with mock data**.
  Production needs FIU onboarding with Sahamati and KYC.
- **The AI service** (Phase 7) will use the Gemini API free tier with **mock
  data only**, because free-tier prompts may be used to improve Google
  products. Production would use Vertex AI.
- **The login rate limiter is in-memory, per instance.** That's fine at max 1
  instance; more instances would need a shared store (Redis).
- **Statement imports:**
  - Scanned (image-only) PDFs aren't supported; they'd need OCR (Document AI,
    a paid upgrade).
  - Bank formats vary, and the parser has only been tested on **mock**
    statements shaped like HDFC/SBI/ICICI exports. No accuracy figure on real
    statements is claimed.
- **Not done yet** (Phase 8, hardening):
  - security headers (CSP, HSTS)
  - restricting the Firebase web API key
  - KMS field encryption
  - audit-log screens
- **No performance or accuracy numbers are claimed yet.** They will be added
  only once measured, along with how they were measured.

---

## Roadmap

1. ✅ **Foundation:** auth, schema, manual entry, transaction list, Cloud Run deploy
2. ✅ **Imports:** CSV + PDF statements, preview with balance check, idempotent insert;
   signed-URL upload → Pub/Sub → private worker
3. **Categorisation, budgets and alerts:** rules engine, 80% / 100% budget
   alerts via FCM and SSE
4. **Analytics:** charts, recurring-payment detection (subscriptions, EMIs, rent)
5. **Account Aggregator:** Setu sandbox consent → fetch → same import pipeline
6. **Gmail alerts + reconciliation:** match the same payment across sources,
   keep it once, show a reconciliation report
7. **AI service:** LLM categorisation for unclear merchants, insights chat with
   read-only tools (the LLM explains numbers; it never computes them)
8. **Hardening:** KMS encryption, audit screens, security headers, more tests

Mobile app (React Native + Expo, same API) starts after Phase 4. Its signature
feature is consent-based **Android bank-SMS capture**.
