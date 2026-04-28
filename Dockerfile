# ───────────────────────────────────────────────────────────────
# Marketplace Service — production image
# Bun runtime + Playwright (Chromium) for the /api/scrape endpoint.
# ───────────────────────────────────────────────────────────────

FROM mcr.microsoft.com/playwright:v1.59.1-jammy

# 1. Setup the non-root user first
RUN useradd -ms /bin/bash app
WORKDIR /home/app/app

# 2. Install Bun directly into the app user's home directory
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Switch to app user for the rest of the setup
USER app

# Install Bun as the app user
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/app/.bun/bin:${PATH}"

# ── Dependencies ──
COPY --chown=app:app package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Use the Playwright-managed Chromium
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# Ensure we can use the pre-installed browsers
RUN bunx playwright install chromium --with-deps || true

# ── App ──
COPY --chown=app:app src ./src
COPY --chown=app:app tsconfig.json ./

ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT||5000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Start the app using the local Bun install
CMD ["/home/app/.bun/bin/bun", "run", "src/index.ts"]
