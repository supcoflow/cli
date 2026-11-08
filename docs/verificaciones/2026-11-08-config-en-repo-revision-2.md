# Revisión independiente — configuración cuando el home es un repo — vuelta 2

**Veredicto: cambios necesarios.**

- Fecha: 2026-11-08. Segunda y última vuelta; no recomiendo abrir una tercera revisión.
- Rama revisada: `fm/cli-config-en-repo`.
- Commit: `b9807e3bcb39e63cf7bf17a28f084eeac3b4f2f6`.
- Diff principal: `e8a95d3..b9807e3`; también se consultó el cambio completo desde `fbc20fd`.
- Fuente: `/Users/germanflores/.treehouse/cli-fb15e0/3/cli`, sólo lectura. No se modificó; seguía limpia al último control.
- Laboratorio: `/Users/germanflores/.treehouse/cli-fb15e0/4/cli`, HEAD separado en el commit revisado.
- Referencias de líneas: corresponden a ese commit.

## Resumen en castellano simple

El cambio mejoró de manera importante: ahora revisa la subcarpeta donde guarda realmente y ya no propone una carpeta temporal. También vuelve a comprobar la carpeta antes de usar los archivos, y el caso sencillo de una carpeta ocupada por otra persona queda rechazado.

Todavía no daría por terminada la protección. Hay dos variantes en las que el control acepta una carpeta sin haber comprobado toda la protección que promete: puede tomar la propia carpeta del usuario como si fuera la carpeta compartida de confianza, y puede perder de vista los permisos de la ruta real cuando hay un enlace propio. Son problemas del mismo objetivo pendiente de la vuelta anterior, P2-2.

La suite está verde: **1055 tests**, más typecheck y build. Sin embargo, las comprobaciones adicionales de esta revisión muestran que faltan estos casos. Recomiendo corregirlos y agregar regresiones antes de integrar. No se necesita otra decisión del dueño: la condición de que la carpeta sea persistente, privada y externa al repo ya fue decidida.

## Estado de los puntos anteriores

| Punto | Resultado |
|---|---|
| P2-1: comprobar `<XDG_CONFIG_HOME>/supcoflow`, no sólo su padre | **Resuelto para los casos señalados en la vuelta 1.** Se inspeccionan raíz y destino, incluidos sus repos por ruta escrita y real. Hay regresiones para destino enlazado a repo, repo en el destino, archivo, permisos y dueño. |
| P2-2: comprobar que la carpeta sigue siendo propia y privada antes de usarla | **Parcialmente resuelto.** El envoltorio está conectado a los tres archivos y se ejecuta antes de leer, escribir y borrar. Faltan los dos casos P2 que se detallan abajo. |
| Q1 / P3-1: persistencia | **Resuelto según la decisión del dueño.** Las candidatas son `/Users/Shared` en macOS y ninguna en otras plataformas. No se usan `/tmp`, `/var/tmp` ni la carpeta temporal del sistema. |
| No guardar credenciales dentro de un repo | **Se conserva la negativa previa.** No encontré un retiro de ese control ni comprobé un guardado de credenciales dentro de un repo. |

## Hallazgos

### P2-R2-1 — La búsqueda del ancestro compartido puede saltarse la raíz que debía proteger

**Archivo y líneas:** `src/guardado/carpeta-privada.ts:55–72`; controles que quedan fuera: `85–94`.
**Selector afectado:** `src/guardado/fuera-del-repo.ts:45–56`.

La búsqueda empieza cerca del destino y toma la primera carpeta que reconoce como compartida. Si `supcoflow-<uid>` tiene modo `01777`, la toma como nuevo punto de partida y sólo comprueba su hijo `supcoflow`. Ya no exige que esa raíz sea privada `0700`, ni que pertenezca al usuario. El bit sticky no convierte una carpeta de cualquier dueño en una raíz personal segura.

Comprobaciones locales contra `dist/` recién compilado:

```text
A selector accepts world-writable 01777 user root: true
A guard reads despite simulated foreign 01777 user root: stored-record
```

La primera usó permisos reales: candidata compartida `01777`, raíz propia `01777` e hijo propio `0700`. El selector devolvió esa raíz en vez de descartarla. La segunda mantuvo el disco local y cambió sólo el uid informado para la raíz, mediante un doble de `ficha`; el control devolvió `null` y el almacén leyó un registro inocuo pese a que esa raíz figuraba ajena. No se usaron claves reales ni red.

**Consecuencia:** no se cumple la promesa de volver a comprobar que la raíz por usuario siga siendo propia y privada. El punto de confianza cambia en función de los permisos de una ruta que justamente se está validando. Además, elegirlo con `stat` antes de comprobar su entrada con `lstat` deja sin inspeccionar la propiedad de esa entrada cuando es un enlace que se convierte en el punto de partida.

**Recomendación:** mantener explícita la separación entre la carpeta compartida de base y la raíz personal. No permitir que una raíz o un tramo inferior reemplace esa base para eludir las comprobaciones. Desde la base, exigir dueño y permisos de la raíz antes de aceptar o usar el destino. Agregar regresiones con raíz `01777`, raíz ajena con ese modo y enlace ajeno hacia una carpeta compartida. Estos casos deben rechazarse antes de delegar al almacén.

### P2-R2-2 — Los permisos se revisan sólo en la cadena escrita, no en los ancestros de la ruta real de un enlace propio

**Archivo y líneas:** `src/guardado/carpeta-privada.ts:47–52`, `85–94`.
**Cableado afectado:** `src/guardado/fuera-del-repo.ts:52–55`; `src/entorno.ts:499–513`.

Se permiten enlaces propios hacia carpetas propias. Al seguir uno, el control comprueba el dueño y los permisos de la carpeta final, pero continúa recorriendo la cadena escrita. No comprueba los ancestros reales que el enlace introduce. El chequeo de git sí mira la ruta real, pero eso no verifica sus permisos ni su protección frente a reemplazos.

Comprobación local con permisos y enlaces reales, sin cambiar dueños ni usar operaciones remotas:

- Candidata compartida con sticky.
- Raíz del usuario como enlace propio hacia una carpeta propia `0700`.
- Esa carpeta real está dentro de otro padre escribible por otros, **sin** sticky.
- Hijo efectivo `supcoflow` propio `0700`.

Resultado:

```text
private check via link: null
private check via real path: carpeta_compartida_insegura
selector accepts: true
```

Es la misma carpeta física: el control la acepta por el enlace y la rechaza cuando recibe su ruta real. No hace falta una modificación concurrente para observar la discrepancia.

**Consecuencia:** se recomienda y utiliza una ubicación cuya cadena real no tiene la protección que el mismo control exige. Que el enlace sea propio y su carpeta final tenga `0700` no demuestra que los nombres de sus ancestros reales estén protegidos. Este punto forma parte de cerrar P2-2; no es una solicitud de cambiar la excepción existente para los archivos ignorados por git.

**Recomendación:** comprobar también la cadena real y los tramos introducidos por cada enlace, conservando las comprobaciones de propiedad de las entradas escritas. Otra solución acotada es no admitir enlaces en la raíz alternativa compartida hasta contar con esa validación. Agregar la regresión anterior; el selector y el almacén deben coincidir con el rechazo obtenido al revisar la ruta real.

### P3-R2-1 — `describe` promete una alternativa incluso cuando no hay candidata

**Archivo y líneas:** `src/comandos/describir.ts:307`, `314`.
**Regla efectiva:** `src/guardado/fuera-del-repo.ts:20–21`, `61`; `src/guardado/repo.ts:93–102`.

Los resúmenes dicen que, cuando git rechaza el destino, el impedimento nombra una carpeta persistente privada para `XDG_CONFIG_HOME`. El código, correctamente, no sugiere nada en Linux ni cuando ninguna candidata pasa las comprobaciones; el README sí explica esa limitación (`README.md:331–333`).

**Recomendación menor:** agregar «when a suitable folder is available» o equivalente en los dos resúmenes. No cambiar la conducta segura de devolver `null`. Sería conveniente fijar esa condición con una prueba de descripción; los tests actuales de contrato y descripción pasan, pero no cubren esa precisión del nuevo texto.

## Lo que sí está bien

- Se valida el destino efectivo `supcoflow`, no únicamente el valor que se asigna a `XDG_CONFIG_HOME`.
- La lista de candidatas ya no contiene temporales del sistema; en esta máquina `/Users/Shared` existe con modo `drwxrwxrwt`. Sólo se consultó; no se crearon fixtures allí.
- `entornoReal` envuelve credenciales, idempotencia y pruebas (`src/entorno.ts:499–526`). Las lecturas del registro de pruebas pasan por el envoltorio, también al retomar una solicitud pendiente.
- El caso nuevo de raíz ajena común se rechaza antes de usar el pedido. El error de seguridad no se interpreta como «no hay pedido» en `crearRegistroDePruebas` (`src/pruebas-guardadas.ts:74–85`).
- El prechequeo suma el impedimento de carpeta privada (`src/guardado/lugar.ts:50–52`).
- La negativa a escribir credenciales en repos sigue antes del guardado (`src/guardado/index.ts:134–143`). Los registros de pruebas e idempotencia mantienen el control de git antes de escribir o borrar.
- La recomendación sigue siendo una sugerencia: no cambia automáticamente variables ni migra registros.
- README explica persistencia, conservación de `XDG_CONFIG_HOME`, cambio de ubicación de credenciales y límite de Linux. Sus afirmaciones sobre protección privada deben quedar respaldadas por las correcciones P2 anteriores.
- No hay cambios de flags ni de códigos de salida. `carpeta_compartida_insegura` es un nuevo motivo dentro de `maquina.impedimentos`, cuya estructura abierta sigue siendo `{ codigo, detalle }`.

## Validación y límites

Node `v24.12.0`, npm `11.6.2`; se reutilizaron las dependencias ya presentes en el laboratorio. No hubo instalación adicional, publicación, login, gasto, cambios de infraestructura ni llamadas a producción.

Comandos principales:

```sh
git -C "$FUENTE" diff --stat e8a95d3 b9807e3
git -C "$FUENTE" diff e8a95d3 b9807e3 -- src README.md test/fuera-del-repo.test.ts test/carpeta-privada.test.ts
git -C "$LAB" switch --detach b9807e3
TMPDIR="$LAB/.review-tmp" NODE_OPTIONS="--import=$LAB/.review-tmp/isolate-ancestors.mjs" npm test
npm run typecheck
npm run build
node "$LAB/dist/cli.js" describe --json
```

Los comandos npm se ejecutaron desde el laboratorio. Resultados:

```text
Test Files 40 passed (40)
Tests      1055 passed (1055)
Duration   19.65s
typecheck  correcto
build      correcto
describe   JSON válido, una línea
```

**Adaptación del entorno de tests:** todos los temporales se mantuvieron dentro del laboratorio autorizado. Como éste es un worktree de git, se usó un preload exclusivamente de revisión que oculta los marcadores `.git` de sus ancestros exactos, conserva los repos creados por los fixtures y propaga a los subprocesos el directorio temporal y `GIT_CEILING_DIRECTORIES`. No se cambiaron fuentes ni expectativas de los tests para obtener el resultado verde. La suite verde usa esta adaptación; no la presento como una ejecución sin aislamiento.

Las comprobaciones adicionales de permisos y rutas se ejecutaron contra los módulos compilados, con fixtures locales descartables y el mismo aislamiento. Las simulaciones de otro dueño se limitaron al uid devuelto por `ficha`; no se probaron dos usuarios reales. El caso de ruta real y enlace propio usó permisos reales, sin simulación de propiedad. No afirmo haber comprobado una filtración de credenciales ni un envío autenticado indebido. La evidencia suficiente para los P2 es que se aceptan ubicaciones que incumplen las comprobaciones de propiedad y privacidad exigidas.

Los tests existentes de propiedad simulada son útiles y adecuados para esa capa; faltan combinaciones de permisos, selección de ancestro y enlaces. El hueco observado no se debe a que los tests necesiten privilegios para cambiar dueños reales.

## Recomendación de entrega

**No integrar este commit como cierre completo de P2-2.** El cambio sí merece entregarse después de resolver los dos casos y agregar tests de regresión primero. No hace falta retirar la mejora del destino real, volver a temporales ni relajar el rechazo de credenciales dentro de repos.

Esta es la última vuelta autorizada: el informe no solicita una tercera revisión. Los pendientes son correcciones técnicas concretas para el implementador y firstmate, con regresiones locales; no una nueva elección de producto.

## Preguntas para el dueño / inventario de decisiones

**Ninguna pregunta nueva. Inventario vacío.** La decisión anterior de usar almacenamiento persistente y privado se toma como resuelta, sin reinterpretarla. Los hallazgos y la recomendación técnica no requieren una elección adicional del dueño.
