import '#tests/test_context'
import { test } from '@japa/runner'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parseAplayDevices } = require('../../electron-kiosk/audio_devices.js')

test.group('electron kiosk audio device discovery', () => {
  test('parses standard aplay -l output into hw device options', ({ assert }) => {
    const devices = parseAplayDevices(`**** List of PLAYBACK Hardware Devices ****
card 0: PCH [HDA Intel PCH], device 0: ALC3232 Analog [ALC3232 Analog]
  Subdevices: 1/1
  Subdevice #0: subdevice #0
card 0: PCH [HDA Intel PCH], device 3: HDMI 0 [HDMI 0]
  Subdevices: 1/1
  Subdevice #0: subdevice #0
`)

    assert.deepEqual(devices, [
      {
        value: 'hw:0,0',
        cardIndex: 0,
        deviceIndex: 0,
        cardId: 'PCH',
        cardLabel: 'HDA Intel PCH',
        deviceId: 'ALC3232 Analog',
        deviceLabel: 'ALC3232 Analog',
        description: 'HDA Intel PCH / ALC3232 Analog',
      },
      {
        value: 'hw:0,3',
        cardIndex: 0,
        deviceIndex: 3,
        cardId: 'PCH',
        cardLabel: 'HDA Intel PCH',
        deviceId: 'HDMI 0',
        deviceLabel: 'HDMI 0',
        description: 'HDA Intel PCH / HDMI 0',
      },
    ])
  })

  test('parses split card/device blocks when card and device are on separate lines', ({
    assert,
  }) => {
    const devices = parseAplayDevices(`**** List of PLAYBACK Hardware Devices ****
card 1: Audio [USB Audio]
  device 0: USB Audio [USB Audio]
`)

    assert.deepEqual(devices, [
      {
        value: 'hw:1,0',
        cardIndex: 1,
        deviceIndex: 0,
        cardId: 'Audio',
        cardLabel: 'USB Audio',
        deviceId: 'USB Audio',
        deviceLabel: 'USB Audio',
        description: 'USB Audio / USB Audio',
      },
    ])
  })
})
