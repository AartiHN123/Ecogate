"""
pipeline.py – Multi-stage NLP preprocessing pipeline for prompt compression.

Stages (executed in order):
  1. Coreference Resolution   – resolve pronouns so meaning persists across sentences
  2. Redundancy Detection     – drop sentences that are conceptually duplicated (TF-IDF cosine ≥ 0.88)
  3. Sentence Compression     – keep subject-verb-object dependency cores only
  4. Stop-word / Filler Removal – strip common filler phrases that add no semantic value
  5. LLMLingua-2 Compression  – token-level extractive compression to the target ratio
"""

from __future__ import annotations

import logging
import re
from functools import lru_cache
from typing import List

import spacy
import numpy as np
from fastcoref import FCoref
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from llmlingua import PromptCompressor

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration constants
# ---------------------------------------------------------------------------
REDUNDANCY_THRESHOLD: float = 0.88   # cosine similarity ≥ this → sentence is redundant
DEFAULT_COMPRESSION_RATIO: float = 0.5

# Filler phrases to strip (case-insensitive, whole-phrase match at word boundaries)
FILLER_PHRASES: List[str] = [
    r"\bplease\b",
    r"\bcould you\b",
    r"\bcan you\b",
    r"\bwould you\b",
    r"\bi was wondering\b",
    r"\bi would like you to\b",
    r"\bi need you to\b",
    r"\bi want you to\b",
    r"\bkindly\b",
    r"\bjust\b",
    r"\bbasically\b",
    r"\bactually\b",
    r"\bliterally\b",
    r"\bsimply\b",
    r"\bif you don't mind\b",
    r"\bif possible\b",
    r"\bfeel free to\b",
]

_FILLER_RE = re.compile(
    "|".join(FILLER_PHRASES),
    flags=re.IGNORECASE,
)

# Dependency relations that constitute the semantic core of a sentence
CORE_DEPS = {
    "nsubj", "nsubjpass",   # nominal subjects
    "ROOT",                  # root verb
    "dobj", "obj",           # direct objects
    "pobj",                  # prepositional objects
    "attr",                  # attribute (e.g., after "is")
    "acomp",                 # adjectival complement
    "xcomp",                 # open clausal complement
    "ccomp",                 # clausal complement
    "neg",                   # negation — semantically critical
    "aux", "auxpass",        # core auxiliaries
}


# ---------------------------------------------------------------------------
# Lazy-loaded model singletons (loaded once on first call)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _get_spacy_model() -> spacy.language.Language:
    logger.info("Loading spaCy model (en_core_web_sm)…")
    try:
        nlp = spacy.load("en_core_web_sm")
    except OSError:
        logger.warning("en_core_web_sm not found – downloading now…")
        from spacy.cli import download as spacy_download
        spacy_download("en_core_web_sm")
        nlp = spacy.load("en_core_web_sm")
    return nlp


@lru_cache(maxsize=1)
def _get_coref_model() -> FCoref:
    logger.info("Loading FCoref model…")
    # ── Compatibility shim ─────────────────────────────────────────────────────
    # transformers ≥ 4.44 calls `model.all_tied_weights_keys` during loading.
    # fastcoref's FCorefModel doesn't define it → AttributeError.
    # Patch it in as an empty dict property so loading succeeds.
    try:
        from fastcoref.modeling import FCorefModel  # type: ignore
        if not hasattr(FCorefModel, "all_tied_weights_keys"):
            FCorefModel.all_tied_weights_keys = property(lambda self: {})  # type: ignore
    except Exception:
        pass
    return FCoref(device="cpu")


@lru_cache(maxsize=1)
def _get_llmlingua() -> PromptCompressor:
    logger.info("Loading LLMLingua-2 (microsoft/llmlingua-2-xlm-roberta-large-meetingbank)…")
    return PromptCompressor(
        model_name="microsoft/llmlingua-2-xlm-roberta-large-meetingbank",
        use_llmlingua2=True,
        device_map="cpu",
    )


# ---------------------------------------------------------------------------
# Stage 1 – Coreference Resolution
# ---------------------------------------------------------------------------

def resolve_coreferences(text: str) -> str:
    """
    Use fastcoref to resolve pronoun chains across sentences.
    Returns the text with pronouns replaced by their antecedents.
    """
    if not text.strip():
        return text

    try:
        coref_model = _get_coref_model()
        preds = coref_model.predict(texts=[text])
        # fastcoref returns cluster spans; rebuild text with substitutions
        clusters = preds[0].get_clusters(as_strings=False)  # list of list of (start, end)
        cluster_strings = preds[0].get_clusters(as_strings=True)  # list of list of str

        if not clusters:
            return text

        # Build a mapping: span (start, end) → canonical mention (first in cluster)
        replacement_map: dict[tuple[int, int], str] = {}
        for cluster_spans, cluster_words in zip(clusters, cluster_strings):
            canonical = cluster_words[0]  # first mention = canonical antecedent
            for span, word in zip(cluster_spans, cluster_words):
                if word != canonical:  # only replace non-canonical mentions
                    replacement_map[span] = canonical

        if not replacement_map:
            return text

        # Reconstruct text applying replacements from right to left (preserves offsets)
        chars = list(text)
        for (start, end), replacement in sorted(replacement_map.items(), reverse=True):
            chars[start:end] = list(replacement)

        return "".join(chars)

    except Exception as exc:  # noqa: BLE001
        logger.warning("Coreference resolution failed, skipping: %s", exc)
        return text


# ---------------------------------------------------------------------------
# Stage 2 – Redundancy Detection (TF-IDF cosine similarity ≥ 0.88)
# ---------------------------------------------------------------------------

def remove_redundant_sentences(text: str, threshold: float = REDUNDANCY_THRESHOLD) -> str:
    """
    Split the text into sentences, then greedily retain only sentences that
    are NOT near-duplicates of any already-retained sentence (cosine < threshold).
    """
    nlp = _get_spacy_model()
    doc = nlp(text)
    sentences = [sent.text.strip() for sent in doc.sents if sent.text.strip()]

    if len(sentences) <= 1:
        return text

    try:
        vectorizer = TfidfVectorizer(stop_words="english")
        tfidf_matrix = vectorizer.fit_transform(sentences)
    except ValueError:
        # Happens if all sentences are stop-words only
        return text

    kept_indices: List[int] = [0]  # always keep the first sentence

    for i in range(1, len(sentences)):
        # Compare sentence i against all already-kept sentences
        sim_scores = cosine_similarity(tfidf_matrix[i], tfidf_matrix[kept_indices]).flatten()
        if sim_scores.max() < threshold:
            kept_indices.append(i)
        else:
            logger.debug(
                "Dropped redundant sentence (max_sim=%.3f): '%s'",
                sim_scores.max(),
                sentences[i][:60],
            )

    return " ".join(sentences[i] for i in kept_indices)


# ---------------------------------------------------------------------------
# Stage 3 – Sentence Compression (keep SVO dependency cores)
# ---------------------------------------------------------------------------

def compress_sentences(text: str) -> str:
    """
    For each sentence, keep only tokens whose dependency relation is in CORE_DEPS.
    This strips away adjuncts, parentheticals, and other decorative language while
    preserving the semantic core.
    """
    nlp = _get_spacy_model()
    doc = nlp(text)
    compressed_sents: List[str] = []

    for sent in doc.sents:
        core_tokens = [
            token.text
            for token in sent
            if token.dep_ in CORE_DEPS
        ]
        if core_tokens:
            compressed_sents.append(" ".join(core_tokens))
        else:
            # Fallback: keep the sentence as-is if no core tokens found
            compressed_sents.append(sent.text.strip())

    return " ".join(compressed_sents)


# ---------------------------------------------------------------------------
# Stage 4 – Stop-word / Filler Removal
# ---------------------------------------------------------------------------

def remove_fillers(text: str) -> str:
    """
    Strip predefined filler words and phrases from the text.
    Trailing punctuation artifacts after removal are normalised.
    """
    cleaned = _FILLER_RE.sub("", text)
    # Normalise multiple spaces left by removals
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    # Fix punctuation artifacts like ", ," or ". ." or leading commas
    cleaned = re.sub(r"\s*,\s*,", ",", cleaned)
    cleaned = re.sub(r"^\s*[,;]\s*", "", cleaned)
    return cleaned.strip()


# ---------------------------------------------------------------------------
# Stage 5 – LLMLingua-2 Extractive Compression
# ---------------------------------------------------------------------------

def llmlingua_compress(text: str, target_ratio: float = DEFAULT_COMPRESSION_RATIO) -> str:
    """
    Apply LLMLingua-2 token-level extractive compression.
    `target_ratio` is the fraction of tokens to retain (0.5 = keep 50%).
    """
    if not text.strip():
        return text

    try:
        compressor = _get_llmlingua()
        result = compressor.compress_prompt(
            context=[text],
            rate=target_ratio,
            force_tokens=["\n", "?", "!"],   # always preserve sentence boundaries
            drop_consecutive=True,
        )
        compressed: str = result.get("compressed_prompt", text)
        logger.debug(
            "LLMLingua-2: %.0f%% tokens retained (ratio=%.2f)",
            target_ratio * 100,
            target_ratio,
        )
        return compressed.strip()

    except Exception as exc:  # noqa: BLE001
        logger.warning("LLMLingua-2 compression failed, returning pre-compressed text: %s", exc)
        return text


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_pipeline(text: str, target_ratio: float = DEFAULT_COMPRESSION_RATIO) -> str:
    """
    Execute all 5 preprocessing stages in order and return the final
    compressed prompt ready for the downstream Ollama LLM call.

    Args:
        text:          The raw user prompt.
        target_ratio:  LLMLingua-2 target compression ratio (0 < ratio ≤ 1).

    Returns:
        Heavily compressed prompt string.
    """
    if not text or not text.strip():
        return text

    logger.info("Pipeline start — original length: %d chars", len(text))

    # Stage 1 – Coreference
    text = resolve_coreferences(text)
    logger.info("After coref resolution: %d chars", len(text))

    # Stage 2 – Redundancy
    text = remove_redundant_sentences(text, threshold=REDUNDANCY_THRESHOLD)
    logger.info("After redundancy removal: %d chars", len(text))

    # Stage 3 – Sentence compression
    text = compress_sentences(text)
    logger.info("After sentence compression: %d chars", len(text))

    # Stage 4 – Filler removal
    text = remove_fillers(text)
    logger.info("After filler removal: %d chars", len(text))

    # Stage 5 – LLMLingua-2
    text = llmlingua_compress(text, target_ratio=target_ratio)
    logger.info("Pipeline end — final length: %d chars", len(text))

    return text
