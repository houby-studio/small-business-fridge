function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000)
}

document.addEventListener('DOMContentLoaded', function () {
  var interval
  const backgroundMusic = new Audio('/audio/kiosk_shop_theme.mp3')

  // Play background them
  backgroundMusic.volume = 0.3
  backgroundMusic.play()

  // Make whole product card clickable for touch screens
  const _forms = document.querySelectorAll('form').forEach((element) => {
    element.addEventListener('click', async function (event) {
      event.preventDefault()
      this.submit()
    })
  })

  // Set the date we're counting down to
  var countDownDate = addMinutes(new Date(), 3)

  // Update the count down every 1 second
  interval = setInterval(function () {
    // Get today's date and time
    var now = new Date().getTime()

    // Find the distance between now and the count down date
    var distance = countDownDate - now

    var minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60))
    var seconds = Math.floor((distance % (1000 * 60)) / 1000)

    // Display the result in the element with id="timer"
    document.getElementById('timer').value = minutes + 'm ' + seconds + 's'

    // If the count down is finished, redirect to keypad to reset page state
    if (distance < 0) {
      clearInterval(interval)
      window.location.href = '/kiosk_keypad?timeout=1'
    }
  }, 1000)
})
