# PayTra AI service

Python + FastAPI, port 8002. Suggests categories for payees the rules engine
didn't recognise. Insights chat and unusual-spending detection come next.

## Rules it follows

- **The model never computes numbers.** It only picks a category name; totals
  stay in SQL in the web app.
- **Minimum data.** It receives the payee name, the direction (DEBIT/CREDIT) and
  the channel. No amounts, account numbers or raw narrations; extra fields are
  rejected (422).
- **Output is constrained and checked.** The response schema only allows the
  caller's category names or `UNKNOWN`; the service then drops invented ids,
  unknown names, and categories that don't fit the direction (e.g. Salary on a
  debit).
- **Payee names are untrusted.** They go in as JSON data and the worst outcome of
  an injected payee is a wrong suggestion the user can correct.
- **No key, no AI.** Without `GEMINI_API_KEY` the endpoint returns 503 and the
  web app keeps using rules only.
- **Mock data only on the free tier.** The Gemini API free tier may use inputs to
  improve Google products. Production would switch to Vertex AI (only
  `app/llm.py` changes).
- **No payees or prompts in logs.** Counts and error types only.

## Run locally (PowerShell)

```powershell
cd ai
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m pytest -q
# optional: copy .env.example to .env.local and add a Gemini API key
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8002 --env-file .env.local
```

Without `--env-file` (no key) the service still starts; `/v1/categorise` returns 503.

## API

`GET /health` → `{"status":"ok"}`

`POST /v1/categorise`

```json
{
  "items": [{ "id": "a1", "payee": "SWIGGY", "direction": "DEBIT", "channel": "UPI" }],
  "categories": [{ "name": "Food & Dining", "kind": "EXPENSE" }]
}
```

→ `{"suggestions":[{"id":"a1","category":"Food & Dining","confidence":"high"}],"model":"gemini-3.5-flash-lite"}`

`category` is `null` when the model didn't know or its answer failed validation.
Limits: 50 items, 100 categories, 80 characters per name.
