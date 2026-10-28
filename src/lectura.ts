// Por qué `leerArchivoChico` no pudo leer un archivo. Son frases sueltas que van después de «I can't read X:», y
// los comandos comparan contra estas constantes (nunca contra el texto a mano).
export const NO_LEIDO = {
  noExiste: "it doesn't exist",
  esUnEnlace: "it's a symlink",
  noSePudoAbrir: "it couldn't be opened",
  noEsComun: "it isn't a regular file",
  demasiadoGrande: "it's too large",
  noSePudoLeer: "it couldn't be read",
} as const;
