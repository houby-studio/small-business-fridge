// Initialize Bootstraps 5 tooltips
const tooltipTriggerList = document.querySelectorAll(
  '[data-bs-toggle="tooltip"]'
)
const tooltipList = [...tooltipTriggerList].map(
  (tooltipTriggerEl) => new bootstrap.Tooltip(tooltipTriggerEl)
)

async function changeColorMode() {
  const color = document.getElementById('colormode')

  document.documentElement.setAttribute('data-bs-theme', color.value)

  await fetch('/profile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: color.id,
      value: color.value
    })
  })
}

// Change settings when checkbox state changes
const checkboxes = document.getElementsByClassName('realtime-checkbox')

const _checkboxesEvent = [...checkboxes].forEach((element) => {
  element.addEventListener('change', async function () {
    await fetch('/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: this.id,
        value: this.checked
      })
    })
  })
})

// Change IBAN settings when state changes
const iban = document.getElementById('realtime-iban')
const ibanEvents = ['paste', 'keyup']

ibanEvents.forEach(function (event) {
  iban.addEventListener(event, async function () {
    const sanitizedValue = this.value.replace(/\s/g, '')

    if (this.checkValidity()) {
      this.style.color = 'green'
      const status = document.getElementById('iban-status')
      status.style.color = 'green'
      status.classList.remove('fa-times-circle')
      status.classList.add('fa-check-circle')

      await fetch('/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: this.id,
          value: sanitizedValue
        })
      })
    } else {
      this.style.color = 'red'
      const status = document.getElementById('iban-status')
      status.style.color = 'red'
      status.classList.remove('fa-check-circle')
      status.classList.add('fa-times-circle')
    }
  })
})

window.onload = function (_event) {
  document.getElementById('colormode').value =
    document.documentElement.getAttribute('data-bs-theme')
}
