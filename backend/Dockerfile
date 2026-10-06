# Backend (Railway service "backend"). Build context: repository root, so shared packages are available.
FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY packages/contracts/package.json packages/contracts/
RUN npm ci --workspace @videosaas/backend --omit=dev --no-audit --no-fund

COPY packages/contracts packages/contracts
COPY backend backend
# The browser preview reads the exact templates, themes, and bundled fonts that
# the worker renders. Keep these source assets in the backend image; render
# binaries and worker-only dependencies remain in the worker service.
COPY worker/templates worker/templates
COPY worker/themes worker/themes
COPY worker/fonts worker/fonts

USER node
WORKDIR /app/backend
EXPOSE 4000
CMD ["node", "src/server.ts"]
