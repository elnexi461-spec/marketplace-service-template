# 1. Use the official Apify Bun image (it handles all permissions/tini)
FROM apify/actor-node-bun:latest

# 2. Switch to root just to install Playwright system dependencies
USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libdbus-1-3 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/*

# 3. Setup the working directory (standard Apify path)
WORKDIR /usr/src/app

# 4. Copy package files first for caching
COPY --chown=myuser:myuser package.json bun.lock* ./

# 5. Switch to the built-in 'myuser' (Apify standard)
USER myuser

# Install dependencies
RUN bun install --frozen-lockfile --production

# Install Playwright Chromium
ENV PLAYWRIGHT_BROWSERS_PATH=/home/myuser/pw-browsers
RUN bunx playwright install chromium

# 6. Copy the rest of your source code
COPY --chown=myuser:myuser src ./src
COPY --chown=myuser:myuser tsconfig.json ./

ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

# The Apify image expects 'npm start', but we'll point it to bun
# We use the full path to be 100% sure on permissions
CMD ["/usr/local/bin/bun", "run", "src/index.ts"]
