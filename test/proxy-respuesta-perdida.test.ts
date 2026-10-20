// El proxy de P4 (bloque 7): una respuesta perdida DE VERDAD, sin ganchos de fallo dentro de la terminal
// publicada. Se prueba contra un motor falso en la propia máquina, nunca contra producción.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { crearProxy } from "../scripts/proxy-respuesta-perdida.ts";

let motor: Server;
let proxy: Server;
let base: string;
const recibidos: { metodo: string; ruta: string; key: string | undefined; cuerpo: string }[] = [];

beforeAll(async () => {
  motor = createServer((req, res) => {
    let cuerpo = "";
    req.on("data", (b) => (cuerpo += b));
    req.on("end", () => {
      recibidos.push({ metodo: req.method!, ruta: req.url!, key: req.headers["idempotency-key"] as string | undefined, cuerpo });
      res.writeHead(req.method === "POST" ? 202 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify({ prueba_id: "prb_0123456789abcdef", n: recibidos.length }));
    });
  });
  await new Promise<void>((r) => motor.listen(0, "127.0.0.1", r));
  proxy = crearProxy(new URL(`http://127.0.0.1:${(motor.address() as AddressInfo).port}`), { avisar: () => {} });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => proxy.close(r));
  await new Promise((r) => motor.close(r));
});

it("reenvía cada POST UNA vez, descarta sólo la primera respuesta y entrega la del reintento; los GET pasan", async () => {
  const post = () => fetch(`${base}/api/proyectos/p/pruebas`, {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": "k-1", authorization: "Bearer x" }, body: JSON.stringify({ techo_usd: 2 }),
  });
  await expect(post()).rejects.toThrow();
  expect(recibidos.filter((r) => r.metodo === "POST")).toHaveLength(1); // el motor sí lo recibió
  const segundo = await post();
  expect(segundo.status).toBe(202);
  expect(await segundo.json()).toMatchObject({ prueba_id: "prb_0123456789abcdef" });
  const posts = recibidos.filter((r) => r.metodo === "POST");
  expect(posts).toHaveLength(2);
  expect(posts.map((p) => p.key)).toEqual(["k-1", "k-1"]);
  expect(posts[1]!.cuerpo).toBe(JSON.stringify({ techo_usd: 2 }));
  const get = await fetch(`${base}/api/proyectos/p/diagnostico`);
  expect(get.status).toBe(200);
  // Un tercer POST también se entrega: sólo la primera respuesta se pierde.
  expect((await post()).status).toBe(202);
});

it("sólo acepta un destino https, o http contra la propia máquina", () => {
  expect(() => crearProxy(new URL("http://evil.example"), { avisar: () => {} })).toThrow();
});
