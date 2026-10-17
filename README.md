# supcoflow

La terminal de [Supcoflow](https://app.supcoflow.dev): iniciar sesión y manejar el chat de soporte
desde la consola, o desde un asistente de código que corre comandos por vos.

Trae iniciar y cerrar sesión, ver con qué cuenta estás, conectar el repo con la App de GitHub,
crear su proyecto y configurar el chat.

## Instalar

Hace falta Node 24 o más nuevo.

```bash
npx supcoflow login
```

## Los comandos

| Comando | Qué hace |
|---|---|
| `supcoflow login` | Te muestra un enlace y un código; lo aprobás en la consola y la terminal queda con su clave. |
| `supcoflow login --start` | El primer paso, solo: pide el código y sale 5 con el enlace para aprobarlo. |
| `supcoflow login --wait` | El segundo paso: espera la aprobación hasta 90 s. Si todavía no llegó, sale 5: volvé a correrlo. |
| `supcoflow logout` | Revoca la clave en uso y la borra de esta máquina. |
| `supcoflow quien-soy` | Con qué clave anda la terminal, a nombre de quién y en qué equipo. |
| `supcoflow repo conectar` | Conecta el repo de esta carpeta con la App de GitHub: te da un enlace, lo confirmás en la consola. Sin terminal, `--start` y después `--wait`, como `login`. |
| `supcoflow proyecto crear` | Crea (o reusa) el proyecto del repo ya conectado y lo anota en `.supcoflow/proyecto.json`. Si el motor no deduce los comandos, `--install "…" --test "…"`. |
| `supcoflow proyecto ver` | El proyecto del repo: rama, comandos y el estado de la App de GitHub. |
| `supcoflow guia revisar` | Revisa `.supcoflow/guia.md` contra el motor sin publicar nada. |
| `supcoflow guia publicar` | Sube `.supcoflow/guia.md` directo (con el commit y la rama que declara tu clon, no verificados en GitHub). `--desde-github` verifica contra la rama principal en vez de subir el archivo. |
| `supcoflow guia ver` | Muestra la guía activa, de dónde viene y si la rama sigue al día. |
| `supcoflow guia usar --origen repo\|agente` | Elige cuál guía queda activa. |
| `supcoflow describir --json` | Todo el contrato (comandos, flags, facultades de la clave, códigos) en una línea de JSON. |

`supcoflow --help` (o `supcoflow <comando> --help`) muestra la ayuda con ejemplos. Los comandos de
repo y proyecto toman el repo del `origin` de la carpeta; `--repo owner/repo` lo elige a mano.

### De cero a un proyecto

1. `supcoflow login`: aprobás el código en la consola.
2. `supcoflow repo conectar`: instalás la App en GitHub si hace falta y tocás Confirmar.
3. `supcoflow proyecto crear`: queda el proyecto y `.supcoflow/proyecto.json` para commitear.
4. `supcoflow proyecto ver`: para revisar cómo quedó.

### Ejemplos

```bash
# Una persona frente a la terminal
supcoflow login

# Un asistente, sin terminal interactiva: dos pasos
supcoflow login --start --json     # sale 5 con verification_uri_complete y user_code
supcoflow login --wait --json      # sale 5 mientras la persona no apruebe; 0 cuando aprueba

supcoflow repo conectar --start --json   # sale 5 con la url para confirmar
supcoflow repo conectar --wait --json    # sale 5 mientras nadie confirme; 0 conectado
supcoflow proyecto crear --json          # 4 si hay un .supcoflow/proyecto.json distinto (no lo pisa)
supcoflow proyecto crear --install "pnpm i" --test "pnpm test"
supcoflow proyecto ver --json

supcoflow quien-soy --json
supcoflow logout --dry-run         # qué revocaría, sin revocar nada
```

## Configurar

Con el repo ya conectado y su proyecto creado, se configura el chat sin entrar a la consola (la clave
tiene que ser de sesión, no de consulta). Todos toman el repo del `origin`, o `--repo owner/repo`, y
los que escriben aceptan `--dry-run`.

| Comando | Qué hace |
|---|---|
| `supcoflow catalogo` | Qué se puede configurar y con qué valores. |
| `supcoflow configuracion` | Chat, sitios, marca y acuerdo de datos del proyecto. |
| `supcoflow chat prender` / `chat apagar` | Prende o apaga el chat (hace falta una guía: publicá la del repo con `supcoflow guia publicar` o generá y aprobá la de nuestro agente en Brain). |
| `supcoflow chat marca --titulo "Ayuda" --tema acento=#0a7` | Título, saludo y colores; lo no nombrado queda igual. |
| `supcoflow chat logo --archivo logo.png` | Sube el logo (.png, .jpg o .webp, hasta 200 KB). |
| `supcoflow sitios agregar\|quitar --sitio https://app.ejemplo.com` | Sitios desde los que carga el chat. |
| `supcoflow datos fijar --permitir usuario_id,atributo:plan` | Acuerdo de datos: frena lo que se guarda y lo que lee la IA que releva; no cubre lo que ve la IA del chat mientras conversa. |
| `supcoflow politica fijar --modo guardar` | Qué hace el motor con un problema que llega por el chat: `relevar` (gasta) o `guardar`. Guardar frena sólo lo automático del chat; una persona puede pedir el relevamiento desde la consola, y cuesta. |
| `supcoflow claves crear --nombre ci --guardar-en ~/ci.key` | Clave de consulta para CI: el secreto queda sólo en ese archivo (0600, fuera de un repo), nunca en la salida. |
| `supcoflow claves listar` / `claves revocar --id cla_…` | Ver y revocar claves de consulta. |

## La guía

La guía le cuenta al chat qué hace cada pantalla de tu producto. Vive en el repo, en
`.supcoflow/guia.md` (en la raíz). El flujo, en este orden:

1. `supcoflow guia revisar`: la revisa contra el motor sin publicar nada (si está mal armada, sale 3 con la línea de cada error).
2. `supcoflow guia publicar`: sube el archivo directo y queda como guía activa. Manda también el commit y la rama de tu
   clon (`git rev-parse HEAD`, si hay git y commits; si no, va sin commit): son declarados por la terminal, no
   verificados en GitHub, y así se muestran. Repetir con el mismo archivo no duplica.
3. Opcional, `supcoflow guia publicar --desde-github`: no sube el archivo; manda su huella y el motor la compara con la
   de la rama principal de GitHub (commit verificado). Si todavía no está subida (o la rama tiene otra), sale 5:
   subí la guía a la rama principal y volvé a correr.

`supcoflow guia ver` muestra la guía activa y si la rama sigue al día (`al_dia` en el JSON);
`supcoflow guia usar --origen repo|agente` elige cuál queda activa cuando hay una del repo y otra de nuestro agente.
Todos toman el repo del `origin`, o `--repo owner/repo` (con `revisar` y `publicar`, sin clon local de ese repo sale 3 `falta_guia`: la guía se lee del archivo); `revisar`, `publicar` y `usar` aceptan `--dry-run`; `--desde-github` es sólo de `publicar`.

El formato de `.supcoflow/guia.md`:

```markdown
# Guía de Mi App            ← opcional; se ignora

## Facturas                 ← una sección por pantalla o función (1 a 60). Nombre: 1–120 caracteres
Para qué sirve: Ver y pagar las facturas del mes.             ← obligatorio, 1–600
Qué puede hacer el usuario: Descargar el PDF, pagar con       ← obligatorio, 1–600; puede seguir
tarjeta y ver el historial.                                       en las líneas de abajo
Problemas comunes:                                            ← opcional; hasta 10, cada uno 1–300
- El botón Pagar no responde con tarjetas de débito.
- El PDF sale en blanco en Safari.
```

- Las etiquetas se reconocen al principio de la línea, sin distinguir mayúsculas y con o sin tildes
  («Para que sirve:» vale). Una línea que no es etiqueta continúa el campo anterior (se une con un espacio).
- Texto antes del primer `## ` que no sea el `# ` del título → error. Una etiqueta repetida en una sección →
  error. Una línea con `<` o `>` → error. Más de 64 KB → `guia_muy_grande`.

## El contrato

Pensado para que lo lea un programa, no sólo una persona:

- **`--json`**: el resultado sale por stdout en **una línea** de JSON; los avisos van por stderr.
  Los errores también: `{"ok":false,"error":"…","message":"…"}`, con su código de salida.
- **Sin preguntas sin terminal interactiva** (o con `--json`): si falta un dato, sale 3 diciendo qué
  flag usar. `supcoflow login` sin terminal sale 3 y te indica el camino en dos pasos.
- **`--dry-run`** donde se puede simular (`login`, `login --start`, `logout`, `repo conectar --start`,
  `proyecto crear`, `guia revisar`, `guia publicar`, `guia usar`). `login --wait
  --dry-run` sale 3: sondear consume el código y no hay cómo simularlo.

| Código | Quiere decir |
|---|---|
| 0 | ok |
| 1 | inesperado |
| 2 | falta login |
| 3 | entrada inválida |
| 4 | hace falta una persona |
| 5 | esperando a una persona: volvé a llamar |
| 6 | tope alcanzado |

## Dónde queda la clave

- En el **llavero del sistema** (Keychain en macOS, Secret Service con `secret-tool` en Linux).
- Si no hay llavero, en `~/.config/supcoflow/credenciales.json` (o `$XDG_CONFIG_HOME/supcoflow/…`)
  con permisos `0600`, y la terminal te avisa.
- **Nunca dentro de un repo de git**: si ese archivo cayera dentro de uno (un `HOME` que es un repo
  de dotfiles, por ejemplo), no guarda nada y te pide usar el llavero o `SUPCOFLOW_TOKEN`.
- **`SUPCOFLOW_TOKEN`** tiene prioridad sobre lo guardado: sirve para CI y para la nube.
- La clave nunca sale en un log ni en una salida `--json`.
- `proyecto crear` guarda su clave de idempotencia (no es un secreto: sólo evita crear dos veces si se
  pierde la respuesta) en `idempotencia.json`, al lado de las credenciales y con los mismos permisos.

Cuando iniciás sesión de nuevo, la clave anterior se revoca recién cuando la nueva quedó guardada; si
no se pudo revocar, queda anotada y se reintenta en el próximo `login` o `logout`.

## La API es fija

La terminal habla siempre con `https://app.supcoflow.dev`. Ningún archivo del repo puede cambiar
eso, así que clonar un repo ajeno y correr `supcoflow` no manda tu clave a otro servidor. Para
desarrollo, sólo la variable de entorno `SUPCOFLOW_API_URL` la mueve (`https`, o `http` contra
`localhost`), y lo guardado queda atado a la API que lo emitió: una clave de un motor local nunca
viaja a producción.
