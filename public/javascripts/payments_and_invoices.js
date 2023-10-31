// Initialize Bootstraps 5 tooltips
const tooltipTriggerList = document.querySelectorAll(
  '[data-bs-toggle="tooltip"]'
)
const tooltipList = [...tooltipTriggerList].map(
  (tooltipTriggerEl) => new bootstrap.Tooltip(tooltipTriggerEl)
)

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
        render: function (data, type, _row, _meta) {
          return type === 'display' ? data + ' ks' : data
        }
      },
      {
        type: 'num',
        targets: 5,
        data: 'Cena',
        render: function (data, type, _row, _meta) {
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
