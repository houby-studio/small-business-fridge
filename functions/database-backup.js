const fs = require('fs')
const _ = require('lodash')
const exec = require('child_process').exec
const path = require('path')

// Concatenate root directory path with our backup folder.
const backupDirPath = path.join(__dirname, '../database-backup/backup')

const dbOptions = {
  autoBackup: true,
  removeOldBackup: true,
  keepLastDaysBackup: process.env.TASKS_DAILY_BACKUP_DAYS_TO_KEEP,
  autoBackupPath: backupDirPath
}

// return stringDate as a date object.
exports.stringToDate = (dateString) => {
  return new Date(dateString)
}

// Check if variable is empty or not.
exports.empty = (mixedVar) => {
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
exports.dbAutoBackUp = () => {
  // check for auto backup is enabled or disabled
  if (dbOptions.autoBackup === true) {
    console.log(backupDirPath)
    const date = new Date()
    let beforeDate, oldBackupDir, oldBackupPath

    // Current date
    var currentDate = this.stringToDate(date)
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
      if (this.empty(error)) {
        // check for remove old backup after keeping # of days given in ENV.
        if (dbOptions.removeOldBackup === true) {
          if (fs.existsSync(oldBackupPath)) {
            exec('rm -rf ' + oldBackupPath, (_err) => {})
          }
        }
      } else {
        console.log(error)
      }
    })
  }
}
