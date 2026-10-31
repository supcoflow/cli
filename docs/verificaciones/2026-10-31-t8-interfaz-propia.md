# T8 (terminal 0.9.0) — la interfaz propia, `instalacion.json` v3 y el punto 7 de `diagnose`

Fecha: 2026-10-31. Rama `fm/ui-t8-cli`. Local y gratis: nada publicado, ningún push, login real ni gasto. Plan: `data/ui-agnostico/report.md` §5 T8.

## Qué cambia

| Pieza | Antes (0.8.1) | Ahora (0.9.0) |
|---|---|---|
| `widget` | Valida el objeto del motor campo por campo y descarta lo demás. | Deja pasar `interfaz_propia` con la forma real que manda el motor (`fm/ui-t8-motor` 1458afa5: `estado`, `contrato {version, archivo, documento}`, `entradas`, `documentos`…; sin código para pegar), lista cerrada. Con `estado: sin_publicar` el texto no ofrece el camino. A medias se descarta con un aviso y el widget sigue. Sin el campo (el motor de hoy) todo igual. |
| `install record` | v2: `archivo`. | v3: `forma` (`widget` / `interfaz_propia`, con `--shape`), `archivos` (`--file` repetible, hasta 20) y `contrato` (la versión que trae el `contract.json` del paquete instalado). Lee v1 y v2. El JSON del comando conserva `archivo`. |
| `diagnose` | 6 puntos. | 7: `interfaz` (local, sólo lee; `aviso: true`). Falla sólo con un contrato MAYOR más nuevo, un archivo que falta o un `instalacion.json` ilegible o de una terminal más nueva; baja el «N of 7», no frena una prueba. |

## Qué se comprobó

- `npm run typecheck`: limpio. `npx vitest run`: **35 archivos, 839 tests en verde**. Los tests nuevos se escribieron antes y se vieron en rojo (commit aparte, `test(cli): T8 en rojo`).
- **Contra el motor de hoy:** `test/sin-tty.test.ts` corre el binario real contra un motor falso local. `widget --json` sin el campo nuevo devuelve exactamente el objeto de siempre (no aparece `interfaz_propia`); con el campo, lo deja pasar.
- **De punta a punta (mismo archivo):** en un repo de git descartable con un `node_modules/@supcoflow/chat/{package.json,contract.json}` y dos archivos de la interfaz, `install record --shape own-interface --file … --file …` escribe v3 con `contrato: "1.1.0"`; `diagnose` da 7 de 7; si el motor pasa a declarar `1.2.0` el punto 7 falla con un aviso y la salida sigue en 0; si se borra un archivo anotado, el punto lo nombra.
- Compatibilidad de formatos: v1 y v2 se leen sin error (el `archivo` de la v2 se lee como widget) y se reescriben v3.

## Lo que no se hizo

- No se corrió contra el motor nuevo: los tests usan una **copia literal** de `interfazPropiaJson` (`test/interfaz-propia-del-motor.ts`, motor `fm/ui-t8-motor` 1458afa5), leída con `git show`. Si el motor cambia la forma, hay que actualizar esa copia.
- Nada publicado: la versión 0.9.0 está en `package.json` pero no se subió a npm.

## Antes de publicar

`diagnose` ahora dice «N of 7» y la skill de hoy pide literalmente «6 of 6» (`SKILL.md`, `referencias/prueba.md`): con el punto 7 en falla frenaría una prueba que la terminal dice que puede seguir. **La 0.9.0 sale junto con la skill de T9** (que mire `instalacion.ok`/`listo`/`aviso`, no un número fijo), no antes. La versión 2.4.0 del sdk tampoco está publicada (`estado: sin_publicar`).

## Revisión 1

Informe en `docs/revisiones/2026-10-31-terminal-0.9.0-revision-1.md`; cómo se resolvió cada hallazgo, en `docs/revisiones/2026-10-31-terminal-0.9.0-respuesta-1.md`.
