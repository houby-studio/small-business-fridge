var Product = require('../models/product');
var config = require('../config/config');
var mongoose = require('mongoose');

mongoose.connect(config.config.db.connstr, {
	useNewUrlParser: true
});

var products = [
	new Product({
		keypadId: 1,
		uniqueName: 'monster_zero',
		displayName: 'Monster Zero',
		description: 'Nula cukru, nula chuti.',
		imagePath: './images/monster_zero.png',
	}),
	new Product({
		keypadId: 2,
		uniqueName: 'monster_hamilton',
		displayName: 'Monster Hamilton',
		description: 'Býval jednička, ale doktor jej nahradil.',
		imagePath: './images/monster_hamilton.png',
	}),
	new Product({
		keypadId: 3,
		uniqueName: 'monster_rossi',
		displayName: 'Monster Rossi',
		description: 'S Valentinem, nebo-li „The Doctor®“, jsme vytvořili tým, který stvořil náš nejrychlejší Monster v historii. Díky své lehké, intenzivní, osvěžující citrusové příchutě a plné dávce naší legendátní směsi Monster Energy váís dostaneme zpátky do nejvyšší rychlosti!.',
		imagePath: './images/monster_rossi.png',
	}),
	new Product({
		keypadId: 4,
		uniqueName: 'monster_energy',
		displayName: 'Monster Energy',
		description: 'Otevři si plechovku toho nejkrutějšího energetického nápoje na planetě, MONSTER energy.',
		imagePath: './images/monster_energy.png',
	}),
	new Product({
		keypadId: 5,
		uniqueName: 'bigshock_zero',
		displayName: 'BigShock Zero',
		imagePath: './images/bigshock_zero.png',
		description: 'Podávejte vychlazené.',
	}),
	new Product({
		keypadId: 6,
		uniqueName: 'birell_fruit',
		displayName: 'Birell Fruit',
		imagePath: './images/birell_fruit.png',
		description: 'Ovocná příchuť!',
	}),
	new Product({
		keypadId: 7,
		uniqueName: 'coca-cola',
		displayName: 'Coca-Cola plech',
		imagePath: './images/coca-cola.png',
		description: 'Coca-Cola je nejoblíbenějším a nejprodávanějším nealkoholickým nápojem v dějinách a zároveň nejznámější značkou světa.',
	}),
	new Product({
		keypadId: 8,
		uniqueName: 'rockstar_twister_wacked',
		displayName: 'Rockstar Twister Wacked',
		imagePath: './images/rockstar_twister_wacked.png',
		description: 'Pokud čekáš pořádnou dávku energie a kofeinu v neobvyklých příchutích, Rockstar Twister je tou pravou volbou!',
	})

];

var done = 0;
for (var i = 0; i < products.length; i++) {
	products[i].save(function (err, result) {
		done++;
		if (done === products.length) {
			exit();
		}
	});
}

function exit() {
	mongoose.disconnect();
}