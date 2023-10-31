const bsAlert = new bootstrap.Alert('#alert')

document.addEventListener('DOMContentLoaded', function () {
  window.setTimeout(function () {
    if (bsAlert._element) {
      bsAlert.close()
    }
  }, 5000)
})
