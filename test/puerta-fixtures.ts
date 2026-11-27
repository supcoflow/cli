// Las formas de lo que contesta el motor en la etapa 2c, tomadas de los ejemplos fijos del contrato de la puerta v1 (`docs/reestructura/contrato-v1/`: 05, 07, 15, 18, 20) y de
// `docs/reestructura/la-api-de-reportes.md` (PR 215 de la app). Todas las claves son de mentira y lo dicen (`…-no-real`). Nada de esto toca producción.

/** La clave de un agente de INVESTIGACIÓN (ejemplo 05 del contrato). */
export const CLAVE_DE_AGENTE = "scf_ag_clainv01_ejemplo-de-clave-de-investigacion-no-real";
/** La clave de un agente de CHAT (ejemplo 17). */
export const CLAVE_DE_CHAT = "scf_ag_clachat01_ejemplo-de-clave-de-chat-no-real";
/** La clave de una PERSONA (la que deja `login`). */
export const CLAVE_DE_PERSONA = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
/** Trozos de la clave del agente: nada de lo que sale de la terminal puede llevar ninguno. */
export const PEDAZOS_DE_LA_CLAVE = [CLAVE_DE_AGENTE, "ejemplo-de-clave-de-investigacion", "clainv01", "de-investigacion-no-real"];

export const PASE = "pse_ejemplo0001.ejemplo-de-pase-no-real";

export const PROYECTO = { id: "proj_ejemplo", slug: "ejemplo", repo: "d/r", rama: "main", install_command: "npm ci", test_command: "npm test" };

// Ejemplo 15.
export const ESTADO_DEL_AGENTE = {
  agente_id: "agc_inv_ejemplo", nombre: "Investigador de producción", tipo: "investigacion", proyecto_id: "proj_ejemplo", activo: true, es_el_investigador_activo: true,
  conectado_por: { persona_id: "usr_ejemplo", nombre_visible: "Fulana" },
  ultimo_aviso: { webhook_id: "msg_avs_ejemplo0001", en: "2026-12-01T12:00:00Z", intentos: 1, respuesta: 200 },
  asignados_sin_entregar: 1, tope: { avisos_por_hora: 60, usados_esta_hora: 3 },
};

// Ejemplo 05.
export const RESPUESTA_DEL_PASE = {
  pase: PASE, audiencia: "agc_chat_ejemplo", contenido: { url: "https://agentes-de-supcoflow.example.com/api/supcoflow/contenido", ref: "msg_cli_7f3a" },
  proyecto_id: "proj_ejemplo", reporte_id: "rpt_ejemplo0001", para: { tipo: "agente", id: "agc_inv_ejemplo" }, permisos: ["leer"], vence_en: "2026-12-01T12:05:00Z",
  acuerdo: { usuario_id: false, usuario_rol: true, atributos: [], pagina_y_navegador: true, capturas: true, elementos: false, email: false },
};

// Ejemplo 07 (el resultado) y su lectura.
export const RESULTADO = {
  agente: { nombre: "investigador-de-referencia", version: "0.1.0", modelo: "anthropic/claude-sonnet-5", cli: "@anthropic-ai/claude-code@2.4.1", prompt_version: "triaje-v12" },
  intencion: "error", decision: { valor: "abrir_issue" }, necesita_persona: { valor: false },
  diagnostico: {
    titulo: "Checkout total ignores the discount after changing the shipping method",
    que_pasa: "When the shipping method changes, the cart total is recomputed from the item prices without the applied coupon.",
    donde_esta: ["src/checkout/total.ts:42-58", "src/checkout/envio.ts:17"],
    como_se_comprueba: "Apply coupon DEMO10, then switch shipping from standard to express: the total goes back to the full price.",
  },
  confianza: { nivel: "media", comentario: "The recompute path is clear; I could not run the app." },
  supuestos: ["The coupon is stored only in the cart state, not in the order draft."], preguntas_abiertas: ["Does express shipping use a different pricing service?"],
  entorno: { pagina: "/checkout", navegador: "Firefox 140", version_app: "3.2.0", errores: [] }, evidencia: [{ tipo: "captura", ref: "evd_cli_01" }],
  costo: { tokens_entrada: 182340, tokens_salida: 4210, usd: 0.61 },
};
export const HUELLA_DEL_RESULTADO = "sha256:05b3a29f598cef96b6af27c760924cffbd906d1b28d8b431e9193678739875e9";
export const LECTURA_PUBLICADA = {
  reporte_id: "rpt_ejemplo0001", proyecto_id: "proj_ejemplo", creado_en: "2026-12-01T11:59:58Z", canal: "chat", investigador: { tipo: "agente", agente_id: "agc_inv_ejemplo" },
  agente_declarado: RESULTADO.agente, decision: "abrir_issue", intencion: "error", necesita_persona: false,
  costo: { declarado_por_el_agente: true, tokens_entrada: 182340, tokens_salida: 4210, usd: 0.61 },
  publicacion: { estado: "publicado", entrega: "ent_ejemplo0001", huella: HUELLA_DEL_RESULTADO, issue: { numero: 412, url: "https://github.com/ejemplo/app/issues/412" } },
};

// Ejemplo 18.
export const FALLO = {
  agente: RESULTADO.agente, motivo: "modelo_no_disponible", costo: { tokens_entrada: 41200, tokens_salida: 310, usd: 0.13 },
};
export const HUELLA_DEL_FALLO = "sha256:f9a47887b65e86c9d68fb04a0df3b36a7dcb5c751b53ce7556245fec34da3b76";
export const LECTURA_DEL_FALLO = {
  reporte_id: "rpt_ejemplo0010", proyecto_id: "proj_ejemplo", creado_en: "2026-12-01T12:00:00Z", canal: "chat", investigador: { tipo: "agente", agente_id: "agc_inv_ejemplo" },
  agente_declarado: RESULTADO.agente, estado: "el_agente_fallo", te_necesitan: true,
  entrega: { tipo: "fallo", entrega: "ent_fallo0001", huella: HUELLA_DEL_FALLO, motivo: "modelo_no_disponible" },
  costo: { declarado_por_el_agente: true, tokens_entrada: 41200, tokens_salida: 310, usd: 0.13 }, publicacion: null,
  acciones: ["abrir igual (sin investigar)", "cambiar de investigador"],
};

// La API de una persona (`la-api-de-reportes.md`).
export const CONTEO = {
  con_issue: 1, sin_issue: 0, esperando: 0, relevando: 0, sin_run: 1, guardado: 0, arranque_incierto: 0, reclamado_sin_run: 0,
  esperando_a_tu_agente: 0, tu_agente_no_contesto: 1, el_agente_fallo: 0, publicacion_a_revisar: 0,
};
export const LISTA_DE_REPORTES = {
  proyecto_id: "proj_ejemplo", ahora: "2026-12-01T12:00:00Z", filtro: "todos", conteo: CONTEO, total: 3, pagina: 1, paginas: 1, por_pagina: 25,
  reportes: [
    { reporte_id: "rpt_ejemplo0001", titulo: "No anda el login", creado_en: "2026-12-01T07:00:00Z", origen: "externo", estado: "con_issue", estado_texto: "issue creado",
      te_necesitan: false, issue: { numero: 12, url: "https://github.com/ejemplo/app/issues/12" }, investigador: { tipo: "supcoflow", agente_id: null } },
    { reporte_id: "rpt_ejemplo0002", titulo: null, creado_en: "2026-12-01T08:00:00Z", origen: "equipo", estado: "sin_run", estado_texto: "sin investigar",
      te_necesitan: true, issue: null, investigador: { tipo: "supcoflow", agente_id: null } },
    { reporte_id: "rpt_ejemplo0003", titulo: null, creado_en: "2026-12-01T09:00:00Z", origen: "externo", estado: "tu_agente_no_contesto", estado_texto: "tu agente no contestó",
      te_necesitan: true, issue: null, investigador: { tipo: "agente", agente_id: "agc_inv_ejemplo" } },
  ],
};

export const recorridoDe = (reporteId: string, o: Record<string, unknown> = {}) => ({
  reporte_id: reporteId, proyecto_id: "proj_ejemplo", titulo: null, creado_en: "2026-12-01T07:00:00Z", origen: "externo", estado: "tu_agente_no_contesto", estado_texto: "tu agente no contestó",
  te_necesitan: true, investigador: { tipo: "agente", agente_id: "agc_inv_ejemplo" }, issue: null,
  eventos: [{ clave: "reportado", texto: "Reportado en https://app.example.com/login", cuando: "2026-12-01T07:00:00Z", href: null }],
  aviso: { tono: "mal", titulo: "Tu agente no contestó", texto: "Pasaron 2 horas desde el aviso." },
  avisos: [{ webhook_id: "msg_avs_ejemplo0001", ronda: 1, creado_en: "2026-12-01T07:00:00Z", vence_en: "2026-12-01T09:00:00Z", entrega: "agotado", resolucion: "plazo_vencido",
    intentos: [{ intento: 1, respuesta: "no_contesta" }, { intento: 6, respuesta: 503 }] }],
  run: null, acciones: [{ accion: "pedir_investigacion", via: "agente_de_afuera" }],
  enlace_a_la_consola: `https://app.example.com/projects/ejemplo/reports/${reporteId}`,
  ...o,
});

/** Un reporte del camino de hoy que se puede investigar (gasta). */
export const RECORRIDO_INVESTIGABLE = recorridoDe("rpt_ejemplo0002", {
  estado: "sin_run", estado_texto: "sin investigar", investigador: { tipo: "supcoflow", agente_id: null }, avisos: [], aviso: null,
  acciones: [{ accion: "pedir_investigacion", via: "supcoflow" }],
});
/** Un reporte con issue: por esta API no hay nada que pedir. */
export const RECORRIDO_SIN_ACCIONES = recorridoDe("rpt_ejemplo0001", {
  estado: "con_issue", estado_texto: "issue creado", te_necesitan: false, investigador: { tipo: "supcoflow", agente_id: null }, avisos: [], aviso: null, acciones: [],
  issue: { numero: 12, url: "https://github.com/ejemplo/app/issues/12" },
  eventos: [
    { clave: "reportado", texto: "Reportado en https://app.example.com/login", cuando: "2026-12-01T07:00:00Z", href: null },
    { clave: "issue", texto: "Issue #12", cuando: "2026-12-01T08:00:00Z", href: "https://github.com/ejemplo/app/issues/12" },
  ],
});

export const DIAGNOSTICO = {
  listo: true, politica: "relevar", puntos: [{ punto: "chat", ok: true, mensaje: "El chat está prendido.", grupo: "instalacion" }],
  techo_usd: 2, saldo_usd: 7.5, tope_usd: 10, comprometido_usd: 2.5, prueba_abierta: null,
};
