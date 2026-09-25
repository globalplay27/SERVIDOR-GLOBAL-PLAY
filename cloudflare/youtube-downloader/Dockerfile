FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir -U yt-dlp

WORKDIR /app
COPY server.py /app/server.py

EXPOSE 8080
CMD ["python","/app/server.py"]
