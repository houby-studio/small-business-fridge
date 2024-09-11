/*global bootstrap*/

// Activate bootstrap modal
const bootstrapModal = new bootstrap.Modal('#confirm-modal')

// Declare variables
const modal = document.getElementById('confirm-modal')
const modalProductName = document.getElementById('product_name')
const modalProductPrice = document.getElementById('product_price')
const modalProductImage = document.getElementById('product_image')
const modalSubmitButton = document.getElementById('modal_confirm_btn')
const modalSubmitContinueButton = document.getElementById(
  'modal_confirm_continue_btn'
)
var backgroundInput = ''
var modalCountDownDate
var modalInterval

// Functions for screen timer and modal timer
function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000)
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000)
}

// Function to display confirmation dialog
async function showConfirm(
  form_id,
  product_name,
  product_price,
  product_image
) {
  modalSubmitButton.dataset.submit_id = form_id
  modalSubmitContinueButton.dataset.submit_id = form_id
  modalProductName.innerText = product_name
  modalProductPrice.innerText = product_price
  modalProductImage.src = product_image
  bootstrapModal.show()
}

// Function to submit purchase and either back to keypad or keep shopping
// eslint-disable-next-line no-unused-vars
function submitFromModal(ctx, keepShopping) {
  const form = document.getElementById(ctx.dataset.submit_id)
  if (keepShopping) {
    form.action += '?return=kiosk_shop'
  }
  form.submit()
}

// On page load start timer, play background music and make product card clickable
document.addEventListener('DOMContentLoaded', function () {
  var shopInterval
  const randomNumber = Math.floor(Math.random() * 11)
  const backgroundMusic = new Audio(
    `/audio/${randomNumber}_kiosk_shop_theme.mp3`
  )

  // Play background theme music
  backgroundMusic.volume = 0.3
  backgroundMusic.play()

  // Make whole product card clickable for touch screens
  // eslint-disable-next-line no-unused-vars
  const _forms = document.querySelectorAll('form').forEach((element) => {
    element.addEventListener('click', async function (event) {
      event.preventDefault()
      if (element.id === 'back-button') {
        this.submit()
      } else {
        showConfirm(
          this.id,
          this.dataset.productname,
          this.dataset.productprice,
          this.dataset.productimage
        )
      }
    })
  })

  // Set the date we're counting down to
  var countDownDate = addMinutes(new Date(), 3)

  // Update the count down every 1 second
  shopInterval = setInterval(function () {
    // Get today's date and time
    var now = new Date().getTime()

    // Find the distance between now and the count down date
    var distance = countDownDate - now

    var minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60))
    var seconds = Math.floor((distance % (1000 * 60)) / 1000)

    // Display the result in the element with id="timer"
    document.getElementById('timer').value = minutes + 'm ' + seconds + 's'

    // If the count down is finished, redirect to keypad to reset page state
    if (distance < 1000) {
      clearInterval(shopInterval)
      window.location.href = '/kiosk_keypad?timeout=1'
    }
  }, 1000)
})

// Listen for keypress events and handle them - specifically suitable for barcode scanners
document.addEventListener('keydown', function (e) {
  e.preventDefault()
  if (e.key === 'Enter') {
    const form = document.querySelector(
      "form[data-code='" + backgroundInput + "']"
    )
    if (form) {
      showConfirm(
        form.id,
        form.dataset.productname,
        form.dataset.productprice,
        form.dataset.productimage
      )
      backgroundInput = ''
    } else {
      backgroundInput = ''
    }
  } else if (e.key.length === 1) {
    backgroundInput = backgroundInput + e.key
  }
})

// On modal shown start timer and finish order when it times out
// On modal hidden clear interval
modal.addEventListener('shown.bs.modal', function () {
  modalSubmitButton.innerHTML = 'Dokončit nákup (5s)'

  // Set the date we're counting down to
  modalCountDownDate = addSeconds(new Date(), 6)

  // Update the count down every 1 second
  modalInterval = setInterval(function () {
    // Get today's date and time
    var now = new Date().getTime()

    // Find the distance between now and the count down date
    var distance = modalCountDownDate - now

    // var minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    var seconds = Math.floor((distance % (1000 * 60)) / 1000)

    // If the count down is finished, redirect to keypad to reset page state
    if (distance < 1000) {
      clearInterval(modalInterval)
      modalSubmitButton.click()
    }

    // Display the result in the element with id="timer"
    modalSubmitButton.innerHTML = 'Dokončit nákup (' + seconds + 's)'
  }, 1000)
})

modal.addEventListener('hidden.bs.modal', function () {
  clearInterval(modalInterval)
})
