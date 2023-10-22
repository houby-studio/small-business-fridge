# Changelog

## ✨ Novinky

- 📅 Rok 2023 - Lednice byla po 4 letech téměř bezproblémového fungování aktualizována na nejnovější verze knihoven a získala tak mimo jiné i trochu jiný vzhled
- 🔭 Kdo dělá co - Lednice dostala do všech svých částí moc krásné logování a tudíž budoucí chyby půjde lépe dohledávat a odstraňovat
- ⏱️ David Kahoun - Kolikrát se Vám stalo, že jste přišli ke kiosku, kde byl přihlášený roztržitý kolega? S novou funkcí časomíry se tato šance značně snižuje! Pro zadání Vašeho ID máte minutu a pro výběr a zakoupení produktu rovnou minuty tři, pak dojde k návratu na úvodní obrazovku bez zadaného ID
- 🤩 Lepší tabulky - Objednávky, Faktury a Platby mají nově chytré výchozí řazení, takže to nejdůležitější vidíte jako první! Řádky zaplacených faktur jsou upozaděny, protože je obvykle není třeba řešit
- 😕 Počty sedí - Kiosek již zobrazuje celkový počet zboží, nikoli pouze aktuální dodávku
- 🔢 Všude stejné - Na e-shopu i na kiosku se zboží nyní řadí stejně a to abecedně
- 🖼️ Bez obrázku to nejde - Nyní již není možné přidat produkt bez vlastního obrázku
- 🔐 Nepoužívám, vypínám - Pokud není nastavený API klíč, je funkce API úplně vypnutá
- 🌐 Nemít internet - Všechny závislosti již nejsou přes CDN, ale jsou součástí kódu aplikace
- 📲 Skutečně responzivní - Nyní kromě zobrazení 1 nebo 4 produktů může v závislosti na velikosti obrazovky být zobrazeno i 2 nebo 6 produktů v řadě
- 🖨️ Export dat - Data v tabulkách nyní nabízí možnosti exportu do různých formátů a tisku
- TODO: favorites
- TODO: filter categories

## 🐞 Opravy chyb

- 📊 Příliš mnoho produktů - Odstraněna chyba, která dodavatelům znemožňovala fakturovat, pokud jejich portfolio obsahovalo více než 65 produktů nebo 65 zákazníků
- 📩 Kdo monitoruje funkci na monitorování - Přestože Lednice obsahovala určité mechanismy, které v případě problému měly odeslat e-mail správci systému, tak bohužel chyba v této funkci způsobila, že nikdy žádný takový e-mail nebyl odeslán
- 🥱 Trochu pomalá Lednice - Změna uživatelských preferencí již nebude způsobovat zamrznutí aplikace
- 📦 Naskladnění - Při zrušení výběru produktu se nyní správně vrátí obrázek na náhled
