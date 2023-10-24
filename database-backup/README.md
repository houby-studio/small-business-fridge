# Overview

In this folder the autoamtic backups will be stored. You should export them to another physical location to have real backup.

## Restoring

To restore with same database name, use following command:

```bash
mongorestore --uri="$DB_CONNECTION_STRING" --archive=./database-backup/backup-mongodump-2020-1-1.tar.gz
```

To restore with different database name, for example for testing and development purposes, use following command:

```bash
mongorestore --uri="$DB_CONNECTION_STRING" --archive=./database-backup/backup-mongodump-2020-1-1.tar.gz --nsFrom="lednice.*" --nsTo="lednice-test.*"
```
