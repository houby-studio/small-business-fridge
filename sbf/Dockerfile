# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN node ace build

# ── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:22-alpine AS production

RUN apk add --no-cache tini tzdata

ENV NODE_ENV=production
ENV TZ=Europe/Prague
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app

# Copy built output
COPY --from=builder /app/build ./

# Install production dependencies only
RUN npm ci --omit=dev

# Create storage directory
RUN mkdir -p storage/uploads

EXPOSE 3000

# Use tini as init to handle signals properly
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "bin/server.js"]
