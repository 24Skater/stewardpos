# Multi-stage build for production
FROM node:22-alpine AS builder

# Install pnpm (v9 matches pnpm-lock.yaml lockfileVersion 9.0)
RUN corepack enable && corepack prepare pnpm@9 --activate

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application with environment variables
# Vite requires env vars at build time, not runtime
# Use empty string for relative paths (works with nginx proxy)
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# Vite inlines VITE_* at build time, so these have to be build args - setting them
# in `environment:` on the running container has no effect on an already-built
# bundle. Off by default: only the demo deployment advertises its credentials.
ARG VITE_DEMO_MODE=false
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE
RUN ./node_modules/.bin/vite build

# Production stage
FROM nginx:alpine

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Health check
#
# `127.0.0.1`, not `localhost`.
#
# nginx listens on 0.0.0.0:80 — IPv4 only — while `localhost` inside the
# container resolves to ::1 first. The check therefore connected to an address
# nothing was listening on and reported "connection refused" for a container
# that was serving requests perfectly well.
#
# It had never once passed. Nothing gates on it, so the only symptom was a
# frontend permanently marked `unhealthy` in `docker compose ps` — which is
# worse than it sounds, because docs/guides/operations.md tells operators to
# read exactly that, and a health indicator that is always red teaches people to
# ignore health indicators.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
