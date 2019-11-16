# Small Business Fridge

[![HitCount](http://hits.dwyl.io/houby-studio/small-business-fridge.svg)](http://hits.dwyl.io/houby-studio/small-business-fridge)
[![Known Vulnerabilities](https://snyk.io/test/github/houby-studio/small-business-fridge/badge.svg?style=flat-square)](https://snyk.io/test/github/houby-studio/small-business-fridge)

## Super simple e-shop for colleagues

*Ever had some nice colleague, who delivers refreshments to your office and allows you to buy it without any profit?*  
Yes? Awesome!  
*Do you always carry enough change to pay it outright?*  
No?  
*Do you write it down on a paper and pay it off later?*  
Maybe? That's nice, but..  
*How often do you forget to write it down?*  
*How often does the paper get lost?*  
*How often do you want to know how much you spent and when?*  
*How often does your colleague AKA supplier wonder how much stuff is left and how much money did he put into it?*  
*How often do you dream about seeing all those data in wonderful tables and graphs?*  
**I made an answer for all those questions!**

**Small Business Fridge** is project which aims exactly on solving this common situation. It offers simple, mostly intuitive e-shop which shows what products are available, how many and for how much.  
Customers can buy product with one simple click. The only other thing they have to do is to take the product and consume it. They also receive nice e-mail notification.  
This obviously comes with many other utilities such as:

 - page to display order history, total amounts spent
 - page for supplier to add products to the stock
 - page for supplier to automatically create invoices for all customers and send it to their e-mail addresses
 - page to mark invoice as paid from both customer and supplier side
 - page for admin who can view all the standard pages across all the customers and suppliers
 - colorful graphs which are hopefully useful

*But what if I do not want to launch browser to buy product even though it is super easy?*  
No problem! There is actually API for simple IoT device which is placed directly on the fridge, which allows customers to press some buttons and voilà, they just bought your favorite refreshment!  
The simple IoT device is Arduino based project which will be placed on GitHub also very soon.

The whole system is running on Node.js with Express.js framework and stores data in MongoDB. It is also strongly secured (I believe) by using Azure passport allowing you to use your company ID to login and manage everything. Also it should be pretty lightweight, as we run it on a potato without any problems.

## Want to know more?

Go checkout [Wiki](https://github.com/houby-studio/small-bussiness-fridge/wiki) for more detailed informations and getting started guides.

## Images

### E-Shop
![Shop](https://raw.githubusercontent.com/wiki/houby-studio/small-bussiness-fridge/images/sbf_shop.png)  
### Orders
![image2](https://raw.githubusercontent.com/wiki/houby-studio/small-bussiness-fridge/images/sbf_orders.png)  
### Invoice
![image3](https://raw.githubusercontent.com/wiki/houby-studio/small-bussiness-fridge/images/sbf_invoice.png)  
### Deliver
![image4](https://raw.githubusercontent.com/wiki/houby-studio/small-bussiness-fridge/images/sbf_deliver.png)  

## Changelog

2019-10-10 - v1.0 - Released first full version which offers basic functionality and is pretty much usable. Some operations like changing user roles (admin or supplier) or adding new product types require direct database access as it doesn't currently have any form on website to handle it.

## License

### MIT

Copyright 2019 Jakub Šindelář

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
