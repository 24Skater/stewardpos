# Stage 1: Dependencies
FROM node:20-alpine AS deps

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (use npm install if package-lock.json doesn't exist)
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Stage 2: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Stage 3: Production
FROM node:20-alpine AS runner

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

WORKDIR /app

# Set NODE_ENV
ENV NODE_ENV=production

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --production; fi && \
    npm cache clean --force

# Copy built application from builder
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Copy migrations (needed at runtime)
COPY --chown=nodejs:nodejs migrations ./migrations

# Copy entrypoint script and ensure Unix line endings
COPY --chown=nodejs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && \
    chmod +x ./docker-entrypoint.sh

# Create logs directory
RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app/logs

# Create uploads directories
RUN mkdir -p /app/uploads/logos /app/uploads/icons && chown -R nodejs:nodejs /app/uploads

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application (entrypoint handles migrations)
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]

