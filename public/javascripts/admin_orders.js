/*global bootstrap*/

const myModal = new bootstrap.Modal('#confirm-modal')

// Display confirmation dialog
// eslint-disable-next-line no-unused-vars
async function showConfirm(id) {
  const submit = document.getElementById('modal_confirm')
  submit.dataset.submit_id = 'storno_' + id
  myModal.show()
}

// Submit form from modal to confirm order storno
// eslint-disable-next-line no-unused-vars
function submitFromModal(ctx) {
  document.getElementById(ctx.dataset.submit_id).submit()
}
