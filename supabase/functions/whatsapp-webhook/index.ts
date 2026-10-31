import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const WHATSAPP_API_VERSION = Deno.env.get("WHATSAPP_API_VERSION") ?? "v23.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function verifySignature(rawBody: string, signature: string) {
  if (!META_APP_SECRET || !signature.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(META_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = "sha256=" + Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  if (signature.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

async function sendWhatsApp(to: string, body: string) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) throw new Error("WhatsApp credentials are not configured");
  const response = await fetch(
    `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body },
      }),
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(`WhatsApp send failed (${response.status}): ${JSON.stringify(result)}`);
  return result;
}

async function answer(message: string) {
  const q = message.trim();
  if (!q) return "ابعت اسم الخدمة أو المنطقة اللي بتدور فيها، وهساعدك.";

  const [{ data: categories, error: catError }, { data: areas, error: areaError }] = await Promise.all([
    supabase.from("categories").select("id,name").eq("active", true).order("sort_order"),
    supabase.from("areas").select("id,name").eq("active", true).order("sort_order"),
  ]);
  if (catError || areaError) throw new Error("تعذر قراءة أقسام ومناطق دليل إسنا");

  const category = categories?.find((x) => q.toLowerCase().includes(x.name.toLowerCase()));
  const area = areas?.find((x) => q.toLowerCase().includes(x.name.toLowerCase()));

  if (/الأقسام|الاقسام|الخدمات|الأقسام المتاحة/.test(q)) {
    return "أقسام دليل إسنا: " + (categories ?? []).map((x) => x.name).join("، ") + ". ابعت اسم القسم أو المنطقة للبحث.";
  }
  if (/المناطق|الأماكن|الاماكن/.test(q)) {
    return "المناطق المتاحة: " + (areas ?? []).map((x) => x.name).join("، ");
  }

  let query = supabase.from("businesses")
    .select("name,description,address,phone,whatsapp")
    .eq("status", "published")
    .limit(8);
  if (category) query = query.eq("category_id", category.id);
  if (area) query = query.eq("area_id", area.id);

  const terms = q.split(/\s+/).filter((w) =>
    w.length > 2 && w !== category?.name && w !== area?.name
  );
  if (terms.length) {
    const safeTerms = terms.map((w) => w.replace(/[(),.*]/g, "")).filter(Boolean);
    if (safeTerms.length) query = query.or(safeTerms.map((w) => `name.ilike.%${w}%`).join(","));
  }

  const { data: businesses, error } = await query;
  if (error) throw new Error("تعذر البحث في أنشطة دليل إسنا");
  if (!businesses?.length) {
    return "ملقتش نتيجة مؤكدة بالبحث ده في دليل إسنا. جرّب اسم خدمة أو منطقة تانية، أو اكتب (موظف) عشان نوصلك بالإدارة.";
  }

  return "لقيت لك النتائج دي في دليل إسنا:\n" +
    businesses.map((b, i) =>
      `${i + 1}) ${b.name}${b.address ? " — " + b.address : ""}${b.phone ? " — تليفون: " + b.phone : ""}${b.whatsapp ? " — واتساب: " + b.whatsapp : ""}`
    ).join("\n") + "\nلو عايز تفاصيل أكتر ابعت اسم المحل.";
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && META_VERIFY_TOKEN && token === META_VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  if (!(await verifySignature(rawBody, signature))) return json({ error: "Invalid signature" }, 401);

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // Acknowledge Meta immediately; process messages asynchronously.
  const work = (async () => {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value?.messages ?? []) {
          if (message.type !== "text") continue;
          const reply = await answer(message.text?.body ?? "");
          await sendWhatsApp(message.from, reply);
        }
      }
    }
  })();

  // Edge Functions support waitUntil for work after the response.
  // Awaiting here keeps processing within the request lifecycle on all supported runtimes.
  try {
    await work;
  } catch (error) {
    console.error("Webhook processing error:", error);
  }
  return json({ ok: true });
});
