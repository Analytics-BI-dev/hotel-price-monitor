import "server-only";

import { request as httpsRequest } from "node:https";

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

// HBook needs a larger response-header allowance than the default Node fetch.
export const hbookFetch: typeof fetch = async (input, init = {}) => {
  const target = new URL(input instanceof Request ? input.url : String(input));
  const headers = new Headers(init.headers);
  headers.set("Accept-Encoding", "identity");
  headers.set("User-Agent", "HotelPriceMonitor/1.0");
  if (init.body != null && typeof init.body !== "string") {
    throw new Error("O transporte do HBook aceita somente payload textual.");
  }

  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(target, {
      method: init.method ?? "GET",
      headers: Object.fromEntries(headers.entries()),
      maxHeaderSize: 256 * 1024,
      signal: init.signal ?? undefined,
    }, (response) => {
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += buffer.length;
        if (receivedBytes > MAX_RESPONSE_BYTES) {
          request.destroy(new Error("A resposta do HBook excedeu o limite de tamanho."));
          return;
        }
        chunks.push(buffer);
      });
      response.on("error", reject);
      response.on("aborted", () => reject(new Error("Resposta do HBook interrompida.")));
      response.on("end", () => {
        try {
          const responseHeaders = new Headers();
          const contentType = response.headers["content-type"];
          if (typeof contentType === "string") responseHeaders.set("Content-Type", contentType);
          const status = response.statusCode ?? 500;
          resolve(new Response(
            [204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
            { status, statusText: response.statusMessage, headers: responseHeaders },
          ));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
    if (typeof init.body === "string") request.write(init.body);
    request.end();
  });
};
