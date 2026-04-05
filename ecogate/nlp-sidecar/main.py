"""
main.py – FastAPI sidecar server for NLP prompt preprocessing.

Endpoints:
  POST /preprocess   – run the full 5-stage NLP pipeline on a prompt
  GET  /health       – liveness probe (used by Node.js fallback logic)
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from pipeline import (
    DEFAULT_COMPRESSION_RATIO,
    REDUNDANCY_THRESHOLD,
    _get_coref_model,
    _get_llmlingua,
    _get_spacy_model,
    run_pipeline,
)

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s – %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("nlp-sidecar")


# ---------------------------------------------------------------------------
# Lifespan: eagerly load all heavy models at startup so the first request
# is not penalised by cold-start latency.
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=== NLP Sidecar starting – warming up models… ===")
    _get_spacy_model()    # ~50 MB – fast
    _get_coref_model()    # fastcoref checkpoint – moderate
    _get_llmlingua()      # XLM-RoBERTa – ~500 MB, slowest
    logger.info("=== All models loaded. Sidecar ready. ===")
    yield
    logger.info("=== NLP Sidecar shutting down. ===")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="EcoGate NLP Sidecar",
    description=(
        "Multi-stage NLP preprocessing pipeline for LLM prompt compression. "
        "Stages: coreference resolution → redundancy removal → sentence compression "
        "→ filler removal → LLMLingua-2 extractive compression."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Node.js server on same host; restrict in prod if needed
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class PreprocessRequest(BaseModel):
    text: str = Field(
        ...,
        min_length=1,
        description="The raw user prompt to compress.",
        examples=["Could you please explain how transformers work? I was wondering about the attention mechanism."],
    )
    target_ratio: Optional[float] = Field(
        default=DEFAULT_COMPRESSION_RATIO,
        gt=0.0,
        le=1.0,
        description=(
            f"Fraction of tokens LLMLingua-2 should retain. "
            f"Default is {DEFAULT_COMPRESSION_RATIO} (keep 50 % of tokens)."
        ),
        examples=[0.5],
    )

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("text must not be blank or whitespace-only.")
        return v


class PreprocessResponse(BaseModel):
    preprocessed_text: str = Field(
        ...,
        description="The fully compressed prompt after all 5 pipeline stages.",
    )
    original_length: int = Field(..., description="Character count of the input text.")
    compressed_length: int = Field(..., description="Character count of the output text.")
    compression_ratio_achieved: float = Field(
        ...,
        description="Ratio of output length to input length (lower = more compressed).",
    )
    processing_time_ms: float = Field(..., description="Wall-clock processing time in milliseconds.")
    target_ratio: float = Field(..., description="The LLMLingua-2 target ratio that was used.")
    redundancy_threshold: float = Field(
        default=REDUNDANCY_THRESHOLD,
        description="TF-IDF cosine similarity threshold used for redundancy detection.",
    )


class HealthResponse(BaseModel):
    status: str
    models_loaded: bool


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.post(
    "/preprocess",
    response_model=PreprocessResponse,
    summary="Run the full 5-stage NLP compression pipeline",
    tags=["compression"],
)
async def preprocess(body: PreprocessRequest) -> PreprocessResponse:
    """
    Accepts a raw user prompt and returns a heavily compressed version
    suitable for passing to an Ollama LLM for further structural compression.

    Pipeline stages (in order):
    1. **Coreference resolution** – pronouns → antecedents (fastcoref)
    2. **Redundancy removal** – drop near-duplicate sentences (TF-IDF cosine ≥ 0.88)
    3. **Sentence compression** – retain SVO dependency cores only (spaCy)
    4. **Filler removal** – strip meaningless phrases ("please", "could you", …)
    5. **LLMLingua-2** – token-level extractive compression to `target_ratio`
    """
    if not body.text.strip():
        raise HTTPException(status_code=422, detail="text must not be blank.")

    original_length = len(body.text)
    t0 = time.perf_counter()

    try:
        compressed = run_pipeline(body.text, target_ratio=body.target_ratio)
    except Exception as exc:
        logger.exception("Pipeline raised an unhandled exception: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"NLP pipeline error: {exc}",
        ) from exc

    elapsed_ms = (time.perf_counter() - t0) * 1000
    compressed_length = len(compressed)
    ratio_achieved = compressed_length / original_length if original_length > 0 else 1.0

    logger.info(
        "Compressed %d → %d chars (%.1f%%) in %.1f ms",
        original_length,
        compressed_length,
        ratio_achieved * 100,
        elapsed_ms,
    )

    return PreprocessResponse(
        preprocessed_text=compressed,
        original_length=original_length,
        compressed_length=compressed_length,
        compression_ratio_achieved=round(ratio_achieved, 4),
        processing_time_ms=round(elapsed_ms, 2),
        target_ratio=body.target_ratio,
        redundancy_threshold=REDUNDANCY_THRESHOLD,
    )


@app.get(
    "/health",
    response_model=HealthResponse,
    summary="Liveness probe",
    tags=["meta"],
)
async def health() -> HealthResponse:
    """
    Returns 200 when the server is running and all models are loaded.
    Used by the Node.js compressor.js fallback logic to decide whether
    to route through the sidecar or bypass it.
    """
    return HealthResponse(status="ok", models_loaded=True)


# ---------------------------------------------------------------------------
# Dev entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,   # set True only during development
        log_level="info",
    )
