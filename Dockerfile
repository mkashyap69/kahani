# One image for both the web app and the worker (FFmpeg + fonts included).
FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fontconfig fonts-dejavu-core openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN npm ci

FROM deps AS build
COPY . .
RUN npx prisma generate --schema packages/core/prisma/schema.prisma \
 && touch .env \
 && npm run build -w @kahani/web

FROM base AS runtime
ENV NODE_ENV=production KAHANI_ROOT=/app
COPY --from=build /app /app
# fonts used by libass for Devanagari subtitles / thumbnails
RUN mkdir -p /usr/share/fonts/truetype/kahani && cp /app/assets/fonts/*.ttf /usr/share/fonts/truetype/kahani/ && fc-cache -f
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@kahani/web"]
