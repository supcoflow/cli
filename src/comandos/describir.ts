// `supcoflow describir --json`: el contrato entero en una línea (§13), para que un asistente sepa
// qué comandos hay, con qué flags, qué puede la clave y qué quiere decir cada código, sin leer la
// ayuda pensada para personas. La ayuda se arma desde acá: una sola fuente, así no se desfasan.
import { SALIDA, type Resultado } from "../contrato.ts";

type Comando = { nombre: string; resumen: string; flags: string[]; ejemplos: string[]; codigos: number[] };

// A mano a propósito, como en api.ts: tiene que coincidir con package.json (lo pinza un test).
const VERSION = "0.7.0";

export const DESCRIPCION: {
  version: string;
  comandos: Comando[];
  flags_globales: string[];
  facultades: { nombre: string; incluye: string; con_api_key: boolean }[];
  codigos: Record<string, string>;
} = {
  version: VERSION,
  comandos: [
    {
      nombre: "login",
      resumen: "Inicia sesión aprobando un código desde la consola. Sin terminal interactiva, en dos pasos: --start y después --wait.",
      flags: [
        "--start: pide el código y sale 5 con la URL para aprobarlo",
        "--wait: espera la aprobación hasta 90 s; sale 5 si todavía no llegó (volvé a llamarlo)",
        "--dry-run: dice qué haría sin pedir nada (no vale con --wait)",
        "--json",
      ],
      ejemplos: ["supcoflow login", "supcoflow login --start --json", "supcoflow login --wait --json"],
      codigos: [0, 1, 2, 3, 4, 5],
    },
    {
      nombre: "logout",
      resumen: "Revoca la clave en uso y la borra de esta máquina; reintenta las que quedaron por revocar.",
      flags: ["--dry-run: dice qué revocaría sin revocar nada", "--json"],
      ejemplos: ["supcoflow logout", "supcoflow logout --json"],
      codigos: [0, 1, 3],
    },
    {
      nombre: "quien-soy",
      resumen: "Muestra con qué clave anda la terminal, a nombre de quién y en qué equipo.",
      flags: ["--json"],
      ejemplos: ["supcoflow quien-soy", "supcoflow quien-soy --json"],
      codigos: [0, 1, 2, 3],
    },
    {
      nombre: "describir",
      resumen: "Describe comandos, flags, facultades y códigos de salida, para un asistente.",
      flags: ["--json"],
      ejemplos: ["supcoflow describir --json"],
      codigos: [0],
    },
    {
      nombre: "repo conectar",
      resumen: "Conecta el repo de esta carpeta (o el de --repo) con la App de GitHub: una persona lo confirma en la consola. Sin terminal interactiva, en dos pasos: --start y después --wait.",
      flags: [
        "--start: pide la conexión y sale 5 con la URL para confirmarla",
        "--wait: espera la confirmación hasta 90 s; sale 5 si todavía no llegó (volvé a llamarlo)",
        "--repo owner/repo: el repo, si no es el «origin» de esta carpeta",
        "--dry-run: dice qué pediría sin pedir nada (--wait sólo lee)",
        "--json",
      ],
      ejemplos: ["supcoflow repo conectar", "supcoflow repo conectar --start --json", "supcoflow repo conectar --wait --json"],
      codigos: [0, 1, 2, 3, 4, 5],
    },
    {
      nombre: "proyecto crear",
      resumen: "Crea (o reusa) el proyecto del repo ya conectado y lo anota en .supcoflow/proyecto.json; un archivo distinto nunca se pisa (sale 4).",
      flags: [
        "--install \"…\": el comando de instalación, cuando el motor no lo puede deducir",
        "--test \"…\": el comando de pruebas, ídem",
        "--repo owner/repo: el repo, si no es el «origin» de esta carpeta (sin escribir el archivo)",
        "--dry-run: dice qué crearía sin crear nada",
        "--json",
      ],
      ejemplos: ["supcoflow proyecto crear --json", "supcoflow proyecto crear --install \"pnpm i\" --test \"pnpm test\""],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "proyecto ver",
      resumen: "Muestra el proyecto del repo: rama, comandos y el estado de la App de GitHub; null si todavía no tiene.",
      flags: ["--repo owner/repo: el repo, si no es el «origin» de esta carpeta", "--json"],
      ejemplos: ["supcoflow proyecto ver --json"],
      codigos: [0, 1, 2, 3],
    },
    {
      nombre: "catalogo",
      resumen: "Lista lo que se puede configurar en el chat (claves y valores admitidos) y el estado del contrato de la App.",
      flags: ["--json"],
      ejemplos: ["supcoflow catalogo --json"],
      codigos: [0, 1, 2, 3],
    },
    {
      nombre: "configuracion",
      resumen: "Muestra la configuración del proyecto del repo: chat, sitios, marca, política de problemas y acuerdo de datos. El acuerdo frena lo que se guarda y lo que lee la IA que releva; no cubre lo que ve la IA del chat mientras conversa.",
      flags: ["--repo owner/repo: el repo, si no es el «origin» de esta carpeta", "--json"],
      ejemplos: ["supcoflow configuracion --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "chat prender",
      resumen: "Prende el chat de soporte del proyecto. Hace falta una guía vigente (la publicada del repo o la aprobada de nuestro agente); si no, sale 4 (skill_no_aprobada).",
      flags: ["--repo owner/repo: el repo, si no es el «origin» de esta carpeta", "--dry-run: dice qué haría sin hacerlo", "--json"],
      ejemplos: ["supcoflow chat prender --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "chat apagar",
      resumen: "Apaga el chat de soporte del proyecto.",
      flags: ["--repo owner/repo: el repo, si no es el «origin» de esta carpeta", "--dry-run: dice qué haría sin hacerlo", "--json"],
      ejemplos: ["supcoflow chat apagar --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "chat marca",
      resumen: "Cambia título, saludo y colores del chat; lo que no nombrás queda como estaba.",
      flags: [
        "--titulo \"…\": el título del chat",
        "--saludo \"…\": el saludo inicial",
        "--tema clave=valor: un color o ajuste del tema (se repite, uno por clave)",
        "--repo owner/repo: el repo, si no es el «origin» de esta carpeta",
        "--dry-run: dice qué haría sin hacerlo",
        "--json",
      ],
      ejemplos: ["supcoflow chat marca --titulo \"Ayuda\" --tema acento=#0a7"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "chat logo",
      resumen: "Sube el logo del chat (.png, .jpg o .webp, hasta 200 KB).",
      flags: ["--archivo ruta: la imagen", "--repo owner/repo: el repo, si no es el «origin» de esta carpeta", "--dry-run: dice qué haría sin hacerlo", "--json"],
      ejemplos: ["supcoflow chat logo --archivo logo.png --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "sitios agregar",
      resumen: "Agrega un sitio desde el que el chat puede cargarse.",
      flags: ["--sitio https://…: el sitio", "--repo owner/repo: el repo, si no es el «origin» de esta carpeta", "--dry-run: dice qué haría sin hacerlo", "--json"],
      ejemplos: ["supcoflow sitios agregar --sitio https://app.ejemplo.com"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "sitios quitar",
      resumen: "Quita un sitio de los que pueden cargar el chat.",
      flags: ["--sitio https://…: el sitio", "--repo owner/repo: el repo, si no es el «origin» de esta carpeta", "--dry-run: dice qué haría sin hacerlo", "--json"],
      ejemplos: ["supcoflow sitios quitar --sitio https://app.ejemplo.com"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "datos fijar",
      resumen: "Fija el acuerdo de datos: qué datos pasan. Frena lo que se guarda y lo que lee la IA que releva el repo; no cubre lo que ve la IA del chat mientras conversa.",
      flags: [
        "--permitir lista: datos que pasan, separados por coma (usuario_id, usuario_rol, pagina_y_navegador, capturas, elementos, email, atributo:nombre) o `nada`",
        "--repo owner/repo: el repo, si no es el «origin» de esta carpeta",
        "--dry-run: dice qué haría sin hacerlo",
        "--json",
      ],
      ejemplos: ["supcoflow datos fijar --permitir usuario_id,atributo:plan"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "politica fijar",
      resumen: "Fija qué hace el motor con un problema que llega por el chat: relevarlo en el acto (gasta) o guardarlo. Guardar frena sólo lo automático del chat: desde la consola una persona puede pedir el relevamiento, y cuesta.",
      flags: ["--modo relevar|guardar", "--repo owner/repo: el repo, si no es el «origin» de esta carpeta", "--dry-run: dice qué haría sin hacerlo", "--json"],
      ejemplos: ["supcoflow politica fijar --modo guardar"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "claves crear",
      resumen: "Crea una clave de consulta (sólo lee su proyecto) y la guarda en un archivo 0600 fuera de todo repo; el secreto nunca sale por la salida.",
      flags: [
        "--nombre ci: para qué es la clave",
        "--guardar-en ruta: el archivo donde queda (fuera de un repo; si ya tiene otra cosa sale 4 y no lo toca)",
        "--repo owner/repo: el repo, si no es el «origin» de esta carpeta",
        "--dry-run: dice qué haría sin hacerlo",
        "--json",
      ],
      ejemplos: ["supcoflow claves crear --nombre ci --guardar-en ~/ci.key --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "claves listar",
      resumen: "Lista las claves de consulta activas del proyecto (id, nombre, fecha; nunca el secreto).",
      flags: ["--repo owner/repo: el repo, si no es el «origin» de esta carpeta", "--json"],
      ejemplos: ["supcoflow claves listar --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "claves revocar",
      resumen: "Revoca una clave de consulta por su id; revocar dos veces deja lo mismo.",
      flags: ["--id cla_…: la clave (la da `claves listar`)", "--repo owner/repo: el repo, si no es el «origin» de esta carpeta", "--dry-run: dice qué haría sin hacerlo", "--json"],
      ejemplos: ["supcoflow claves revocar --id cla_0123456789abcdef --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "guia revisar",
      resumen: "Revisa .supcoflow/guia.md (la raíz de este clon) contra el motor, sin publicar nada: dice si está bien armada y cuántas secciones tiene. Es el paso antes del commit.",
      flags: ["--repo owner/repo: el repo, si no es el «origin» de esta carpeta (sin clon local sale 3 falta_guia: la guía se lee del archivo)", "--dry-run: dice qué mandaría sin mandarlo", "--json"],
      ejemplos: ["supcoflow guia revisar --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "guia publicar",
      resumen: "Sube .supcoflow/guia.md directo: manda el contenido y el commit y la rama que declara este clon (si hay git y commits; si no, sin commit). El motor la revisa y la deja como guía activa; el commit queda como «declarado por la terminal, no verificado en GitHub». Con --desde-github conserva la vía anterior: manda la huella y el motor la compara con la de la rama principal; si todavía no está subida a esa rama (o es otra), sale 5.",
      flags: ["--desde-github: no sube el archivo; verifica contra la rama principal de GitHub (sale 5 guia_no_subida / guia_distinta si no coincide)", "--repo owner/repo: el repo, si no es el «origin» de esta carpeta (sin clon local sale 3 falta_guia: la guía se lee del archivo)", "--dry-run: dice qué mandaría (o la huella con --desde-github), sin pedir nada", "--json"],
      ejemplos: ["supcoflow guia publicar --json"],
      codigos: [0, 1, 2, 3, 4, 5],
    },
    {
      nombre: "guia ver",
      resumen: "Muestra la guía activa del proyecto, de dónde viene y si la rama principal sigue teniendo esa versión (`al_dia` en el JSON).",
      flags: ["--repo owner/repo: el repo, si no es el «origin» de esta carpeta", "--json"],
      ejemplos: ["supcoflow guia ver --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "guia usar",
      resumen: "Elige cuál guía queda activa cuando hay dos: la del repo o la de nuestro agente.",
      flags: ["--origen repo|agente: cuál queda activa (obligatorio)", "--repo owner/repo: el repo, si no es el «origin» de esta carpeta", "--dry-run: dice qué haría sin hacerlo", "--json"],
      ejemplos: ["supcoflow guia usar --origen repo --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "widget",
      resumen: "Muestra lo que hay que pegar en la app para tener el chat, armado por el motor con los ids del proyecto: el paquete y su versión exacta, el archivo envoltorio de Next.js (`nextjs.contenido`, tal cual, sin reescribir los ids), cómo usarlo, la línea de CSP y la de <script> (no para Next.js). No escribe archivos. Sale 4 sin_proyecto si el repo no tiene proyecto; 1 respuesta_inesperada si el motor manda algo a medias.",
      flags: ["--repo owner/repo: el repo, si no es el «origin» de esta carpeta", "--json: el objeto del motor tal cual"],
      ejemplos: ["supcoflow widget --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "instalacion anotar",
      resumen: "Anota en .supcoflow/instalacion.json (la raíz de este clon) con qué versiones se instaló el chat: la skill, esta terminal, el paquete del chat (declarado en el package.json de la app e instalado en node_modules) y la configuración del proyecto; nunca un secreto ni una fecha. Repetir sin cambios no lo toca (sin_cambios: true). Lo reescribe sólo si git ya guarda el anterior: si tiene cambios sin commit (o está borrado sin commit) sale 4 cambios_sin_commit; si existe sin estar versionado (o ignorado), 4 archivo_no_versionado. Otros: 3 falta_skill / skill_invalida / app_fuera_del_repo / app_inexistente / sin_clon; 4 sin_proyecto / acuerdo_ilegible; 1 paquete_ilegible / configuracion_inesperada / archivo_no_escrito.",
      flags: [
        "--skill versión: la metadata.version de la skill que instala (semver, obligatorio; sin él sale 3 falta_skill sin pedir nada)",
        "--app carpeta: la carpeta de la app, relativa a la raíz del repo (por defecto la raíz; fuera del repo sale 3 app_fuera_del_repo)",
        "--repo owner/repo: el repo, si no es el «origin» de esta carpeta (sin clon local sale 3 sin_clon: el archivo va en el clon)",
        "--dry-run: muestra el archivo y la diferencia sin escribir nada",
        "--json",
      ],
      ejemplos: ["supcoflow instalacion anotar --skill 0.1.0 --app web --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "diagnosticar",
      resumen: "Dice, gratis y sin escribir nada, si una prueba del proyecto entraría y hasta dónde llegaría: instalación de GitHub, sitios, chat, guía, política, saldo del mes contra el techo de la prueba, pruebas abiertas y lo que el motor sume. Sale 0 si está todo listo y 4 si algo hay que arreglar (no_listo), con cada punto.",
      flags: ["--repo owner/repo: el repo, si no es el «origin» de esta carpeta", "--json"],
      ejemplos: ["supcoflow diagnosticar --json"],
      codigos: [0, 1, 2, 3, 4],
    },
    {
      nombre: "probar",
      resumen: "Prueba la instalación de punta a punta: un problema entra por la misma puerta que el chat y termina en un issue. Gasta un relevamiento (hasta el techo que dice el motor; con la política guardar llega hasta el caso guardado y no gasta). Sin --autorizo-gasto no manda nada: sale 4 falta_autorizacion con techo_usd, saldo_usd, tope_usd y comprometido_usd. Con --autorizo-gasto pide la prueba y sale 5 con prueba_id; después --wait la sigue. Otros: 4 prueba_en_curso (con su id), techo_distinto, chat_deshabilitado, requiere_api_key, intento_pendiente; 6 tope_mensual; 1 con intento_pendiente: true si la respuesta no llegó (repetir retoma la misma prueba).",
      flags: [
        "--autorizo-gasto: autoriza el gasto de UNA prueba, hasta el techo que mostró el motor; sin él no se manda nada que escriba",
        "--mensaje \"…\": el texto del problema de la prueba (por defecto, uno fijo del motor); con un pedido sin confirmar, otro --mensaje sale 4 intento_pendiente",
        "--wait: sigue la última prueba hasta 90 s; sale 5 mientras corre, 0 con el issue (o guardado), 4 si hace falta mirarla (con el enlace a la bandeja); el cobro sale como esté (pendiente nunca es 0)",
        "--prueba prb_…: con --wait, sigue esa prueba en vez de la última guardada",
        "--repo owner/repo: el repo, si no es el «origin» de esta carpeta",
        "--dry-run: dice qué haría (proyecto, techo, saldo, política) sin pedir nada que escriba",
        "--json",
      ],
      ejemplos: ["supcoflow probar --json", "supcoflow probar --autorizo-gasto --json", "supcoflow probar --wait --json", "supcoflow probar --dry-run --autorizo-gasto --json"],
      codigos: [0, 1, 2, 3, 4, 5, 6],
    },
  ],
  flags_globales: ["--json: el resultado en una línea de JSON por stdout; los avisos van por stderr", "--help, -h: la ayuda con ejemplos"],
  facultades: [
    {
      nombre: "consultar",
      incluye: "Identidad y equipo, proyectos, configuración, casos, issues, runs, costos, estado de la instalación, leer y revisar la guía (guia revisar, guia ver)",
      con_api_key: true,
    },
    {
      nombre: "configurar",
      incluye: "Crear/reusar proyecto, conectar o desconectar el repo, configurar y prender el chat, sitios permitidos, acuerdo de datos, política de problemas, publicar la guía, elegir la guía activa (guia usar), crear y revocar claves de consulta, perfiles de los agentes",
      con_api_key: true,
    },
    { nombre: "probar", incluye: "La prueba hasta el issue (gasta, dentro de los topes)", con_api_key: true },
    {
      nombre: "solo_consola",
      incluye: "Subir el tope de gasto, borrar el proyecto, encender la fábrica, dar o sacar acceso a personas: sólo con sesión en la consola",
      con_api_key: false,
    },
    {
      nombre: "operador",
      incluye: "Solicitudes, /maquinaria, cerrar runs, la fábrica de operador: nunca por clave, aunque la persona sea operadora",
      con_api_key: false,
    },
  ],
  codigos: {
    [SALIDA.ok]: "ok",
    [SALIDA.inesperado]: "inesperado",
    [SALIDA.faltaLogin]: "falta login",
    [SALIDA.entradaInvalida]: "entrada inválida",
    [SALIDA.haceFaltaUnaPersona]: "hace falta una persona",
    [SALIDA.esperandoAUnaPersona]: "esperando a una persona (volvé a llamar)",
    [SALIDA.topeAlcanzado]: "tope alcanzado",
  },
};

export function comandoDescribir(): Resultado {
  return { codigo: SALIDA.ok, json: { ok: true, ...DESCRIPCION }, texto: ayuda(null) };
}

function bloque(c: Comando): string {
  return [
    `  ${c.nombre}: ${c.resumen}`,
    ...c.flags.map((f) => `      ${f}`),
  ].join("\n");
}

export function ayuda(comando: string | null): string {
  const elegidos = comando === null ? DESCRIPCION.comandos : DESCRIPCION.comandos.filter((c) => c.nombre === comando);
  const uso = comando === null ? "supcoflow <comando> [flags]" : `supcoflow ${comando} [flags]`;
  const codigos = Object.entries(DESCRIPCION.codigos).map(([n, t]) => `  ${n}  ${t}`);
  return [
    `Uso: ${uso}`,
    "",
    comando === null ? "Comandos:" : "Comando:",
    ...elegidos.map(bloque),
    "",
    "Flags de todos los comandos:",
    ...DESCRIPCION.flags_globales.map((f) => `  ${f}`),
    "",
    "Ejemplos:",
    ...elegidos.flatMap((c) => c.ejemplos.map((e) => `  ${e}`)),
    "",
    "Códigos de salida:",
    ...codigos,
  ].join("\n");
}
