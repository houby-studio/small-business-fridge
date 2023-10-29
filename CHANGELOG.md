# Changelog

## ✨ Novinky

- 📅 Rok 2023 - Lednice byla po 4 letech téměř bezproblémového fungování aktualizována na nejnovější verze knihoven a získala tak mimo jiné i trochu jiný vzhled - v profilu naleznete možnosti, pomocí kterých lze vzhled ještě více ladit podle nálady alternativními tématy a přepínáním na světlý režim
- 🏷️ Mnoho produktů - Jelikož se sortiment neustále rozšířuje, jsou nově řazeny do kategorií, podle kterých lze rychle filtrovat
- 📲 Skutečně responzivní (v mezích Bootstrapu) - Nyní kromě zobrazení 1 nebo 4 produktů může v závislosti na velikosti obrazovky být zobrazeno i 2 nebo 6 produktů v řadě
- ⭐ Jan Kříž - Při nakupování přes e-shop můžete zařadit konkrétní produkty mezi své oblíbené a tím je vidět vždy vpředu jak na e-shopu, tak na kiosku - věrní odběratelé stále stejných produktů to nikdy neměli snazší
- 🍔 Předělaná navigace - Prvky, které se skrývaly pod tlačítkem uživatele jsou nyní klasicky v horní navigaci
- ✉️ Hezčí e-maily - Všechny e-maily se nyní generují pomocí šablon a mají tak trochu komplexnější vzhled a uspořádání obsahu
- 🔢 Všude stejné - Na e-shopu i na kiosku se zboží nyní řadí stejně a to abecedně
- 🟰 Počty sedí - Kiosek již zobrazuje celkový počet zboží, nikoli pouze aktuální dodávku
- 🤑 Štěpán Kruťa - Všichni víme kde pracujeme a jak se chováme k fakturám, ale i tak nově neplatičům faktur nyní bude pravidelně chodit automatická upomínka každý den, abychom doufejme zkrátili dobu, po kterou jsou chudáci dodavatelé bez svých peněz
- 🖨️ Export dat - Data v tabulkách nyní nabízí možnosti exportu do různých formátů a tisku
- 🤩 Lepší tabulky - Objednávky, Faktury a Platby mají nově chytré výchozí řazení, takže to nejdůležitější vidíte jako první! Řádky zaplacených faktur jsou upozaděny, protože je obvykle není třeba řešit
- ⏱️ David Kahoun - Kolikrát se Vám stalo, že jste přišli ke kiosku, kde byl přihlášený roztržitý kolega? S novou funkcí časomíry se tato šance značně snižuje! Pro zadání Vašeho ID máte minutu a pro výběr a zakoupení produktu rovnou minuty tři, pak dojde k návratu na úvodní obrazovku bez zadaného ID
- ✏️ Úpravy - Je to neuvěřitelné, ale nyní již lze upravit vlastnosti produktu přímo z aplikace a není potřeba zasahovat do databáze
- ❓ Automatické ID - Dodavatele jistě potěší, že již nemusí vymýšlet ID produktu pro API z hlavy, ale systém jej automaticky vytvoří za ně
- 🔐 Lepší role - Práva na vytvoření produktu již má i dodavatel, nikoliv pouze administrátor
- 🖼️ Bez obrázku to nejde - Nyní již není možné přidat produkt bez vlastního obrázku
- 🔭 Kdo dělá co - Lednice dostala do všech svých částí moc krásné logování a tudíž budoucí chyby půjde lépe dohledávat a odstraňovat
- 🔐 Nepoužívám, vypínám - Pokud není nastavený API klíč, je funkce API úplně vypnutá
- 🌐 Nemít internet - Všechny knihovny již nejsou načítány přes cizí CDN, ale jsou součástí kódu aplikace
- 🤖 Sbohem útočníci - Všechny funkce, které zapisují do databáze jsou nyní rate limited, aby se zvýšila ochrana proti útokům typu DDoS
- 📏 Dlouhé popisy - Aby se předešlo deformaci zobrazení, když má nějaký produkt nadprůměrně dlouhý popis, zobrazuje se nově pouze jeden řádek, dokud se na něj nenajede myší, následně dojde k jeho rozbalení
- 💀 Ozvěna minulosti - Ve všech vlastních skriptech byl jQuery nahrazen nativním javascriptem, takže jej obvykle vůbec nepotřebujete - výjimkou jsou stránky s tabulkami, protože námi použitá knihovna jej používá jako závislost
- TODO: favorites stocked notification
- TODO: context aware buttons
- TODO: docs

## 🐞 Opravy chyb

- 📊 Příliš mnoho produktů - Odstraněna chyba, která dodavatelům znemožňovala fakturovat, pokud jejich portfolio obsahovalo více než 65 produktů nebo 65 zákazníků
- 📩 Kdo monitoruje funkci na monitorování - Přestože Lednice obsahovala určité mechanismy, které v případě problému měly odeslat e-mail správci systému, tak bohužel chyba v této funkci způsobila, že nikdy žádný takový e-mail nebyl odeslán
- 🥱 Trochu pomalá Lednice - Změna uživatelských preferencí již nebude způsobovat zamrznutí aplikace
- 📦 Naskladnění - Při zrušení výběru produktu se nyní správně vrátí obrázek na náhled
- 🤷 Chybami se člověk učí - Odstraněno velké množství duplicitních či zbytečných přepočtů dat (a stále spousta zbývá), takže některé požadavky jsou citelně rychlejší
- 🐢 Fakturace - přepsán nejsložitější dotaz do databáze, který vytváří faktury a je nyní výrazně rychlejší
- 🔫 Zločiny proti HTML - kód každé stránky byl validován a nemalé množství chyb bylo opraveno
- TODO: odstraněním uživatele/dodavatele přijde zákazník o možnost zobrazení historie objednávek
