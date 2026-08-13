/**
 * Shopacific — CJ Dropshipping Proxy
 * Vercel Serverless Function
 * URL: https://your-project.vercel.app/api/cj
 */

const CJ_BASE = "https://developers.cjdropshipping.com/api2.0/v1";

// ── Token memory cache (process জীবিত থাকলে reuse হয়) ──
let _cachedToken = null;
let _tokenExpiry = 0;

const ALLOWED_ORIGINS = [
  "https://shopacific-8d9cd.web.app",
  "https://shopacific-8d9cd.firebaseapp.com",
  "https://shopacific.com",
];

function setCORS(req, res) {
  const origin = req.headers.origin || "";
  const ok =
    ALLOWED_ORIGINS.includes(origin) ||
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1") ||
    origin === "null" ||
    origin === "";
  res.setHeader("Access-Control-Allow-Origin", ok ? (origin || "*") : ALLOWED_ORIGINS[0]);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

async function getToken(email, apiKey) {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;

  const res = await fetch(`${CJ_BASE}/authentication/getAccessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: apiKey }),
  });
  const data = await res.json();

  if (!data.data?.accessToken) {
    throw new Error(data.message || "CJ login failed — email বা API key ভুল");
  }

  _cachedToken = data.data.accessToken;
  _tokenExpiry = Date.now() + 23 * 3600 * 1000;
  return _cachedToken;
}

async function cjFetch(path, method = "GET", body = null, token) {
  const opts = {
    method,
    headers: { "CJ-Access-Token": token, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${CJ_BASE}${path}`, opts);
  const data = await res.json();

  if (data.code === 401 || data.message === "Unauthorized") {
    _cachedToken = null;
    _tokenExpiry = 0;
    throw new Error("TOKEN_EXPIRED");
  }
  if (data.code !== 200) throw new Error(data.message || `CJ error ${data.code}`);
  return data.data;
}

export default async function handler(req, res) {
  setCORS(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }

  const body = req.body || {};
  const action = body.action || "";

  // Credentials: body থেকে অথবা Vercel Environment Variables থেকে
  const email  = body.email  || process.env.CJ_EMAIL  || "";
  const apiKey = body.apiKey || process.env.CJ_API_KEY || "";

  if (!email || !apiKey) {
    res.status(400).json({ ok: false, error: "CJ email ও API key দরকার।" });
    return;
  }

  try {
    let token;
    try {
      token = await getToken(email, apiKey);
    } catch (e) {
      res.status(401).json({ ok: false, error: e.message });
      return;
    }

    switch (action) {

      case "test":
        res.json({ ok: true, message: "✅ CJ সংযোগ সফল!", tokenPreview: token.slice(0, 20) + "…" });
        return;

      case "products": {
        const params = new URLSearchParams({
          pageNum:  body.pageNum  || 1,
          pageSize: Math.min(body.pageSize || 20, 100),
        });
        if (body.keyword)    params.set("productNameEn", body.keyword);
        if (body.categoryId) params.set("categoryId",    body.categoryId);
        const data = await cjFetch(`/product/list?${params}`, "GET", null, token);
        res.json({ ok: true, data });
        return;
      }

      case "product": {
        if (!body.pid) { res.status(400).json({ ok: false, error: "pid দরকার" }); return; }
        const data = await cjFetch(`/product/query?pid=${body.pid}`, "GET", null, token);
        res.json({ ok: true, data });
        return;
      }

      case "categories": {
        const data = await cjFetch("/product/getCategory", "GET", null, token);
        res.json({ ok: true, data });
        return;
      }

      case "shipping": {
        const { pid, country = "BD", qty = 1 } = body;
        if (!pid) { res.status(400).json({ ok: false, error: "pid দরকার" }); return; }
        const params = new URLSearchParams({ startCountryCode: "CN", endCountryCode: country, quantity: qty, pid });
        const data = await cjFetch(`/logistic/freightCalculate?${params}`, "GET", null, token);
        res.json({ ok: true, data });
        return;
      }

      case "createOrder": {
        if (!body.orderData) { res.status(400).json({ ok: false, error: "orderData দরকার" }); return; }
        const data = await cjFetch("/shopping/order/createOrderV2", "POST", body.orderData, token);
        res.json({ ok: true, data });
        return;
      }

      case "orderStatus": {
        if (!body.cjOrderId) { res.status(400).json({ ok: false, error: "cjOrderId দরকার" }); return; }
        const data = await cjFetch(`/shopping/order/getOrderDetail?orderId=${body.cjOrderId}`, "GET", null, token);
        res.json({ ok: true, data });
        return;
      }

      case "tracking": {
        if (!body.cjOrderId) { res.status(400).json({ ok: false, error: "cjOrderId দরকার" }); return; }
        const data = await cjFetch(`/logistic/track?orderId=${body.cjOrderId}`, "GET", null, token);
        res.json({ ok: true, data });
        return;
      }

      case "usdRate": {
        try {
          const r = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
          const d = await r.json();
          res.json({ ok: true, rate: d.rates?.BDT || 110 });
        } catch (_) {
          res.json({ ok: true, rate: 110, fallback: true });
        }
        return;
      }

      default:
        res.status(400).json({ ok: false, error: `Unknown action: "${action}"` });
    }

  } catch (err) {
    console.error("[CJ Proxy]", err);
    if (err.message === "TOKEN_EXPIRED") {
      res.status(401).json({ ok: false, error: "Token expired — retry করুন" });
      return;
    }
    res.status(500).json({ ok: false, error: err.message });
  }
}
