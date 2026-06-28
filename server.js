const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

function requireLogin(req, res, next) {
  const auth = req.headers.authorization;

  if (!auth) {
    res.setHeader("WWW-Authenticate", 'Basic realm="CardHawk"');
    return res.status(401).send("Login required");
  }

  const encoded = auth.split(" ")[1];
  const decoded = Buffer.from(encoded, "base64").toString();
  const [user, pass] = decoded.split(":");

  if (
    user === process.env.CARDHAWK_USER &&
    pass === process.env.CARDHAWK_PASS
  ) {
    return next();
  }

  res.setHeader("WWW-Authenticate", 'Basic realm="CardHawk"');
  return res.status(401).send("Invalid login");
}

app.use(requireLogin);

async function getEbayToken() {
  const credentials = Buffer.from(
    `${process.env.EBAY_APP_ID.trim()}:${process.env.EBAY_CERT_ID.trim()}`
  ).toString("base64");

  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope"
  });

  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));

  return data.access_token;
}

async function searchEbay(query) {
  const token = await getEbayToken();

  const response = await fetch(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=12`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
      }
    }
  );

  const data = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(data));

  return data.itemSummaries?.map((item) => ({
    title: item.title,
    price: item.price,
    shipping: item.shippingOptions?.[0]?.shippingCost || { value: "0.00", currency: "USD" },
    condition: item.condition,
    url: item.itemWebUrl,
    image: item.image?.imageUrl
  })) || [];
}

app.get("/", async (req, res) => {
  try {
    const query = req.query.q || "baseball card";
    const results = await searchEbay(query);

    res.send(`
      <html>
        <head>
          <title>CardHawk</title>
          <style>
            body {
              margin: 0;
              font-family: Arial, sans-serif;
              background: #0f172a;
              color: white;
            }
            .container {
              max-width: 1100px;
              margin: auto;
              padding: 40px 20px;
            }
            h1 {
              font-size: 42px;
              margin-bottom: 10px;
            }
            .subtitle {
              color: #94a3b8;
              margin-bottom: 30px;
            }
            form {
              display: flex;
              gap: 10px;
              margin-bottom: 30px;
            }
            input {
              flex: 1;
              padding: 14px;
              border-radius: 10px;
              border: none;
              font-size: 16px;
            }
            button {
              padding: 14px 22px;
              border: none;
              border-radius: 10px;
              background: #38bdf8;
              color: #0f172a;
              font-weight: bold;
              cursor: pointer;
            }
            .grid {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
              gap: 20px;
            }
            .card {
              background: #1e293b;
              border: 1px solid #334155;
              border-radius: 16px;
              padding: 16px;
            }
            .card img {
              width: 100%;
              height: 220px;
              object-fit: contain;
              background: white;
              border-radius: 12px;
              margin-bottom: 12px;
            }
            .title {
              font-size: 16px;
              font-weight: bold;
              min-height: 60px;
            }
            .price {
              color: #22c55e;
              font-size: 22px;
              font-weight: bold;
              margin-top: 10px;
            }
            .meta {
              color: #cbd5e1;
              font-size: 14px;
              margin: 6px 0;
            }
            a {
              display: inline-block;
              margin-top: 12px;
              color: #38bdf8;
              font-weight: bold;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🦅 CardHawk</h1>
            <div class="subtitle">Live eBay card search. Private access only.</div>

            <form>
              <input name="q" value="${query}" placeholder="Search for a card..." />
              <button>Search</button>
            </form>

            <h2>Results for: ${query}</h2>

            <div class="grid">
              ${results.map(item => `
                <div class="card">
                  <img src="${item.image || ""}" />
                  <div class="title">${item.title}</div>
                  <div class="price">$${item.price?.value || "N/A"}</div>
                  <div class="meta">Shipping: $${item.shipping?.value || "0.00"}</div>
                  <div class="meta">Condition: ${item.condition || "Unknown"}</div>
                  <a href="${item.url}" target="_blank">View on eBay</a>
                </div>
              `).join("")}
            </div>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send(`<pre>${error.message}</pre>`);
  }
});

app.listen(PORT, () => {
  console.log(`CardHawk running on port ${PORT}`);
});
