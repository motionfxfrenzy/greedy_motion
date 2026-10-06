# Worker (Railway service "worker"). Build context: repository root.
FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium \
    HYPERFRAMES_NO_TELEMETRY=1 \
    HYPERFRAMES_NO_UPDATE_CHECK=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ffmpeg fonts-liberation fonts-dejavu-core ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 --shell /usr/sbin/nologin renderer

WORKDIR /app
COPY worker/package.json worker/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY worker/ ./
RUN mkdir -p fixtures/smoke/fonts \
  && cp /usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf fixtures/smoke/fonts/LiberationSans-Regular.ttf \
  && mkdir -p /renders \
  && chown -R renderer:renderer /app /renders

USER renderer
EXPOSE 8080
ENTRYPOINT ["tini", "--"]
CMD ["node", "src/worker.mjs"]
