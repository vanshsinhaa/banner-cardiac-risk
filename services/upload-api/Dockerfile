# Runtime image for the EKG upload API prototype.
# Tests are not copied in. CI runs them before this image is built.
FROM python:3.12-slim

# No .pyc files, and print logs right away instead of buffering them.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv

# Install dependencies first. This layer is reused until requirements.txt changes.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

# Run as a normal user, not root.
RUN useradd --create-home --uid 10001 appuser
USER appuser

EXPOSE 8000

# The slim image has no curl, so the health check uses Python.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
