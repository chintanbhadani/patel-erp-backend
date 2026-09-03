import mongoose from "mongoose";
import Inventory from "../src/modal/inventory.js";
import dns from "dns";
import dotenv from "dotenv";
dotenv.config();

// Use Google DNS to bypass ISP/router blocking of SRV records
dns.setDefaultResultOrder("ipv4first");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const MONGODB_URI = process.env.MONGO_DB;

const seedInventory = async () => {
  try {
    await mongoose.connect(MONGODB_URI, {
      dbName: "amazon_db",
      serverSelectionTimeoutMS: 10000,
      family: 4, // Force IPv4
    });
    console.log("Connected to MongoDB for inventory seeding...");

    const mockInventory = [
      {
        asin: "B08DFG23X",
        sellerSku: "SKU-PRO-001",
        productName: "Wireless Charging Pad",
        quantity: 120,
        sellingPrice: 1599,
        minPrice: 999,
        maxPrice: 1999,
        productCost: 850,
        fulfillmentType: "FBA",
        condition: "New",
        status: "Active"
      },
      {
        asin: "B07ZPKZSSC",
        sellerSku: "SKU-PRO-002",
        productName: "Ergonomic Office Chair",
        quantity: 45,
        sellingPrice: 12499,
        minPrice: 9999,
        maxPrice: 15000,
        productCost: 6200,
        fulfillmentType: "MFN",
        condition: "New",
        status: "Active"
      },
      {
        asin: "B08L5TNJJ5",
        sellerSku: "SKU-PRO-003",
        productName: "USB-C Hub Multiport Adapter",
        quantity: 210,
        sellingPrice: 2499,
        minPrice: 1500,
        maxPrice: 3500,
        productCost: 1100,
        fulfillmentType: "FBA",
        condition: "New",
        status: "Active"
      }
    ];

    for (const item of mockInventory) {
      await Inventory.findOneAndUpdate(
        { asin: item.asin },
        item,
        { upsert: true, new: true }
      );
    }

    console.log("✅ Inventory seeded successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding inventory:", error.message);
    process.exit(1);
  }
};

seedInventory();
