# Build stage
FROM node:24-alpine AS builder

# Install corepack for pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY apps/daemon/package.json ./apps/daemon/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY packages/ ./packages/
COPY apps/daemon/ ./apps/daemon/

# Build all packages
RUN pnpm --filter @clawback/shared build && \
    pnpm --filter @clawback/db build && \
    pnpm --filter @clawback/daemon build

# Production stage
FROM node:24-alpine AS production

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy package files for production install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY apps/daemon/package.json ./apps/daemon/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built files
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/apps/daemon/dist ./apps/daemon/dist

# Create data directory
RUN mkdir -p /data /skills

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_URL=/data/clawback.db
ENV SKILLS_DIR=/skills

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/status || exit 1

# Run daemon
CMD ["node", "apps/daemon/dist/index.js"]
