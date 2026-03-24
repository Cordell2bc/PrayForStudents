export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  if (!env.INTERCEDE_KV) {
    return new Response(JSON.stringify({ error: "KV namespace not bound" }), {
      status: 500, headers,
    });
  }

  if (request.method === "GET") {
    const data = await env.INTERCEDE_KV.get("people");
    return new Response(data || "[]", { headers });
  }

  if (request.method === "POST") {
    const body = await request.text();
    try {
      JSON.parse(body);
      await env.INTERCEDE_KV.put("people", body);
      return new Response(JSON.stringify({ ok: true }), { headers });
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400, headers,
      });
    }
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405, headers,
  });
}
