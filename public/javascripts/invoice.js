// Initialize Bootstraps 5 tooltips
const tooltipTriggerList = document.querySelectorAll(
  '[data-bs-toggle="tooltip"]'
)
const tooltipList = [...tooltipTriggerList].map(
  (tooltipTriggerEl) => new bootstrap.Tooltip(tooltipTriggerEl)
)

var userClicks = false
var prodClicks = false

// User graph swapper - changes between 'Spent amount in Kč and bought amount'
document.getElementById('user-swap').addEventListener('click', (e) => {
  // Load required objects
  const userSpin = document.getElementById('user-spin')
  const userText = document.getElementById('user-text')

  // Spin button for 300ms
  userSpin.classList.add('spin')
  setTimeout(function () {
    userSpin.classList.remove('spin')
  }, 300)

  // Change text depending on state
  if (userClicks) {
    userText.textContent = 'Uživatelé - k fakturaci v Kč'

    perUserSpent.data.datasets[0].data = userDatasetPriceSpent
    perUserSpent.options.plugins.labels = {
      render: function (args) {
        return args.value + 'Kč'
      },
      fontColor: '#fff'
    }
    perUserSpent.update()
  } else {
    userText.textContent = 'Uživatelé - k fakturaci v ks'

    perUserSpent.data.datasets[0].data = userDatasetAmountBought
    perUserSpent.options.plugins.labels = {
      render: function (args) {
        return args.value + 'ks'
      },
      fontColor: '#fff'
    }
    perUserSpent.update()
  }
  userClicks = !userClicks
})

// User graph
var ctx = document.getElementById('perUserSpent').getContext('2d')
var perUserSpent = new Chart(ctx, {
  type: 'pie',
  data: {
    labels: userLabelUsernames,
    datasets: [
      {
        data: userDatasetPriceSpent,
        backgroundColor: userColorPalette
      }
    ]
  },
  options: {
    plugins: {
      legend: {
        display: false
      },
      labels: {
        render: function (args) {
          return args.value + 'Kč'
        },
        fontColor: '#fff'
      }
    }
  }
})

// Product graph swapper - changes between 'Spent amount in Kč and bought amount'
document.getElementById('prod-swap').addEventListener('click', (e) => {
  // Load required objects
  const prodSpin = document.getElementById('prod-spin')
  const prodText = document.getElementById('prod-text')

  // Spin button for 300ms
  prodSpin.classList.add('spin')
  setTimeout(function () {
    prodSpin.classList.remove('spin')
  }, 300)

  // Change text depending on state
  if (prodClicks) {
    prodText.textContent = 'Produkty - k fakturaci v Kč'

    perProductSpent.data.datasets[0].data = productDatasetPriceSpent
    perProductSpent.options.plugins.labels = {
      render: function (args) {
        return args.value + 'Kč'
      },
      fontColor: '#fff'
    }
    perProductSpent.update()
  } else {
    prodText.textContent = 'Produkty - k fakturaci v ks'

    perProductSpent.data.datasets[0].data = productDatasetAmountBought
    perProductSpent.options.plugins.labels = {
      render: function (args) {
        return args.value + 'ks'
      },
      fontColor: '#fff'
    }
    perProductSpent.update()
  }
  prodClicks = !prodClicks
})

// Product graph
var ctx = document.getElementById('perProductSpent').getContext('2d')
var perProductSpent = new Chart(ctx, {
  type: 'pie',
  data: {
    labels: productLabelUsernames,
    datasets: [
      {
        data: productDatasetPriceSpent,
        backgroundColor: productColorPalette
      }
    ]
  },
  options: {
    plugins: {
      legend: {
        display: false
      },
      labels: {
        render: function (args) {
          return args.value + 'Kč'
        },
        fontColor: '#fff'
      }
    }
  }
})

// Initialize DataTables and conditionally disable invoice button
document.addEventListener('DOMContentLoaded', function () {
  $('#table-orders').DataTable({
    dom:
      "<'row'<'col-sm-12 col-md-4'l><'col-sm-12 col-md-4'f><'col-sm-12 col-md-4'B>>" +
      "<'row'<'col-sm-12'tr>>" +
      "<'row'<'col-sm-12 col-md-5'i><'col-sm-12 col-md-7'p>>",
    columnDefs: [{ type: 'natural', targets: 3 }],
    language: {
      url: '/datatables/cs.json',
      searchPlaceholder: 'Hledaný výraz'
    },
    fixedHeader: true,
    order: [[0, 'desc']],
    lengthMenu: [
      [10, 25, 50, -1],
      [10, 25, 50, 'Vše']
    ],
    stateSave: false
  })

  // If no items to invoice, disable button
  const someIsNotZero = perUserSpent.data.datasets[0].data.some(
    (item) => item !== 0
  )
  if (!someIsNotZero) {
    document.getElementById('invoice_submit').disabled = true
  }
})
