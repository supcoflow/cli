// `supcoflow describir --json`: el contrato entero en una línea (§13), para que un asistente sepa
// qué comandos hay, con qué flags, qué puede la clave y qué quiere decir cada código, sin leer la
// ayuda pensada para personas. La ayuda se arma desde acá: una sola fuente, así no se desfasan.
import { SALIDA, type Resultado } from "../contrato.ts";

type Comando = { nombre: string; resumen: string; flags: string[]; ejemplos: string[]; codigos: number[] };

// A mano a propósito, como en api.ts: tiene que coincidir con package.json (lo pinza un test).
const VERSION = "0.1.0";

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
  ],
  flags_globales: ["--json: el resultado en una línea de JSON por stdout; los avisos van por stderr", "--help, -h: la ayuda con ejemplos"],
  facultades: [
    {
      nombre: "consultar",
      incluye: "Identidad y equipo, proyectos, configuración, casos, issues, runs, costos, estado de la instalación",
      con_api_key: true,
    },
    {
      nombre: "configurar",
      incluye: "Crear/reusar proyecto, conectar o desconectar el repo, configurar y prender el chat, sitios permitidos, acuerdo de datos, política de problemas, publicar la guía, crear y revocar claves de consulta, perfiles de los agentes",
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
