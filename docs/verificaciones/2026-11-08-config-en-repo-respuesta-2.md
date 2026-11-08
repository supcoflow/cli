# Respuesta a la revisión 2 (cli-config-en-repo)

Revisión: `2026-11-08-config-en-repo-revision-2.md` (cambios necesarios: 2 P2, 1 P3). Última vuelta; no hay tercera.
Regla aplicada: ante la duda, rechazar. Las regresiones se escribieron primero (commit en rojo) y después el arreglo.

| Hallazgo | Cómo se resolvió |
|---|---|
| P2-R2-1: el ancestro compartido más cercano podía ser la propia raíz del usuario | `recorrer` (src/guardado/carpeta-privada.ts) toma como carpeta compartida de confianza la MÁS ALTA que otros pueden escribir, no la más cercana al destino. Desde ahí, la raíz personal tiene que ser propia, sin escritura de otros (un 01777 no pasa) y sin acceso de otros (0700); un enlace ajeno no se sigue. Tests: raíz propia 01777, raíz ajena 01777 (y el almacén no lee lo plantado), enlace ajeno hacia otra compartida, raíz 01777 recién creada con `crear`. |
| P2-R2-2: los ancestros reales de un enlace propio no se comprobaban | `revisarCarpetaPrivada` revisa la cadena escrita y, si un enlace propio la desvía, también la cadena REAL del destino con las mismas reglas (y, si no se puede resolver, rechaza). Tests: raíz = enlace propio a una carpeta 0700 dentro de un padre 0777 sin sticky (rechazo por el enlace y por la ruta real, coinciden), el almacén no escribe, el selector devuelve null; control: el mismo enlace hacia un padre con sticky sí vale. |
| P3-R2-1: `describe` prometía una alternativa sin condición | Los resúmenes de `diagnose` y `test` dicen «when … a suitable folder is available» y que en Linux normalmente no la hay; test en test/describir.test.ts. |

Efecto a tener presente: bajo una carpeta que otros pueden escribir (por ejemplo `HOME` dentro de `/tmp` o un 0777 sin sticky), el archivo de credenciales, `pruebas.json` e `idempotencia.json` se rechazan si el tramo de abajo no es propio y privado; `SUPCOFLOW_TOKEN` y el llavero no se ven afectados. Una carpeta personal normal (`~/.config/supcoflow`, incluso con grupo escribible propio) no cambia.
