// Initialize DataTables
// dom customizes header paging, search and export
// columndefs makes id unsortable, sortabledate hidden, date linked for filtering and displays currency next to price
// sort by date by default
document.addEventListener("DOMContentLoaded", function () {
  $("#table-users").DataTable({
    dom:
      "<'row'<'col-sm-12 col-md-4'l><'col-sm-12 col-md-4'f><'col-sm-12 col-md-4'B>>" +
      "<'row'<'col-sm-12'tr>>" +
      "<'row'<'col-sm-12 col-md-5'i><'col-sm-12 col-md-7'p>>",
    buttons: [
      {
        extend: "print",
        exportOptions: {
          columns: [1, 2, 3, 4, 5, 6, 7, 8],
        },
      },
      "copyHtml5",
      "excelHtml5",
      "csvHtml5",
      {
        extend: "pdfHtml5",
        exportOptions: {
          columns: [1, 2, 3, 4, 5, 6, 7, 8],
        },
      },
    ],
    language: {
      url: "/datatables/cs.json",
      searchPlaceholder: "Hledaný výraz",
    },
    lengthMenu: [
      [10, 25, 50, -1],
      [10, 25, 50, "Vše"],
    ],
    order: [[0, "asc"]],
    stateSave: false,
  });
});
