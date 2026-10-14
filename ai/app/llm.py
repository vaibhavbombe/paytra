"""Gemini adapter. Development uses the Gemini API free tier, whose inputs may be
used to improve Google products, so it must only ever see mock data. The paid
upgrade is Vertex AI (no training on customer data); only this file changes."""

from typing import Any

from google import genai
from google.genai import types

TIMEOUT_MS = 20_000


class GeminiModel:
    def __init__(self, api_key: str, model: str):
        self.name = model
        self._client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=TIMEOUT_MS))

    async def generate_json(self, system: str, prompt: str, schema: dict[str, Any]) -> str:
        resp = await self._client.aio.models.generate_content(
            model=self.name,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system,
                temperature=0,
                response_mime_type="application/json",
                response_json_schema=schema,
            ),
        )
        return resp.text or ""
