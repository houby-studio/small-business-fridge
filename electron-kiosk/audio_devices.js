'use strict'

const { execFileSync } = require('node:child_process')

function parseAplayDevices(output) {
  if (!output) return []

  const devices = []
  let currentCard = null

  for (const rawLine of String(output).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const cardMatch = rawLine.match(
      /^card\s+(\d+):\s*([^\[]+)\[(.*?)\],\s*device\s+(\d+):\s*(.+?)\s*\[(.*?)\]/
    )
    if (cardMatch) {
      const [, cardIndex, cardIdRaw, cardLabel, deviceIndex, deviceIdRaw, deviceLabel] = cardMatch
      devices.push({
        value: `hw:${cardIndex},${deviceIndex}`,
        cardIndex: Number(cardIndex),
        deviceIndex: Number(deviceIndex),
        cardId: cardIdRaw.trim(),
        cardLabel: cardLabel.trim(),
        deviceId: deviceIdRaw.trim(),
        deviceLabel: deviceLabel.trim(),
        description: `${cardLabel.trim()} / ${deviceLabel.trim()}`,
      })
      currentCard = null
      continue
    }

    const compactCardMatch = rawLine.match(/^card\s+(\d+):\s*([^\[]+)\[(.*?)\],?\s*$/)
    if (compactCardMatch) {
      const [, cardIndex, cardIdRaw, cardLabel] = compactCardMatch
      currentCard = {
        cardIndex: Number(cardIndex),
        cardId: cardIdRaw.trim(),
        cardLabel: cardLabel.trim(),
      }
      continue
    }

    const deviceMatch = rawLine.match(/^\s*device\s+(\d+):\s*(.+?)\s*\[(.*?)\]/)
    if (deviceMatch && currentCard) {
      const [, deviceIndex, deviceIdRaw, deviceLabel] = deviceMatch
      devices.push({
        value: `hw:${currentCard.cardIndex},${deviceIndex}`,
        cardIndex: currentCard.cardIndex,
        deviceIndex: Number(deviceIndex),
        cardId: currentCard.cardId,
        cardLabel: currentCard.cardLabel,
        deviceId: deviceIdRaw.trim(),
        deviceLabel: deviceLabel.trim(),
        description: `${currentCard.cardLabel} / ${deviceLabel.trim()}`,
      })
    }
  }

  return devices
}

function listAudioDevices() {
  try {
    const output = execFileSync('aplay', ['-l'], { encoding: 'utf8' })
    return {
      devices: parseAplayDevices(output),
      rawOutput: output.trim(),
      error: null,
    }
  } catch (error) {
    return {
      devices: [],
      rawOutput: '',
      error: String(error.message || error),
    }
  }
}

module.exports = {
  listAudioDevices,
  parseAplayDevices,
}
