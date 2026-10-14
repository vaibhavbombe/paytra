"""PayTra AI service (FastAPI, port 8002).

Private by design: on Cloud Run only the web app's service account may invoke
it (IAM), and it has no database access. The web app sends the minimum it
needs and owns everything that touches money or users.
"""

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request

from .categorise import Model, categorise
from .schemas import CategoriseRequest, CategoriseResponse

log = logging.getLogger("paytra.ai")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")

DEFAULT_MODEL = "gemini-3.5-flash-lite"


def model_from_env() -> Model | None:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        return None
    from .llm import GeminiModel

    return GeminiModel(key, os.environ.get("GEMINI_MODEL", DEFAULT_MODEL))


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not hasattr(app.state, "model"):
        app.state.model = model_from_env()
    log.info("model configured: %s", app.state.model.name if app.state.model else "none")
    yield


app = FastAPI(title="PayTra AI", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/categorise", response_model=CategoriseResponse)
async def categorise_route(body: CategoriseRequest, request: Request) -> CategoriseResponse:
    model: Model | None = request.app.state.model
    if model is None:
        # The web app falls back to rules only; nothing breaks without a key.
        raise HTTPException(status_code=503, detail="AI model not configured")
    if len({i.id for i in body.items}) != len(body.items):
        raise HTTPException(status_code=400, detail="duplicate item ids")
    try:
        suggestions = await categorise(model, body)
    except Exception as e:
        # Never log payees or prompts (an exception message can echo them):
        # counts and the error type only.
        log.error("categorise failed for %d items: %s", len(body.items), type(e).__name__)
        raise HTTPException(status_code=502, detail="AI model call failed") from None
    log.info(
        "categorised %d items, %d known",
        len(suggestions),
        sum(1 for s in suggestions if s.category is not None),
    )
    return CategoriseResponse(suggestions=suggestions, model=model.name)
