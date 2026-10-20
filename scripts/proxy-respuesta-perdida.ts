// El proxy de P4 (bloque 7, la prueba): una respuesta perdida DE VERDAD entre la terminal y el motor, sin
// ningún gancho de fallo dentro de la terminal publicada. No viaja en el paquete (`files` es sólo `dist`).
//
//   node scripts/proxy-respuesta-perdida.ts --destino https://app.supcoflow.dev --puerto 4555
//   SUPCOFLOW_API_URL=http://127.0.0.1:4555 supcoflow probar --autorizo-gasto --json   # sale 1, intento guardado
//   SUPCOFLOW_API_URL=http://127.0.0.1:4555 supcoflow probar --autorizo-gasto --json   # 5, la MISMA prueba
//
// Los DOS comandos van por el proxy: la terminal separa lo guardado por origen (src/entorno.ts), y cambiar de
// origen entre medio es otra clave (comprobado en la segunda revisión). Después, si se quiere,
// `supcoflow probar --wait --prueba <id>` directo contra el motor.
//
// Qué hace: reenvía cada pedido al destino UNA vez (nunca reintenta por su cuenta). Del primer POST a
// `…/pruebas` espera la respuesta del motor —o sea, el motor ya creó la prueba— y corta la conexión con la
// terminal sin contestar. Todo lo demás (GET, y los POST siguientes) pasa tal cual. No registra encabezados
// ni cuerpos: por acá pasa el Bearer.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

const LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Lo que fetch ya resolvió (descomprimió, desarmó) o que es de este salto y no del de afuera.
const SIN_REENVIAR = new Set(["host", "connection", "content-length", "transfer-encoding", "content-encoding", "keep-alive"]);

const esPostDePrueba = (req: IncomingMessage) => req.method === "POST" && /\/pruebas\/?$/.test(new URL(req.url ?? "/", "http://x").pathname);

export function crearProxy(destino: URL, o: { avisar?: (s: string) => void } = {}): Server {
  if (!(destino.protocol === "https:" || (destino.protocol === "http:" && LOCALES.has(destino.hostname)))) {
    throw new Error("El destino tiene que ser https, o http contra la propia máquina.");
  }
  const avisar = o.avisar ?? ((s: string) => void process.stderr.write(s + "\n"));
  let yaPerdio = false;

  async function atender(req: IncomingMessage, res: ServerResponse) {
    const partes: Buffer[] = [];
    for await (const b of req) partes.push(b as Buffer);
    const cuerpo = Buffer.concat(partes);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || SIN_REENVIAR.has(k)) continue;
      headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    }
    const perder = esPostDePrueba(req) && !yaPerdio;
    if (perder) yaPerdio = true;
    let r: Response;
    try {
      r = await fetch(new URL(req.url ?? "/", destino), {
        method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : cuerpo, redirect: "manual",
      });
    } catch {
      avisar(`${req.method} ${req.url} → sin respuesta del destino`);
      res.socket?.destroy();
      return;
    }
    const texto = Buffer.from(await r.arrayBuffer());
    if (perder) {
      // El motor ya contestó (y por lo tanto ya hizo lo suyo): la terminal no se entera.
      avisar(`${req.method} ${req.url} → ${r.status} DESCARTADA (la primera)`);
      res.socket?.destroy();
      return;
    }
    avisar(`${req.method} ${req.url} → ${r.status}`);
    const salida: Record<string, string> = {};
    r.headers.forEach((v, k) => { if (!SIN_REENVIAR.has(k)) salida[k] = v; });
    res.writeHead(r.status, { ...salida, "content-length": String(texto.length) });
    res.end(texto);
  }

  return createServer((req, res) => {
    atender(req, res).catch(() => res.socket?.destroy());
  });
}

// Corrido directo (`node scripts/proxy-respuesta-perdida.ts …`), no al importarse desde un test.
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n: string) => {
    const i = process.argv.indexOf(`--${n}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const destino = new URL(arg("destino") ?? "https://app.supcoflow.dev");
  const puerto = Number(arg("puerto") ?? "4555");
  crearProxy(destino).listen(puerto, "127.0.0.1", () => {
    process.stderr.write(`Proxy en http://127.0.0.1:${puerto} → ${destino.origin}. Descarta la primera respuesta a POST …/pruebas.\n`);
  });
}
