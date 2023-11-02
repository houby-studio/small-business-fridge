;[
  {
    $lookup: {
      as: 'deliveries',
      from: 'deliveries',
      foreignField: '_id',
      localField: 'deliveryId'
    }
  },
  {
    $lookup: {
      as: 'products',
      from: 'products',
      foreignField: '_id',
      localField: 'deliveries.productId'
    }
  },
  {
    $project: {
      order_date: 1,
      product: {
        $first: '$products.displayName'
      },
      price: {
        $first: '$deliveries.price'
      },
      created_on: {
        $first: '$deliveries.created_on'
      },
      amount_supplied: {
        $first: '$deliveries.amount_supplied'
      },
      amount_left: {
        $first: '$deliveries.amount_left'
      }
    }
  },
  {
    $group: {
      _id: {
        date: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$order_date'
          }
        },
        product: '$product'
      },
      count: {
        $sum: 1
      }
    }
  },
  {
    $project: {
      date: '$_id.date',
      product: '$_id.product',
      count: 1,
      _id: 0
    }
  }
]
