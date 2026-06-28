const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

async function getEbayToken() {
  const credentials = Buffer.from(
    `${process.env.EBAY_APP_ID}:${process.env.EBAY_CERT_ID}`
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

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data.access_token;
}

app.get("/", (req, res) => {
  res.send("CardHawk is alive! 🦅");
});

app.get("/test-ebay", async (req, res) => {
  try {
    const token = await getEbayToken();

    const response = await fetch(
      "https://api.ebay.com/buy/browse/v1/item_summary/search?q=baseball%20card&limit=5",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
        }
      }
    );

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`CardHawk running on port ${PORT}`);
});
