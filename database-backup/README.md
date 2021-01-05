To restore use
mongorestore --uri="connectionstring" --archive=./database-backup/backup-mongodump-2020-1-1.tar.gz

To restore to different database
mongorestore --uri="connectionstring" --archive=./database-backup/backup-mongodump-2020-1-1.tar.gz --nsFrom="lednice.*" --nsTo="lednice-test.*"