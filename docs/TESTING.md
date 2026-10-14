# Testing PayTra

How to check every feature, on the live app or locally, and what you should see.
All data here is mock data. Never use a real bank statement, password or UPI PIN for testing.

## Links

| What | Link |
|---|---|
| Live app (Cloud Run, Mumbai) | https://paytra-web-983935958947.asia-south1.run.app |
| Sign in | https://paytra-web-983935958947.asia-south1.run.app/login |
| Code | https://github.com/vaibhavbombe/paytra |
| Local app | http://localhost:3000 (`npm run dev` in `web/`) |
| Local worker health | http://localhost:5004/health |

The live service scales to zero, so the first request after a quiet period takes a few seconds.

### What is live and what is not

| Feature | Live (master) | Local branch |
|---|---|---|
| Sign in, manual entry, transaction list | Yes | Yes |
| CSV / PDF statement import | Yes | Yes |
| Rules and categories | Yes | Yes |
| Budgets, 80% / 100% alerts, push | Yes | Yes |
| Analytics, recurring payments | Yes | Yes |
| Privacy: activity log, export, delete account | Yes | Yes |
| Reconciliation (bank alerts) | Yes | Yes |
| Account Aggregator (Setu sandbox) | Not yet | `feature/account-aggregator`; Setu's test AA is down at the time of writing |

## Automated tests

```powershell
cd web
npx vitest run
```

Expected: `Test Files 19 passed (19)`, `Tests 146 passed (146)` (measured on 14 Oct 2026 on the
`feature/account-aggregator` branch; master without the Account Aggregator: 139 tests in 18 files). They cover paise parsing and formatting, budget periods,
CSV and PDF statement parsing, narration and reference extraction, duplicate detection, the rules
engine, budget thresholds, bank-alert parsing, the reconciliation engine, Account Aggregator data
mapping, and the budget and analytics SQL on PGlite (Postgres in WebAssembly, so the real
migrations run in memory).

Type check and lint:

```powershell
npx tsc --noEmit
npm run lint
```

Expected: no output from `tsc`, no errors from lint.

## Manual checks

Use a test account. Each step says where to go and what to expect.

### 1. Sign in and session

1. Open `/login`, sign in with Google or email.
   Expect the dashboard, the ₹ logo in the header, and the nav links.
2. Open the browser dev tools, Application → Cookies.
   Expect a `__Host-paytra_session` cookie marked HttpOnly and Secure, and nothing in Local Storage.
3. Sign out, then open `/transactions` directly.
   Expect a redirect to `/login`.

### 2. Accounts and manual entry

1. `/accounts` → add an account (bank name, last 4 digits only).
   Expect only the last 4 digits shown (`••1234`); the full number is never asked for.
2. `/transactions/new` → add ₹250.50, Debit, a payee such as "Swiggy".
   Expect it in `/transactions` as ₹250.50 under Food & Dining.
3. Try an amount of `12.345` or `-5`.
   Expect a validation error; nothing is saved.

### 3. Statement import and duplicates

1. `/imports` → choose the account → upload
   `web/src/lib/imports/__fixtures__/hdfc-style-mock.csv`.
   Expect a preview within a few seconds with rows, totals and the opening/closing balance check.
2. Confirm. Expect the rows in `/transactions`, categorised by rules.
3. Upload the same file again.
   Expect every row reported as already in PayTra and 0 new rows on confirm.
4. Optional: upload a text-based PDF statement with mock data.
   Expect the same preview. A scanned PDF is reported as unreadable, not guessed.

### 4. Categories and rules

1. On `/transactions`, change one transaction's category.
   Expect other transactions from the same payee (set by rules) to change too.
2. `/rules`. Expect a new rule for that payee, marked as yours.

### 5. Budgets and alerts

1. `/budgets` → create a monthly budget for a category, set below what you've already spent.
   Expect the budget bar in amber (80%+) or red (100%+).
2. `/dashboard`. Expect an alert in the alerts panel.
3. With the app open in one tab, add a manual transaction that crosses a threshold in another tab.
   Expect a live pop-up in the first tab within a few seconds (Server-Sent Events).
4. `/settings` → enable push notifications, then cross another threshold.
   Expect a browser notification that names the budget but shows no rupee amount.
5. Cross the same threshold again in the same period. Expect no second alert.

### 6. Analytics

1. `/analytics` → switch daily / weekly / monthly / yearly.
   Expect the trend chart, category split, this vs last period, and top payees.
2. With 3 or more monthly payments to the same payee (e.g. a subscription), expect it under
   recurring payments with the next expected date.

### 7. Privacy

1. `/settings` → activity log. Expect sign-ins, imports and budget changes, with masked IPs.
2. Export. Expect a JSON file with your transactions, budgets and rules.
3. Delete account (use a throwaway account).
   If the sign-in is older than 10 minutes, expect a request to sign in again first.
   After deletion, expect to be signed out with all data gone.

### 8. Reconciliation

1. `/reconciliation` → paste a mock bank alert, for example:
   `Rs.450.00 debited from A/c XX4821 on 05-10-26 to VPA swiggy@icici UPI Ref 427812345678`
   using an account whose last 4 digits match.
   Expect it saved as an alert-only transaction.
2. Import a statement with the same UPI reference.
   Expect one transaction, not two, linked to both sources (exact match).
3. Paste an alert without a reference that matches an amount within 2 days.
   Expect a suggestion you confirm by hand. Two equal candidates show as "needs your check".
4. Paste an OTP message. Expect it rejected and not stored.

### 9. Account Aggregator (local branch, Setu sandbox)

Needs `SETU_*` values in `web/.env.local`.

1. `/aa` → read the consent summary → choose "Setu (test AA)" → mobile `9999999999` → tick the box
   → Continue. Expect a redirect to Setu's approval screen.
2. Approve with OTP `123456`, select the mock accounts.
   Expect `/aa/return` to show "waiting", then the number of transactions imported.
3. Return to `/aa` → Revoke, with "delete data" ticked.
   Expect status Revoked and only the transactions from that consent removed.

Known issue (Oct 2026): Setu's test AA returns "upstream servers are currently down".
Onemoney's test AA sends a real SMS and works only for numbers Setu has whitelisted.

### 10. AI category suggestions (mock data only)

1. Add mock manual transactions for payees no rule knows, e.g. ₹120 Blinkit, ₹85 Rapido,
   ₹499 Netflix, ₹350 Apollo Pharmacy, ₹500 Rahul Sharma.
2. `/transactions` → **Suggest with AI**. Expect a notice saying only payee names and money in/out go
   to Google Gemini (free tier, mock data only) and a checkbox; **Send to AI** stays disabled until
   it is ticked.
3. Tick and send. Expect the businesses categorised with an **AI** tag and the person's name left
   uncategorised ("left for you").
4. Change an AI-tagged category. Expect the tag to go and a rule for that payee on `/rules`.
5. `/settings` → activity log. Expect "Asked AI to suggest categories", with no payee names.

AI service tests: `cd ai; .venv\Scripts\python -m pytest -q` → `23 passed`.
Measured on 14 Oct 2026 with 8 mock payees on `gemini-3.5-flash-lite`: 1.3–1.9 s per call;
6 of 8 categorised, the personal name and a prompt-injection payee left uncategorised.

### 11. Ask about your spending (insights chat, mock data only)

1. **Ask** in the nav → tick the mock-data box → try the example questions.
2. "How much did I spend on food last month?" → expect a one-line answer in ₹ plus chips showing how
   it was read: *Period: 1 Sept 2026 to 30 Sept 2026 · Category: Food & Dining*. The total should
   match `/analytics` for that month and category.
3. "Where did my money go this year?" → a category table with shares; "Top 5 payees in September" →
   a payee table; "List my Swiggy orders this month" → matching transactions, newest first.
4. "Should I invest in index funds?", "Delete all my transactions", "What will I spend next month?" →
   a polite refusal, nothing run.
5. `/settings` → activity log shows "Asked a question about spending" without the question text.

What leaves PayTra: the question, today's date and category names. Amounts and transactions never do;
the AI only picks one of five read-only queries, and PayTra calculates and writes the answer.

## Security checks

| Check | How | Expected |
|---|---|---|
| Security headers | `curl -I https://paytra-web-983935958947.asia-south1.run.app/login` | HSTS, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, no `X-Powered-By` |
| Worker is private | `curl https://<worker-url>/health` without a token | 403 |
| AI service is private | `curl https://paytra-ai-983935958947.asia-south1.run.app/health` | 403 |
| Pages need a session | open `/budgets` signed out | redirect to `/login` |
| Upload URL expires | reuse an upload URL after 10+ minutes | rejected by Cloud Storage |
| No secrets in git | `git grep -nE "npg_\|private_key\|AIza"` | no real values |
