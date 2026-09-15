import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  try {
    const invoiceDate = new Date();
    const productId = '123'; // just a dummy string to see syntax errors
    const quantityChange = -5;
    
    await prisma.$queryRaw`
            WITH proposed_ledger AS (
                SELECT date, "quantityChange"
                FROM "StockLedger"
                WHERE "productId" = ${productId}
                
                UNION ALL
                
                SELECT ${invoiceDate}::TIMESTAMP, ${quantityChange}::INTEGER
            ),
            cumulative_calculation AS (
                SELECT 
                    date,
                    SUM("quantityChange") OVER (ORDER BY date ASC) AS cumulative_balance
                FROM proposed_ledger
            )
            SELECT MIN(cumulative_balance) AS min_future_balance
            FROM cumulative_calculation
            WHERE date >= ${invoiceDate}::TIMESTAMP;
          `;
    console.log("Query 1 passed");
  } catch (e: any) {
    console.error("Query 1 failed:", e.message);
  }
}
main().finally(() => prisma.$disconnect());
