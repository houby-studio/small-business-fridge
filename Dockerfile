FROM node:24-alpine AS base

# ----------------------------
# Stage 1: Install all dependencies
# ----------------------------
FROM base AS deps
WORKDIR /app
COPY package*.json ./
# patch-package (postinstall) needs the patches before the first npm ci
COPY patches ./patches
RUN npm ci

# ----------------------------
# Stage 2: Build the application
# ----------------------------
FROM deps AS build
WORKDIR /app
ENV NODE_ENV=development
COPY . .
RUN cp .env.example .env \
  && node ace generate:key \
  && node ace docs:generate \
  && node ace build

# ----------------------------
# Stage 3: Production runtime
# ----------------------------
FROM base AS production
WORKDIR /app
ENV NODE_ENV=production

# Which build this is. Supplied by the release workflow; `dev` for a plain local build.
# The same values go into OCI labels so `docker inspect` can answer without the app running.
ARG APP_VERSION=dev
ARG GIT_SHA=""
ARG BUILD_DATE=""
ENV APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA} \
    BUILD_DATE=${BUILD_DATE}

LABEL org.opencontainers.image.title="Small Business Fridge" \
      org.opencontainers.image.description="Office fridge shop: colleagues buy drinks and snacks at cost." \
      org.opencontainers.image.source="https://github.com/houby-studio/small-business-fridge" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}"

COPY --from=build /app/swagger.json ./
COPY --from=build /app/swagger.yml ./
COPY --from=build /app/build ./
RUN npm ci --omit=dev

# Copy the entrypoint script
COPY docker-entrypoint.js ./

EXPOSE 3000
CMD ["node", "docker-entrypoint.js"]
