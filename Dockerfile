FROM node:alpine

# Install mongodump for database backups
RUN apk add --no-cache mongodb-tools tini tzdata

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# If you are building your code for production
RUN npm ci --only=production

# Bundle app source
COPY . .

# Change ownership for writeable folders to node user
RUN chown -R node:node /usr/src/app/public/images
RUN chown -R node:node /usr/src/app/database-backup

# Set default ENV variables
ENV NODE_ENV=production
ENV DEBUG=false

# Do not run under root
USER node

# Port to expose in container
EXPOSE 3000

# Wrap process within simple init
ENTRYPOINT ["/sbin/tini", "--"]
# Run node app
CMD [ "node", "bin/www" ]

# install mongodump

#https://nodejs.org/en/docs/guides/nodejs-docker-webapp/
#https://github.com/nodejs/docker-node/blob/master/docs/BestPractices.md
#https://github.com/krallin/tini#using-tini
#https://americanexpress.io/do-not-run-dockerized-applications-as-root/

#https://www.npmjs.com/package/dotenv
#https://www.npmjs.com/package/dotenv-parse-variables

# TODO:
# Load ENV variables