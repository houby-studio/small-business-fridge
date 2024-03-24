# Changelog

## ✨ Novinky

- 💳 Nově může administrátor uživatelům přidat kartu o minimální délce 6 znaků, která slouží jako bezpečnější způsob ověření
      a rovněž slouží pro načtení fyzického čářového nebo QR kódu místo ručního zadávání
- 😱 Chybně zakoupený produkt nově dokáže administrátor do 15 minut stornovat
- 📱 Nová sada API volání umožňuje nakupovat pomocí nové mobilní aplikace sbf-scanner
- 🔢 Číslo klávesnice nyní může mít maximálně délku 5 znaků, pro delší bezpečnější způsob ověření slouží karta
- 🔐 Zákazník si může zakázat přihlašování pomocí čísla klávesnice, aby jeho snadno uhodnutelná identita nemohla být zneužita
- 🫅 Administrátorům konečně přibyla správa zákazníků, kde mohou nastavit práva, kartu a anonymizovat bývalé uživatele

## 🐞 Opravy chyb

- 🎨 Kategorie se v nabídce zobrazují ihned po vytvoření, není je potřeba ještě dodatečně upravit přes formulář Upravit kategorii
- 🚫 Zakázané kategorie se již nezobrazují ve filtru, u produktů a ani při vytváření a úpravě produktů
- 📑 S ohledem na rostoucí velikost databáze byly definovány indexy, které by měly rychlosti odezvy pomoci
- 🪪 Formuláře pro změnu údajů na stránce profilu nyní využívají CSRF token stejně jako ostatní části aplikace
