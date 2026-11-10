from abc import ABC, abstractmethod
from dataclasses import dataclass, field


class AIProviderError(RuntimeError):
    """Raised for any provider-side failure (network, non-200, malformed
    response) -- callers surface this as a clean 502-shaped error, never an
    unhandled 500."""


@dataclass
class GeneratedStep:
    action: str
    expected: str


@dataclass
class GeneratedTestCase:
    title: str
    description: str
    steps: list[GeneratedStep] = field(default_factory=list)


@dataclass
class AIGenerationResult:
    test_cases: list[GeneratedTestCase]
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


ReviewCategory = str  # "clarity" | "missing_steps" | "ambiguous_expected" | "other"


@dataclass
class ReviewSuggestion:
    category: ReviewCategory
    message: str


@dataclass
class ReviewStep:
    action: str
    expected: str


@dataclass
class AIReviewResult:
    suggestions: list[ReviewSuggestion]
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


@dataclass
class ChangeImpactCandidate:
    """One linked test case offered to the model for impact assessment,
    identified by its 1-based position in the list passed to the prompt
    (not by test_case_id -- matching back to the real UUID by position is
    simpler and more reliable than asking the model to echo a UUID)."""

    index: int
    title: str


@dataclass
class ChangeImpactFinding:
    index: int
    needs_review: bool
    reason: str


@dataclass
class AIChangeImpactResult:
    findings: list[ChangeImpactFinding]
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class AIProvider(ABC):
    """Provider-agnostic interface (ADR-045): the rest of the app calls this
    abstraction, never a concrete SDK, so swapping the first implementation
    (Gemini) for another provider later touches one factory function, not
    every call site."""

    @abstractmethod
    def generate_test_cases(
        self,
        *,
        api_key: str,
        requirement_title: str,
        requirement_description: str,
        max_cases: int,
    ) -> AIGenerationResult: ...

    @abstractmethod
    def review_test_case(
        self,
        *,
        api_key: str,
        title: str,
        description: str,
        steps: list[ReviewStep],
    ) -> AIReviewResult: ...

    @abstractmethod
    def analyze_requirement_change(
        self,
        *,
        api_key: str,
        old_title: str,
        old_description: str,
        new_title: str,
        new_description: str,
        candidates: list[ChangeImpactCandidate],
    ) -> AIChangeImpactResult: ...
