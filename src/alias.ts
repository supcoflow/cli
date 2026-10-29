// Los nombres que la terminal tenía hasta la 0.7.0 (castellano). Siguen funcionando como alias, pero no salen en
// `describe` ni en la ayuda: el nombre canónico es el inglés. Todo el castellano de nombres vive acá, en un
// solo archivo, para que la alarma de textos (`test/textos-en-ingles.test.ts`) pueda dejarlo afuera.

// El comando viejo (completo, de una o dos palabras) → el canónico.
export const COMANDOS_VIEJOS: Readonly<Record<string, string>> = {
  "quien-soy": "whoami",
  describir: "describe",
  "repo conectar": "repo connect",
  "proyecto crear": "project create",
  "proyecto ver": "project show",
  catalogo: "catalog",
  configuracion: "config",
  "chat prender": "chat on",
  "chat apagar": "chat off",
  "chat marca": "chat brand",
  "sitios agregar": "sites add",
  "sitios quitar": "sites remove",
  "datos fijar": "data set",
  "politica fijar": "policy set",
  "claves crear": "keys create",
  "claves listar": "keys list",
  "claves revocar": "keys revoke",
  "guia revisar": "guide check",
  "guia publicar": "guide publish",
  "guia ver": "guide show",
  "guia usar": "guide use",
  "instalacion anotar": "install record",
  diagnosticar: "diagnose",
  probar: "test",
};

// El flag viejo (sin los guiones) → el canónico.
export const FLAGS_VIEJOS: Readonly<Record<string, string>> = {
  "autorizo-gasto": "authorize-spend",
  "desde-github": "from-github",
  permitir: "allow",
  modo: "mode",
  mensaje: "message",
  prueba: "test-id",
  sitio: "site",
  titulo: "title",
  saludo: "greeting",
  tema: "theme",
  archivo: "file",
  nombre: "name",
  "guardar-en": "save-to",
  origen: "source",
};

// Los valores viejos de los flags con valores fijos → el canónico. A la API siempre viaja el valor de la API
// (`relevar`, `guardar`, `agente`, `nada`…): cada comando traduce el que recibe.
export const POLITICA_VIEJA: Readonly<Record<string, "investigate" | "save">> = { relevar: "investigate", guardar: "save" };
export const ORIGEN_VIEJO: Readonly<Record<string, "repo" | "agent">> = { repo: "repo", agente: "agent" };
export const PERMITIDOS_VIEJOS: Readonly<Record<string, string>> = {
  usuario_id: "user_id",
  usuario_rol: "user_role",
  pagina_y_navegador: "page_and_browser",
  capturas: "screenshots",
  elementos: "elements",
  nada: "nothing",
};
export const PREFIJO_VIEJO_DE_ATRIBUTO = "atributo:";
