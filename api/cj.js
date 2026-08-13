const CJ_BASE = "https://developers.cjdropshipping.com/api2.0/v1";

let _token = null;
let _expiry = 0;

async function getToken(email, apiKey) {
  if (_token && Date.now() < _expiry) return _token;
  const r = await fetch(`${CJ_BASE}/authentication/getAccessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: apiKey }),
  });
  const d = await r.json();
  if (!d.data?.accessToken) throw new Error(d.message || "CJ auth failed");
  _token = d.data.accessToken;
  _expiry = Date.now() + 23 * 3600 * 1000;
  return _token;
}

async function cjCall(path, method, body, token) {
  const opts = {
    method: method || "GET",
    headers: { "CJ-Access-Token": token, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${CJ_BASE}${path}`, opts);
  const d = await r.json();
  if (d.code === 401) { _token = null; throw new Error("TOKEN_EXPIRED"); }
  if (d.code !== 200) throw new Error(d.message || "CJ error " + d.code);
  return d.data;
}

module.exports = async function (req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method === "GET") { res.json({ ok: true, msg: "Shopacific CJ Proxy running!" }); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "POST only" }); return; }

  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }

  const action = body.action || "";
  const email  = body.email  || process.env.CJ_EMAIL  || "";
  const apiKey = body.apiKey || process.env.CJ_API_KEY || "";

  if (!action) { res.status(400).json({ ok: false, error: "action দরকার" }); return; }

  // usdRate-এ CJ credentials লাগে না
  if (action === "usdRate") {
    try {
      const r = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
      const d = await r.json();
      res.json({ ok: true, rate: d.rates?.BDT || 110 });
    } catch (_) {
      res.json({ ok: true, rate: 110, fallback: true });
    }
    return;
  }

  if (!email || !apiKey) {
    res.status(400).json({ ok: false, error: "email ও apiKey দরকার" });
    return;
  }

  try {
    const token = await getToken(email, apiKey);

    if (action === "test") {
      res.json({ ok: true, message: "✅ CJ সংযোগ সফল!", tokenPreview: token.slice(0, 20) + "…" });
      return;
    }

    if (action === "products") {
      const p = new URLSearchParams({ pageNum: body.pageNum || 1, pageSize: Math.min(body.pageSize || 20, 100) });
      if (body.keyword)    p.set("productNameEn", body.keyword);
      if (body.categoryId) p.set("categoryId",    body.categoryId);
      const data = await cjCall("/product/list?" + p, "GET", null, token);
      res.json({ ok: true, data }); return;
    }

    if (action === "product") {
      const data = await cjCall("/product/query?pid=" + body.pid, "GET", null, token);
      res.json({ ok: true, data }); return;
    }

    if (action === "categories") {
      const data = await cjCall("/product/getCategory", "GET", null, token);
      res.json({ ok: true, data }); return;
    }

    if (action === "shipping") {
      const p = new URLSearchParams({ startCountryCode:"CN", endCountryCode: body.country||"BD", quantity: body.qty||1, pid: body.pid });
      const data = await cjCall("/logistic/freightCalculate?" + p, "GET", null, token);
      res.json({ ok: true, data }); return;
    }

    if (action === "createOrder") {
      const data = await cjCall("/shopping/order/createOrderV2", "POST", body.orderData, token);
      res.json({ ok: true, data }); return;
    }

    if (action === "orderStatus") {
      const data = await cjCall("/shopping/order/getOrderDetail?orderId=" + body.cjOrderId, "GET", null, token);
      res.json({ ok: true, data }); return;
    }

    if (action === "tracking") {
      const data = await cjCall("/logistic/track?orderId=" + body.cjOrderId, "GET", null, token);
      res.json({ ok: true, data }); return;
    }

    res.status(400).json({ ok: false, error: "Unknown action: " + action });

  } catch (err) {
    console.error("[CJ]", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
};
