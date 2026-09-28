# TCG Trade workers: scheduler + 24/7 drop monitors + email/alert delivery.
# Build from the workers/ directory:  docker build -t tcgtrade-workers .
FROM python:3.11-slim

COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    TZ=Australia/Melbourne

WORKDIR /app

# Dependencies first (cached layer), then the project itself.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY tcgworkers ./tcgworkers
RUN uv sync --frozen --no-dev

RUN useradd --system --uid 10001 --no-create-home worker
USER worker

ENV PATH="/app/.venv/bin:$PATH"
# SIGINT/SIGTERM stop the scheduler and let the drop monitors finish their cycle.
STOPSIGNAL SIGTERM
CMD ["python", "-m", "tcgworkers.main"]
