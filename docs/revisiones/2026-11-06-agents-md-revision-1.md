# Revisión independiente del grupo A de orank — vuelta 1

**Fecha:** 2026-11-06. **Revisor:** GPT 6.1 Sol (`PI_MODEL=gpt-6.1-sol`, proveedor OpenAI), crewmate `orank-a-rev1`.

## Resultado ejecutivo

**No integraría las tres ramas tal como están.** Encontré tres correcciones concretas, una por repositorio. No hay hallazgos P1 ni fallas de compilación o de los tests del producto.

| Repo / rama / commit revisado | Veredicto | Motivo principal |
|---|---|---|
| landing — `fm/orank-grupo-a` — `6e37497924a800c684efba1d8713b41161dceaaa` | **No integrar tal cual** | Los enlaces ocultos del pie crean destinos de teclado invisibles; además no usaría ese recurso para sumar descubrimiento en buscadores. El resto de los cambios puede conservarse. |
| cli — `fm/orank-a-cli` — `831e04fe2d95f954bd04e2c36dbfeef902217dec` | **No integrar tal cual; corrección documental pequeña** | `AGENTS.md` promete que `--json` nunca pregunta y que sin terminal sale 3; `agents set-key` contradice ambas afirmaciones. |
| skills — `fm/orank-a-skills` — `1c1a89993253907e22cafc5de8d18a3f1a64042e` | **No integrar tal cual; corregir instrucciones de huella** | La documentación presenta como protegida una versión publicada, pero el script todavía permite rehacer la huella de 0.5.0 sin cambiar la versión. **`plugin.json` sí cumple el spec actual.** |

P1 = urgente/crítico; P2 = corregir antes de integrar; P3 = mejora menor, no bloqueante. Los P2 de CLI y skills señalan afirmaciones nuevas incorrectas sobre comportamientos preexistentes: no son regresiones de código introducidas por estas ramas.

## Alcance y método

Leí el informe `/Users/germanflores/firstmate/data/orank-2026-11-05/informe.md`, especialmente secciones 1, 3, 4 y P-1; el pedido `/Users/germanflores/firstmate/data/orank-grupo-a/revision-pedido.md`; README e instrucciones de cada repo; los diffs completos y el código relacionado. Contrasté con las copias de NLWeb y ARD entregadas y con las especificaciones oficiales actuales de Agent Plugins y Vercel.

Revisé las ramas contra estas bases:

```text
landing: dcbe051..6e37497 (incluye 19476f8, c1f60d2, 6e37497)
cli:     d385f7a..831e04f
skills:  6e26df8..1c1a899
```

Los repos originales se leyeron con `git -C <worktree> ...`. Para ejecutar, extraje cada commit mediante `git archive` en directorios **sin checkout propio** dentro de mi laboratorio:

```text
/Users/germanflores/.treehouse/landing-2aa734/3/landing/.review/landing
/Users/germanflores/.treehouse/landing-2aa734/3/landing/.review/cli
/Users/germanflores/.treehouse/landing-2aa734/3/landing/.review/skills
```

No cambié ninguna rama revisada, no hice push, no publiqué, no inicié sesiones ni corridas pagas y no desplegué. Las reproducciones usan dependencias inyectadas, valores ficticios y copias descartables; no llaman al motor real. Al finalizar las comprobaciones, `git status --short` de los tres worktrees fuente seguía vacío.

### Validaciones ejecutadas

Entorno: Node **v24.12.0**, npm **11.6.2**. En cada copia: `npm ci --no-audit --no-fund`.

| Repo | Comandos | Resultado observado |
|---|---|---|
| landing | `npm run build`; `npm exec --yes --package=@astrojs/check --package=typescript -- astro check` | **Build correcto: 7 páginas. Check: 0 errores, 0 warnings, 2 hints** por símbolos sin uso. No hay script `test` en este repo. |
| cli | `npm test`; `npm run typecheck`; `npm run build` | **38 archivos, 998/998 tests correctos**. Typecheck y build correctos. |
| skills | `npm test`; `npm run huella` | **284/284 tests correctos**. Huella de 0.5.0: `b818a8a9a4aa6a03ac3d05210d220f6eb325131f8a5ee0aeaaa728807e5477df`. No hay scripts de build ni de typecheck propios. |

También ejecuté comprobaciones independientes con Node/assert y Ajv:

```text
Vercel routes: schema OK
Plugin: schema OK
ARD entry: schema OK
TrustManifest: schema OK
Feed: 4 unique JSON-LD objects identical to built pages
Route expression simulation: 52 cases OK (NOT a Vercel runtime test)
CLI set-key with json=true, TTY=true: prompts=1, exit=3, error=cancelado
CLI set-key with json=true, TTY=false: exit=4, error=sin_terminal
Skill hash override after text change, version still 0.5.0: exit=0
CLI describe --json == skills describe-0.10.0.json: exact JSON equality
```

**Incidencias del laboratorio, resueltas:** al anidar las copias, Vite intentaba resolver el tsconfig del directorio anfitrión, que aún no tenía dependencias; instalar las dependencias del anfitrión lo resolvió. La primera corrida útil de CLI dio 941 correctos y 57 fallos porque los temporales dentro de este worktree activaban su protección de credenciales. Firstmate autorizó por inbox `001.msg` usar `/tmp/orank-a-rev1` sólo para esos tests. Repetí con `TMPDIR=/tmp/orank-a-rev1`, obtuve 998/998 y borré esa carpeta. No atribuyo esos fallos iniciales al producto.

La validación de Vercel fue de **`properties.routes` del esquema oficial**, no del esquema raíz entero: el documento oficial descargado declara draft-04 pero contiene reglas de otras secciones incompatibles con ese borrador. Esto no afecta la validación aislada de las rutas revisadas ni demuestra funcionamiento en la red de Vercel.

## 1. Landing

### L-1 · P2 — Enlaces enfocables permanentemente ocultos en el pie

**Archivo y líneas:** `src/components/Footer.astro:45-53` y `:220-228`.

Los dos `<a href>` del `<nav class="repos-sr">` son destinos normales del teclado, pero el contenedor siempre mide 1 × 1 px y tiene `overflow: hidden` y `clip-path: inset(50%)`. No existe una regla `:focus-within` que lo revele. Una persona que navega con Tab llega a enlaces que no puede ver ni identificar visualmente. La regla global de foco no puede sacar su texto del recorte del ancestro.

Eso es un defecto concreto, independientemente de cómo puntúe orank. No es equivalente a ocultar una etiqueta adicional para un lector de pantalla.

**Sobre buscadores:** Google distingue el contenido oculto cuyo propósito es manipular buscadores del contenido oculto que realmente mejora la experiencia de lectores de pantalla. Su política no prohíbe todo patrón `sr-only`. Por tanto, **no afirmo que estos dos enlaces vayan a causar una penalización**. Sí veo un riesgo innecesario: el comentario del cambio dice expresamente que se ocultan para cumplir D5 sin tocar el diseño, y no hay un mecanismo para que las personas que ven la página los usen. No lo daría por una solución de descubrimiento sana sólo por llamarlo `repos-sr`.

Fuente: https://developers.google.com/search/docs/essentials/spam-policies#hidden-text-and-link-abuse (consultada durante esta revisión; contempla expresamente la excepción legítima de accesibilidad).

**Recomendación:** retirar por ahora el `<nav>` y su CSS —el commit `6e37497` sólo agrega ese cambio—, conservar los enlaces reales en `llms.txt` e `index.md`, y no dar por completada la parte «enlaces desde la home» de D5. Si el dueño quiere los dos enlaces visibles, mostrarle antes una propuesta del pie, como exige el proyecto. No sugiero hacer visible el pie por cuenta del trabajador. Revelarlos al foco también requiere aprobación por su efecto visible y no resuelve por sí solo la finalidad del contenido oculto.

**Prueba de aceptación:** ningún enlace permanentemente invisible en el recorrido con Tab; si se aprueba un diseño con enlaces, ambos son visibles/utilizables y el dueño revisó antes la propuesta.

### L-2 · P3 — Las variantes nuevas no pasan por las reglas posteriores de `Link`

**Archivo y líneas:** `vercel.json:10-32` frente a `:34-48`.

Las reglas nuevas que sirven Markdown por `mode=agent` o User-Agent no tienen `continue: true`; terminan el recorrido y no alcanzan las cabeceras `Link` definidas después. El tipo de contenido y `Vary` sí están en cada regla terminal, de modo que no es un fallo de selección del cuerpo. La negociación por `Accept` ya tenía esta limitación antes de la rama.

**Recomendación no bloqueante:** si se pretende conservar esos enlaces de descubrimiento en todas las representaciones, poner las reglas de cabeceras con `continue` antes de las reglas terminales, o repetir `Link` en éstas. No agregar simplemente `continue: true` a los rewrites sin analizar el resto del recorrido. Verificar las cabeceras reales en la vista previa autorizada.

### Resultado de los focos pedidos

- **Regex de `has`: correcta para el formato admitido.** El esquema oficial de Vercel describe `value` de tipo string como regex; no exige grupos con nombre cuando no se usan capturas en `dest`. Los patrones de esta rama son sintácticamente válidos. Validé las rutas contra el esquema descargado de https://openapi.vercel.sh/vercel.json.
- **Selección y orden del cuerpo:** correctos en lectura estática. Las reglas condicionales preceden a `handle: filesystem`, por lo que no queda primero el HTML estático. Las cabeceras necesarias de tipo y variación están en las rutas terminales. La salvedad de `Link` está en L-2.
- **Los seis bots elegidos:** pasan a Markdown tanto en `/` como en las dos formas de `/getting-started`. Probé los seis nombres dentro de User-Agents con prefijo Mozilla y versión. **Googlebot, bingbot, OAI-SearchBot, Claude-SearchBot, Applebot, DuckDuckBot, YandexBot y Baiduspider no coinciden por User-Agent.** Un buscador que solicite explícitamente Markdown por `Accept` seguirá recibiéndolo: ése es el comportamiento anterior y deliberado, no una entrada accidental en la lista nueva.
- **`mode=agent`:** aplica a la raíz, como exige A6; no es necesario extenderlo a todas las páginas. `Vary: Accept, User-Agent` es razonable para las variantes de cabeceras; el modo usa la URL de consulta. No hay que agregar `mode` a `Vary`, que enumera nombres de cabeceras, no parámetros de URL.
- **Límite importante:** los 52 casos son una simulación propia de las expresiones y del orden, no una ejecución de Vercel. No presento las rutas ni su caché como verificadas en producción. Antes de publicarlas, probar una vista previa autorizada, alternando navegador, bots y `mode=agent` para detectar contaminación entre representaciones.
- **A11:** las sustituciones h5/h6 → div conservan los selectores de estilo correspondientes; el ajuste móvil de Triage también se actualizó. No encontré scripts que dependan de los h5/h6 eliminados. El HTML compilado tiene cero h5/h6; sus niveles presentes son h1, h2, h3 y h4. No repetí una captura independiente en navegador; la evidencia visual del trabajador no se presenta aquí como una captura mía.
- **A12:** el feed compilado tiene exactamente cuatro nodos únicos: Organization, WebSite, SoftwareApplication y HowTo. Comparé cada objeto con los nodos de los `<script type="application/ld+json">` de ambas páginas compiladas, agregando sólo el `@context` del grafo: igualdad exacta. El mapa XML usa las dos namespaces y `sf:contentType` exigidos; el `schemamap:` de robots apunta a una URL absoluta HTTPS. Concuerda con NLWeb Schema Feeds v0.1, §§3–5 y 7.1. El `lastmod` fijo `2026-11-06` es válido **hoy**; debe cambiar con el contenido del feed, no en cada build. También se puede omitir porque es opcional. No es un defecto actual.
- **D3:** `identity=https://supcoflow.dev` coincide con el publicador del identificador. `identityType=https`, `relation=source`, `sourceId` fijado al commit y `sourceDigest=sha256:…` son compatibles con el schema entregado. Validé tanto la entrada como `$defs/TrustManifest` por separado: el schema entregado usa `TrustManifest` con mayúscula en `EntryFields`, así que validar sólo la entrada no sería prueba suficiente del campo minúsculo publicado. El SHA-256 de los bytes del SKILL.md antiguo coincide: `093ad7f0df992fe43533d64688786d3b6cc3bdc7bea691984a2b7559fa9ad96f`. No se inventan auditoría, firma ni marco de verificación. **No confundir este manifiesto descriptivo con una certificación criptográfica de confianza.**
- **Versiones antiguas:** esta rama sigue anunciando skill 0.4.0 y terminal 0.9.0, según lo excluido expresamente del pedido. No lo cuento como regresión nueva, pero la integración debe incluir la corrección `fm/versiones-publicadas` y volver a comprobar que versión, URL fijada y digest cambian juntos. No publicar las versiones viejas como actuales por mezclar sólo esta rama.
- **A8/A16:** de acuerdo con no implementarlos a ciegas. El dueño exigió evidencia previa. No agregar un tipo de datos sin contenido real ni frontmatter sólo para perseguir puntos. El experimento de vista previa queda sujeto a autorización; tampoco hay garantía de puntos adicionales. **U5 sigue fuera**, como se había acordado.

**Veredicto landing:** no integrar el conjunto actual. Retirando L-1, el resto es integrable desde esta revisión de código, con L-2 opcional y la prueba real de rutas pendiente antes de publicar.

## 2. CLI

### C-1 · P2 — La regla nueva de no-interacción contradice `agents set-key`

**Archivo y líneas del cambio:** `AGENTS.md:47-49`.

Dice que con `--json` un comando nunca hace preguntas y que, sin terminal, sale 3 indicando el flag faltante. En realidad:

1. `src/comandos/agentes.ts:43` no incluye `json` entre los flags que usa el comando.
2. En `:297-301`, sin terminal y sin `--from-env`, retorna **4 `sin_terminal`**, no 3.
3. En `:321-324`, con terminal llama a `leerClaveOculta` aunque el objeto de flags contenga `json: true`. `src/entorno.ts:575-579` calcula esa interactividad sólo con los TTY de stdin/stdout/stderr, no con `--json`.

Lo reproduje sobre la función compilada, inyectando un guardado y proyecto ficticios y una lectura de teclado que sólo cuenta la pregunta y devuelve cancelación. No pedí ni usé ninguna clave real y no hubo llamadas de red:

```text
flags: agent=chat, fromEnv=null, dryRun=false, json=true
Deps.esTty=true:  preguntas=1, salida=3, error=cancelado
Deps.esTty=false: preguntas=0, salida=4, error=sin_terminal
```

**Impacto:** un agente que crea esta regla puede tratar mal el código 4 y, si dispone de una pseudoterminal, dejar un proceso esperando una entrada que creía imposible. También es importante no convertir la salida 4 en una invitación a conseguir una clave por chat.

**Recomendación para esta rama documental:** describir la excepción de `agents set-key` con precisión: sin terminal necesita a la persona y sale 4; con terminal puede pedir la clave sin eco incluso con `--json`. La clave nunca pasa por el asistente. No «arreglar» sólo el test para sostener una afirmación que el código no cumple.

**Trabajo que convendría promover por separado:** si la política deseada es realmente que `--json` nunca pregunte, pasar ese modo al comando, impedir el prompt y agregar un test TTY + JSON antes del cambio. Eso sería una modificación de comportamiento del CLI, no necesaria para corregir la veracidad de este `AGENTS.md`.

### Resto de la comprobación

- Node >=24, ESM, TypeScript, binario y ausencia de dependencias de runtime coinciden con `package.json`.
- Scripts y rutas citadas existen. `dist/` es salida ignorada. El catálogo público se mantiene en `src/comandos/describir.ts`, con apoyo de contrato y flags citados en el documento.
- Los códigos 0–6, prioridad de `SUPCOFLOW_TOKEN`, URL de API fija y excepción local por variable de entorno coinciden con código y pruebas.
- Los controles de no filtrar la clave de IA, `--from-env` como nombre y mensajes fijos de esos comandos están implementados y cubiertos por los tests.
- La autorización y techo de la prueba con gasto existen. No ejecuté esa prueba real.
- La salida de la terminal construida `node dist/cli.js describe --json` es **idéntica como JSON** al vector `describe-0.10.0.json` de skills.

**Veredicto CLI:** no integrar tal cual por C-1; tras corregir ese párrafo, no encuentro otro impedimento para integrar esta rama documental. Tests, typecheck y build verdes.

**Preguntas para el dueño:** ninguna necesaria para corregir esta rama. Un eventual cambio de comportamiento de `--json` puede decidirse aparte, sin bloquear la corrección documental.

## 3. Skills

### S-1 · P2 — La excepción de huella no garantiza lo que el documento dice hoy

**Archivo y línea del cambio:** `AGENTS.md:20`.

El documento presenta `SIN_PUBLICAR` como la versión aún no publicada y afirma que una versión publicada nunca obtiene una huella reescrita. Pero `scripts/huella.mjs:20-21` sigue fijando `SIN_PUBLICAR = "0.5.0"`, y `:75-93` acepta el override para esa versión sin consultar ningún estado de publicación. El informe de referencia, sección 3, ya da **0.5.0 como publicada**, y el pedido parte de ese estado. El README también conserva una nota antigua de «sin publicar»; no sirve como prueba de que siga sin publicar hoy.

**Reproducción segura:** copié `skills/` y `test/vectores/` a un directorio nuevo del laboratorio, agregué allí un archivo de texto a `referencias/` sin cambiar `metadata.version` y ejecuté el script original con `HUELLA_RAIZ` apuntando a esa copia:

```bash
HUELLA_RAIZ=<copia-descartable> node <repo>/scripts/huella.mjs --escribir --sin-subir-version
```

Resultado:

```text
exit=0
huella-de-la-skill.json: 0.5.0 2a4aac5c29b5d4f73b3b78ab4ca71bfce1bab393e8174432e20ffbfca2206ef0
```

Es decir, **sí reescribe** la huella tras modificar el texto de la versión 0.5.0. La reproducción no alteró el texto ni el registro del repo revisado. No se hizo ninguna publicación.

**Impacto:** estas instrucciones nuevas pueden llevar a un agente a usar una excepción obsoleta y cambiar el contenido de una versión que las personas ya reciben, sin subirla. Eso debilita precisamente la regla que el documento intenta proteger.

**Recomendación:** no presentar el script como garantía automática de «no publicado» ni recomendar su excepción para la 0.5.0. Indicar que el estado de publicación se verifica aparte y que toda modificación de la versión ya publicada requiere subir la versión. Si se conserva el mecanismo excepcional, actualizar/desactivar la constante y sus tests para no permitirlo en 0.5.0. La causa técnica ya existía en la base; la rama nueva la documenta como una garantía que hoy no se cumple.

### S-2 · P3 — La regla de vectores mezcla copias externas con contenido propio

**Archivo y línea:** `AGENTS.md:24`.

Dice que todos los archivos de `test/vectores/`, salvo la huella, son copias de otros repos y no deben escribirse a mano. El README, sección Versiones, distingue `motivos-de-la-guia.json`: los `motivo` vienen del motor, pero `queHacer` es **propio de la skill**. No todo ese archivo puede obtenerse copiando su fuente externa.

**Recomendación:** distinguir los vectores byte a byte de la tabla enriquecida por la skill; al actualizar ésta se sincronizan los motivos externos y se revisa el texto propio. Es una precisión menor, no un motivo adicional para rechazar el manifiesto.

### `plugin.json`: aprobado contra el spec actual

Consulté directamente:

- https://agent-plugins.org/specification y su representación https://agent-plugins.org/specification.md — versión **1.0.0, Published**.
- https://agent-plugins.org/schemas/1.0.0/plugin.schema.json — descargado y usado para validación Ajv 2020-12.

Resultado: **válido, campos y ubicación correctos**.

- Va en `plugin.json` **en la raíz del plugin**: §§4.1 y 5.1. No debe mudarse a `.claude-plugin/` para cumplir este estándar.
- `$schema` es exactamente el identificador canónico exigido.
- `name=supcoflow-skills` cumple las restricciones de nombre.
- `description` y `repository` son campos permitidos de tipo string.
- `version`, `author`, licencia y otros metadatos son opcionales. No hace falta inventarlos.
- No debe agregarse un campo superior `skills`: la lista cerrada de §5.2 no lo permite. El descubrimiento sale de **`skills/<nombre>/SKILL.md`**, según §§6.1 y 7.1. La skill existente está exactamente en `skills/supcoflow/SKILL.md`.
- No hace falta declarar MCP ni crear `mcp.json`: no hay uno en este repo, y su ausencia está permitida.

El resto de `AGENTS.md` describe correctamente el script de tests, el cálculo normal de huella, la versión fijada de terminal y la comprobación de comandos y flags contra el vector. Los 284 tests pasan.

**Veredicto skills:** no integrar tal cual por S-1. Con la instrucción corregida y sin prometer una protección inexistente, el manifiesto y el resto de la rama son integrables; S-2 es menor. No hace falta una decisión de producto del dueño para esos arreglos.

## Preguntas al dueño: inventario consolidado para Firstmate

Estas preguntas **ya venían planteadas en el pedido de landing** y siguen sin respuesta acreditada en los materiales revisados. No las contesté ni tomé decisiones de diseño o publicación:

1. **Enlaces al código:** «¿Querés que se vean los enlaces al código de las dos herramientas? Si sí, primero te mostramos una propuesta del pie de página; si no, retiramos los enlaces ocultos y dejamos los que ya están en el texto para asistentes».
2. **Prueba antes de publicar:** «¿Autorizás publicar una versión temporal de prueba para comprobar que cada asistente recibe el texto correcto? Podemos limitarla a eso, o usarla también para comprobar las dos mejoras de puntuación que quedaron pendientes».

Opciones de la segunda pregunta: sólo comprobar las rutas A6/A17; sumar el experimento A8/A16; o no autorizar ninguna publicación temporal por ahora. No se ejecutó ningún scan nuevo ni despliegue. No presupongo que una prueba o servicio externo sea gratuito.

**Inventario de cierre:** no está vacío. Corresponde que Firstmate registre o vincule **una tarea de decisión consolidada** para estas preguntas y atestigüe la finalización con ese inventario. El revisor no administra el backlog ni ejecuta `complete --none` con preguntas pendientes.

## Evidencia y cómo repetir lo esencial

Comandos de identificación y diferencias, todos de sólo lectura sobre las fuentes:

```bash
git -C /Users/germanflores/.treehouse/landing-2aa734/1/landing diff dcbe051 fm/orank-grupo-a
git -C /Users/germanflores/.treehouse/cli-fb15e0/1/cli diff d385f7a fm/orank-a-cli
git -C /Users/germanflores/.treehouse/skills-6496f0/1/skills diff 6e26df8 fm/orank-a-skills
```

Cada copia ejecutable se hizo así, sustituyendo repo, rama y destino por los de cada fila:

```bash
git -C <worktree-fuente> archive <rama> | tar -x -C <directorio-del-laboratorio>
```

Prueba independiente del digest ARD, sin depender de la constante de la landing:

```bash
git -C /Users/germanflores/.treehouse/skills-6496f0/1/skills \
  show 797c386a2838cec0b01ab2aed9c82157da9aa9de:skills/supcoflow/SKILL.md | shasum -a 256
# 093ad7f0df992fe43533d64688786d3b6cc3bdc7bea691984a2b7559fa9ad96f
```

Para repetir C-1 sin tocar red ni llavero: importar `agentesPonerClave` de `dist/comandos/agentes.js`; pasar los flags `repo:'d/r', agent:'chat', fromEnv:null, dryRun:false, provider:null, option:null, dataRetention:null, json:true`; inyectar `guardado.leerClaveCompleta` con un valor ficticio y `completa:true`, `buscarProyecto` con `{id:'proj_test',repo:'d/r'}`, `git` devolviendo que no hay clon y `leerClaveOculta` que incremente un contador y retorne `null`. Con `esTty:true` el contador termina en 1; con `false` retorna 4 `sin_terminal` antes de preguntar.

Para repetir las rutas sin atribuirle valor de prueba de red: aplicar `src` al pathname y cada `has.value` como `^(?:<patrón>)$`, recorrer en orden y comprobar las tres rutas `/`, `/getting-started`, `/getting-started/` con los seis bots seleccionados, los ocho buscadores enumerados y un navegador; añadir `Accept: text/markdown`, `mode=agent`, valores distintos de `agent` y una página ajena. La simulación propia pasó los **52 casos**, pero sólo un pedido real a una vista previa podrá verificar el comportamiento de Vercel y su caché.

Los logs completos y el script de comprobaciones quedaron durante la sesión en `.review/evidence/` y `.review/check.mjs` del laboratorio descartable. Las salidas, resultados y reproducciones necesarias están incluidos arriba porque **sólo este informe sobrevive al cierre**.

## Resumen final en castellano simple

Los cambios principales están bien encaminados y todas las pruebas locales terminaron bien. No se inventó un servidor ni una función de producto para sumar puntos. El archivo que presenta la skill a otros asistentes está bien armado.

Antes de unir las ramas corregiría tres cosas: sacar del pie los enlaces que reciben el foco pero no se ven; contar con precisión cuándo la terminal puede pedir una clave; y no asegurar que está protegida una versión de la skill cuando todavía hay una orden que permite cambiarla sin subir su número.

No hace falta rediseñar ni publicar nada para corregir esas tres cosas. Mostrar enlaces visibles y publicar una versión temporal de prueba sí siguen requiriendo el permiso del dueño. No se publicó nada en esta revisión.
