# Stage 1: Build & Setup
FROM mcr.microsoft.com/playwright:v1.59.1-jammy AS builder
WORKDIR /app

# Install Bun
RUN apt-get update && apt-get install -y curl unzip \
    && curl -fsSL https://bun.sh/install | bash \
    && mv /root/.bun/bin/bun /usr/local/bin/bun

COPY package.json bun.lock* ./
RUN /usr/local/bin/bun install --frozen-lockfile --production

# Stage 2: Production (Fixing the Permission Denied)
FROM mcr.microsoft.com/playwright:v1.59.1-jammy
WORKDIR /app

# Copy the Bun binary from builder and force the execute bit
COPY --from=builder /usr/local/bin/bun /usr/local/bin/bun
RUN chmod +x /usr/local/bin/bun

# Copy dependencies and source
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Environment setup
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN /usr/local/bin/bunx playwright install chromium --with-deps || true

# CRITICAL: We stay as root for the Entrypoint to satisfy Tini's exec check, 
# but the app runs in the standard container space.
ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

# Using the absolute path in an array format prevents shell permission errors
ENTRYPOINT ["/usr/local/bin/bun"]
CMD ["run", "src/index.ts"]
