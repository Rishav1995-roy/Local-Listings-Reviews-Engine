# =============================================================
# Dockerfile — Multi-stage build for production
# =============================================================
# Stage 1 (builder): Install all deps, compile TypeScript
# Stage 2 (runner):  Copy only compiled JS + prod node_modules
#                    Results in a lean ~180MB image vs ~600MB
# =============================================================

# ── Stage 1: Build ────────────────────────────────────────────
FROM node:20-alpine AS builder

# Prisma requires OpenSSL on Alpine Linux
RUN apk add --no-cache openssl

WORKDIR /app

# Copy package files first to leverage Docker layer cache
# Node modules only re-install when package*.json changes
COPY package*.json ./
COPY tsconfig.json ./

# Install ALL dependencies (including devDeps needed for tsc)
RUN npm ci

# Copy source code and Prisma schema
COPY src ./src
COPY prisma ./prisma

# Generate Prisma client (must happen before tsc)
RUN npx prisma generate

# Compile TypeScript → JavaScript
RUN npm run build

# ── Stage 2: Production runner ────────────────────────────────
FROM node:20-alpine AS runner

# Prisma requires OpenSSL on Alpine Linux
RUN apk add --no-cache openssl

# Security: run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ONLY production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy compiled JS from builder stage
COPY --from=builder /app/dist ./dist

# Copy generated Prisma client (includes native binaries)
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy Prisma schema (needed for migrate deploy)
COPY prisma ./prisma

# Switch to non-root user
USER appuser

# Expose application port
EXPOSE 3000

# Health check: hits /health every 30s
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Run database migrations then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
