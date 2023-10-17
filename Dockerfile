FROM houbystudio/base-small-business-fridge:2023-10-17

# Create app directory
WORKDIR /usr/src/app

# Set default ENV variables
ENV NODE_ENV=production
ENV DEBUG=false

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# If you are building your code for production
RUN npm ci --only=production

# Bundle app source
COPY defaults.env .env
COPY . .

# Change ownership for writeable folders to node user
RUN chown -R node:node /usr/src/app/public/images
RUN chown -R node:node /usr/src/app/database-backup

# Do not run under root
USER node

# Port to expose in container
EXPOSE 3000

# Wrap process within simple init
ENTRYPOINT ["/sbin/tini", "--"]
# Run node app
CMD [ "node", "bin/www" ]
