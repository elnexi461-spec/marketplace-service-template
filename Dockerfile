# 1. Use the official Apify Bun image (pre-configured for their platform)
FROM apify/actor-node-bun:latest

# 2. Switch to root to install Playwright's system dependencies
USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libdbus-1-3 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/*

# 3. Setup the working directory
WORKDIR /usr/src/app

# 4. Copy package files using the correct Apify user (myuser)
COPY --chown=myuser:myuser package.json bun.lock* ./

# 5. Switch back to the non-root user 'myuser'
USER myuser

# Install project dependencies
RUN bun install --frozen-lockfile --production

# Install Playwright Chromium into the user's home directory
ENV PLAYWRIGHT_BROWSERS_PATH=/home/myuser/pw-browsers
RUN bunx playwright install chromium

# 6. Copy the rest of the source code
COPY --chown=myuser:myuser src ./src
COPY --chown=myuser:myuser tsconfig.json ./

ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

# Start using the pre-installed Bun binary provided by the image
CMD ["bun", "run", "src/index.ts"]
