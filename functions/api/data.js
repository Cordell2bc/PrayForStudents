export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };

  if (request.method === "OPTIONS") return new Response(null, { headers });

  if (!env.INTERCEDE_KV) {
    return new Response(JSON.stringify({ error: "KV namespace not bound" }), { status: 500, headers });
  }

  if (request.method === "GET") {
    const data = await env.INTERCEDE_KV.get("people");
    return new Response(data || "[]", { headers });
  }

  if (request.method === "POST") {
    const body = await request.text();
    let incoming;
    try {
      incoming = JSON.parse(body);
      if (!Array.isArray(incoming)) throw new Error("not array");
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers });
    }

    // Refuse to store empty — safety net
    if (incoming.length === 0) {
      return new Response(JSON.stringify({ error: "Refusing to store empty data" }), { status: 400, headers });
    }

    // Read current KV and merge person-by-person using updatedAt
    let stored = [];
    try {
      const raw = await env.INTERCEDE_KV.get("people");
      if (raw) stored = JSON.parse(raw);
      if (!Array.isArray(stored)) stored = [];
    } catch { stored = []; }

    // Build lookup maps
    const storedMap = Object.fromEntries(stored.map(p => [p.id, p]));
    const incomingMap = Object.fromEntries(incoming.map(p => [p.id, p]));

    // Merge: for each unique ID, keep whichever version has a newer updatedAt
    const allIds = new Set([...Object.keys(storedMap), ...Object.keys(incomingMap)]);
    const merged = [];
    for (const id of allIds) {
      const s = storedMap[id];
      const i = incomingMap[id];
      if (s && i) {
        // Both have this person — keep the newer one
        merged.push((i.updatedAt || 0) >= (s.updatedAt || 0) ? i : s);
      } else {
        // Only one side has this person — keep it
        merged.push(s || i);
      }
    }

    // Sort by original incoming order where possible, new entries at end
    const incomingOrder = incoming.map(p => p.id);
    merged.sort((a, b) => {
      const ai = incomingOrder.indexOf(a.id);
      const bi = incomingOrder.indexOf(b.id);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return 0;
    });

    await env.INTERCEDE_KV.put("people", JSON.stringify(merged));
    return new Response(JSON.stringify({ ok: true, count: merged.length }), { headers });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
}
