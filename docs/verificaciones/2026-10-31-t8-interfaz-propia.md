# T8 (terminal 0.9.0) — la interfaz propia, `instalacion.json` v3 y el punto 7 de `diagnose`

Fecha: 2026-10-31. Rama `fm/ui-t8-cli`. Local y gratis: nada publicado, ningún push, login real ni gasto. Plan: `data/ui-agnostico/report.md` §5 T8.

## Qué cambia

| Pieza | Antes (0.8.1) | Ahora (0.9.0) |
|---|---|---|
| `widget` | Valida el objeto del motor campo por campo y descarta lo demás. | Deja pasar `interfaz_propia` (paquete, versión, instalar, ids, backend, CSP, `contrato_version`; sin código para pegar) con la misma validación: lista cerrada, y a medias es `respuesta_inesperada`. Sin el campo (el motor de hoy) todo igual. |
| `install record` | v2: `archivo`. | v3: `forma` (`widget` / `interfaz_propia`, con `--shape`), `archivos` (`--file` repetible, hasta 20) y `contrato` (la versión que trae el `contract.json` del paquete instalado). Lee v1 y v2. El JSON del comando conserva `archivo`. |
| `diagnose` | 6 puntos. | 7: `interfaz` (local, sólo lee). Aviso: baja el «N of 7», no frena una prueba. |

## Qué se comprobó

- `npm run typecheck`: limpio. `npx vitest run`: **35 archivos, 839 tests en verde**. Los tests nuevos se escribieron antes y se vieron en rojo (commit aparte, `test(cli): T8 en rojo`).
- **Contra el motor de hoy:** `test/sin-tty.test.ts` corre el binario real contra un motor falso local. `widget --json` sin el campo nuevo devuelve exactamente el objeto de siempre (no aparece `interfaz_propia`); con el campo, lo deja pasar.
- **De punta a punta (mismo archivo):** en un repo de git descartable con un `node_modules/@supcoflow/chat/{package.json,contract.json}` y dos archivos de la interfaz, `install record --shape own-interface --file … --file …` escribe v3 con `contrato: "1.1.0"`; `diagnose` da 7 de 7; si el motor pasa a declarar `1.2.0` el punto 7 falla con un aviso y la salida sigue en 0; si se borra un archivo anotado, el punto lo nombra.
- Compatibilidad de formatos: v1 y v2 se leen sin error (el `archivo` de la v2 se lee como widget) y se reescriben v3.

## Lo que no se hizo

- No se probó contra el motor nuevo de la tanda `ui-t8-motor` (corre en paralelo); los nombres del campo son los de este informe. Ver «Nombres para alinear» en el reporte.
- Nada publicado: la versión 0.9.0 está en `package.json` pero no se subió a npm.
