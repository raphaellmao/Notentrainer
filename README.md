# Notentrainer

Noten lesen lernen fürs Klavier: Die App zeigt eine Note im Notensystem, du tippst die passende Taste.
Reines HTML/CSS/JavaScript, keine Frameworks, kein Build-Schritt. Läuft als PWA auch offline.

## Bedienung

- **Schlüssel:** Violin, Bass oder Gemischt (die Klaviatur wechselt dann mit dem Schlüssel).
- **Stufe 1:** nur Noten ohne Hilfslinien (Violin d¹–g², Bass F–h).
  **Stufe 2:** mit Hilfslinien (Violin c¹–c³, Bass C–c¹).
- **Klaviatur:** immer zwei Oktaven, Violin c¹–c³, Bass C–c¹. Der graue Punkt markiert das mittlere C (c¹).
  Schwarze Tasten zählen als falsch, denn es kommen nur Stammtöne vor.
- **Runde:** 20 Noten, danach Trefferquote, Durchschnittszeit und die falschen Noten.
- **Adaptiv:** Pro Note werden Versuche, Fehler und Antwortzeit im Browser gespeichert (localStorage).
  Noten, die oft falsch oder langsam kommen, erscheinen häufiger. Dieselbe Note kommt nie zweimal hintereinander.

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| `js/notes.js` | Notenmodell: Tonhöhen, deutsche Namen (H statt B), Schlüssel, Position im Notensystem |
| `js/staff.js`, `js/clefs.js` | **Notendarstellung:** Notensystem, Hilfslinien, ganze Note, Schlüssel als eigene SVG-Pfade |
| `js/keyboard.js` | **Klaviatur:** Tastenlayout, Treffer-Erkennung, SVG |
| `js/trainer.js` | **Übungslogik:** Notenvorrat, adaptive Auswahl, Statistik, Runden |
| `js/audio.js` | Klavierähnlicher Ton über die Web Audio API |
| `js/app.js` | Oberfläche: verbindet alles |
| `sw.js`, `manifest.json` | PWA: offline nutzbar, zum Startbildschirm hinzufügbar |

## Tests

```
npm test
```

`tests/zuordnung.test.js` prüft für alle Noten beider Schlüssel die Zuordnungen „Note → Position im Notensystem“
(inklusive Hilfslinien, gemessen am gezeichneten SVG) und „Note → Taste“. Die Erwartungswerte sind von Hand
eingetragen, nicht aus dem Code berechnet. `tests/uebung.test.js` prüft die Übungslogik.

Zum Vergleich mit einer gedruckten Notentabelle: `tests/notentabelle.html` zeigt jede Note so, wie die App sie zeichnet.

## Lokal starten

```
npm start
```

Danach http://localhost:8793/ öffnen.

## Veröffentlichen

Jeder Push auf `main` aktualisiert GitHub Pages automatisch.
Bei jeder Veröffentlichung `VERSION` in `sw.js` erhöhen. Dann lädt der Service Worker alle Dateien neu vor und
räumt alte Caches auf. Der Service Worker holt online ohnehin immer zuerst die neue Fassung („erst Netz, dann Cache“).
