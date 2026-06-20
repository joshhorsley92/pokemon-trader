/**
 * NDJSON streaming wrapper for the analyzer routes: emits
 *   {"type":"status","message":"…"}      zero or more times
 *   {"type":"result","result":{…}}       on success
 *   {"type":"error","error":"…"}         on failure
 * one JSON object per line, so the client can show live progress on
 * long-running runs (a 10k-card MTG list takes minutes of Scryfall batches).
 */
export function ndjsonAnalysis(
  run: (progress: (message: string) => void) => Promise<unknown>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const result = await run((message) => send({ type: "status", message }));
        send({ type: "result", result });
      } catch (err) {
        send({
          type: "error",
          error: err instanceof Error ? err.message : "Analysis failed",
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}
