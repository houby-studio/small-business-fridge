/*global bootstrap,$ */

// Initialize Bootstraps 5 tooltips and modal
const tooltipTriggerList = document.querySelectorAll(
  '[data-bs-toggle="tooltip"]'
)
// eslint-disable-next-line no-unused-vars
const tooltipList = [...tooltipTriggerList].map(
  (tooltipTriggerEl) => new bootstrap.Tooltip(tooltipTriggerEl)
)
const myModal = new bootstrap.Modal('#qr-modal')

// Initialize DataTables
document.addEventListener('DOMContentLoaded', function () {
  const table = $('#table-invoices').DataTable({
    dom:
      "<'row'<'col-sm-12 col-md-4'l><'col-sm-12 col-md-4'f><'col-sm-12 col-md-4'B>>" +
      "<'row'<'col-sm-12'tr>>" +
      "<'row'<'col-sm-12 col-md-5'i><'col-sm-12 col-md-7'p>>",
    columnDefs: [
      { sortable: false, targets: 0 },
      { visible: false, targets: 1 },
      { targets: 2, orderData: 1 },
      {
        type: 'num',
        targets: 4,
        data: 'Počet kusů',
        render: function (data, type) {
          return type === 'display' ? data + ' ks' : data
        }
      },
      {
        type: 'num',
        targets: 5,
        data: 'Cena',
        render: function (data, type) {
          return type === 'display' ? data + ' Kč' : data
        }
      }
    ],
    buttons: [
      {
        extend: 'print',
        exportOptions: {
          columns: [1, 3, 4, 5, 6]
        }
      },
      {
        extend: 'copyHtml5',
        exportOptions: {
          columns: [0, 1, 2, 3, 4, 5, 6]
        }
      },
      {
        extend: 'excelHtml5',
        exportOptions: {
          columns: [0, 1, 2, 3, 4, 5, 6]
        }
      },
      {
        extend: 'csvHtml5',
        exportOptions: {
          columns: [0, 1, 2, 3, 4, 5, 6]
        }
      },
      {
        extend: 'pdfHtml5',
        exportOptions: {
          columns: [1, 3, 4, 5, 6]
        }
      }
    ],
    language: {
      url: '/datatables/cs.json',
      searchPlaceholder: 'Hledaný výraz'
    },
    order: [[6, 'asc']],
    lengthMenu: [
      [10, 25, 50, -1],
      [10, 25, 50, 'Vše']
    ],
    stateSave: false
  })

  // If navigating from context aware link, search for specific item
  const paymentParam = new URLSearchParams(location.search).get(
    'confirmpayment'
  )
  if (paymentParam) table.search(paymentParam).draw()
})

// Display QR Code and handle modal display and button
// eslint-disable-next-line no-unused-vars
async function getQrCode(id, paid) {
  // Append url to current url
  let url = window.location.pathname + '/qrcode'
  // Obtain CSRF token
  const csrf = document.getElementsByName('_csrf')[0].value

  // Fetch QRCode data
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      invoice_id: id,
      _csrf: csrf
    })
  })
  const qrCode = await response.text()

  // Handle if supplier does not have IBAN
  if (qrCode === 'NOIBAN') {
    document.getElementById('qr_code').classList.add('d-none')
    document.getElementById('no_qr_code').classList.remove('d-none')
  } else {
    document.getElementById('qr_code').classList.remove('d-none')
    document.getElementById('no_qr_code').classList.add('d-none')
    document.getElementById('qr_code').src = qrCode
  }

  // Change button state depending on paid status
  const submit = document.getElementById('modal_confirm')
  if (!paid) {
    submit.dataset.submit_id = id
    submit.disabled = false
  } else {
    submit.disabled = true
  }

  myModal.show()
}

// Submit form from modal to confirm payment
// eslint-disable-next-line no-unused-vars
function submitFromModal(ctx) {
  document.getElementById(ctx.dataset.submit_id).submit()
}
