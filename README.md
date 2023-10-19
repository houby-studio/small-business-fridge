# Small Business Fridge

[![contributions welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg?style=flat)](https://github.com/houby-studio/small-business-fridge/issues)
[![GitHub license](https://img.shields.io/github/license/Naereen/StrapDown.js.svg)](https://github.com/houby-studio/small-business-fridge/blob/master/LICENSE)

## 2023 UPDATE

This simple system is alive and kicking for 4 years already in our office! While imperfect, it has enabled us to share 4379 pieces of drinks and food in total cost of 76374 CZK as of today.  
We actually keep expanding to other colleagues, adding more products and features. That has obviously shown certain weak points of this system and for that very reason we have dusted off our javascript skills to get this system back on track!
You can expect fixes of many features, updating all dependencies, some most needed new features and who knows, maybe some magical ✨AI✨ add-ons?

## Disclaimer

This tool is exclusively made by us and used by us, but we have commited anyways to make it FOSS and configurable to allow others to use it if they want!  
There are however couple things that may need some customizations on your end, whether you fork it or open a pull request on this repository. The list of gotchas:

- Authentication is written for Microsoft Entra ID (Azure Active Directory)
- Application is in czech language and there is no internalization package currently
- Application has the minimum required features required for this model - no alternative methods for orders, payments, administration etc.

## Super simple e-shop for colleagues

**Small Business Fridge** offers simple, mostly intuitive e-shop which shows what products are available, how many and for how much.  
Customers can buy product with one simple click. The only other thing they have to do is to take the product and consume it. They also receive simple e-mail notification.  
This obviously comes with many other utilities such as:

 - page to display order history, total amount spent
 - page for supplier to add products to the stock
 - page for supplier to automatically create invoices (read QR code) for all customers and send it to their e-mail addresses
 - page to mark invoice as paid from both customer and supplier side
 - page for admin who can view all the standard pages across all the customers and suppliers
 - colorful graphs which are hopefully useful

*But what if I do not want to launch browser to buy product even though it is super easy?*  
No problem! You can either assign kiosk role to a user, which can be logged on a some thin client with browser next to a fridge, eventually with touch screen display to allow easy shopping right at the fridge,  
or there is API for anything you can and want to make! We have also worked and used for some time simple Arduino ESP32 device which may be found here [Small business fridge IoT keypad](https://github.com/houby-studio/small-business-fridge-keypad)

The whole system is running on Node.js with Express.js framework and stores data in MongoDB. We have made everything in our power to secure this application by using Azure passport allowing you to use your company ID to login and manage everything.  
It should be pretty lightweight, as we run it on a potato without any problems for around 20 users.

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

## License

### MIT

Copyright 2023 Jakub Šindelář

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Development

One way

- You can customize docker-compose.dev.example.yaml to develop with all required tools in containers
 - Not tested, we debug main application directly on our computer and use containers to run database and other dev tools

Second way

- Download and install NodeJS
- Install dependencies `npm install`
- Copy `defaults.env` as `.env` and configure variables
- Start server with `npm start` or run debug task in VSCode

For linux users, you may want to allow node to bind to system protected ports

`sudo setcap 'cap_net_bind_service=+ep' $(readlink -f $(which node))`
