const bsAlert = new bootstrap.Alert('#alert')

window.setTimeout(function () {
  if (bsAlert._element) {
    bsAlert.close()
  }
}, 5000)
