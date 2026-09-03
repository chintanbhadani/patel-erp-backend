import { detectMappedSellers } from "../src/services/mappingDetectionService.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import connectDB from "../src/modal/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
    console.log("Connecting to database...");
    await connectDB();
    
    console.log("Starting active inventory scan for lost buyboxes...");
    
    // We pass a progress callback to log output so we can see it running
    const result = await detectMappedSellers({ 
        skipHistory: true,
        onProgress: (percent, current, total, found) => {
            if (current % 10 === 0 || current === total) {
                console.log(`Progress: ${current}/${total} (${percent}%) - Lost Buyboxes Found: ${found}`);
            }
        }
    });
    
    const reportPath = path.join(__dirname, "../lost_buyboxes_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(result.allMappings, null, 2));
    
    console.log("\n=================================");
    console.log(`Scan Complete! Found ${result.allMappings.length} products where the Buy Box is lost.`);
    console.log(`Report saved to: ${reportPath}`);
    console.log("=================================\n");
    
    process.exit(0);
}

run().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
