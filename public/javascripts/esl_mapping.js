/*global bootstrap, $, json_data*/

const unlinkModal = new bootstrap.Modal('#unlink-modal')
const linkModal = new bootstrap.Modal('#link-modal')

// Display dialog to unlink product from label
// eslint-disable-next-line no-unused-vars
async function showUnlinkConfirm(id) {
  const submit = document.getElementById('modal_unlink')
  submit.dataset.submit_id = 'unlink_' + id
  unlinkModal.show()
}

// Display dialog to link product to label
// eslint-disable-next-line no-unused-vars
async function showLinkConfirm(id) {
  const submit = document.getElementById('modal_link')
  submit.dataset.submit_id = 'link_' + id
  submit.dataset.product_id = 'product_id_' + id
  linkModal.show()
}

// Submit form from modal to confirm product unlink from label
// eslint-disable-next-line no-unused-vars
function submitUnlinkFromModal(ctx) {
  document.getElementById(ctx.dataset.submit_id).submit()
}

// Submit form from modal to confirm product link to label
// eslint-disable-next-line no-unused-vars
function submitLinkFromModal(ctx) {
  console.log(document.getElementById(ctx.dataset.product_id))
  console.log(document.getElementById('product_id').value)

  document.getElementById(ctx.dataset.product_id).value =
    document.getElementById('product_id').value

  document.getElementById(ctx.dataset.submit_id).submit()
}

function loadProductInfo() {
  var productId = document.getElementById('product_id').value
  var productStockId = document.getElementById('product_stock')
  var productPriceId = document.getElementById('product_price')
  var newImg = new Image()
  newImg.onload = function () {
    document.getElementById('product_img').src = this.src
  }
  if (productId === '') {
    newImg.src = '/static_images/preview.png'
  } else {
    newImg.src = json_data[productId].product_image
  }

  if (productStockId === '') {
    productStockId.value = null
  } else {
    productStockId.value = json_data[productId].product_stock
  }

  if (productPriceId === '') {
    productPriceId.value = null
  } else {
    productPriceId.value = json_data[productId].product_price
  }
}

document.addEventListener('DOMContentLoaded', function () {
  if (document.getElementById('product_id').value) {
    loadProductInfo()
  }
})

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
