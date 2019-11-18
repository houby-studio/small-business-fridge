// Bootstrap table customization
$(document).ready(function () {
  $('#table-orders').DataTable({
    language: {
      url: '//cdn.datatables.net/plug-ins/1.10.19/i18n/Czech.json'
    },
    lengthMenu: [
      [10, 25, 50, -1],
      [10, 25, 50, 'Vše']
    ],
    stateSave: true
  })
  $('.dataTables_length').addClass('bs-select')
})
