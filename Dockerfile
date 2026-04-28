# ───────────────────────────────────────────────────────────────
# Marketplace Service — production image
# Bun runtime + Playwright (Chromium) for the /api/scrape endpoint.
# ───────────────────────────────────────────────────────────────

FROM mcr.microsoft.com/playwright:v1.59.1-jammy AS base
WORKDIR /app

# Install Bun and move it to a neutral location immediately
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://bun.sh/install | bash \
 && mv /root/.bun/bin/bun /usr/local/bin/bun \
 && chmod 755 /usr/local/bin/bun

# ── Dependencies ──
COPY package.json bun.lock* ./
# Run install as root to ensure it has permissions to create node_modules
RUN /usr/local/bin/bun install --frozen-lockfile --production

# Use the Playwright-managed Chromium
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN /usr/local/bin/bunx playwright install chromium --with-deps || true

# ── App ──
COPY src ./src
COPY tsconfig.json ./

# Setup non-root user and fix ALL permissions
RUN useradd -ms /bin/bash app \
 && chown -R app:app /app \
 && chown app:app /usr/local/bin/bun

USER app

ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

# Set path so "bun" command works globally
ENV PATH="/usr/local/bin:${PATH}"

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT||5000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/index.ts"]
