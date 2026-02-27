FROM node:25.6.1-alpine3.23 AS base

# All deps stage
FROM base AS deps
WORKDIR /app
ADD package.json package-lock.json ./
RUN npm ci

# Production only deps stage
FROM base AS production-deps
WORKDIR /app
ADD package.json package-lock.json ./
RUN npm ci --omit=dev

# Build stage
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
ADD . .
RUN rm -f .env.production \
  && export NODE_ENV=production PORT=3000 APP_KEY=build-only-app-key-123456 HOST=0.0.0.0 LOG_LEVEL=info SESSION_DRIVER=cookie DB_HOST=localhost DB_PORT=5432 DB_USER=sbf DB_DATABASE=sbf SMTP_HOST=localhost SMTP_PORT=25 \
  && node ace docs:generate \
  && node ace build \
  && cp swagger.json build/swagger.json \
  && cp swagger.yml build/swagger.yml

# Production stage
FROM base
RUN apk add --no-cache tzdata
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-deps /app/node_modules /app/node_modules
COPY --from=build /app/build /app
COPY .env.production .env.production
EXPOSE 3000
CMD ["sh", "-c", "node ace migration:run --force && node ./bin/server.js"]
