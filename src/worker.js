export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true, service: "isna-whatsapp-webhook" });
    if (url.pathname !== "/webhook") return new Response("Not found", { status: 404 });

    if (request.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && env.META_VERIFY_TOKEN && token === env.META_VERIFY_TOKEN && challenge) {
        return new Response(challenge, { status: 200 });
      }
      return new Response("Forbidden", { status: 403 });
    }

    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const rawBody = await request.text();
    if (!await verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), env.META_APP_SECRET)) {
      return new Response("Invalid signature", { status: 401 });
    }

    // Acknowledge Meta quickly; process messages after signature validation.
    const payload = JSON.parse(rawBody);
    const tasks = [];
    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        for (const message of change.value?.messages || []) {
          if (message.type === "text" && message.from && message.text?.body) {
            tasks.push(handleMessage(message.from, message.text.body, env));
          }
        }
      }
    }
    const results = await Promise.allSettled(tasks);
    for (const result of results) if (result.status === "rejected") console.error("Message processing failed", result.reason);
    return new Response("EVENT_RECEIVED", { status: 200 });
  }
};

async function verifyMetaSignature(body, signature, secret) {
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const hex = [...digest].map(b => b.toString(16).padStart(2, "0")).join("");
  const expected = "sha256=" + hex;
  if (signature.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function supabaseGet(table, query, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase secrets missing");
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const endpoint = new URL(base + "/rest/v1/" + table);
  for (const [key, value] of Object.entries(query)) endpoint.searchParams.set(key, value);
  const response = await fetch(endpoint, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY }
  });
  if (!response.ok) throw new Error("Supabase query failed: " + response.status);
  return response.json();
}

async function sendWhatsApp(to, body, env) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) throw new Error("WhatsApp secrets missing");
  const version = env.WHATSAPP_API_VERSION || "v23.0";
  const response = await fetch(`https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: "Bearer " + env.WHATSAPP_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body } })
  });
  const result = await response.json();
  if (!response.ok) throw new Error("WhatsApp send failed: " + JSON.stringify(result));
  return result;
}

async function answer(text, env) {
  const q = (text || "").trim();
  if (!q) return "ابعت اسم الخدمة أو المنطقة اللي بتدور فيها، وهساعدك.";
  const [categories, areas] = await Promise.all([
    supabaseGet("categories", { select: "id,name", active: "eq.true", order: "sort_order.asc" }, env),
    supabaseGet("areas", { select: "id,name", active: "eq.true", order: "sort_order.asc" }, env)
  ]);
  const category = categories.find(x => q.toLowerCase().includes(String(x.name).toLowerCase()));
  const area = areas.find(x => q.toLowerCase().includes(String(x.name).toLowerCase()));
  if (/الأقسام|الاقسام|الخدمات|الأقسام المتاحة/.test(q)) return "أقسام دليل إسنا: " + categories.map(x => x.name).join("، ") + ". ابعت اسم القسم أو المنطقة للبحث.";
  if (/المناطق|الأماكن|الاماكن/.test(q)) return "المناطق المتاحة: " + areas.map(x => x.name).join("، ");
  const filters = { select: "name,description,address,phone,whatsapp", status: "eq.published", limit: "8" };
  if (category) filters.category_id = "eq." + category.id;
  if (area) filters.area_id = "eq." + area.id;
  const terms = q.split(/\s+/).filter(w => w.length > 2 && w !== category?.name && w !== area?.name);
  if (terms.length) filters.or = "(" + terms.map(w => "name.ilike.*" + w.replace(/[(),.*]/g, "") + "*").join(",") + ")";
  const businesses = await supabaseGet("businesses", filters, env);
  if (!businesses.length) return "ملقتش نتيجة مؤكدة بالبحث ده في دليل إسنا. جرّب اسم خدمة أو منطقة تانية، أو اكتب (موظف) عشان نوصلك بالإدارة.";
  return "لقيت لك النتائج دي في دليل إسنا:\n" + businesses.map((b, i) => `${i + 1}) ${b.name}${b.address ? " — " + b.address : ""}${b.phone ? " — تليفون: " + b.phone : ""}${b.whatsapp ? " — واتساب: " + b.whatsapp : ""}`).join("\n") + "\nلو عايز تفاصيل أكتر ابعت اسم المحل.";
}

async function handleMessage(from, text, env) {
  const reply = await answer(text, env);
  await sendWhatsApp(from, reply, env);
}
