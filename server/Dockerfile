FROM oven/bun:1.2

WORKDIR /app

# Copy manifest first to leverage layer caching
COPY package.json bun.lock ./

# Install production dependencies
RUN bun install --frozen-lockfile --production

# Copy source files needed for the build
COPY tsconfig.json ./
COPY drizzle.config.ts ./
COPY src ./src

# TDLib stores local session data here at runtime
RUN mkdir -p /app/tdlib-sessions

# Build the backend
RUN bun run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8000
ENV TDLIB_SESSIONS_DIR=/app/tdlib-sessions

EXPOSE 8000

# Run as non-root and ensure runtime session storage is writable
RUN groupadd --system bunapp && useradd --system --gid bunapp --create-home bunuser && chown -R bunuser:bunapp /app

VOLUME ["/app/tdlib-sessions"]

USER bunuser

CMD ["bun", "run", "start"]
