"""Pure scoring rules shared by live matching and the admin preview."""

from uuid import UUID

from app.same_sky_ai import safe_themes


def score_candidate(
    comparisons: list[tuple[UUID, UUID, float]],
    own_themes: set[str],
    candidate_themes: set[str],
    own_categories: set[str],
    candidate_categories: set[str],
    own_preferences: set[str],
    candidate_preferences: set[str],
) -> dict:
    """Return the actual matcher score plus component diagnostics."""
    semantic = sum(sorted((item[2] for item in comparisons), reverse=True)[:3]) / min(3, len(comparisons)) if comparisons else 0.0
    common_themes = own_themes & candidate_themes
    theme_context = len(common_themes) / max(1, min(len(own_themes), len(candidate_themes)))
    category_context = len(own_categories & candidate_categories) / max(1, len(own_categories | candidate_categories))
    context_score = 0.72 * theme_context + 0.28 * category_context
    own_participating = {source for source, _, similarity in comparisons if similarity >= 0.60}
    candidate_participating = {target for _, target, similarity in comparisons if similarity >= 0.60}
    consistency = (
        0.5 * min(1.0, len(own_participating) / 5)
        + 0.5 * min(1.0, len(candidate_participating) / 5)
    )
    preference_scores = []
    if own_preferences:
        preference_scores.append(len(own_preferences & candidate_categories) / len(own_preferences))
    if candidate_preferences:
        preference_scores.append(len(candidate_preferences & own_categories) / len(candidate_preferences))
    preference_fit = sum(preference_scores) / len(preference_scores) if preference_scores else 1.0
    score = 0.40 * semantic + 0.25 * context_score + 0.20 * consistency + 0.15 * preference_fit

    rejection_reasons = []
    if semantic < 0.52:
        rejection_reasons.append("semantic_similarity")
    if context_score < 0.08:
        rejection_reasons.append("theme_or_category_context")
    if consistency < 0.20:
        rejection_reasons.append("story_consistency")
    if not common_themes:
        rejection_reasons.append("no_shared_themes")

    labels = safe_themes(sorted(common_themes)[:3])
    theme_words = ", ".join(labels[:2])
    explanation = (
        f"Several stories point to similar experiences around {theme_words}. "
        "This is a conversation starting point, not a judgment about either of you."
    ) if labels else "No shared theme labels were found."

    return {
        "score": score,
        "semantic": semantic,
        "context": context_score,
        "consistency": consistency,
        "preference_fit": preference_fit,
        "shared_theme_keys": sorted(common_themes),
        "shared_themes": labels[:3],
        "explanation": explanation[:320],
        "rejection_reasons": rejection_reasons,
        "passed": not rejection_reasons,
    }
