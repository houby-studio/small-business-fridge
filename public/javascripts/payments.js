// Initialize Bootstraps 5 tooltips
const tooltipTriggerList = document.querySelectorAll(
  '[data-bs-toggle="tooltip"]'
)
const tooltipList = [...tooltipTriggerList].map(
  (tooltipTriggerEl) => new bootstrap.Tooltip(tooltipTriggerEl)
)

// Bootstrap table customization
$(document).ready(function () {
  $('#table-invoices').DataTable({
    columnDefs: [{ type: 'natural', targets: [2, 3] }],
    language: {
      url: '/datatables/cs.json',
      searchPlaceholder: 'Hledaný výraz'
    },
    order: [[4, 'asc']],
    lengthMenu: [
      [10, 25, 50, -1],
      [10, 25, 50, 'Vše']
    ],
    stateSave: true
  })
})
