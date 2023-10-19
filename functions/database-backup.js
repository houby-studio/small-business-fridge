import fs from 'fs'
import _ from 'lodash'
import { exec } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import logger from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Concatenate root directory path with our backup folder.
const backupDirPath = path.join(__dirname, '../database-backup/backup')

const dbOptions = {
  autoBackup: true,
  removeOldBackup: true,
  keepLastDaysBackup: process.env.TASKS_DAILY_BACKUP_DAYS_TO_KEEP,
  autoBackupPath: backupDirPath
}

// return stringDate as a date object.
function stringToDate(dateString) {
  return new Date(dateString)
}

// Check if variable is empty or not.
function empty(mixedVar) {
  let undef, key, i, len
  const emptyValues = [undef, null, false, 0, '', '0']
  for (i = 0, len = emptyValues.length; i < len; i++) {
    if (mixedVar === emptyValues[i]) {
      return true
    }
  }
  if (typeof mixedVar === 'object') {
    for (key in mixedVar) {
      return false
    }
    return true
  }
  return false
}

// Auto backup function
export default function dbAutoBackUp() {
  // check for auto backup is enabled or disabled
  if (dbOptions.autoBackup === true) {
    logger.info(
      `server.functions.databasebackup__Automatic backup is configured to directory ${dbOptions.autoBackupPath}.`
    )
    console.log(backupDirPath)
    const date = new Date()
    let beforeDate, oldBackupDir, oldBackupPath

    // Current date
    var currentDate = stringToDate(date)
    const newBackupDir =
      currentDate.getFullYear() +
      '-' +
      (currentDate.getMonth() + 1) +
      '-' +
      currentDate.getDate()

    // New backup path for current backup process
    const newBackupPath =
      dbOptions.autoBackupPath + '-mongodump-' + newBackupDir + '.tar.gz'
    // check for remove old backup after keeping # of days given in ENV
    if (dbOptions.removeOldBackup === true) {
      beforeDate = _.clone(currentDate)
      // Substract number of days to keep backup and remove old backup
      beforeDate.setDate(beforeDate.getDate() - dbOptions.keepLastDaysBackup)
      oldBackupDir =
        beforeDate.getFullYear() +
        '-' +
        (beforeDate.getMonth() + 1) +
        '-' +
        beforeDate.getDate()
      // old backup(after keeping # of days)
      oldBackupPath =
        dbOptions.autoBackupPath + 'mongodump-' + oldBackupDir + '.tar.gz'
    }

    // Command for mongodb dump process
    const cmd =
      'mongodump --forceTableScan --uri="' +
      process.env.DB_CONNECTION_STRING +
      '" --archive=' +
      newBackupPath

    exec(cmd, (error, stdout, stderr) => {
      if (empty(error)) {
        logger.info(
          `server.functions.databasebackup__Succesfully created backup ${newBackupPath}.`
        )
        // check for remove old backup after keeping # of days given in ENV.
        if (dbOptions.removeOldBackup === true) {
          if (fs.existsSync(oldBackupPath)) {
            logger.info(
              `server.functions.databasebackup__Deleting old backup ${oldBackupPath}.`
            )
            exec('rm -rf ' + oldBackupPath, (_err) => {})
          }
        }
      } else {
        logger.error(
          'server.functions.databasebackup__Failed to create backup. Error:',
          error
        )
      }
    })
  }
}
