# DeepSeek Harness plugin bumper. Build context is the repo root.
# Pins: Node 24 and the pnpm version in package.json. The image carries no agent
# runtime: a migration installs the target release and runs the plugin's checks.
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}

ARG DEBIAN_MIRROR=
ARG NPM_REGISTRY=

ENV DEBIAN_FRONTEND=noninteractive \
    NPM_CONFIG_UPDATE_NOTIFIER=false

RUN printf 'Acquire::Retries "5";\nAcquire::http::Timeout "120";\nAcquire::https::Timeout "120";\n' \
      > /etc/apt/apt.conf.d/99-network-resilience

# Native plugin dependencies may need python3, make and g++ during their checks.
RUN set -eux; \
  if [ -n "$DEBIAN_MIRROR" ]; then \
    sed -i "s|http://deb.debian.org/debian|$DEBIAN_MIRROR|g" /etc/apt/sources.list.d/debian.sources; \
  fi; \
  apt-get update; \
  apt-get install -y --no-install-recommends git ca-certificates python3 make g++; \
  rm -rf /var/lib/apt/lists/*

WORKDIR /opt/dsh-migrate
COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN set -eux; \
  corepack enable; \
  corepack prepare "$(node -p 'require("./package.json").packageManager')" --activate; \
  if [ -n "$NPM_REGISTRY" ]; then npm config set registry "$NPM_REGISTRY"; fi; \
  pnpm install --frozen-lockfile

COPY src ./src
COPY container ./container

# Keep the bundled TypeScript compiler as a production dependency. Consumer
# plugin checks still use npm for release-time dependency resolution.
RUN set -eux; \
  pnpm run build; \
  pnpm prune --prod; \
  ln -sf /opt/dsh-migrate/dist/src/cli.js /usr/local/bin/dsh-migrate; \
  chmod +x /opt/dsh-migrate/dist/src/cli.js /opt/dsh-migrate/container/entrypoint.sh

ENV DSH_MIGRATE_APP_ROOT=/opt/dsh-migrate

# An image whose CLI cannot load is not shipped.
RUN dsh-migrate print-config > /dev/null

WORKDIR /github/workspace
ENTRYPOINT ["/opt/dsh-migrate/container/entrypoint.sh"]
