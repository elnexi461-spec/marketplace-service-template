# ───────────────────────────────────────────────────────────────
# Marketplace Service — production image
# Bun runtime + Playwright (Chromium) for the /api/scrape endpoint.
# Uses Microsoft's playwright base image so the Chromium system
# libraries (libglib, libnss, libxshmfence, etc.) are pre-installed.
# ───────────────────────────────────────────────────────────────

FROM mcr.microsoft.com/playwright:v1.59.1-jammy AS base
WORKDIR /app

# Install Bun (no Node-specific tooling needed at runtime)
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL https://bun.sh/install | bash \
 && ln -s /root/.bun/bin/bun /usr/local/bin/bun

# ── Dependencies ──
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Use the Playwright-managed Chromium that ships with the base image.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN bunx playwright install chromium --with-deps || true

# ── App ──
COPY src ./src
COPY tsconfig.json ./

# Non-root user - Added explicit permissions for Bun and App directory
RUN useradd -ms /bin/bash app && chown -R app:app /app
RUN chmod -R 755 /root/.bun/bin && chmod +x /usr/local/bin/bun
USER app

ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT||5000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/index.ts"]
