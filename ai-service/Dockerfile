# syntax=docker/dockerfile:1.7
# ============================================================================
# ai-service
#
# A aplicação principal roda em Cloudflare Workers, que não executa processo
# Python de longa duração (auditoria §6). Este container é deployment separado.
#
# Mesma imagem serve API e worker — muda só o CMD. Duas imagens divergiriam com
# o tempo e criariam a classe de bug em que o worker roda código diferente da
# API.
# ============================================================================

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# curl fica para o HEALTHCHECK; o resto é build de psycopg.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /srv

# Dependências antes do código: o layer só invalida quando o pyproject muda.
COPY pyproject.toml ./
RUN uv sync --no-dev --no-install-project

COPY app ./app
COPY migrations ./migrations
RUN uv sync --no-dev

# Usuário sem privilégio. O serviço tem credencial de banco; se alguém
# escapar do processo, que não escape como root.
RUN useradd --system --uid 10001 --no-create-home aiservice \
    && chown -R aiservice:aiservice /srv
USER aiservice

ENV PATH="/srv/.venv/bin:$PATH"

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8000/health || exit 1

# API. Para o worker: CMD ["python", "-m", "app.workers.agent_jobs"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
