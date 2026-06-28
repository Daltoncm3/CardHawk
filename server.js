const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("CardHawk is alive! 🦅");
});

app.get("/test-ebay", async (req, res) => {
  try {
    const response = await fetch("https://api.ebay.com/buy/browse/v1/item_summary/search?q=baseball%20card&limit=5", {
      headers: {
        Authorization: `Bearer ${process.env.EBAY_APP_ID}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US"
      }
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`CardHawk running on port ${PORT}`);
});
