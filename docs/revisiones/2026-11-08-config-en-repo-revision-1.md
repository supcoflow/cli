# Revisión independiente — configuración cuando el home es un repo

**Veredicto: cambios necesarios.**

- Fecha: 2026-11-08. Vuelta 1 de un máximo de 2.
- Rama revisada: `fm/cli-config-en-repo`.
- Commit: `e8a95d33bd01a258cf3f7f54bc5388ec1d7c48b6`; base `fbc20fd57e6e9479e3cf6ebb0d57e28ec7f11712`.
- Fuente original: `/Users/germanflores/.treehouse/cli-fb15e0/3/cli`, leída sin modificarla. Al terminar la inspección seguía limpia y en el mismo commit.
- Laboratorio: `/Users/germanflores/.treehouse/cli-fb15e0/4/cli`, HEAD separado en el commit revisado. Sin cambios a la rama, publicaciones, gasto, login, secretos reales ni llamadas a producción.
- Referencias de líneas: corresponden al commit revisado.

## Resumen en castellano simple

El aviso llega a tiempo: `diagnose` y `test` sin autorización explican el problema antes de pedir permiso para gastar. También se conserva la protección que impide guardar una clave de acceso dentro de un repo. La observación del implementador es correcta: el caso sencillo del home-repo ya estaba resuelto por la excepción de archivos ignorados; este cambio agrega una salida para los casos que todavía se rechazan.

Pero la carpeta ofrecida todavía no es una salida confiable. El programa revisa la carpeta de arriba, no la subcarpeta donde guarda realmente. Por eso puede recomendar un lugar que vuelve a caer en el mismo repo y repetir exactamente la misma recomendación que no sirve. Además, al ofrecer un nombre predecible en una carpeta compartida, necesita comprobar de forma segura que ese lugar sigue siendo del usuario cuando lo utiliza, no solamente cuando muestra la sugerencia.

Recomiendo corregir esos dos puntos antes de integrar el arreglo. Hay además una pregunta de producto pendiente: una carpeta temporal puede desaparecer por limpieza del sistema; eso puede hacer perder el registro que permite retomar la misma prueba sin pedir otra.

## Hallazgos

### P2-1 — Se valida XDG_CONFIG_HOME, pero no el destino real `XDG_CONFIG_HOME/supcoflow`

**Ubicación principal:** `src/guardado/fuera-del-repo.ts:35–43`.
**Cableado relevante:** `src/entorno.ts:481`, `489–508`.

`carpetaFueraDeUnRepo` verifica los ancestros y la ruta real de `base/supcoflow-<uid>`, y la devuelve. Sin embargo, la aplicación añade **otra** subcarpeta, `supcoflow`, antes de guardar sus registros y credenciales. Esa última subcarpeta no se inspecciona para elegir la candidata.

Caso reproducido, sin carreras ni cambios concurrentes:

1. Hay una candidata escribible y ajena a todo repo.
2. Existe `candidata/supcoflow-501`, del usuario.
3. Dentro hay un enlace `supcoflow -> <repo>`; el repo tiene `pruebas.json` añadido al índice.
4. El selector devuelve `candidata/supcoflow-501` como salida válida.
5. Al revisar el destino efectivo aparece `git_lo_sigue`. El aviso vuelve a recomendar **el mismo** `XDG_CONFIG_HOME` que ya no sirve.

Salida de la reproducción contra los módulos compilados del commit:

```text
CASE1 helper accepted XDG parent with supcoflow -> repo: <LAB>/base/supcoflow-501
CASE1 actual request path: <LAB>/repo
CASE1 actual storage blockers: git_lo_sigue
CASE1 warning suggests the SAME unusable XDG path again: true
```

También se aceptan candidatas cuyo hijo `supcoflow` es un archivo, una carpeta sin permisos o una carpeta de otro dueño, aunque esas condiciones ya impedirían guardar. No basta con comprobar que se puede crear algo en el padre.

**Impacto:** la salida propuesta puede seguir dentro del repo original por un enlace, o ser inutilizable. Incumple la condición central de proponer un destino realmente externo y utilizable. No demuestra una filtración de credenciales: el control posterior de credenciales sigue rechazando el repo.

**Cambio recomendado:** antes de seleccionar la candidata, comprobar también `join(sub, "supcoflow")` y los destinos relevantes, tanto en su ruta escrita como real. Reutilizar el prechequeo donde sea conveniente; rechazar candidatas que ya tienen obstáculos conocidos y continuar con la siguiente. Agregar tests para hijo enlazado al repo original, repo anidado en el hijo, hijo archivo, hijo ajeno y falta de permisos. Los tests actuales sólo cubren el enlace en `supcoflow-<uid>`, no en su hijo efectivo.

### P2-2 — El nombre predecible en una carpeta compartida no se asegura antes de leer un pedido pendiente

**Ubicación que introduce la exposición:** `src/guardado/fuera-del-repo.ts:14–16`, `35–43`; uso nuevo en `src/entorno.ts:494–508`.
**Flujo existente que hay que reforzar para ese destino:** `src/comandos/probar.ts:308–334`; `src/guardado/archivo.ts:29–44`; `src/guardado/lugar.ts:34–36`.

El chequeo `propio` del selector ocurre al sugerir la carpeta. No reserva ni crea el nombre. Entre ese comando y el siguiente, otro usuario local puede crear `/var/tmp/supcoflow-<uid>` —o el equivalente compartido de la segunda candidata— y dejar dentro un `supcoflow/pruebas.json` legible con un pedido pendiente preparado por él. También se admite un padre propio ya existente que permita a terceros reemplazar sus entradas: el selector no comprueba esos permisos.

El prechequeo detectaría `carpeta_ajena`, pero `test --authorize-spend` no lo ejecuta antes de leer el registro. Si encuentra un intento pendiente con el mismo techo y política y no se pasa `--message`, usa ese intento directamente y llama a `pedirPrueba`, **sin pasar por la escritura que podría fallar al cambiar permisos**. El `chmod` al guardar y el `wx` del archivo temporal no protegen esa lectura previa. El mismo almacenamiento movido contiene también el archivo de credenciales.

Reproducción de flujo, íntegramente local:

- El selector devolvió una subcarpeta todavía inexistente.
- Se colocó un registro pendiente en esa ruta después de la sugerencia.
- La propiedad ajena se simuló mediante `FsDelLugar.estado` (`propio: false`), sin cambiar dueños reales ni necesitar otro usuario del sistema.
- Se usaron el registro, el almacén de archivo, el protegido y `probar` reales; sólo la identidad/proyecto y `pedirPrueba` fueron dobles, sin red.

```text
CASE2 precheck with simulated foreign owner: {"ok":false,"impedimentos":[{"codigo":"carpeta_ajena",...}]}
CASE2 mocked POST count despite foreign ownership blocker: 1
CASE2 mocked POST body: {"clave":"injected-idempotency","mensaje":"UNTRUSTED PENDING MESSAGE","techoUsd":2,"politicaEsperada":"guardar"}
CASE2 all network mocked; no credentials or spend used.
```

**Alcance de la evidencia:** comprobé el salto del control y la utilización del pedido inyectado; no ejecuté un ataque con dos usuarios reales. Tampoco comprobé una filtración de claves. El techo y la política no se amplían en esta reproducción; sí se sustituye el contenido y la clave de reintento del pedido que se envía autenticado.

**Cambio recomendado:** para usar un destino compartido, crear de forma exclusiva la raíz por usuario, comprobar con `lstat` dueño y tipo, rechazar enlaces/raíces inseguras y asegurar permisos privados **antes de leer** registros o credenciales. Si ya existe, no basta con `mkdir({recursive:true})`. Mantener la raíz protegida frente a reemplazos por terceros y volver a verificarla al utilizar la ruta en otro comando. Alternativamente, evitar las candidatas compartidas y emplear una ubicación persistente/privada comprobada. Añadir regresiones para la ocupación de la ruta entre la sugerencia y su uso, y para un padre propio pero escribible por terceros.

Es una exposición nueva del flujo existente al recomendar almacenamiento compartido, no un pedido de rediseñar todas las escrituras de la terminal. Un nombre con el uid y el prechequeo separado no alcanzan por sí solos.

### P3-1 — Falta advertir que la salida propuesta puede perder el registro de reintento por limpieza del sistema

**Ubicación:** `src/guardado/fuera-del-repo.ts:14–16`; `src/guardado/repo.ts:102`; `README.md:314–316`, `327–332`.

La selección usa exclusivamente `/var/tmp` y `os.tmpdir()`. No son almacenamiento duradero: el sistema puede limpiarlos, y la segunda candidata puede perderse en un reinicio. El aviso afirma que crea la carpeta al guardar, pero no explica esta limitación. El README menciona la carpeta temporal, sin explicar que se puede perder el intento pendiente, la última prueba o el archivo de credenciales que se traslade allí.

Si se pierde un registro tras una respuesta ambigua, `leer` considera que no hay intento y `probar` genera otra clave (`src/comandos/probar.ts:311–328`). Ya no se puede prometer que repetir retoma la misma prueba. No afirmo que todo reintento vaya a duplicar gasto: una prueba aún abierta también tiene protección del motor.

**Cambio recomendado:** preferir almacenamiento persistente para el estado de reintento; si se acepta mantener una opción temporal, explicar la limpieza y sus consecuencias tanto en el aviso como en el README y no presentarla como equivalente al registro persistente. La aceptación de esa limitación está pendiente en Q1; no la resolví por el dueño.

## Lo que sí está bien

- `diagnose` incorpora `maquina` antes de declarar la prueba lista; si falla, `listo` y `prueba.listo` quedan en falso y sale 4. El chequeo no necesita autorización de gasto.
- `test` sin autorización pone los impedimentos al principio del mensaje, antes del comando de lanzamiento. No se agregó una llamada que gaste.
- La ruta exterior es una sugerencia, no una modificación automática de `XDG_CONFIG_HOME` ni una migración de datos.
- Se conservan los códigos y los detalles anteriores. Si `fuera` devuelve `null` o lanza, no se inventa una ruta ni se pierde el aviso.
- Las comillas del comando manejan espacios y apóstrofos. Los controles posteriores contra repos y el rechazo de credenciales dentro de ellos no fueron retirados.
- El README explica que hay que conservar `XDG_CONFIG_HOME` en los comandos siguientes, incluido `test --wait`, y que mueve el archivo de credenciales.
- `describe --json` sigue siendo coherente con los comandos, flags y códigos existentes: sólo se amplía texto libre de impedimentos ya existentes. No exige una modificación de esquema por este cambio. Corrí los tests de contrato y descripción y el binario `describe --json`.

## Validación y límites

Entorno: Node `v24.12.0`, npm `11.6.2`. Dependencias instaladas con `npm ci --no-audit --no-fund`, con caché dentro del laboratorio.

Comandos principales, desde la copia descartable:

```sh
git diff fbc20fd e8a95d3 --stat
git diff fbc20fd e8a95d3 --
npm ci --cache "$LAB/.review-tmp/npm-cache" --no-audit --no-fund
npm run typecheck
npm run build
node dist/cli.js describe --json
```

Resultados: **typecheck y build pasan**. `describe --json` produce una línea de JSON.

Para no escribir temporales fuera del worktree autorizado, utilicé `TMPDIR="$LAB/.review-tmp"`. Eso introduce un repo ancestro que los tests normalmente no tienen. La primera ejecución de `npm test` sin adaptación dio **960 pasados / 64 fallidos**, en cinco archivos: los casos que necesitan estar fuera de un repo encontraban el repo del laboratorio. No atribuyo esos fallos al arreglo.

Para verificar la suite sin vulnerar el límite de escrituras, agregué un **preload sólo en el laboratorio**, sin cambiar fuente ni tests del producto. El preload:

1. Oculta exclusivamente los marcadores `.git` de los ancestros del directorio temporal, mediante un envoltorio de `lstatSync` que devuelve `ENOENT` para esas rutas exactas.
2. Deja visibles todos los repos creados por los tests dentro de los fixtures, incluidos los repos enlazados.
3. Propaga ese aislamiento a los subprocesos Node de los tests y fija `GIT_CEILING_DIRECTORIES` al directorio temporal para los subprocesos git. No propaga tokens ni otras variables del shell a los entornos mínimos de las pruebas.

Con ese aislamiento explícito:

```sh
TMPDIR="$LAB/.review-tmp" NODE_OPTIONS="--import=$LAB/.review-tmp/isolate-ancestors.mjs" npm test
# Test Files 39 passed (39)
# Tests 1024 passed (1024)
# Duration 20.09s
```

Antes, la ejecución focal de `fuera-del-repo`, `maquina`, `proteccion-de-git`, `contrato` y `describir` también había pasado: **83/83**. La suite verde usa el aislamiento indicado; no la presento como una ejecución sin adaptación del entorno. No cambié las funciones bajo revisión ni sus expectativas para obtenerla.

Las dos reproducciones adicionales se ejecutaron contra `dist/` recién compilado, con todos los fixtures dentro del laboratorio y con el mismo ocultamiento de ancestros. No forman parte de los 1024 tests: son casos nuevos que conviene incorporar al arreglo.

### Receta de reproducción de P2-1

Con una base temporal realmente fuera de un repo —o el aislamiento descrito—:

```js
// Imports: carpetaFueraDeUnRepo; revisarElLugar; fsDelLugarReal; gitReal;
// fs, path y execFileSync de Node.
mkdirSync(`${base}/supcoflow-501`, { recursive: true });
mkdirSync(repo, { recursive: true });
execFileSync('git', ['init', '-q'], { cwd: repo });
writeFileSync(`${repo}/pruebas.json`, '{}');
execFileSync('git', ['add', '-f', 'pruebas.json'], { cwd: repo });
symlinkSync(repo, `${base}/supcoflow-501/supcoflow`);
const elegida = carpetaFueraDeUnRepo({
  fs: fsDelLugarReal, candidatos: [base], usuario: '501'
});
// Resultado incorrecto: elegida === `${base}/supcoflow-501`, no null.
const impedimentos = await revisarElLugar({
  ruta: `${elegida}/supcoflow/pruebas.json`, fs: fsDelLugarReal,
  git: gitReal, fuera: () => elegida
});
// git_lo_sigue; detalle recomienda otra vez la misma elegida.
```

Para P2-2, el fixture de `pruebas.json` usado fue:

```json
{
  "http://localhost:4555#prueba#proj_review": {
    "valor": "{\"intento\":{\"clave\":\"injected-idempotency\",\"mensaje\":\"UNTRUSTED PENDING MESSAGE\",\"techo_usd\":2,\"politica_esperada\":\"guardar\"},\"ultima\":null}",
    "escritoEn": 1
  }
}
```

`FsDelLugar.estado` devolvía `propio:false` para la raíz sugerida y sus hijos; la lectura/escritura seguía usando `fsReal`. `pruebas.revisar('proj_review')` encontró `carpeta_ajena`. A continuación `probar` con `authorizeSpend:true`, `ceiling:'2'`, `expectPolicy:'save'`, `message:null`, `wait:false` llamó al doble de `pedirPrueba` con el intento del fixture. El doble respondió `ambigua`, para no confirmar ni escribir nada después. No hubo servidor remoto ni una prueba real.

## Pregunta pendiente para el dueño / inventario de decisiones

**Q1 — ¿Se acepta ofrecer una carpeta temporal que el sistema puede borrar, con la consiguiente pérdida del registro para retomar una prueba, o se requiere una carpeta persistente fuera de repos?**

- Opción A: buscar una carpeta persistente y privada, comprobando igualmente que esté fuera de repos y que se pueda usar sin riesgo. Es mi recomendación.
- Opción B: conservar la salida temporal, pero asumir y explicar sus límites de conservación, además de resolver P2-1 y P2-2. No la consideraría una garantía equivalente de recuperación.

La pregunta ya figura como elección no resuelta en el pedido de revisión del implementador; la dejo expresamente sin responder por el dueño. No presupongo que `/Users/Shared` por sí sola resuelva seguridad o persistencia: también necesita una subcarpeta privada validada.

**Inventario no vacío:** una decisión consolidada, Q1, asociada al trabajo `cli-config-en-repo`. Firstmate debe registrarla/enlazarla mediante su mecanismo de decisiones y atestiguar la finalización de esta revisión antes del `done`. No ejecuté `complete --none`, porque declararía falsamente que no quedan preguntas.

## Recomendación de entrega

El arreglo merece continuar y entregarse una vez resueltos P2-1 y P2-2, y aclarado el criterio de conservación. No es necesario cambiar la excepción existente del home-repo ni relajar la protección de credenciales. Añadir los casos nuevos como tests antes de la corrección y utilizar la segunda vuelta, si se solicita, sobre esos cambios. No integrar este commit tal cual como si la ruta sugerida ya cumpliera la garantía solicitada.
