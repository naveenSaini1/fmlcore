"""Selectable Gemini/Groq analysis and Gemini embeddings for Same Sky."""

import json
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from pydantic import BaseModel, Field, ValidationError

from app.config import settings

THEME_KEYS = {
    "trust_betrayal", "privacy_breach", "friendship_loss", "family_conflict",
    "relationship_breakup", "rejection", "loneliness", "grief_change",
    "academic_pressure", "workplace_stress", "self_image", "regret_mistake",
    "moving_belonging", "financial_stress", "identity_acceptance",
    "bullying_exclusion", "manipulation_control", "addiction_recovery",
    "mental_health_struggle", "personal_growth", "other_life_change",
}
CONTEXT_KEYS = {
    "friendship", "romantic_relationship", "family", "education", "work",
    "social_group", "self", "financial", "health", "other",
}
EMOTION_KEYS = {"hurt", "grief", "fear", "shame", "anger", "loneliness", "confusion", "hope", "mixed", "none"}
RISK_KEYS = {"immediate_threat", "coercion_or_exploitation", "targeted_harassment"}
THEME_LABELS = {
    "trust_betrayal": "Trust and betrayal", "privacy_breach": "A privacy boundary was crossed",
    "friendship_loss": "A friendship changed or ended", "family_conflict": "Family conflict",
    "relationship_breakup": "A relationship changed or ended", "rejection": "Feeling rejected",
    "loneliness": "Feeling alone", "grief_change": "Loss or a major change",
    "academic_pressure": "School or college pressure", "workplace_stress": "Work pressure",
    "self_image": "Self-image and confidence", "regret_mistake": "Regret and mistakes",
    "moving_belonging": "Finding a sense of belonging", "financial_stress": "Money stress",
    "identity_acceptance": "Identity and acceptance", "bullying_exclusion": "Being excluded or targeted",
    "manipulation_control": "Control or manipulation", "addiction_recovery": "Recovery and change",
    "mental_health_struggle": "A difficult personal period", "personal_growth": "Personal growth",
    "other_life_change": "A life change",
}
_request_gap_lock = threading.Lock()
_last_request_started: dict[str, float] = {}


class ProviderRequestError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool, retry_after_seconds: float | None = None):
        super().__init__(message)
        self.retryable = retryable
        self.retry_after_seconds = retry_after_seconds


def _throttle_provider(provider: str) -> None:
    gap = settings.same_sky_gemini_request_gap_seconds if provider == "Gemini" else settings.same_sky_groq_request_gap_seconds
    with _request_gap_lock:
        now = time.monotonic()
        wait = max(0.0, gap - (now - _last_request_started.get(provider, 0.0)))
        if wait:
            time.sleep(wait)
        _last_request_started[provider] = time.monotonic()


class EntryAnalysis(BaseModel):
    themes: list[str] = Field(min_length=1, max_length=5)
    contexts: list[str] = Field(min_length=1, max_length=3)
    emotion: str
    safe_summary: str = Field(min_length=8, max_length=280)
    copy_signal: str
    risk_flags: list[str] = Field(max_length=3)


class CopyComparison(BaseModel):
    likely_copy: bool
    reason: str = Field(max_length=160)


def _post_json(url: str, payload: dict, *, headers: dict | None = None, provider: str) -> dict:
    _throttle_provider(provider)
    request_headers = {
        "Content-Type": "application/json",
        "User-Agent": "FMLCore/0.9",
        **(headers or {}),
    }
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=request_headers,
        method="POST",
    )
    try:
        with urlopen(request, timeout=60) as response:
            body = response.read().decode("utf-8")
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            raise ProviderRequestError(f"{provider} returned invalid JSON.", retryable=False) from None
    except HTTPError as exc:
        # Do not include request URLs, response bodies, or API keys in worker logs.
        try:
            retry_after = float(exc.headers.get("Retry-After")) if exc.headers.get("Retry-After") else None
        except (TypeError, ValueError):
            retry_after = None
        retryable = exc.code in {408, 429} or exc.code >= 500
        raise ProviderRequestError(
            f"{provider} returned HTTP {exc.code}.",
            retryable=retryable,
            retry_after_seconds=retry_after,
        ) from None
    except TimeoutError:
        raise RuntimeError(f"{provider} request timed out.") from None
    except URLError as exc:
        reason_type = type(exc.reason).__name__
        raise RuntimeError(f"{provider} connection failed ({reason_type}).") from None


def _generate_gemini(prompt: str, response_schema: dict) -> tuple[dict, str]:
    model = quote(settings.gemini_model, safe="-")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={quote(settings.gemini_api_key, safe='')}"
    data = _post_json(url, {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "responseSchema": response_schema},
    }, provider="Gemini")
    try:
        candidate = data["candidates"][0]
        text = "".join(part.get("text", "") for part in candidate["content"]["parts"])
        parsed = json.loads(text)
        return parsed, candidate.get("modelVersion", settings.gemini_model)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError):
        raise RuntimeError("Gemini returned an incomplete analysis.") from None


def _generate_groq(prompt: str, response_schema: dict) -> tuple[dict, str]:
    schema_text = json.dumps(response_schema, separators=(",", ":"), sort_keys=True)
    data = _post_json(
        "https://api.groq.com/openai/v1/chat/completions",
        {
            "model": settings.groq_model,
            "messages": [
                {"role": "system", "content": "Return one JSON object only. Follow the JSON schema in the user message exactly."},
                {"role": "user", "content": f"{prompt}\n\nJSON schema:\n{schema_text}"},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.1,
            "max_tokens": 1200,
        },
        headers={"Authorization": f"Bearer {settings.groq_api_key}"},
        provider="Groq",
    )
    try:
        choice = data["choices"][0]
        parsed = json.loads(choice["message"]["content"])
        return parsed, data.get("model", settings.groq_model)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError):
        raise RuntimeError("Groq returned an incomplete analysis.") from None


def _generate(prompt: str, response_schema: dict, provider: str) -> tuple[dict, str]:
    if provider == "gemini":
        if not settings.same_sky_gemini_ready:
            raise RuntimeError("Gemini requires a configured, billing-enabled project.")
        return _generate_gemini(prompt, response_schema)
    if provider == "groq":
        if not settings.groq_api_key:
            raise RuntimeError("Groq is selected but its API key is not configured.")
        return _generate_groq(prompt, response_schema)
    raise RuntimeError("Unsupported Same Sky AI provider.")


def _validated_entry(raw: dict, provider: str) -> EntryAnalysis:
    try:
        result = EntryAnalysis.model_validate(raw)
    except ValidationError:
        raise RuntimeError(f"{provider}'s analysis did not pass validation.") from None
    if not set(result.themes) <= THEME_KEYS or not set(result.contexts) <= CONTEXT_KEYS or result.emotion not in EMOTION_KEYS or result.copy_signal not in {"low", "review"} or not set(result.risk_flags) <= RISK_KEYS:
        raise RuntimeError(f"{provider}'s analysis contained unsupported values.")
    result.safe_summary = result.safe_summary.strip()[:280]
    return result


def analyze_story(entry: dict, provider: str = "gemini") -> tuple[EntryAnalysis, str]:
    prompt = (
        "Analyze this newly created FMLCore post or confession to prepare private peer-matching signals. "
        "Do not diagnose, infer identity, verify truth, or give advice. Similar lived experiences are not copying. "
        "Use only the allowed theme, context, emotion, and risk keys in the schema. Keep safe_summary broad and non-identifying; "
        "never quote names or distinctive details. Set copy_signal to low; a single story cannot establish copying. "
        "The backend checks exact and near-duplicate stories separately. Add risk_flags only for an explicit immediate threat, "
        "coercion/exploitation, or targeted harassment; do not treat ordinary sadness or past hardship as a current crisis.\n"
        f"Entry type: {entry['entry_type']}\nTitle: {entry['title']}\nDescription: {entry['description']}\n"
        f"Category: {entry['category']}\nMood: {entry.get('mood') or 'not provided'}\n"
        f"Reflection: {entry.get('reflection') or 'not provided'}"
    )
    schema = {
        "type": "OBJECT",
        "properties": {
            "themes": {"type": "ARRAY", "items": {"type": "STRING", "enum": sorted(THEME_KEYS)}, "minItems": 1, "maxItems": 5},
            "contexts": {"type": "ARRAY", "items": {"type": "STRING", "enum": sorted(CONTEXT_KEYS)}, "minItems": 1, "maxItems": 3},
            "emotion": {"type": "STRING", "enum": sorted(EMOTION_KEYS)},
            "safe_summary": {"type": "STRING"},
            "copy_signal": {"type": "STRING", "enum": ["low", "review"]},
            "risk_flags": {"type": "ARRAY", "items": {"type": "STRING", "enum": sorted(RISK_KEYS)}, "maxItems": 3},
        },
        "required": ["themes", "contexts", "emotion", "safe_summary", "copy_signal", "risk_flags"],
    }
    raw, model_version = _generate(prompt, schema, provider)
    result = _validated_entry(raw, provider.title())
    result.copy_signal = "low"
    return result, f"{provider.title()}:{model_version}"[:120]


def compare_for_copying(new_entry: dict, nearest_entry: dict, provider: str = "gemini") -> tuple[CopyComparison, str]:
    prompt = (
        "Compare two private story records only for likely copying. A shared life situation, theme, or emotional pattern "
        "is NOT copying even when the descriptions are similar. Flag only if the second appears to reproduce the first person's distinctive "
        "specific account or wording with minor changes. Do not conclude either story is false. If uncertain, return likely_copy=false. "
        "Give a short privacy-safe reason without quoting either story.\n"
        f"Story A: {nearest_entry['title']}\n{nearest_entry['description']}\n"
        f"Story B: {new_entry['title']}\n{new_entry['description']}"
    )
    schema = {"type": "OBJECT", "properties": {"likely_copy": {"type": "BOOLEAN"}, "reason": {"type": "STRING"}}, "required": ["likely_copy", "reason"]}
    raw, model_version = _generate(prompt, schema, provider)
    try:
        result = CopyComparison.model_validate(raw)
    except ValidationError:
        raise RuntimeError(f"{provider.title()}'s duplicate comparison did not pass validation.") from None
    return result, f"{provider.title()}:{model_version}"[:120]


def embed_text(text: str) -> list[float]:
    if not settings.same_sky_ai_ready:
        raise RuntimeError("Gemini requires a configured, billing-enabled project for embeddings.")
    if settings.same_sky_embedding_dimensions != 768:
        raise RuntimeError("Same Sky embedding dimensions require a matching database migration.")
    model = quote(settings.gemini_embedding_model, safe="-")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent?key={quote(settings.gemini_api_key, safe='')}"
    data = _post_json(url, {
        "model": f"models/{settings.gemini_embedding_model}",
        "content": {"parts": [{"text": text}]},
        "taskType": "SEMANTIC_SIMILARITY",
        "outputDimensionality": 768,
    }, provider="Gemini")
    try:
        vector = [float(value) for value in data["embedding"]["values"]]
    except (KeyError, TypeError, ValueError):
        raise RuntimeError("Gemini returned an invalid embedding.") from None
    if len(vector) != 768 or any(not (-1e6 < value < 1e6) for value in vector):
        raise RuntimeError("Gemini returned an embedding with the wrong dimensions.")
    return vector


def safe_themes(keys: list[str]) -> list[str]:
    return [THEME_LABELS[key] for key in keys if key in THEME_LABELS]
