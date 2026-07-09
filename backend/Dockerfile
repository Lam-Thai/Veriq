# syntax=docker/dockerfile:1
#
# Multi-stage build producing a minimal, non-root FastAPI/uvicorn image.
# Dependencies come solely from pyproject.toml (no dev/test extras) and no
# secret values are ARG'd or ENV'd into this file — runtime configuration
# (ALLOWED_ORIGINS, ENVIRONMENT, ...) is supplied via docker-compose
# `env_file`, not baked into any layer here.

FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# ---- builder: resolve and install dependencies into a venv ----
FROM base AS builder
WORKDIR /app

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Only the files pip needs to resolve the package are copied first, so this
# layer is cached until pyproject.toml or the app source actually changes.
COPY pyproject.toml ./
COPY app ./app

RUN pip install --upgrade pip \
    && pip install .

# ---- runtime: slim image, no compilers or build tooling ----
FROM base AS runtime
WORKDIR /app

RUN addgroup --system app && adduser --system --ingroup app app

COPY --from=builder /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"

USER app
EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=2)" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
