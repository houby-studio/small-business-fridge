#!/bin/bash

# This script can be added as cron to host running two docker-compose projects to
# copy images and database from one environment to another (eg. TEST and PROD)
# We use it to keep data current on TEST environment (one day behind PROD)
# For example copy once a day at 3AM (make sure you have cron created with crontab -e):
# cp refresh-from-prod.sh /opt/test-small-business-fridge
# chmod +x /opt/test-small-business-fridge/refresh-from-prod.sh
# (crontab -l && echo "0 3 * * * /opt/test-small-business-fridge/refresh-from-prod.sh") | crontab -

TEST_CONTAINER_NAME="test-small-business-fridge"
PROD_BACKUPPATH="/var/lib/docker/volumes/small-business-fridge_backup/_data/"
TEST_BACKUPPATH="/var/lib/docker/volumes/test-small-business-fridge_test-backup/_data/"
PROD_IMAGEPATH="/var/lib/docker/volumes/small-business-fridge_images/_data/"
TEST_IMAGEPATH="/var/lib/docker/volumes/test-small-business-fridge_test-images/_data/"
YESTERDAY=$(date -d "yesterday" '+%Y-%-m-%-d')

echo "Deleting TEST images"
rm ${TEST_IMAGEPATH}*

echo "Copying PROD images to TEST"
cp ${PROD_IMAGEPATH}* $TEST_IMAGEPATH

echo "Fixing images permissions"
chmod 644 ${TEST_IMAGEPATH}*

echo "Copying PROD database backup file to TEST"
cp ${PROD_BACKUPPATH}backup-mongodump-${YESTERDAY}.tar.gz ${TEST_BACKUPPATH}prod-backup-mongodump-${YESTERDAY}.tar.gz

echo "Restoring PROD database from backup file to TEST"

docker exec -e YESTERDAY=$YESTERDAY $TEST_CONTAINER_NAME /bin/sh -c '/usr/bin/mongorestore --uri="$DB_CONNECTION_STRING" --drop --archive=/usr/src/app/database-backup/prod-backup-mongodump-${YESTERDAY}.tar.gz --nsFrom="lednice.*" --nsTo="lednice-test.*"'

echo "Deleting PROD database backup"
rm ${TEST_BACKUPPATH}prod-backup-mongodump-${YESTERDAY}.tar.gz

