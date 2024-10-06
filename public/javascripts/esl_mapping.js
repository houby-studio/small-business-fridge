/*global bootstrap, $*/

const myModal = new bootstrap.Modal('#confirm-modal')

// Change settings when checkbox state changes
const checkboxes = document.getElementsByClassName('realtime-checkbox')

// eslint-disable-next-line no-unused-vars
const _checkboxesEvent = [...checkboxes].forEach((element) => {
  element.addEventListener('change', async function () {
    await fetch('/admin_users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        user: this.dataset.user,
        name: this.dataset.property,
        value: this.checked,
        _csrf: document.getElementsByName('_csrf')[0].value
      })
    })
  })
})

// Display confirmation dialog
// eslint-disable-next-line no-unused-vars
async function showUnlinkConfirm(id) {
  const submit = document.getElementById('modal_confirm')
  submit.dataset.submit_id = 'unlink_' + id
  myModal.show()
}

// Submit form from modal to confirm deactivation
// eslint-disable-next-line no-unused-vars
function submitFromModal(ctx) {
  document.getElementById(ctx.dataset.submit_id).submit()
}

// Initialize DataTables
// dom customizes header paging, search and export
// columndefs makes id unsortable, sortabledate hidden, date linked for filtering and displays currency next to price
// sort by date by default
document.addEventListener('DOMContentLoaded', function () {
  $('#table-labels').DataTable({
    dom:
      "<'row'<'col-sm-12 col-md-4'l><'col-sm-12 col-md-4'f><'col-sm-12 col-md-4'B>>" +
      "<'row'<'col-sm-12'tr>>" +
      "<'row'<'col-sm-12 col-md-5'i><'col-sm-12 col-md-7'p>>",
    buttons: [
      {
        extend: 'print',
        exportOptions: {
          columns: [0, 1, 5, 7]
        }
      },
      'copyHtml5',
      'excelHtml5',
      'csvHtml5',
      {
        extend: 'pdfHtml5',
        exportOptions: {
          columns: [0, 1, 5, 7]
        }
      }
    ],
    language: {
      url: '/datatables/cs.json',
      searchPlaceholder: 'Hledaný výraz'
    },
    lengthMenu: [
      [10, 25, 50, -1],
      [10, 25, 50, 'Vše']
    ],
    order: [[0, 'asc']],
    stateSave: false
  })
})
