FROM houbystudio/base-small-business-fridge:2026-02-16

# Copy default .env
COPY build-deps/defaults.env .env

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# If you are building your code for production
RUN npm ci --only=production

# Copy source code
COPY . .

# Change ownership for writeable folders to node user
RUN chown -R node:node /usr/src/app/public/images && chown -R node:node /usr/src/app/database-backup && chown -R node:node /usr/src/app/logs
