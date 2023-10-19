// Bootstrap table customization
$(document).ready(function () {
  $('#table-orders').DataTable({
    columnDefs: [{ type: 'natural', targets: 2 }],
    language: {
      url: '//cdn.datatables.net/plug-ins/1.13.6/i18n/cs.json',
      searchPlaceholder: 'Hledaný výraz'
    },
    lengthMenu: [
      [10, 25, 50, -1],
      [10, 25, 50, 'Vše']
    ],
    order: [[0, 'desc']],
    stateSave: true
  })
  $('.dataTables_length').addClass('bs-select')
})
