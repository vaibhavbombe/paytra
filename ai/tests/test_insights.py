import json
from datetime import date

from fastapi.testclient import TestClient

from app.insights import PlanRequest, build_prompt, response_schema, validate_plan
from app.main import app

TODAY = date(2026, 10, 14)
CATS = ["Food & Dining", "Transport", "Salary"]


def req(q="How much did I spend on food last month?"):
    return PlanRequest(question=q, today=TODAY, categories=CATS)


def plan(**kw):
    return validate_plan(req(), json.dumps(kw))


def test_valid_total_plan_passes_through():
    p = plan(tool="total", from_date="2026-09-01", to_date="2026-09-30", category="Food & Dining")
    assert (p.tool, p.from_date, p.to_date, p.category) == ("total", date(2026, 9, 1), date(2026, 9, 30), "Food & Dining")


def test_missing_dates_default_to_this_month_so_far():
    p = plan(tool="total")
    assert (p.from_date, p.to_date) == (date(2026, 10, 1), TODAY)


def test_future_end_is_clamped_to_today():
    p = plan(tool="total", from_date="2026-10-01", to_date="2026-12-31")
    assert p.to_date == TODAY


def test_period_entirely_in_future_is_unsupported():
    assert plan(tool="total", from_date="2027-01-01", to_date="2027-01-31").tool == "unsupported"


def test_reversed_or_too_long_period_is_unsupported():
    assert plan(tool="total", from_date="2026-09-30", to_date="2026-09-01").tool == "unsupported"
    assert plan(tool="total", from_date="2015-01-01", to_date="2026-01-01").tool == "unsupported"


def test_category_not_in_list_is_unsupported_not_ignored():
    # Dropping it would silently answer "all spending" to a food question.
    p = plan(tool="total", from_date="2026-09-01", to_date="2026-09-30", category="Lottery")
    assert p.tool == "unsupported"


def test_limits_are_capped():
    assert plan(tool="top_payees", limit=500).limit == 10
    assert plan(tool="transactions", limit=0).limit == 1
    assert plan(tool="transactions").limit == 20


def test_trend_gets_a_granularity_and_irrelevant_filters_are_dropped():
    p = plan(tool="trend", from_date="2026-01-01", to_date="2026-10-14", payee="Swiggy")
    assert (p.granularity, p.payee) == ("month", None)
    p = plan(tool="by_category", category="Food & Dining", limit=5)
    assert (p.category, p.limit) == (None, None)


def test_unsupported_keeps_a_short_reason():
    p = plan(tool="unsupported", reason="I can't give investment advice." + "x" * 500)
    assert p.tool == "unsupported" and p.reason.startswith("I can't give") and len(p.reason) <= 200


def test_garbage_is_unsupported():
    for raw in ["", "nope", "[]", '{"tool":"drop_table"}', '{"tool":"total","from_date":"31/09/2026"}']:
        assert validate_plan(req(), raw).tool == "unsupported"


def test_prompt_carries_only_question_date_and_category_names():
    p = json.loads(build_prompt(req()))
    assert set(p) == {"today", "allowed_categories", "question"}


def test_schema_limits_tools_and_categories():
    s = response_schema(CATS)["properties"]
    assert "unsupported" in s["tool"]["enum"] and s["category"]["enum"] == CATS


class FakeModel:
    name = "fake-model"

    def __init__(self, raw):
        self.raw = raw

    async def generate_json(self, system, prompt, schema):
        return self.raw


def test_plan_endpoint():
    app.state.model = FakeModel(json.dumps({"tool": "by_category", "from_date": "2026-09-01", "to_date": "2026-09-30"}))
    r = TestClient(app).post(
        "/v1/insights/plan",
        json={"question": "Where did my money go in September?", "today": "2026-10-14", "categories": CATS},
    )
    assert r.status_code == 200
    assert r.json()["plan"]["tool"] == "by_category"


def test_plan_endpoint_validates_input():
    app.state.model = FakeModel("{}")
    c = TestClient(app)
    assert c.post("/v1/insights/plan", json={"question": "x" * 301, "today": "2026-10-14", "categories": CATS}).status_code == 422
    assert c.post("/v1/insights/plan", json={"question": "hi", "today": "2026-10-14", "categories": CATS, "amount": 1}).status_code == 422
