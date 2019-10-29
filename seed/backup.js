var backup = require('mongodb-backup');
var config = require('../config/config.js'); // configuration file

backup({
    uri: 'mongodb://lednice-app:yBfpXtGpOkcJ00MT@mountfield-lednice-aiypp.azure.mongodb.net/lednice', // mongodb://<dbuser>:<dbpassword>@<dbdomain>.mongolab.com:<dbport>/<dbdatabase>
    root: "backup", // write files into this dir
    callback: function(err) {
        if (err) {
            console.error(err);
        } else {
            console.log('finish');
        }
    }
});