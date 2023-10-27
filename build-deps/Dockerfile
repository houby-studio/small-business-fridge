FROM node:18.18.2-alpine3.17

RUN apk update && apk upgrade

RUN apk add --no-cache mongodb-tools tini tzdata

# Create app directory
WORKDIR /usr/src/app

# Port to expose in container
EXPOSE 3000

# Wrap process within simple init
ENTRYPOINT ["/sbin/tini", "--"]
# Run node app
CMD [ "node", "bin/www" ]

# Set default ENV variables
ENV NODE_ENV=production
ENV DEBUG=false