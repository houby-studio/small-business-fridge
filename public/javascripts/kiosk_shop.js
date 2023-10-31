function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000)
}

var interval

window.onload = function (event) {
  const backgroundMusic = new Audio('/audio/kiosk_shop_theme.mp3')
  backgroundMusic.volume = 0.3
  backgroundMusic.play()

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

    // Display the result in the element with id="demo"
    document.getElementById('timer').value =
      //days + 'd ' + hours + 'h ' + minutes + 'm ' + seconds + 's '
      minutes + 'm ' + seconds + 's'

    // If the count down is finished, write some text
    if (distance < 0) {
      clearInterval(interval)
      window.location.href = '/kiosk_keypad'
    }
  }, 1000)
}

const forms = document.querySelectorAll('form').forEach((element) => {
  element.addEventListener('click', async function (event) {
    event.preventDefault()
    this.submit()
  })
})
