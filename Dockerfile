# Render uses the PORT environment variable automatically
ENV PORT=10000
EXPOSE 10000

# Simple start command
CMD ["bun", "run", "src/index.ts"]
