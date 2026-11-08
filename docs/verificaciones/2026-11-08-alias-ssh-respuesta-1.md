# Alias de SSH: respuesta a la revisión 1 (2026-11-08)

Revisión: `2026-11-08-alias-ssh-revision-1.md` (cambios necesarios, sobre el commit `5b434a6`).

Decisión del dueño (opción 1): el alias se reconoce leyendo `~/.ssh/config` como TEXTO. No se corre `ssh` ni nada.

| Hallazgo | Qué se hizo |
|---|---|
| H1: `ssh -G` evalúa `Match exec` y ejecuta programas | Se sacó la llamada a `ssh` (ni `entorno.ts` ni `repo-local.ts` lanzan procesos para esto). `src/ssh-config.ts` lee el archivo como texto: busca el bloque `Host <alias>` y su `HostName`; los bloques `Match` no se evalúan (un `Match` con `HostName` antes del que decide deja la duda y no se acepta). `Include` simple (ruta relativa a `~/.ssh`, `~`, absoluta, `*` en el nombre del archivo); lo no simple da duda. Test con archivos reales: un `Match exec`/`ProxyCommand`/`LocalCommand` que crearía un marcador no lo crea (`test/ssh-config.test.ts`), y otro test comprueba que esos dos archivos fuente no contienen `child_process`/`execFile`/`spawn`. README y `describe` dicen que se lee como texto y nunca se ejecuta. |
| H2: se pierde el puerto de `ssh://git@alias:PUERTO/…` | Se captura. Con HostName `github.com`/`ssh.github.com` sólo se acepta sin puerto, con 22, o con 443 en `ssh.github.com`; otro puerto se rechaza con un mensaje que lo dice. El caso exacto de la revisión (un `Match … exec "test %p = 2222"` que apunta a otro servidor) da duda y no se acepta. |
| Otros puntos | `--repo` y el remoto `supcoflow` ya no evitan nada que haya que evitar (no se ejecuta nada). Prioridad origin directo > alias resuelto > remoto `supcoflow` se dejó y se documentó en README y `describe`. `ssh.github.com` se mantiene como extensión consciente (cubierta por tests). La versión del paquete no se tocó (0.10.1). |
