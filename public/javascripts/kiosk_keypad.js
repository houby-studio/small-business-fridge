function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000)
}

document.addEventListener('DOMContentLoaded', function () {
  var interval
  const kiosk_click_button = new Audio('/audio/kiosk_click_button.mp3')
  const kiosk_click_reset = new Audio('/audio/kiosk_click_reset.mp3')
  const kiosk_timeout_alert = new Audio('/audio/kiosk_timeout.mp3')
  const timer_display = document.getElementById('timer')

  // Play sound on SUBMIT click
  document.getElementById('submit').addEventListener('click', function () {
    kiosk_click_button.currentTime = 0
    kiosk_click_button.play()
  })

  // Play sound on RESET click and reset and stop timer
  document.getElementById('reset').addEventListener('click', function () {
    kiosk_timeout_alert.pause()

    kiosk_click_reset.currentTime = 0
    kiosk_click_reset.play()

    clearInterval(interval)
    timer_display.value = '⏱️'
  })

  // If navigated to this page with alert, play sound
  const alertElement = document.getElementById('alert')
  if (alertElement?.classList.contains('alert-danger')) {
    new Audio('/audio/kiosk_user_not_found.mp3').play()
  } else if (alertElement?.classList.contains('alert-success')) {
    new Audio('/audio/kiosk_purchase_confirmed.mp3').play()
  } else {
    // If navigating from context aware link, trigger timeout alert
    const timeout = new URLSearchParams(location.search).get('timeout')
    if (timeout) kiosk_timeout_alert.play()
    // If navigating from context aware link, trigger timeout alert
    const cancel = new URLSearchParams(location.search).get('cancel')
    if (cancel) new Audio('/audio/kiosk_purchase_cancel.mp3').play()
  }

  // Register number input handling for all numeric buttons
  const numberButtons = document.getElementsByClassName('numberBtn')

  const _numberButtonsEvent = [...numberButtons].forEach((element) => {
    element.addEventListener('click', async function () {
      // Play sound on NUMBER click
      kiosk_click_button.currentTime = 0
      kiosk_click_button.play()

      // Stop previous interval
      clearInterval(interval)

      // Set the date we're counting down to
      var countDownDate = addMinutes(new Date(), 1)

      // Update the count down every 1 second
      interval = setInterval(function () {
        // Get today's date and time
        var now = new Date().getTime()

        // Find the distance between now and the count down date
        var distance = countDownDate - now

        var seconds = Math.floor((distance % (1000 * 60)) / 1000)

        // Display the result in the element with id="timer"
        timer_display.value = seconds + 's'

        // If the count down is finished, redirect to itself to reset page state
        if (distance < 0) {
          clearInterval(interval)
          window.location.href = '/kiosk_keypad?timeout=1'
        }
      }, 1000)

      // Display numbers on screen
      const screen = document.getElementById('customer_id')
      screen.value = screen.value + this.value
    })
  })
})
