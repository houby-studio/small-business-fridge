FROM node:24-alpine AS base

# ----------------------------
# Stage 1: Install all dependencies
# ----------------------------
FROM base AS deps
WORKDIR /app
COPY package*.json ./
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

COPY --from=build /app/storage/uploads/keypad ./storage/uploads/keypad
COPY --from=build /app/swagger.json ./
COPY --from=build /app/swagger.yml ./
COPY --from=build /app/build ./
RUN npm ci --omit=dev

# Copy the entrypoint script
COPY docker-entrypoint.js ./

EXPOSE 3000
CMD ["node", "docker-entrypoint.js"]
