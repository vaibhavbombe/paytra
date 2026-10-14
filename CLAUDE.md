# PayTra — Personal Finance Tracker (project guide for Claude)

## What this project is
A personal finance platform that brings all of a user's payments (including UPI payments made
through GPay, PhonePe, Paytm etc.) into one place, tracks spending daily / weekly / monthly / yearly,
lets the user set budgets, sends live alerts before a budget is exceeded, and gives AI-powered
analytics. Built to impress banks and fintech companies, so security, correctness of money
calculations and consent-based data access matter more than visual polish.

Vaibhav's background: he builds Finance & Accounts (FIAC) modules, including bank reconciliation,
in an enterprise ERP. PayTra should show that domain knowledge.

## Current status (14 Oct 2026)
- **Live:** https://paytra-web-983935958947.asia-south1.run.app (master; Cloud Build trigger
  `deploy-on-master` skips commits that only change `*.md`).
- **Code:** https://github.com/vaibhavbombe/paytra
- **Done and live (master):** Phases 1–4 (foundation, CSV/PDF imports via signed URL → Cloud
  Storage → Pub/Sub → worker, rules + budgets + 80/100% alerts via SSE and FCM web push,
  analytics + recurring payments), privacy (activity log, export, step-up account deletion,
  security headers), ₹ app logo (`web/src/app/icon.svg`, `logo.tsx`), `docs/TESTING.md`.
- **Built, on branch `feature/account-aggregator`, not merged:** Phase 6 reconciliation
  (pasted bank alerts, exact merge on UPI/NEFT reference, suggestions within ±2 days, report) and
  Phase 5 Account Aggregator (Setu sandbox: consent, fetch, import through the statement parser,
  revoke with optional delete). AA end-to-end is blocked: Setu's `@setu` test AA returns
  "upstream servers are currently down"; `@onemoney` needs the test number whitelisted by Setu.
  Before merging AA: add `SETU_*` to Secret Manager and the Cloud Run service.
- **Not started:** Gmail alert import (needs approval for the Gmail API / OAuth consent screen),
  AI service (Phase 7), KMS field encryption + strict CSP (Phase 8), mobile app (M1–M6).
  Cloud Scheduler daily budget check was skipped by choice (budgets are checked after each
  import or entry).
- **Tests:** 146 Vitest tests in 19 files on the AA branch, 120 in 16 on master, all passing
  (14 Oct 2026). How to test everything,
  with live links: `docs/TESTING.md`.
- **Engineering notes** (design decisions, interview Q&A basic → advanced, architecture diagram):
  https://claude.ai/code/artifact/d0863ec3-6d0a-4a2c-b0b8-2b9a66d0ed59

## Key decisions already made (don't re-litigate without a reason)
- Dev and live share one Neon database, so every migration is **expand → contract**; test new
  migrations on PGlite first.
- Reconciliation auto-merges **only on an equal UPI/NEFT reference**; anything weaker is a
  suggestion the user confirms; equal candidates are flagged ambiguous, never auto-picked.
- AA data is converted into a statement table and parsed by the same parser, so fingerprints
  match CSV/PDF imports. Consent: DEPOSIT, TRANSACTIONS + SUMMARY, 12 months, purpose 102,
  one-time fetch, valid 1 month.
- Push notifications never contain rupee amounts. SSE only for visible tabs (~50 s streams,
  resume by UUIDv7 cursor).
- Rate limiter is in memory: correct only while Cloud Run max instances = 1.

## Important truth about UPI apps
GPay, PhonePe and Paytm have NO public API for reading a user's transaction history.
Never claim or build a "direct GPay/PhonePe integration". UPI payments debit the user's bank
account, so they are captured through these legitimate sources instead:
1. **Account Aggregator (RBI framework)** via the Setu AA sandbox: consent → fetch bank transactions.
   Sandbox / mock data only. Production would need KYC and Sahamati FIU onboarding.
2. **Bank statement upload** (CSV and PDF) → parsed into transactions.
3. **Bank alert emails** via the Gmail API (read-only scope, user permission) → near-live tracking.
4. **Manual entry** (cash).

## Stack (free setup now; paid upgrades listed at the end)
- **Web app:** Next.js (App Router) + TypeScript + Tailwind + Recharts. Route Handlers / Server
  Actions for everyday API calls. Web sessions in httpOnly, Secure, SameSite cookies (no tokens in
  localStorage).
- **Mobile app:** React Native with Expo (development build, not Expo Go) + TypeScript.
  Talks to the SAME Next.js API; Postgres stays the single source of truth.
- **Auth (web + mobile):** Firebase Authentication (Google sign-in + email). The Next.js API
  verifies Firebase ID tokens with the Firebase Admin SDK and maps them to the user row in
  Postgres. Web exchanges the ID token for an httpOnly session cookie.
- **Firebase (free tier):** Auth, Cloud Messaging (push alerts), Crashlytics, Remote Config.
  Do NOT store transactions in Firestore.
- **Database:** PostgreSQL on Neon (free) + Prisma ORM and migrations.
- **Worker:** Node.js + TypeScript on Cloud Run, triggered by Pub/Sub (parse imports,
  categorise, dedupe, check budgets, send alerts).
- **AI service:** Python + FastAPI on Cloud Run. Gemini API free tier during development with
  MOCK DATA ONLY (free-tier data may be used to improve Google products). Pydantic validation.
- **GCP (region asia-south1, Mumbai):** Cloud Run, Pub/Sub, Cloud Scheduler (max 3 jobs),
  Secret Manager, Cloud Storage (private bucket for statements), Cloud KMS, Firebase Cloud
  Messaging (push alerts), Cloud Build (CI/CD), Cloud Logging/Monitoring.
- **Live updates in the open dashboard:** Server-Sent Events (not Socket.io).
- **Local ports:** web 3000, worker 5004, AI service 8002.

## Money rules (non-negotiable)
- Store amounts as integers in **paise** (BigInt / integer columns). Never floats.
- Every transaction has a currency code (INR) and a direction (debit / credit).
- Imports are **idempotent**: re-uploading the same statement or re-fetching the same AA data
  never creates duplicates (unique fingerprint per transaction: account + date + amount +
  reference / normalised narration).
- **Reconciliation:** the same payment arriving from two sources (email alert and statement)
  is matched and kept once, with a link to both sources. Show a reconciliation report.
- Budget and analytics totals are calculated in SQL / code. **The LLM never computes numbers.**
- Use database transactions where several rows must change together.

## Security rules (non-negotiable)
- Consent first: clear consent screens, data fetched only for the approved period,
  user can revoke consent and delete their data.
- Never store bank passwords or UPI PINs. Never ask for them.
- Mask account numbers everywhere (last 4 digits only). Encrypt sensitive fields
  (account identifiers, raw narrations) using a key from Cloud KMS.
- Secrets in Secret Manager in production, `.env.local` only in development; never commit them.
- Audit log: who accessed or changed what, and when.
- Rate limiting on auth routes; input validation with Zod on every API boundary.
- Statement files: private bucket, signed upload URLs that expire, deleted after parsing
  (or after a short retention period).

## Features
- Transactions: unified list with filters; daily / weekly / monthly / yearly views
- Categorisation: rules first (merchant → category), LLM only for unclear ones; user corrections
  are remembered as new rules
- Budgets: weekly or monthly, per category or overall; alerts at 80% and 100%
  (FCM push + in-app via SSE + optional email)
- Analytics: trends, category split, this vs last period, top merchants,
  recurring payment detection (subscriptions, EMIs, rent), unusual spending alerts
- AI insights chat: "How much did I spend on food last month?" The AI calls read-only tools
  (get_spend_by_category, get_trend, list_transactions) and explains the computed results

## Build phases (deploy and test after each)
1. **Foundation:** Next.js + TypeScript app, Prisma schema (users, accounts, transactions,
   categories, budgets, consents, audit_logs), Firebase Auth + httpOnly session cookie, manual transaction
   entry, transaction list. Deploy to Cloud Run (asia-south1) with Cloud Build.
2. **Imports:** CSV statement upload → parse → idempotent insert. Then PDF statements
   (own parser first). Upload via signed URL to Cloud Storage → Pub/Sub → worker.
3. **Categorisation + budgets + alerts:** rules engine, budget periods, 80% / 100% alerts
   via FCM and SSE, Cloud Scheduler daily check.
4. **Analytics dashboard:** daily / weekly / monthly / yearly charts, recurring payment detection.
5. **Account Aggregator:** Setu sandbox consent flow → fetch → import through the same pipeline.
6. **Gmail alerts + reconciliation:** parse bank alert emails, match against statement/AA data,
   reconciliation report.
7. **AI service:** LLM categorisation for unclear merchants, insights chat with tools,
   unusual spending detection.
8. **Hardening + README:** tests for money logic (paise maths, dedupe, budget periods, parsers),
   KMS field encryption, audit log screens, honest limitations, architecture diagram.

## Mobile app phases (start after web Phase 4)
M1. **Expo app foundation:** Firebase Auth login, transaction list, add manual transaction,
    dashboard summary, all via the existing API. Secure token storage (expo-secure-store).
M2. **Bank-grade app security:** biometric / PIN app lock (expo-local-authentication),
    hide content in the app switcher, auto-lock after inactivity, no sensitive data in logs.
M3. **Push alerts:** FCM budget alerts (80% / 100%) and daily summary; tapping opens the right screen.
M4. **Android SMS capture (the signature feature):** read ONLY bank transaction SMS
    (filter by known bank sender IDs), parse amount / merchant / account last 4 / reference,
    send to the API through the same idempotent import + reconciliation pipeline.
    Explicit in-app consent screen; non-financial SMS are never read, stored or sent.
    Android only (iOS does not allow reading SMS). Demo is distributed as an APK;
    Google Play would require the SMS Permissions Declaration Form and approval under the
    "SMS-based money management" exception.
M5. **Offline mode:** local SQLite cache, manual entries queued offline and synced when back online
    (idempotent, with conflict handling).
M6. **Charts + polish:** daily / weekly / monthly / yearly charts, budget progress, dark mode.

## Cost safety (GCP)
- Billing budget alert set before deploying anything (about ₹300/month, alerts at 50/90/100%).
- Cloud Run max instances 1–2, min instances 0.
- Max 3 Cloud Scheduler jobs. Keep Secret Manager versions small.
- Document AI and Vertex AI stay off until the paid phase.

## Paid upgrades later (only when Vaibhav decides)
- Neon → Cloud SQL for PostgreSQL
- Gemini API free tier → Vertex AI (no training on customer data)
- Document AI for PDF statements the own parser can't read
- BigQuery for large-scale analytics

## How to work with Vaibhav
- One small step at a time; after each, say exactly how to test it and what result to expect.
- Explain design decisions briefly; he will be asked about them in bank / fintech interviews.
- Windows + PowerShell; save config files as UTF-8.
- Feature branches, merge to master; Cloud Build deploys from master.
- Ask before enabling any GCP service that can cost money.

## Honesty rules
- README says plainly: Account Aggregator runs on the Setu sandbox with mock data; there is no
  direct GPay/PhonePe integration and why; which parts are free-tier dev setups.
- No invented metrics. Numbers (tests count, parse accuracy on sample statements, alert latency)
  only after they are actually measured, with how they were measured.