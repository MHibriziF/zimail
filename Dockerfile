# Zimail, self-hosted: the SvelteKit Node build, run on Bun. Bun has the two
# things the server needs off Cloudflare built in: node:sqlite for the
# database and HTMLRewriter for the signature sanitizer.
# Everything is kept in one volume at /data: zimail.db and blobs/.

FROM oven/bun:1.4 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM oven/bun:1.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run build:node

FROM oven/bun:1.4-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=3000 \
    BODY_SIZE_LIMIT=50M
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/server ./server
COPY package.json ./
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD ["bun", "-e", "const r = await fetch('http://127.0.0.1:' + (process.env.PORT ?? 3000) + '/login', { redirect: 'manual' }); process.exit(r.status < 500 ? 0 : 1)"]
CMD ["bun", "server/node.js"]
