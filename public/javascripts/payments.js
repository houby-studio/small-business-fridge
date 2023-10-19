// Bootstrap table customization
$(document).ready(function () {
  $('#table-invoices').DataTable({
    columnDefs: [{ type: 'natural', targets: [2, 3] }],
    language: {
      url: '//cdn.datatables.net/plug-ins/1.10.19/i18n/Czech.json',
      searchPlaceholder: 'Hledaný výraz'
    },
    order: [[4, 'asc']],
    lengthMenu: [
      [10, 25, 50, -1],
      [10, 25, 50, 'Vše']
    ],
    stateSave: true
  })
  $('.dataTables_length').addClass('bs-select')
})
