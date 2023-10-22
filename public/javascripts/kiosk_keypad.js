function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000)
}

var x

// Change settings when checkbox state changes
const numberButtons = document.getElementsByClassName('numberBtn')

const _numberButtonsEvent = [...numberButtons].forEach((element) => {
  element.addEventListener('click', async function () {
    // Stop previous interval
    clearInterval(x)

    // Set the date we're counting down to
    var countDownDate = addMinutes(new Date(), 1)

    // Update the count down every 1 second
    x = setInterval(function () {
      // Get today's date and time
      var now = new Date().getTime()

      // Find the distance between now and the count down date
      var distance = countDownDate - now

      // Time calculations for days, hours, minutes and seconds
      //var days = Math.floor(distance / (1000 * 60 * 60 * 24))
      //var hours = Math.floor(
      //  (distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
      //)
      //var minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60))
      var seconds = Math.floor((distance % (1000 * 60)) / 1000)

      // Display the result in the element with id="demo"
      document.getElementById('timer').value =
        //days + 'd ' + hours + 'h ' + minutes + 'm ' + seconds + 's '
        seconds + 's'

      // If the count down is finished, write some text
      if (distance < 0) {
        clearInterval(x)
        window.location.href = '/kiosk_keypad'
      }
    }, 1000)

    // Display numbers on screen
    const screen = document.getElementById('customer_id')
    console.log(screen.value)
    screen.value = screen.value + this.value
  })
})

document.getElementById('reset').addEventListener('click', function () {
  clearInterval(x)
  document.getElementById('timer').value = '⏱️'
})
