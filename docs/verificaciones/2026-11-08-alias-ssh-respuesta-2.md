# Alias de SSH: respuesta a la revisión 2 (2026-11-08)

Revisión: `2026-11-08-alias-ssh-revision-2.md` (cambios necesarios, sobre el commit `482b4c4`). Última vuelta. Regla aplicada a
todo: ante cualquier duda el lector devuelve null (no acepta) y el error sugiere `--repo`. Cada caso tiene su test primero en
`test/ssh-config.test.ts`.

| Hallazgo | Qué se hizo |
|---|---|
| R2-H1: un `Include` reactivaba un bloque que no aplica | El archivo incluido ya no puede abrir bloques propios si se incluyó desde dentro de un `Host`/`Match` (duda, null). Un `Include` bajo un `Host` que no aplica se salta entero. Bajo un `Match` con un `HostName` adentro: duda. Sigue valiendo restaurar el contexto del padre al volver. |
| R2-H2: las palabras de un comentario eran patrones | El tokenizador corta en un `#` que empieza una palabra; comillas sin cerrar, barra invertida o un `#` pegado a una palabra dan duda. Un `#` entre comillas es parte del argumento. |
| R2-H3: los patrones de `Host` se pasaban a minúsculas | El alias de entrada se pasa a minúsculas (como ssh) y el patrón se compara tal cual: `Host ALIAS` no aplica a `alias`. La comparación sin mayúsculas queda sólo para el HostName final. |
| R2-H4: `*` leía archivos ocultos; `~usuario` | El `*` no entra en archivos ocultos salvo que el patrón empiece con punto. `~usuario` y `~` solos dan duda (sólo se expande `~/`). |
| R2-H5 (P3): enumeración sin tope | El lector real abre la carpeta y corta a las 500 entradas (duda); además, más de 40 archivos que coinciden dan duda. |
| Lectura: objeto presente pero no admitido | Un archivo que no existe se ignora (como ssh); una carpeta, un FIFO, algo enorme, sin permiso o que cambia de tamaño mientras se lee da duda en vez de saltearse. |
| Contrato | Test nuevo en `test/describir.test.ts`: `describe` y el README dicen «plain text», «never run», «Match ignored» y la prioridad, y no mencionan `ssh -G`. |

Contraste con OpenSSH real (`ssh -G -F`, archivos sintéticos, sin red): los seis casos del revisor dan gitlab.com en OpenSSH y
ahora gitlab.com o null en el lector (nunca github.com); el caso común da github.com en ambos. Sin cambios de comandos, flags,
códigos ni versión (0.10.1).
