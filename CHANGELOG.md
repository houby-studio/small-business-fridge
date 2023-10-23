# Changelog

## ✨ Novinky

- 📅 Rok 2023 - Lednice byla po 4 letech téměř bezproblémového fungování aktualizována na nejnovější verze knihoven a získala tak mimo jiné i trochu jiný vzhled
- 🔭 Kdo dělá co - Lednice dostala do všech svých částí moc krásné logování a tudíž budoucí chyby půjde lépe dohledávat a odstraňovat
- ⏱️ David Kahoun - Kolikrát se Vám stalo, že jste přišli ke kiosku, kde byl přihlášený roztržitý kolega? S novou funkcí časomíry se tato šance značně snižuje! Pro zadání Vašeho ID máte minutu a pro výběr a zakoupení produktu rovnou minuty tři, pak dojde k návratu na úvodní obrazovku bez zadaného ID
- 🤩 Lepší tabulky - Objednávky, Faktury a Platby mají nově chytré výchozí řazení, takže to nejdůležitější vidíte jako první! Řádky zaplacených faktur jsou upozaděny, protože je obvykle není třeba řešit
- 🖨️ Export dat - Data v tabulkách nyní nabízí možnosti exportu do různých formátů a tisku
- 🟰 Počty sedí - Kiosek již zobrazuje celkový počet zboží, nikoli pouze aktuální dodávku
- 🔢 Všude stejné - Na e-shopu i na kiosku se zboží nyní řadí stejně a to abecedně
- 🖼️ Bez obrázku to nejde - Nyní již není možné přidat produkt bez vlastního obrázku
- 🔐 Nepoužívám, vypínám - Pokud není nastavený API klíč, je funkce API úplně vypnutá
- 🌐 Nemít internet - Všechny závislosti již nejsou přes CDN, ale jsou součástí kódu aplikace
- 🍔 Předělaná navigace - Prvky, které se skrývaly pod tlačítkem uživatele jsou nyní klasicky v horní navigaci, zatímco stránky o aplikaci a seznam změn je naopak dole a to pouze na hlavní stránce
- 📲 Skutečně responzivní (v mezích Bootstrapu) - Nyní kromě zobrazení 1 nebo 4 produktů může v závislosti na velikosti obrazovky být zobrazeno i 2 nebo 6 produktů v řadě
- ✏️ Úpravy - Je to neuvěřitelné, ale nyní již lze upravit vlastnosti produktu přímo z aplikace a není potřeba zasahovat do databáze
- ❓ Automatické ID - Dodavatele jistě potěší, že již nemusí vymýšlet ID produktu pro API z hlavy, ale systém jej automaticky vytvoří za ně
- 🔐 Lepší role - Práva na vytvoření produktu již má i dodavatel, nikoliv pouze administrátor
- 🤖 Sbohem útočníci - Všechny funkce, které zapisují do databáze jsou nyní rate limited, aby se zvýšila ochrana proti útokům typu DDoS
- TODO: favorites
- TODO: filter categories

## 🐞 Opravy chyb

- 📊 Příliš mnoho produktů - Odstraněna chyba, která dodavatelům znemožňovala fakturovat, pokud jejich portfolio obsahovalo více než 65 produktů nebo 65 zákazníků
- 📩 Kdo monitoruje funkci na monitorování - Přestože Lednice obsahovala určité mechanismy, které v případě problému měly odeslat e-mail správci systému, tak bohužel chyba v této funkci způsobila, že nikdy žádný takový e-mail nebyl odeslán
- 🥱 Trochu pomalá Lednice - Změna uživatelských preferencí již nebude způsobovat zamrznutí aplikace
- 📦 Naskladnění - Při zrušení výběru produktu se nyní správně vrátí obrázek na náhled
- 🤷 Chybami se člověk učí - Odstraněno velké množství duplicitních či zbytečných přepočtů dat (a stále spousta zbývá), takže některé požadavky jsou citelně rychlejší
- TODO: odstraněním uživatele/dodavatele přijde zákazník o možnost zobrazení historie objednávek
