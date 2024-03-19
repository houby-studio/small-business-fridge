const myModal = new bootstrap.Modal("#confirm-modal");

// Change settings when checkbox state changes
const checkboxes = document.getElementsByClassName("realtime-checkbox");

const _checkboxesEvent = [...checkboxes].forEach((element) => {
  element.addEventListener("change", async function () {
    await fetch("/admin_users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user: this.dataset.user,
        name: this.dataset.property,
        value: this.checked,
        _csrf: document.getElementsByName("_csrf")[0].value,
      }),
    });
  });
});

// Change card when state changes
const cards = document.getElementsByClassName("realtime-card");
const cardEvents = ["paste", "keyup"];

[...cards].forEach((element) => {
  cardEvents.forEach(function (event) {
    element.addEventListener(event, async function () {
      const sanitizedValue = this.value.replace(/\s/g, "");

      if (this.checkValidity()) {
        this.style.color = "green";
        const response = await fetch("/admin_users", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user: this.dataset.user,
            name: this.dataset.property,
            value: sanitizedValue,
          }),
        });
        if (response.status !== 200) {
          this.style.color = "red";
        }
      } else {
        this.style.color = "red";
      }
    });
  });
});

// Display confirmation dialog
async function showConfirm(id) {
  const submit = document.getElementById("modal_confirm");
  submit.dataset.submit_id = "deactivate_" + id;
  myModal.show();
}

// Submit form from modal to confirm deactivation
function submitFromModal(ctx) {
  document.getElementById(ctx.dataset.submit_id).submit();
}

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
