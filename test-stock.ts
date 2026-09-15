import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const stock = await prisma.stockLedger.findMany();
  console.log("Stock Ledger entries:", stock.length);
  const products = await prisma.product.findMany();
  console.log("Products with quantity > 0:", products.filter(p => p.quantity > 0).length);
}
main().finally(() => prisma.$disconnect());
