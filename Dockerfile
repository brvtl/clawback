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
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY packages/ ./packages/
COPY apps/daemon/ ./apps/daemon/
COPY apps/web/ ./apps/web/

# Build all packages (shared must build before daemon and web)
RUN pnpm --filter @clawback/shared build && \
    pnpm --filter @clawback/db build && \
    pnpm --filter @clawback/daemon exec tsc --noCheck && \
    VITE_API_URL="" pnpm --filter @clawback/web build

# Production stage
FROM node:24-alpine AS production

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Install nginx
RUN apk add --no-cache nginx

WORKDIR /app

# Copy package files for production install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY apps/daemon/package.json ./apps/daemon/
COPY apps/web/package.json ./apps/web/

# Install production dependencies (--ignore-scripts skips husky prepare)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy native bindings from builder (better-sqlite3 needs compiled .node file)
COPY --from=builder /app/node_modules/.pnpm/better-sqlite3@12.6.2/node_modules/better-sqlite3/build \
    ./node_modules/.pnpm/better-sqlite3@12.6.2/node_modules/better-sqlite3/build

# Copy built files — daemon
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/apps/daemon/dist ./apps/daemon/dist

# Copy built files — web (adapter-node output)
COPY --from=builder /app/apps/web/build ./apps/web/build

# Copy migration files (needed at runtime)
COPY --from=builder /app/packages/db/drizzle ./packages/db/drizzle

# Copy nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy entrypoint script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Create data directory
RUN mkdir -p /data /skills

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV PORT_WEB=3001
ENV ORIGIN=http://localhost
ENV DATABASE_URL=/data/clawback.db
ENV SKILLS_DIR=/skills

EXPOSE 80

# Health check via nginx
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/api/status || exit 1

# Run migrations, start nginx + web + daemon
ENTRYPOINT ["./docker-entrypoint.sh"]
