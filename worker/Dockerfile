# Standard browser renderer. Build context: repository root.
# Rust/GPU renderers are separate capabilities, not compilers installed into this worker.
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY worker/package.json worker/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

# Depth maps for template sets (src/depth.mjs): Depth Anything V2 Small as ONNX (onnx-community export), licence Apache-2.0
# (https://huggingface.co/onnx-community/depth-anything-v2-small, base https://huggingface.co/depth-anything/Depth-Anything-V2-Small).
# Pinned to one revision and checked by SHA-256, so the image never runs a file it did not expect. Only the Small checkpoint is
# Apache-2.0; never swap in Base/Large (CC-BY-NC-4.0).
FROM ${NODE_IMAGE} AS depth-model
ARG DEPTH_MODEL_URL=https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/4472b7362082ad9968fee890ca0f1e5aca36b93d/onnx/model.onnx
ARG DEPTH_MODEL_SHA256=afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c
RUN mkdir -p /models && node -e "const [url,sha]=process.argv.slice(1);(async()=>{const r=await fetch(url);if(!r.ok)throw new Error('depth model download '+r.status);const b=Buffer.from(await r.arrayBuffer());const h=require('crypto').createHash('sha256').update(b).digest('hex');if(h!==sha)throw new Error('depth model sha256 '+h);require('fs').writeFileSync('/models/depth-anything-v2-small.onnx',b);})().catch(e=>{console.error(e.message);process.exit(1)})" "$DEPTH_MODEL_URL" "$DEPTH_MODEL_SHA256"

FROM ${NODE_IMAGE} AS runtime
ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    HYPERFRAMES_BROWSER_PATH=/usr/local/bin/chromium-no-shm \
    HYPERFRAMES_NO_TELEMETRY=1 \
    HYPERFRAMES_NO_UPDATE_CHECK=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ffmpeg fonts-liberation fonts-dejavu-core fonts-noto-core ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && printf '#!/bin/sh\nexec /usr/bin/chromium --disable-dev-shm-usage --no-sandbox "$@"\n' > /usr/local/bin/chromium-no-shm \
  && chmod +x /usr/local/bin/chromium-no-shm \
  && useradd --create-home --uid 10001 --shell /usr/sbin/nologin renderer
WORKDIR /app
COPY --from=dependencies --chown=renderer:renderer /app/node_modules ./node_modules
COPY --chown=renderer:renderer worker/package.json worker/package-lock.json ./
COPY --chown=renderer:renderer worker/src ./src
COPY --chown=renderer:renderer worker/templates ./templates
COPY --chown=renderer:renderer worker/fonts ./fonts
COPY --chown=renderer:renderer worker/themes ./themes
COPY --chown=renderer:renderer worker/fixtures ./fixtures
# Plate scenes: the capture adapter and assembly rules from the versioned engine package (plates.mjs imports ./plate-engine/).
COPY --chown=renderer:renderer packages/plate-engine/lib/capture.mjs packages/plate-engine/lib/rules.mjs ./plate-engine/
COPY --from=depth-model --chown=renderer:renderer /models/depth-anything-v2-small.onnx ./models/depth-anything-v2-small.onnx
RUN mkdir -p fixtures/smoke/fonts /renders \
  && cp /usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf fixtures/smoke/fonts/LiberationSans-Regular.ttf \
  && chown -R renderer:renderer fixtures/smoke/fonts /renders
USER renderer
EXPOSE 8080
ENTRYPOINT ["tini", "--"]
CMD ["node", "src/worker.mjs"]
