export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  }

  if (!env.INTERCEDE_KV) {
    return new Response(JSON.stringify({ ok: true }), { headers });
  }

  // We don't know which subscription this device has without storing something client-side.
  // The client sends its subscription endpoint hash so we can mark it as seen.
  let endpointHash = null;
  try {
    const body = await request.json();
    endpointHash = body.endpointHash;
  } catch (_e) {}

  if (endpointHash) {
    const key = "push:" + endpointHash;
    const raw = await env.INTERCEDE_KV.get(key);
    if (raw) {
      const record = JSON.parse(raw);
      record.lastSeen = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      await env.INTERCEDE_KV.put(key, JSON.stringify(record));
    }
  }

  return new Response(JSON.stringify({ ok: true }), { headers });
}
