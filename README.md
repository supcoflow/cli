# supcoflow

La terminal de [Supcoflow](https://app.supcoflow.dev): iniciar sesión y manejar el chat de soporte
desde la consola, o desde un asistente de código que corre comandos por vos.

Por ahora trae lo básico: iniciar y cerrar sesión, y ver con qué cuenta estás.

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
| `supcoflow describir --json` | Todo el contrato (comandos, flags, facultades de la clave, códigos) en una línea de JSON. |

`supcoflow --help` (o `supcoflow <comando> --help`) muestra la ayuda con ejemplos.

### Ejemplos

```bash
# Una persona frente a la terminal
supcoflow login

# Un asistente, sin terminal interactiva: dos pasos
supcoflow login --start --json     # sale 5 con verification_uri_complete y user_code
supcoflow login --wait --json      # sale 5 mientras la persona no apruebe; 0 cuando aprueba

supcoflow quien-soy --json
supcoflow logout --dry-run         # qué revocaría, sin revocar nada
```

## El contrato

Pensado para que lo lea un programa, no sólo una persona:

- **`--json`**: el resultado sale por stdout en **una línea** de JSON; los avisos van por stderr.
  Los errores también: `{"ok":false,"error":"…","message":"…"}`, con su código de salida.
- **Sin preguntas sin terminal interactiva** (o con `--json`): si falta un dato, sale 3 diciendo qué
  flag usar. `supcoflow login` sin terminal sale 3 y te indica el camino en dos pasos.
- **`--dry-run`** donde se puede simular (`login`, `login --start`, `logout`). `login --wait
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

Cuando iniciás sesión de nuevo, la clave anterior se revoca recién cuando la nueva quedó guardada; si
no se pudo revocar, queda anotada y se reintenta en el próximo `login` o `logout`.

## La API es fija

La terminal habla siempre con `https://app.supcoflow.dev`. Ningún archivo del repo puede cambiar
eso, así que clonar un repo ajeno y correr `supcoflow` no manda tu clave a otro servidor. Para
desarrollo, sólo la variable de entorno `SUPCOFLOW_API_URL` la mueve (`https`, o `http` contra
`localhost`), y lo guardado queda atado a la API que lo emitió: una clave de un motor local nunca
viaja a producción.
