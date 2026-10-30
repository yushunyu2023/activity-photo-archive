import { expect, test } from "@playwright/test";
import { readResponseBytesWithLimit } from "../src/lib/storage";

test("bounded response reader rejects a chunked stream without Content-Length", async () => {
  let pulls = 0;
  const chunk = new Uint8Array(4 * 1024 * 1024);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls > 5) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
    },
  });
  const response = new Response(stream, {
    headers: { "content-type": "application/octet-stream" },
  });
  expect(response.headers.get("content-length")).toBeNull();

  await expect(
    readResponseBytesWithLimit(response, 10 * 1024 * 1024),
  ).rejects.toThrow("加密对象超过本地安全读取上限");
  expect(pulls).toBe(3);
});

test("bounded response reader preserves normal bytes", async () => {
  const source = new TextEncoder().encode("bounded-response-reader");
  const response = new Response(source, {
    headers: { "content-type": "application/octet-stream" },
  });

  const result = await readResponseBytesWithLimit(response, 1024);
  expect(Buffer.from(result)).toEqual(Buffer.from(source));
});
