# Small Business Fridge

[![contributions welcome](https://img.shields.io/badge/contributions-welcome-brightgreen.svg?style=flat)](https://github.com/houby-studio/small-business-fridge/issues)
[![GitHub license](https://img.shields.io/github/license/Naereen/StrapDown.js.svg)](https://github.com/houby-studio/small-business-fridge/blob/master/LICENSE)

## 2023 UPDATE

This simple system is alive and kicking for 4 years already in our office! While imperfect, it has enabled us to share 4561 pieces of drinks and food in total cost of 79084 CZK in version 1.0.x.
Version 1.0.x has been in use from 2019-09-07 to 2023-11-02 and since 2023-11-03 we have deployed version 2.0.0 and hope to keep going strong.
Only time will tell, if everything is worknig as expected and whether we need to develop additional updates. Most likely we will.

## Disclaimer

This tool is exclusively made for our office, but we have commited to make it FOSS and hopefully configurable enough to allow others to use it if they want!
There are however couple things that may need some customizations on your end, whether you fork it or open a pull request on this repository. The list of known gotchas:

- Authentication is written for Microsoft Entra ID (Azure Active Directory) with Passport.js - You are more than welcome to securely replace it with general OAuth/OIDC library
- Application is in czech language and there is no internalization package currently - Again, if you are willing to provide translations, we will try to implement it
- Application has the minimum required features required for our use case, that is sharing foods and drinks with no profit, thus no legal compliance typically required for businesses

## Super simple e-shop for colleagues

> ⚠️ NEEDS UPDATING: Current text block is from version 1.0.x and does not reflect new features available in new versions

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

> ⚠️ NEEDS UPDATING: Current text block is from version 1.0.x and does not reflect new features available in new versions

Go checkout [Wiki](https://github.com/houby-studio/small-bussiness-fridge/wiki) for more detailed informations and getting started guides.

## Images

> ⚠️ NEEDS UPDATING: Current text block is from version 1.0.x and does not reflect new features available in new versions

### E-Shop

![Shop](https://raw.githubusercontent.com/wiki/houby-studio/small-bussiness-fridge/images/sbf_shop.png)

### Orders

![image2](https://raw.githubusercontent.com/wiki/houby-studio/small-bussiness-fridge/images/sbf_orders.png)

### Invoice

![image3](https://raw.githubusercontent.com/wiki/houby-studio/small-bussiness-fridge/images/sbf_invoice.png)

### Deliver

![image4](https://raw.githubusercontent.com/wiki/houby-studio/small-bussiness-fridge/images/sbf_deliver.png)

## Development

### General instructions

- To develop main application directly on host, you can follow instructions below for both Windows and Linux, or follow general instructions:
  - Download and install NodeJS
  - Install dependencies `npm install`
  - Copy `example-dev.env` as `.env` and configure variables
  - Copy `example.compose-dev.yaml` as `compose-dev.yaml` and configure variables
  - Start docker compose to start dependencies (at least mongoDB) `docker compose --file compose-dev.yaml up -d`
  - Start server with `npm start` or run debug task in VSCode
- As an alternative, you can potentially customize `docker-compose.dev.example.yaml` to develop with all required tools in containers - Not tested

To allow bind on port 443, Windows users need to launch IDE as administrator.
Linux users should be able to configure non-root usage by running `sudo setcap 'cap_net_bind_service=+ep' $(readlink -f $(which node))`

### Windows 11

Tested this setup 2023-10-27 with VSCode, Node.js 20 and Docker.
Main app is being run directly on host, mongo, mongo express and maildev in docker compose.

#### Installed software

- git
- nodejs lts 20
- docker desktop
- visual studio code

### Setup development environment on Windows

- Clone repo `git clone https://github.com/houby-studio/small-business-fridge.git`
- Launch VSCode as administrator (to be able to bind to port 443)
- Open folder small-business-fridge
- For VSCode extensions we recommend at least Prettier (Native formatter does not like handlebars)
- Install dependencies `npm install`
- Prepare other containers for dev `cp example.compose-dev.yaml compose-dev.yaml`
  - If you want to run main app in container as well, there is commented out section, which may be used with some tweaks
- Prepare dotenv variables `cp example-dev.env .env` and at least change following variables with your AAD registered App:
  - CREDS_IDENTITY_METADATA
  - CREDS_CLIENT_ID
  - CREDS_CLIENT_SECRET
- Start docker containers `docker compose --file compose-dev.yaml up -d`
- Hit F5 to start debugging
- Navigate to <https://localhost/> and login with your AAD account - since you have **NODE_ENV=development**, all new users will be admins and suppliers by default
- Add new products, deliveries, start buying, invoicing etc.
- Navigate to <http://localhost:8080> to view all **e-mails** being sent
- Navigate to <http://localhost:8081> with login admin:pass to view, edit, export and import data in database **sbf-dev**

### Manjaro / Linux

Tested this setup 2023-10-26 with VSCode, Node.js 18 and Docker.
Main app is being run directly on host, mongo, mongo express and maildev in docker compose.

#### Installed packages

- git
- nodejs-lts-hydrogen
- docker
- docker-compose
- yay
  - visual-studio-code-bin

### Setup development environment on Linux

- Clone repo `git clone https://github.com/houby-studio/small-business-fridge.git`
- Change into a directory and launch VSCode `cd small-business-fridge && code .`
- For VSCode extensions we recommend at least Prettier (Native formatter does not like handlebars)
- Install dependencies `npm install`
- Prepare other containers for dev `cp example.compose-dev.yaml compose-dev.yaml`
  - If you want to run main app in container as well, there is commented out section, which may be used with some tweaks
- Prepare dotenv variables `cp example-dev.env .env` and at least change following variables with your AAD registered App:
  - CREDS_IDENTITY_METADATA
  - CREDS_CLIENT_ID
  - CREDS_CLIENT_SECRET
- Allow node to bind to port 443 `sudo setcap 'cap_net_bind_service=+ep' $(readlink -f $(which node))`
- Start docker containers `docker compose --file compose-dev.yaml up -d`
- Hit F5 to start debugging
- Navigate to <https://localhost/> and login with your AAD account - since you have **NODE_ENV=development**, all new users will be admins and suppliers by default
- Add new products, deliveries, start buying, invoicing etc.
- Navigate to <http://localhost:8080> to view all **e-mails** being sent
- Navigate to <http://localhost:8081> with login admin:pass to view, edit, export and import data in database **sbf-dev**

## License

### MIT

Copyright 2023 Jakub Šindelář

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
