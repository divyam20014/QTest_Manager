from app.core.ai.base import AIProvider
from app.core.ai.gemini_provider import GeminiProvider

_PROVIDERS: dict[str, type[AIProvider]] = {
    "gemini": GeminiProvider,
}


def get_provider(name: str) -> AIProvider:
    provider_cls = _PROVIDERS.get(name)
    if provider_cls is None:
        raise ValueError(f"Unknown AI provider: {name}")
    return provider_cls()
