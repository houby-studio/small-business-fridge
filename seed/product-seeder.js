var Product = require('../models/product');
var config = require('../config/config');

var mongoose = require('mongoose');

mongoose.connect(config.db.connstr,{ useNewUrlParser: true });

var products = [
    new Product({
		keypadId: 1,
		uniqueName: 'monster_absolute_zero',
		displayName: 'Monster Zero',
		description: 'Nula cukru, nula chuti.',
		imagePath: 'images/01_monster_zero.png',
        price: 26
    }),
    new Product({
        keypadId: 2,
		uniqueName: 'monster_hamilton',
		displayName: 'Monster Hamilton',
		description: 'Býval jednička, ale doktor jej nahradil.',
		imagePath: 'images/02_monster_hamilton.png',
        price: 25
    }),
    new Product({
        keypadId: 3,
		uniqueName: 'monster_rossi',
		displayName: 'Monster Rossi',
		description: 'S Valentinem, nebo-li „The Doctor®“, jsme vytvořili tým, který stvořil náš nejrychlejší Monster v historii. Díky své lehké, intenzivní, osvěžující citrusové příchutě a plné dávce naší legendátní směsi Monster Energy váís dostaneme zpátky do nejvyšší rychlosti!.',
		imagePath: 'images/03_monster_rossi.png',
        price: 25
    }),
    new Product({
        keypadId: 4,
		uniqueName: 'monster_energy',
		displayName: 'Monster',
		description: 'Otevři si plechovku toho nejkrutějšího energetického nápoje na planetě, MONSTER energy.',
		imagePath: 'images/04_monster_energy.png',
        price: 25
    }),
	new Product({
		keypadId: 5,
		uniqueName: 'bigshock_zero',
		displayName: 'BigShock Zero',
        imagePath: 'images/05_bigshock_zero.png',
        description: 'Podávejte vychlazené.',
        price: 24
	}),
	new Product({
		keypadId: 6,
		uniqueName: 'birell_fruit',
		displayName: 'Birell Fruit',
        imagePath: 'images/06_birell_fruit.png',
        description: 'Ovocná příchuť!',
        price: 16
	})
];

var done = 0;
for (var i = 0; i < products.length; i++) {
    products[i].save(function(err, result) {
        done++;
        if (done === products.length) {
            exit();
        }
    });
}

function exit() {
    mongoose.disconnect();
}