# ---------- Stage 1: builder ----------
FROM node:22-bookworm-slim AS builder

# Optional: pin the range42-deployer CLI to a specific version (e.g. --build-arg DEPLOYER_CLI_VERSION=1.2.3)
ARG DEPLOYER_CLI_VERSION

WORKDIR /app

# Install Python + venv toolchain (venv is required on Debian bookworm — PEP 668 blocks system-level pip installs)
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Install the range42-deployer CLI into an isolated venv
RUN python3 -m venv /opt/deployer-env \
    && /opt/deployer-env/bin/pip install --no-cache-dir \
       "range42-deployer${DEPLOYER_CLI_VERSION:+==${DEPLOYER_CLI_VERSION}}"

ENV PATH="/opt/deployer-env/bin:${PATH}"

# Install Node dependencies and build the production bundle
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM nginx:stable-bookworm AS runtime

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost/health || exit 1
