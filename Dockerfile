# ---------- Stage 1: builder ----------
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Install Node dependencies and build the production bundle
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM nginx:stable-bookworm AS runtime

# The nginx bookworm image ships no HTTP client, so the healthcheck below needs
# one installed explicitly (the alpine variant gets wget via busybox, this one
# does not).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -fsS http://localhost/health || exit 1
