(function (APA) {
  'use strict';

  // localStorage can be missing or throw (private windows, blocked site data). The app must still run,
  // so every access goes through here and failure falls back to "nothing stored".
  function readJson(key) {
    try {
      const raw = globalThis.localStorage && globalThis.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : undefined;
    } catch (error) {
      console.warn(`[storage] could not read ${key}`, error);
      return undefined;
    }
  }

  function writeJson(key, value) {
    try {
      globalThis.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn(`[storage] could not write ${key}`, error);
      return false;
    }
  }

  function remove(key) {
    try { globalThis.localStorage.removeItem(key); } catch (error) { console.warn(`[storage] could not remove ${key}`, error); }
  }

  APA.storage = { readJson, writeJson, remove };
})((globalThis.APA = globalThis.APA || {}));
