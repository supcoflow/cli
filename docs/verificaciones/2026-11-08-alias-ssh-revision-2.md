# Revisión independiente — alias SSH en la terminal, vuelta 2 y última

**Veredicto: cambios necesarios.**

**Revisado:** rama `fm/cli-alias-ssh`, commit `482b4c46f8dfedead1c06513e6a6810f5de9cdb6`; diff de esta vuelta: `git diff 5b434a6 HEAD`.
**Fecha:** 2026-11-08.
**Rama del autor:** `/Users/germanflores/.treehouse/cli-fb15e0/2/cli`, sólo lectura, sin cambios y todavía en ese commit al finalizar las comprobaciones.
**Laboratorio propio:** `/Users/germanflores/.treehouse/cli-fb15e0/1/cli`, HEAD separado en el mismo commit.

## Resumen en castellano simple

El cambio importante que pidió el dueño está hecho: **reconocer el alias ya no ejecuta SSH ni las órdenes de su configuración**. También se conserva y valida el puerto escrito en la dirección del remoto. Las **1035 pruebas, el chequeo de tipos y la compilación pasan**.

Pero el lector de configuración todavía puede equivocarse en lo esencial: **da por GitHub un remoto que OpenSSH configura para GitLab**. Lo reproduje con inclusiones dentro de bloques que no corresponden, comentarios, mayúsculas en los patrones y archivos ocultos encontrados por un comodín. No son sólo casos que rechazan un alias válido: son aceptaciones equivocadas.

Recomiendo corregir esos cuatro problemas antes de integrar. Son correcciones técnicas dentro de la decisión ya tomada, sin volver a ejecutar SSH en el producto. Si una construcción no se puede interpretar con seguridad, debe dejarse sin resolver y conservar la asociación manual. **No hay una nueva pregunta para el dueño. Esta es la segunda y última revisión; no propongo una tercera vuelta.**

## Estado de H1 y H2 de la vuelta 1

- **H1, ejecución de programas: resuelto.** Se eliminó el wrapper `ssh -G`. `src/entorno.ts:273–277` conecta `gitReal.resolverAlias` con `hostnameDeAlias`; este último sólo importa operaciones de archivos y rutas. No hay lanzamiento de procesos en el resolutor. Las lecturas de Git de `leerRepoLocal` siguen siendo las preexistentes; no interpreto la promesa como eliminar Git de toda la terminal.
  - Probé el **resolutor real exportado**, con HOME descartable dentro de mi copia y reglas `Match ... exec`, `ProxyCommand` y `LocalCommand` que crearían un marcador. Resultado: `{"resolver":"gitReal.resolverAlias","actual":"github.com","markerExists":false}`. No pasé esa configuración a OpenSSH. La prueba de marcador de la suite también pasa.
- **H2, puerto perdido en la URL: resuelto para el alcance acordado.** `src/repo-local.ts:54–62, 99–104, 133–141` conserva el número y rechaza puertos fuera de la lista. Las regresiones `test/repo-local.test.ts:226–240` pasan: acepta 22 en ambos hosts y 443 sólo sobre `ssh.github.com`; rechaza 2222 y 443 sobre `github.com`. El caso anterior de `Match ... exec` dependiente de `%p`, con `HostName` antes del bloque decisivo, ahora deja la duda y no se acepta.
  - Esto **no significa interpretar todo el transporte SSH**: la opción `Port` del archivo no se lee. Comprobé que `HostName github.com` + `Port 2222`, sin puerto en la URL, sigue aceptándose. Es el alcance explícito del pedido de esta vuelta (puerto de la URL, o ausente), no una corrección pendiente del mismo bug de pérdida del puerto. Tampoco se evalúan los comandos proxy, por decisión del dueño. README y `describe` hablan específicamente del puerto de la URL; no conviene ampliar esa promesa a «puerto efectivo completo de OpenSSH».

## Hallazgos que requieren corrección — P2

No encontré un P1. Los siguientes cuatro P2 comparten impacto: `leerRepoLocal` puede devolver `{repo:"owner/repo", raiz:...}` para un origin que OpenSSH lleva a otro servidor. Eso cambia la selección del proyecto y la atribución de archivos del clon; no hice pedidos ni modificaciones contra el motor para demostrar consecuencias posteriores.

### R2-H1 — P2: un `Include` puede reactivar un bloque que no aplica, incluso dentro de un `Match` ignorado

**Archivo y líneas:** `src/ssh-config.ts:79–95`, especialmente `:90` y `:92–94`.

Se entra en el archivo incluido con el contexto del padre, pero un `Host alias` dentro del hijo lo reemplaza por `aplica`, sin conservar que **la inclusión entera estaba desactivada o era desconocida**. OpenSSH no deja activar así un archivo incluido bajo un `Host` que no corresponde. En un `Match` desconocido tampoco hay certeza que permita aceptar al hijo.

**Reproducción con archivos reales** (`/LAB/extra` representa una ruta absoluta dentro del laboratorio):

```sshconfig
# config
Host other
  Include /LAB/extra
Host alias
  HostName gitlab.com
```

```sshconfig
# extra
Host alias
  HostName github.com
```

Para `git@alias:owner/repo.git`:

```text
lector del commit       -> github.com
OpenSSH -G -F config    -> hostname gitlab.com; port 22; exit 0
leerRepoLocal           -> repo owner/repo, con la raíz del clon
```

Reemplacé la primera línea por `Match originalhost other`, manteniendo el Include y el resto: **mismo falso positivo**. No hubo `exec` en ninguna de estas configuraciones de contraste.

**Recomendación:** separar la habilitación de la inclusión de los bloques locales del archivo incluido. Un Include bajo un Host inactivo no puede aportar opciones; uno bajo un Match desconocido no puede producir una aceptación cierta. Conservar la restauración del contexto del padre al volver del Include: esa parte sí la contrasté y funciona. Añadir ambos negativos; la prueba actual de Include dentro de Match (`test/ssh-config.test.ts:106–108`) sólo prueba un hijo sin un nuevo `Host`, y por eso no descubre el escape.

### R2-H2 — P2: las palabras de un comentario se interpretan como patrones `Host`

**Archivo y líneas:** `src/ssh-config.ts:44–52, 85–90`.

`palabras` separa tokens, pero no termina ante un comentario `#` fuera de comillas. Así un alias mencionado en el comentario de otro bloque pasa a formar parte de su lista de hosts.

**Reproducción:**

```sshconfig
Host other # alias
  HostName github.com
Host alias
  HostName gitlab.com
```

```text
lector del commit    -> github.com
OpenSSH              -> hostname gitlab.com; exit 0
leerRepoLocal        -> repo owner/repo, con la raíz
```

**Recomendación:** reconocer comentarios fuera de comillas según la gramática admitida, antes de interpretar patrones o destinos Include. Si una forma de comillas/escape no está soportada, devolver duda; no reinterpretarla como otros tokens. No basta con quitar todo desde el primer `#`, porque puede ser parte de un argumento entre comillas. Añadir esta regresión; la prueba llamada «comillas y comentarios» (`test/ssh-config.test.ts:26–28`) sólo cubre un comentario de línea completa.

### R2-H3 — P2: convertir los patrones `Host` a minúsculas activa bloques que OpenSSH no activa

**Archivo y líneas:** `src/ssh-config.ts:55–65`.

Es correcto que los nombres de las directivas sean indiferentes a mayúsculas. No es correcto convertir también el **patrón literal de `Host`**. En el OpenSSH probado, el host de entrada se normaliza, pero un patrón `ALIAS` no pasa a ser `alias`.

**Reproducción:**

```sshconfig
Host ALIAS
  HostName github.com
Host alias
  HostName gitlab.com
```

Con destino `git@alias`:

```text
lector del commit    -> github.com
OpenSSH              -> hostname gitlab.com; exit 0
```

También lo probé sin el segundo bloque: OpenSSH devuelve `hostname alias`, mientras el lector devuelve `github.com`.

**Recomendación:** no bajar indiscriminadamente el patrón a minúsculas; reproducir la normalización de la entrada y el tratamiento del patrón de OpenSSH, o rechazar las formas cuya semántica no se soporte. Mantener aparte la comparación sin mayúsculas del **HostName final** con la lista de GitHub: esa comparación no es el problema. Añadir el caso de patrón en mayúsculas. El test actual de entrada en mayúsculas y patrón en minúsculas (`test/ssh-config.test.ts:36`) no prueba esta dirección.

### R2-H4 — P2: la expansión simplificada de `Include` lee archivos que OpenSSH no incluiría

**Archivo y líneas:** `src/ssh-config.ts:107–116`, especialmente `:114–115`.

La expresión regular que sustituye a `glob` incluye archivos ocultos con `*`. El glob usado por OpenSSH no los incluye si el patrón no empieza con punto. Un archivo oculto de respaldo puede así decidir el destino antes de los archivos activos.

**Reproducción:**

```sshconfig
# config
Include /LAB/config.d/*
Host alias
  HostName gitlab.com
```

```sshconfig
# config.d/.hidden
Host alias
  HostName github.com
```

`config.d/visible` sólo contiene `Host other` y `User git`.

```text
lector del commit    -> github.com
OpenSSH              -> hostname gitlab.com; exit 0
leerRepoLocal        -> repo owner/repo, con la raíz
```

Hay otra forma no soportada que se acepta como si lo estuviera: `Include ~usuario/archivo` se interpreta como una carpeta literal `~usuario` dentro de `~/.ssh`, en vez de expansión del home de ese usuario o duda (`:109`). Lo reproduje con `~root/ssh-config`: un archivo sintético en la carpeta literal de mi laboratorio dio `github.com`; OpenSSH no lo incluyó y conservó `gitlab.com`. No modifiqué ningún archivo del home de otro usuario.

**Recomendación:** imitar al menos la regla de archivos ocultos de glob; admitir un patrón explícito que empiece por punto, no todos los ocultos indiscriminadamente. Rechazar `~usuario` si sólo se implementa `~/`. Cualquier expansión fuera del subconjunto declarado debe devolver duda. Añadir regresiones negativas de ambas formas y conservar el orden de prioridad documentado.

## Mejoras menores — P3

### R2-H5 — P3: el tope de 40 archivos no limita la enumeración de un directorio incluido

**Archivo y líneas:** `src/ssh-config.ts:37–38, 114–116`.

`readdirSync` carga el directorio completo; luego se filtra, ordena y convierte toda la lista en rutas antes de aplicar el contador de archivos de `:80`. Por lo tanto, «hasta 40 archivos» no limita memoria ni trabajo cuando el patrón encuentra muchísimas entradas. No hice una prueba de agotamiento de recursos: es un límite ausente visible en el código, no un bloqueo o consumo extremo observado.

**Recomendación:** enumeración acotada, con cierre seguro del directorio y resultado de duda si se supera un máximo de entradas. Es endurecimiento menor para la configuración local, no el motivo principal del veredicto.

## Lecturas de archivos y otros límites revisados

- **FIFOs y carpetas:** probé ambas con archivos reales dentro de mi copia. `O_NONBLOCK` más `fstat().isFile()` evita leerlas; las consultas terminaron en 0–1 ms, sin colgarse. No ejecuté SSH sobre el FIFO. Un Include de esos objetos se trata como ausente y permite aceptar un HostName posterior. Para la promesa más conservadora de «no adivinar si un archivo no se pudo leer», conviene distinguir archivo inexistente de objeto presente pero no admitido y devolver duda en el segundo caso. No es una afirmación de que se haya leído el FIFO ni de que se ejecutara algo.
- **Enlaces:** no se usa `O_NOFOLLOW`; los enlaces a archivos comunes sí se siguen. Lo comprobé con un enlace local a una configuración que devuelve `gitlab.com`; el enlace roto se omite. El chequeo de tipo y tamaño se hace sobre el descriptor ya abierto, no sólo sobre una ruta que luego se vuelve a abrir. Seguir un enlace de la configuración personal no es por sí mismo ejecución ni escritura; no marco como vulnerabilidad la existencia de enlaces legítimos. Cualquier política más estricta debe ser explícita.
- **Tamaños:** un archivo de 262145 bytes devuelve duda; el tope se comprueba antes de reservar el buffer. No encontré lectura ilimitada del contenido de un archivo. Se lee el tamaño del primer `fstat`, sin una comprobación posterior de cambios; para endurecer frente a modificaciones concurrentes se puede detectar truncado/cambio de tamaño y fallar cerrado. No reproduje una carrera.
- **Ciclos/profundidad/cantidad:** hay límites de profundidad 5 y 40 intentos de archivo; los ciclos no son recursión ilimitada. La suite cubre un ciclo, no todas las fronteras de cada contador.
- **Errores:** `leerRepoLocal` convierte excepciones del resolutor en falta de certeza y mantiene el fallback. El lector distingue poco entre ausencia y error de apertura; no imprime contenido de archivos ni secretos.
- **Lista de hosts:** se conserva la lista cerrada `github.com` / `ssh.github.com`, sin aceptar sufijos engañosos; mayúsculas y punto final del HostName no dan acceso a otros dominios. Prioridad origin directo > alias reconocido > remoto `supcoflow`, ahora expresada en README y `describe`.

## README, contrato y cobertura

- `README.md:51–69` y `src/comandos/describir.ts:81` ya no recomiendan `ssh -G`: explican lectura de texto, Include simple, Match no evaluado, puerto de URL y prioridad. En lo esencial son coherentes con la decisión del dueño.
- Ejecuté `node dist/cli.js describe --json`: **una línea de JSON**, versión 0.10.1, sin `ssh -G`, con la descripción «read as plain text». No se agregaron comandos, flags ni códigos. La tabla pública no necesita una fila nueva por este cambio.
- La garantía de reconocer sólo con certeza todavía no se cumple por los P2. No se debe resolver debilitando el texto para permitir falsos positivos; corresponde arreglar el lector o devolver duda.
- `test/describir.test.ts` y `test/contrato.test.ts` no cambiaron en este diff y pasan. Falta una regresión contractual específica que impida reintroducir la explicación anterior y fije la prioridad y la política sin ejecución; añadirla junto a las correcciones.
- Los 1035 tests verdes prueban el recorrido nominal y varios rechazos, pero no los seis contrastes reales anteriores. No doy por demostrada la práctica temporal «tests primero» a partir del diff.

## Evidencia y método reproducible

Leí el pedido de revisión, el informe de la vuelta 1, la respuesta de la rama, las instrucciones del repo, README y el diff completo de esta vuelta. No modifiqué la rama del autor. Usé Node `v24.12.0` y `OpenSSH_10.5p1, LibreSSL 3.3.6`.

Comandos principales:

```sh
W=/Users/germanflores/.treehouse/cli-fb15e0/1/cli
A=/Users/germanflores/.treehouse/cli-fb15e0/2/cli
git -C "$A" diff 5b434a6 HEAD
git -C "$W" checkout --detach 482b4c46f8dfedead1c06513e6a6810f5de9cdb6
git -C "$W" diff --check 5b434a6 HEAD
( cd "$W" && npm test && npm run typecheck && npm run build )
( cd "$W" && node --experimental-transform-types .review-ssh-v2/probe.mjs )
( cd "$W" && node --experimental-transform-types .review-ssh-v2/assertions.mjs )
( cd "$W" && node --experimental-transform-types .review-ssh-v2/noexec.mjs )
( cd "$W" && node dist/cli.js describe --json )
git -C "$A" status --porcelain
git -C "$A" rev-parse HEAD
```

Resultados:

```text
Test Files 39 passed (39)
Tests      1035 passed (1035)
typecheck  exit 0
build      exit 0
diff check exit 0
rama autor status vacío; HEAD 482b4c46f8dfedead1c06513e6a6810f5de9cdb6

inactive-include: OpenSSH=gitlab.com; lector=github.com; falso positivo=true
match-include:    OpenSSH=gitlab.com; lector=github.com; falso positivo=true
hidden-glob:     OpenSSH=gitlab.com; lector=github.com; falso positivo=true
host-comment:    OpenSSH=gitlab.com; lector=github.com; falso positivo=true
host-case:       OpenSSH=gitlab.com; lector=github.com; falso positivo=true
tilde-user:      OpenSSH=gitlab.com; lector=github.com; falso positivo=true
```

Los scripts son de laboratorio y se descartarán. Para reproducir sin ellos, crear los archivos de cada ejemplo en `<HOME_DESCARTABLE>/.ssh`, reemplazando `/LAB` por una ruta absoluta del mismo laboratorio. Comparar:

```js
// Desde una copia del commit, con Node 24 y --experimental-transform-types:
import { hostnameDeAlias, lectorReal } from './src/ssh-config.ts';
console.log(hostnameDeAlias('alias', lectorReal, '<HOME_DESCARTABLE>'));
```

```sh
/usr/bin/ssh -G -F '<HOME_DESCARTABLE>/.ssh/config' -- git@alias
```

**Sólo usar el contraste con los ejemplos sin comandos ejecutables de los P2.** Para el marcador de H1 utilicé únicamente el lector del producto y el resolutor real, no OpenSSH. Las comparaciones `-G` no abrieron sesiones ni usaron la red. Las llamadas a `leerRepoLocal` usaron un doble de las lecturas de Git que devolvía la raíz y `git@alias:owner/repo.git`, ningún remoto alternativo y el **lector real** como resolutor; no fueron llamadas al motor.

No hice login, publicaciones, operaciones de GitHub, gasto ni cambios en producción. No cambié configuraciones personales. No dejé procesos de laboratorio en segundo plano.

## Recomendación final e inventario de preguntas

**Hay trabajo concreto que debe incorporarse:** corregir R2-H1 a R2-H4 y agregar sus regresiones antes de integrar; conservar la ausencia de ejecución y la validación de puertos ya logradas. El endurecimiento R2-H5 es menor. Después, repetir tests, tipos y build. No suplir el lector con una llamada a SSH ni abrir una tercera revisión GPT.

**Preguntas nuevas para el dueño: ninguna.** La decisión de confianza de la primera vuelta ya vino resuelta en el brief; los problemas de esta vuelta tienen solución técnica dentro de esa decisión. Esta recomendación de corrección no es una solicitud de permiso humano ni una autorización de publicación.
