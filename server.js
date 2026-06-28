const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

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
    `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=10`,
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
  const query = req.query.q || "baseball card";
  const results = await searchEbay(query);

  res.send(`
    <html>
      <body style="font-family: Arial; padding: 30px;">
        <h1>🦅 CardHawk</h1>
        <form>
          <input name="q" value="${query}" style="width: 300px; padding: 10px;" />
          <button style="padding: 10px;">Search</button>
        </form>
        <h2>Results for: ${query}</h2>
        ${results.map(item => `
          <div style="border:1px solid #ccc; padding:15px; margin:15px 0; display:flex; gap:15px;">
            <img src="${item.image}" width="120" />
            <div>
              <h3>${item.title}</h3>
              <p><b>Price:</b> $${item.price?.value}</p>
              <p><b>Shipping:</b> $${item.shipping?.value}</p>
              <p><b>Condition:</b> ${item.condition}</p>
              <a href="${item.url}" target="_blank">View on eBay</a>
            </div>
          </div>
        `).join("")}
      </body>
    </html>
  `);
});

app.get("/test-ebay", async (req, res) => {
  try {
    const results = await searchEbay("baseball card");
    res.json({ search: "baseball card", results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`CardHawk running on port ${PORT}`);
});
