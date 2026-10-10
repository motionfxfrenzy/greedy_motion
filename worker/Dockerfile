# Standard browser renderer. Build context: repository root.
# Rust/GPU renderers are separate capabilities, not compilers installed into this worker.
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY worker/package.json worker/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

FROM ${NODE_IMAGE} AS runtime
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
COPY --from=dependencies --chown=renderer:renderer /app/node_modules ./node_modules
COPY --chown=renderer:renderer worker/package.json worker/package-lock.json ./
COPY --chown=renderer:renderer worker/src ./src
COPY --chown=renderer:renderer worker/templates ./templates
COPY --chown=renderer:renderer worker/fonts ./fonts
COPY --chown=renderer:renderer worker/themes ./themes
COPY --chown=renderer:renderer worker/fixtures ./fixtures
RUN mkdir -p fixtures/smoke/fonts /renders \
  && cp /usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf fixtures/smoke/fonts/LiberationSans-Regular.ttf \
  && chown -R renderer:renderer fixtures/smoke/fonts /renders
USER renderer
EXPOSE 8080
ENTRYPOINT ["tini", "--"]
CMD ["node", "src/worker.mjs"]
