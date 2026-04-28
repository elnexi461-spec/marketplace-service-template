# 1. Use the official Playwright image
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

# 2. Install Bun as ROOT and put it in the most public folder possible
RUN apt-get update && apt-get install -y curl unzip \
    && curl -fsSL https://bun.sh/install | bash \
    && mv /root/.bun/bin/bun /usr/bin/bun \
    && chmod 755 /usr/bin/bun

WORKDIR /app

# 3. Copy files and force ownership to the default 'pwuser' (Playwright's user)
COPY --chown=pwuser:pwuser package.json bun.lock* ./
RUN /usr/bin/bun install --frozen-lockfile --production

COPY --chown=pwuser:pwuser . .

# 4. Setup Playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN /usr/bin/bunx playwright install chromium --with-deps || true

# 5. Environment
ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

# 6. THE FIX: Switch to the built-in user and use 'npm start'
# Apify's Tini is pre-configured to trust npm.
USER pwuser
CMD ["npm", "start"]
