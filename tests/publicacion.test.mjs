import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

test("la página y la caché PWA usan las mismas versiones de los recursos", async () => {
  const raiz = new URL("../", import.meta.url);
  const [html, app, sw] = await Promise.all(["index.html", "app.js", "sw.js"].map(archivo => readFile(new URL(archivo, raiz), "utf8")));
  const urls = [
    ...[...html.matchAll(/(?:src|href)="([^"\s]+\.(?:js|css)(?:\?[^"\s]*)?)"/g)].map(m => m[1]),
    ...[...app.matchAll(/from "(\.\/[^"\s]+)"/g)].map(m => m[1])
  ];
  assert.ok(urls.length >= 3);
  const activos = [...sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  for (const recurso of urls) {
    const url = new URL(recurso, raiz);
    assert.ok(url.searchParams.get("v"), `Falta versión para evitar copias antiguas: ${recurso}`);
    assert.ok(activos.includes("./" + recurso.replace(/^\.\//, "")), `Falta en la caché PWA: ${recurso}`);
    url.search = "";
    await access(url);
  }
});
