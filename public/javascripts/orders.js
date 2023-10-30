// Initialize DataTables
// dom customizes header paging, search and export
// columndefs makes id unsortable, sortabledate hidden, date linked for filtering and displays currency next to price
// sort by date by default
$(document).ready(function () {
  $('#table-orders').DataTable({
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
          columns: [1, 3, 4, 5]
        }
      },
      'copyHtml5',
      'excelHtml5',
      'csvHtml5',
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
    lengthMenu: [
      [10, 25, 50, -1],
      [10, 25, 50, 'Vše']
    ],
    order: [[2, 'desc']],
    stateSave: false
  })
})
