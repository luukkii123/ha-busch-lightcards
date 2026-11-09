'use strict';
// #877: offener Dialog sperrt das Scrollen der Seite und gibt es auf jedem Schließweg frei.
const test = require('node:test');
const assert = require('node:assert');
const { neueUmgebung, neuesHaus, neueKarte } = require('./attrappe.js');

const seite = (u) => u.document.documentElement.style.overflow;

test('Dialog offen: Seite scrollt nicht mit', () => {
  const u = neueUmgebung(), karte = neueKarte(u, neuesHaus({ an: true }));
  karte._openDialog();
  assert.equal(seite(u), 'hidden');
});

test('Schließen-Knopf gibt die Seite wieder frei', () => {
  const u = neueUmgebung(), karte = neueKarte(u, neuesHaus({ an: true }));
  karte._openDialog();
  karte._dialog._sheet.querySelector('.head').querySelector('.iconbtn').click();
  u.uhr.vor(400); // Absicherung, falls popstate ausbleibt
  assert.equal(seite(u) || '', '');
});

test('Zurück-Geste gibt die Seite wieder frei', () => {
  const u = neueUmgebung(), karte = neueKarte(u, neuesHaus({ an: true }));
  karte._openDialog();
  const dialog = karte._dialog;
  for (const fn of u.kontext.window.listeners.popstate || []) fn({});
  assert.equal(dialog.isConnected, false, 'Dialog ist zu');
  assert.equal(seite(u) || '', '');
});

test('ein vorher gesetzter Wert der Seite bleibt erhalten', () => {
  const u = neueUmgebung(), karte = neueKarte(u, neuesHaus({ an: true }));
  u.document.documentElement.style.overflow = 'scroll';
  karte._openDialog();
  assert.equal(seite(u), 'hidden');
  karte._dialog.remove();
  assert.equal(seite(u), 'scroll');
});
