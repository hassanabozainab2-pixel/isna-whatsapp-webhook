import express from "express";
import crypto from "node:crypto";

const app = express();
const PORT = process.env.PORT || 3000;
const {
  META_VERIFY_TOKEN,
  META_APP_SECRET,
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_API_VERSION = "v23.0",
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
} = process.env;

app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

function verifySignature(req) {
  if (!META_APP_SECRET) return false;
  const signature = req.get("x-hub-signature-256") || "";
  const expected = "sha256=" + crypto.createHmac("sha256", META_APP_SECRET).update(req.rawBody || Buffer.from("")).digest("hex");
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

async function supabaseGet(table, query) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase credentials are not configured");
  const url = new URL("/rest/v1/" + table, SUPABASE_URL);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY } });
  if (!response.ok) throw new Error("Supabase query failed: " + response.status);
  return response.json();
}

async function sendWhatsApp(to, body) {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) throw new Error("WhatsApp credentials are not configured");
  const response = await fetch(`https://graph.facebook.com/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: "Bearer " + WHATSAPP_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body } })
  });
  const data = await response.json();
  if (!response.ok) throw new Error("WhatsApp send failed: " + JSON.stringify(data));
  return data;
}

async function answer(text) {
  const q = (text || "").trim();
  if (!q) return "ابعت اسم الخدمة أو المنطقة اللي بتدور فيها، وهساعدك.";
  const categories = await supabaseGet("categories", { select: "id,name", active: "eq.true", order: "sort_order.asc" });
  const areas = await supabaseGet("areas", { select: "id,name", active: "eq.true", order: "sort_order.asc" });
  const category = categories.find(x => q.toLowerCase().includes(x.name.toLowerCase()));
  const area = areas.find(x => q.toLowerCase().includes(x.name.toLowerCase()));
  if (/الأقسام|الاقسام|الخدمات|الأقسام المتاحة/.test(q)) return "أقسام دليل إسنا: " + categories.map(x => x.name).join("، ") + ". ابعت اسم القسم أو المنطقة للبحث.";
  if (/المناطق|الأماكن|الاماكن/.test(q)) return "المناطق المتاحة: " + areas.map(x => x.name).join("، ");
  const filters = { select: "name,description,address,phone,whatsapp", status: "eq.published", limit: "8" };
  if (category) filters.category_id = "eq." + category.id;
  if (area) filters.area_id = "eq." + area.id;
  const terms = q.split(/\s+/).filter(w => w.length > 2 && ![category?.name, area?.name].includes(w));
  if (terms.length) filters.or = "(" + terms.map(w => "name.ilike.*" + w.replace(/[(),.*]/g, "") + "*").join(",") + ")";
  const businesses = await supabaseGet("businesses", filters);
  if (!businesses.length) return "ملقتش نتيجة مؤكدة بالبحث ده في دليل إسنا. جرّب اسم خدمة أو منطقة تانية، أو اكتب (موظف) عشان نوصلك بالإدارة.";
  return "لقيت لك النتائج دي في دليل إسنا:\n" + businesses.map((b,i) => `${i+1}) ${b.name}${b.address ? " — " + b.address : ""}${b.phone ? " — تليفون: " + b.phone : ""}${b.whatsapp ? " — واتساب: " + b.whatsapp : ""}`).join("\n") + "\nلو عايز تفاصيل أكتر ابعت اسم المحل.";
}

app.get("/health", (req,res) => res.json({ ok:true, service:"isna-whatsapp-webhook" }));
app.get("/webhook", (req,res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && META_VERIFY_TOKEN && token === META_VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});
app.post("/webhook", async (req,res) => {
  if (!verifySignature(req)) return res.sendStatus(401);
  res.sendStatus(200);
  try {
    for (const entry of req.body.entry || []) for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const message of value.messages || []) {
        if (message.type !== "text") continue;
        const from = message.from;
        const reply = await answer(message.text?.body || "");
        await sendWhatsApp(from, reply);
      }
    }
  } catch (error) { console.error("Webhook processing error:", error.message); }
});
app.listen(PORT, () => console.log("Isna WhatsApp webhook listening on " + PORT));
