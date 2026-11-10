# Revisión independiente — alias SSH en la terminal, vuelta 1

**Veredicto: cambios necesarios.**

**Rama y commit:** `fm/cli-alias-ssh`, `5b434a6c893cf98df7e81bc79199789ad1331da3`, contra su padre `fbc20fd57e6e9479e3cf6ebb0d57e28ec7f11712`.

**Fecha:** 2026-11-08. Revisé el diff completo y los dos informes de 0.8.1 indicados en el pedido. La rama del autor, en `/Users/germanflores/.treehouse/cli-fb15e0/2/cli`, permaneció sin cambios. Para ejecutar pruebas puse **mi propia copia**, `/Users/germanflores/.treehouse/cli-fb15e0/1/cli`, en ese commit, con HEAD separado.

## Resumen en castellano simple

El caso habitual funciona: un alias que lleva a GitHub ya permite reconocer el proyecto. Las 1015 pruebas, el chequeo de tipos y la compilación pasan.

Pero hay dos problemas antes de darlo por bueno:

1. Mirar la configuración de SSH **puede ejecutar programas**, aunque no se abra una sesión SSH. Lo comprobé: una regla de configuración ejecutó un programa de la carpeta del repo. El límite de tres segundos tampoco detiene necesariamente esos programas. Esto cambia una protección que la terminal prometía antes; hace falta resolver explícitamente si se acepta ese cambio de confianza.
2. En las direcciones SSH que incluyen un puerto, el cambio descarta ese dato. Puede consultar una configuración distinta de la que usaría Git y dar por GitHub un remoto que realmente apunta a otro servidor.

No encontré una inyección de opciones mediante el alias o el usuario: las restricciones y el `--` están bien aplicados en el recorrido real. Tampoco encontré aceptación de nombres engañosos como `github.com.evil.com`.

## Hallazgos

### H1 — P2: la detección automática ejecuta reglas SSH desde la carpeta del repo, sin una autorización que reemplace la garantía anterior

**Referencias:** `src/entorno.ts:272–285` (especialmente `:276`); `src/repo-local.ts:83–90, 149–154`; promesa al usuario en `README.md:51–54` y `src/comandos/describir.ts:81`.

`execFile("ssh", ["-G", "--", "usuario@alias"], ...)` evita pasar por un shell en esa primera llamada, pero OpenSSH sí evalúa los `Match exec` de su configuración. La llamada no fija un `cwd` seguro: hereda la carpeta desde la que corre la terminal. Una regla que invoque un ejecutable relativo puede terminar ejecutando **un archivo versionado del repo ajeno**. Una regla también puede hacer escrituras o usar la red por su cuenta. Que SSH no abra una sesión no vuelve de sólo lectura a esa evaluación.

No es una ejecución remota universal: requiere que la configuración SSH de la persona tenga una regla ejecutable aplicable; el repo por sí solo no instala una regla en `~/.ssh/config`, ni un archivo versionado puede cambiar mágicamente `origin`. El problema es ampliar sin advertencia la superficie: una vez que existe esa configuración y el origin tiene forma de alias, comandos de consulta de Supcoflow pasan a disparar esas reglas. El repo puede aportar archivos que una regla relativa use y ser el directorio de trabajo de esos programas. Eso es más influencia que elegir solamente el nombre de un alias.

**Reproducción local ejecutada:** utilicé el `gitReal.resolverAlias` exportado por el código revisado. En un directorio de laboratorio dentro de mi worktree puse un ejecutable `repo-hook` que únicamente escribe un marcador. La configuración de prueba fue:

```sshconfig
Host github-review
 HostName github.com
Match originalhost github-review exec "./repo-hook"
 User git
```

Para no leer ni modificar la configuración real de la persona, un `ssh` de prueba, primero en PATH, hacía exclusivamente `exec /usr/bin/ssh -F '<laboratorio>/ssh_config' "$@"`. Así la evaluación la hizo **OpenSSH real**, con una configuración de prueba en lugar de la del sistema. La función de producción siguió aportando los argumentos y el entorno mínimo. Con el proceso ubicado en el laboratorio:

```text
await gitReal.resolverAlias('github-review', 'git') -> github.com
marcador de ./repo-hook                         -> executed
SUPCOFLOW_TOKEN en el hijo                     -> absent
```

El filtrado de entorno funciona para esa variable, pero **no es un aislamiento de permisos o de archivos**: un programa ejecutado sigue teniendo los permisos de la persona. No probé leer ninguna credencial ni usé secretos reales.

**Plazo comprobado:** sustituí la regla por:

```sshconfig
Host github-slow
 HostName github.com
Match originalhost github-slow exec "sleep 5; printf completed > late-marker"
 User git
```

Resultado:

```text
resolver -> null a los 3003 ms
hijo     -> creó late-marker con completed después del vencimiento
```

Esperé dentro de la misma reproducción a que ese hijo terminara. No quedaron procesos de prueba pendientes. **No afirmo que la promesa del resolutor haya tardado más de tres segundos:** en esta prueba se cumplió ese plazo. Lo que no se cumplió es detener el trabajo que había disparado. Un timeout sobre el PID de SSH no revoca los efectos ni garantiza terminar sus descendientes.

**Contraste con el diseño anterior:** el padre del commit decía expresamente que no ejecutaba SSH porque `Match exec` podía ejecutar programas. Las revisiones previas conservaban esa propiedad: `docs/revisiones/2026-10-29-terminal-0.8.1-revision-1.md:83–88` y `...-revision-2.md:60–64`. La especificación de Firstmate pide ahora usar `ssh -G`; eso explica la implementación, pero los documentos suministrados no muestran una aceptación informada del dueño de estas consecuencias. No considero esa aceptación implícita en «reconocer mi alias».

**Recomendación:** resolver la pregunta de confianza antes de habilitarlo automáticamente. La opción conservadora es mantener la asociación explícita sin evaluar configuración ejecutable; una opción intermedia es permitir la resolución sólo tras una autorización local de la persona, **no habilitable por un archivo del repo**. Si se acepta ejecutar la configuración, documentar expresamente `Match exec`, evitar el directorio del repo para las evaluaciones, tratar el árbol de procesos y su cancelación, y añadir regresiones con SSH real y configuración aislada. Cambiar el directorio ayuda contra ejecutables relativos, pero **no hace inofensivo un `Match exec` arbitrario** ni sustituye la decisión de confianza. README y `describe` deben dejar de presentarlo como algo que «only prints» sin advertir sus posibles efectos.

### H2 — P2: se descarta el puerto de la URL antes de resolver qué host usaría SSH

**Referencias:** `src/repo-local.ts:52–64` (puerto aceptado, pero no capturado/devuelto), `:87–90` y `:151–154`; prueba insuficiente en `test/repo-local.test.ts:167–169`.

El parser acepta `ssh://git@alias:2222/owner/repo.git`, pero sólo conserva usuario, host y repo. El resolutor invoca SSH sin `-p 2222`. Las reglas `Match exec` pueden usar `%p`; por tanto, el `hostname` obtenido puede no ser el que corresponde a ese origin. El código puede aceptar como GitHub un origin que con sus parámetros reales no apunta a GitHub.

**Reproducción ejecutada con OpenSSH real y la misma envoltura aislada de H1:**

```sshconfig
Match originalhost port-review exec "test %p = 2222"
 HostName gitlab.com
Host port-review
 HostName github.com
```

```text
origin: ssh://git@port-review:2222/owner/repo.git

/usr/bin/ssh -G -F <config_de_prueba> -p 2222 -- git@port-review
  hostname gitlab.com
  port 2222

gitReal.resolverAlias('port-review', 'git')
  github.com

leerRepoLocal(gitConEseOriginYResolutorReal, laboratorio)
  {"repo":"owner/repo","raiz":"<laboratorio>"}
```

La última llamada usa un doble de las lecturas de Git y el resolutor real del commit. No hubo conexión de red. El resultado contradice la condición central: aceptar sólo cuando la configuración correspondiente al origin lleva a GitHub. A partir de ese resultado se pueden seleccionar pedidos del proyecto o habilitar el uso de archivos del clon equivocado; no probé mutaciones contra el motor.

**Arreglo recomendado:** conservar el puerto de la URL y pasarlo como argumento separado y validado (`-p`, valor, antes de `--`) al resolver. Alternativamente, para el alcance mínimo de esta tarea, rechazar esa forma con puerto y conservar el mecanismo de asociación explícita. Añadir una regresión que contraste una configuración dependiente de `%p`: el doble actual siempre devuelve el hostname pedido y oculta la pérdida de información. La corrección técnica debe entrar antes de integrar el cambio.

## Otros puntos revisados

### Opciones, caracteres, entorno y errores

- El recorrido desde `origin` limita usuario y host a `[A-Za-z0-9._-]` y valida `owner/repo`. Rechaza alias y usuarios que empiezan con `-` antes de llamar al resolutor; éste vuelve a rechazarlos. La llamada usa un array de argumentos con `--`, sin concatenación de shell. **No encontré una inyección de opciones ni de shell por esos campos en este recorrido.**
- Lo anterior no elimina los efectos de la configuración SSH: es una frontera distinta, descrita en H1.
- El hijo recibe PATH y HOME, no todo `process.env`. El `SUPCOFLOW_TOKEN` ficticio de la prueba no llegó al hijo. PATH sigue eligiendo el ejecutable, igual que en el wrapper de Git existente; un PATH que incluya el directorio actual tampoco es una frontera de confianza. No probé cambios en el PATH real de la persona.
- Error de SSH, ausencia de `hostname`, hostname inválido, ausencia del resolutor y excepciones se convierten en el comportamiento de fallo/fallback esperado. Las pruebas unitarias de esos casos pasan. Mi reproducción real cubrió además un vencimiento.
- SSH se intenta también antes de mirar el remoto alternativo y aunque haya `--repo`, porque `repoPedido` primero llama a `leerRepoLocal` (`src/repo-local.ts:197–199`). **Ni `--repo` ni agregar el remoto `supcoflow` sirven hoy para evitar los efectos de H1** cuando el origin tiene forma de alias.

### Comparación del hostname y alcance

`src/repo-local.ts:74–80` usa una lista cerrada, con minúsculas y eliminación de un único punto final. No admite sufijos o prefijos engañosos. Los tests cubren `github.com.evil.com`, `evil-github.com` y otros servidores.

Se amplió el pedido literal «sólo github.com» a `ssh.github.com`, mayúsculas y nombres absolutos con punto final. `ssh.github.com` es un host legítimo de GitHub, y el punto final/mayúsculas no permiten un dominio ajeno: **no lo clasifico como vulnerabilidad ni como otro bloqueo funcional**. README y `describe` sí anuncian ambos hosts. Para mantener el alcance literal se puede reducir a `github.com`; si se conserva la ampliación, dejarla como una extensión consciente y cubierta. No hace falta involucrar al dueño en esa precisión técnica.

### Prioridad frente al remoto `supcoflow`

Prioridad real: **origin directo > alias resuelto > remoto `supcoflow`**. Está fijada por `test/repo-local.test.ts:219–221` y por el orden de `src/repo-local.ts:144–160`.

La comprobé con dos repos distintos:

```text
origin SSH resuelto a GitHub -> origin/repo
remoto supcoflow             -> explicit/repo
leerRepoLocal               -> origin/repo; ni consulta el remoto supcoflow
--repo explicit/repo         -> raiz:null, "This clone is github.com/origin/repo, not explicit/repo."
```

Es coherente con la regla histórica de que un origin reconocido gana, una vez que se decide reconocer el alias. **No lo marco por sí solo como un bug ni exijo invertir esa regla.** Sí cambia clones que antes usaban una asociación explícita distinta; conviene decir expresamente en README que el alias resuelto también tiene prioridad. Consultar primero una asociación explícita evitaría evaluación SSH en esos clones, pero sería otro criterio de prioridad y no debe introducirse como si ya fuese el contrato actual.

### README, `describe --json` y cobertura

- Ejecuté el binario compilado: `node dist/cli.js describe --json`. Produjo JSON de una línea, que incluye la explicación nueva en `project show`. No se agregaron comandos, flags ni códigos de salida. La versión sigue siendo 0.10.1.
- La explicación de hosts y fallback de README coincide en lo esencial con `describe`; ambas necesitan la advertencia de H1. Decir `ssh -G alias` es una abreviatura: el código pasa `usuario@alias`, dato relevante para reglas `Match user`.
- No hubo cambios en `test/describir.test.ts` ni `test/contrato.test.ts`. Al corregir la política de confianza o introducir un permiso/flag, actualizar esos tests y el contrato, no sólo los tests de `repo-local`.
- Las pruebas nuevas verifican bien el caso nominal, negativos de hostname, guiones iniciales y errores. No prueban el wrapper real de SSH, la ejecución de configuración ni la semántica del puerto. Una suite verde con esos dobles no cubre H1/H2.
- El diff no demuestra por sí solo el orden temporal de «test primero»; no doy esa práctica por verificada independientemente.

## Evidencia de ejecución y límites

Comandos principales, siempre sobre mi copia salvo las lecturas de la rama indicada:

```sh
W=/Users/germanflores/.treehouse/cli-fb15e0/1/cli
git -C "$W" checkout --detach 5b434a6
git -C "$W" diff 5b434a6^ 5b434a6
git -C "$W" diff --check 5b434a6^ 5b434a6
( cd "$W" && node --experimental-transform-types .review-ssh/probe.mjs )
( cd "$W" && npm test && npm run typecheck && npm run build )
( cd "$W" && node --experimental-transform-types .review-ssh/port-probe.mjs )
( cd "$W" && node dist/cli.js describe --json )
git -C /Users/germanflores/.treehouse/cli-fb15e0/2/cli status --porcelain
```

Resultados independientes:

```text
Node v24.12.0
OpenSSH_10.5p1, LibreSSL 3.3.6
Test Files 38 passed (38)
Tests      1015 passed (1015)
npm run typecheck -> 0
npm run build     -> 0
diff --check      -> 0
estado del worktree revisado -> vacío
```

Las reproducciones usaron archivos descartables dentro de mi worktree, OpenSSH con `-F` apuntando sólo a una configuración sintética y dobles de las lecturas de Git cuando correspondía. No modifiqué la configuración SSH personal. La primera versión del script intentó leer el marcador tardío inmediatamente al vencer los tres segundos y obtuvo `ENOENT`; lo ajusté para esperar hasta que terminara el hijo, y repetí la reproducción completa con el resultado documentado. No confundí ese error del instrumento con un error del producto.

No cambié código de la rama del autor, no publiqué, no abrí operaciones de GitHub, no pedí login, no gasté ni hice pedidos al motor o a producción. El informe es el artefacto durable; los scripts y logs de mi copia son de laboratorio.

## Pregunta pendiente para el dueño, a canalizar por Firstmate

**Una sola decisión de confianza:** ¿se permite que reconocer automáticamente un alias active reglas de la configuración SSH que pueden ejecutar programas, escribir o usar la red, o se mantiene esa evaluación desactivada hasta que la persona la autorice expresamente?

Opciones:

1. **Conservadora, recomendada por defecto:** conservar la asociación explícita sin ejecutar configuración SSH automáticamente; habilitar resolución sólo con permiso local expreso de la persona, si se implementa.
2. **Aceptar el cambio de confianza:** permitir la evaluación automática, con una advertencia clara sobre esos efectos y las correcciones técnicas de H1/H2. No presentarlo como una operación incapaz de ejecutar programas.

Esta revisión no decide por el dueño ni asume que haya autorizado el segundo comportamiento. Firstmate debe registrar esta decisión y acreditar el inventario de preguntas antes de cerrar la revisión; no corresponde una atestación `--none` mientras siga abierta.

## Recomendación de entrega

Hay trabajo concreto que debe incorporarse: corregir el puerto o dejar esa forma fuera, añadir las regresiones reales aisladas y resolver/documentar la frontera de confianza. Después de la decisión, aplicar el camino elegido, ejecutar otra vez suite, tipos y build y usar, si corresponde, **la segunda y última vuelta** para comprobar las correcciones. No integrar este commit como aprobado por esta revisión.
