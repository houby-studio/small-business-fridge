// If nothing to invoice, replace non-existing or useless graph with text
Chart.plugins.register({
	afterDraw: function(chart) {
        const someIsNotZero = chart.data.datasets[0].data.some(item => item !== 0);
        const isAllZero = !someIsNotZero;
        if (isAllZero) {
            // No data is present
            var ctx = chart.chart.ctx;
            var width = chart.chart.width;
            var height = chart.chart.height
            chart.clear();
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Žádné produkty k fakturaci', width / 2, height / 2);
            ctx.restore();
        }
    }
});

// User graph swapper - changes between 'Spent amount in Kč and bought amount'
$('#user-swap').click(function() {
    var clicks = $(this).data('clicks');
    $('#user-spin').addClass('spin');
	setTimeout(function () { 
        $('#user-spin').removeClass('spin');
    }, 300);
    if (clicks) {
        $("#user-text").html('Uživatelé - k fakturaci v Kč');
        perUserSpent.data.datasets[0].data = userDatasetPriceSpent;
        perUserSpent.options.plugins.labels = {
            render: function (args) {
                return args.value + 'Kč';
            },
            fontColor: '#fff',
        };
        perUserSpent.update();
    } else {
        $("#user-text").html('Uživatelé - k fakturaci v ks');
        perUserSpent.data.datasets[0].data = userDatasetAmountBought;
        perUserSpent.options.plugins.labels = {
            render: function (args) {
                return args.value + 'ks';
            },
            fontColor: '#fff',
        };
        perUserSpent.update();
    }
    $(this).data("clicks", !clicks);
});

// User graph
var ctx = document.getElementById('perUserSpent').getContext('2d');
var perUserSpent = new Chart(ctx, {
    type: 'pie',
    data: {
        labels: userLabelUsernames,
        datasets: [{
            data: userDatasetPriceSpent,
            backgroundColor: userColorPalette,
        }]
    },
    options: {
        legend: {
            display: true,
        },
        plugins: {
            labels: {
                render: function (args) {
                  return args.value + 'Kč';
                },
                fontColor: '#fff',
            }
        }
    }
});

// Product graph swapper - changes between 'Spent amount in Kč and bought amount'
$('#prod-swap').click(function() {
    var clicks = $(this).data('clicks');
    $('#prod-spin').addClass('spin');
	setTimeout(function () { 
        $('#prod-spin').removeClass('spin');
    }, 300);
    if (clicks) {
        $("#prod-text").html('Produkty - k fakturaci v Kč');
        perProductSpent.data.datasets[0].data = productDatasetPriceSpent;
        perProductSpent.options.plugins.labels = {
            render: function (args) {
                return args.value + 'Kč';
            },
            fontColor: '#fff',
        };
        perProductSpent.update();
    } else {
        $("#prod-text").html('Produkty - k fakturaci v ks');
        perProductSpent.data.datasets[0].data = productDatasetAmountBought;
        perProductSpent.options.plugins.labels = {
            render: function (args) {
                return args.value + 'ks';
            },
            fontColor: '#fff',
        };
        perProductSpent.update();
    }
    $(this).data("clicks", !clicks);
});

// Product graph
var ctx = document.getElementById('perProductSpent').getContext('2d');
if (productDatasetAmountBought == 0) {
    console.log(productDatasetAmountBought);
}
var perProductSpent = new Chart(ctx, {
    type: 'pie',
    data: {
        labels: productLabelUsernames,
        datasets: [{
            data: productDatasetPriceSpent,
            backgroundColor: productColorPalette,
        }]
    },
    options: {
        legend: {
            display: true,
        },
        plugins: {
            labels: {
                render: function (args) {
                  return args.value + 'Kč';
                },
                fontColor: '#fff',
            }
        }
    }
});

// Bootstrap tooltip on hover
$(function () {
    $('[data-toggle="tooltip"]').tooltip()
})

// Bootstrap table customization
$(document).ready(function () {
    $('#table-orders').DataTable({
        language: {
            "url": "//cdn.datatables.net/plug-ins/1.10.19/i18n/Czech.json"
        },
        fixedHeader: true,
        lengthMenu: [[10, 25, 50, -1], [10, 25, 50, "Vše"]],
        columnDefs: [
            { "orderData":[ 4 ],   "targets": [ 0 ] },
            {
                "targets": [ 4 ],
                "visible": false,
                "searchable": true
            }
        ],
        //order: true,
        //scrollY: '60vh',
        //scrollCollapse: true,
        //stateSave: true
    });
    $('.dataTables_length').addClass('bs-select');
});