# Production Dockerfile for RS Awal Bros Botania Knowledge Base
# Base image: Node.js 20 on Alpine Linux (minimal footprint, high security)
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Copy package manifests first for efficient Docker layer caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev --no-audit --no-fund

# Copy application source code
COPY --chown=node:node . .

# Ensure entrypoint script is executable
RUN chmod +x /app/docker-entrypoint.sh

# Expose HTTP application port
EXPOSE 3000

# Switch to unprivileged non-root user
USER node

# Container healthcheck using the M9 readiness probe
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/v1/health/ready || exit 1

# Launch entrypoint script (executes migrations, seeds if needed, and starts server)
ENTRYPOINT ["/app/docker-entrypoint.sh"]
