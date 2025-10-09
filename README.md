# LSS_rename_vehicles
LSS Tampermonkey Script to automatically rename vehicles

---

Dokumentation: 
- [Tampermonkey Dokumentation](https://www.tampermonkey.net/documentation.php)
- [JavaScript Mozilla Dokumentation](https://developer.mozilla.org/de/docs/Web/JavaScript)

API Links: 
- [Vehicle API](https://www.leitstellenspiel.de/api/vehicles)
- [Building API](https://www.leitstellenspiel.de/api/buildings)
- [LSSM Vehicle Type API](https://api.lss-manager.de/de_DE/vehicles)

---

# Aktueller Stand:
Die Lightbox wird geöffnet, die API Daten werden geladen

Dann können Aliase für die Gebäude, und auch für die verschiedenen Fahrzeugtypen vergeben werden

Auch kann eine "Logik" für den Aufbau des neuen Fahrzeugnamens vergeben werden

Zum Schluss müssen zuerst die neuen Namen generiert werden. Im Anschluss kann per Knopfdruck das Umbenennen abgeschickt werden. Dann werden die neuen Namen an für das jeweillige Fahrzeug abgeschickt. 

---

# Bekannte Probleme:

[ ] Skript geht nur im Light Mode --> Code von Caddy erhalten um das auszulesen und anzupassen

[x] im Alias für Gebäude die Aliase beschränken auf nur Wachen, die Gebäude haben. (kein Krankenhaus, Schulen)

[ ] Es sollen für verschiedene Wachen Typen unterschiedliche Logiken zum Umbenennen genutzt werden [Forum Post](https://forum.leitstellenspiel.de/index.php?thread/10810-scriptwusch-fahrzeugumbenennungsscript/&postID=566930#post566930)

[x] Genaue Unterscheidung zwischen "local storage" und "session storage" --> Beschwerde, dass Aliase nicht gespeichert wurden. 