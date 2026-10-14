"""Request / response shapes. Everything that crosses the HTTP boundary is
validated here (Pydantic), the same rule as Zod on the web side."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Direction = Literal["DEBIT", "CREDIT"]
CategoryKind = Literal["EXPENSE", "INCOME", "TRANSFER"]
Confidence = Literal["high", "low"]

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]

MAX_ITEMS = 50
MAX_CATEGORIES = 100


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CategoryOption(Strict):
    name: ShortText
    kind: CategoryKind


class PayeeItem(Strict):
    # Opaque id chosen by the caller (e.g. a hash of the payee); echoed back.
    id: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
    # Only the payee name extracted from the narration. No amount, no account
    # number, no raw narration: the model doesn't need them to pick a category.
    payee: ShortText
    direction: Direction
    channel: Literal["UPI", "NEFT", "IMPS", "RTGS", "CARD", "ATM", "NACH", "CHEQUE", "OTHER"] = "OTHER"


class CategoriseRequest(Strict):
    items: list[PayeeItem] = Field(min_length=1, max_length=MAX_ITEMS)
    categories: list[CategoryOption] = Field(min_length=1, max_length=MAX_CATEGORIES)


class Suggestion(Strict):
    id: str
    # None = the model didn't know, or its answer failed validation.
    category: str | None
    confidence: Confidence | None


class CategoriseResponse(Strict):
    suggestions: list[Suggestion]
    model: str
