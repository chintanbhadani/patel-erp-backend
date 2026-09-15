import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  let supplier = await prisma.supplier.findFirst();
  if (!supplier) {
    supplier = await prisma.supplier.create({ data: { name: 'Test Supplier' } });
  }
  let category = await prisma.category.findFirst();
  if (!category) {
    category = await prisma.category.create({ data: { name: 'Test Category' } });
  }
  let product = await prisma.product.findFirst();
  if (!product) {
    product = await prisma.product.create({ 
      data: { 
        name: 'Test Product', 
        sku: 'TEST-SKU-' + Date.now(), 
        categoryId: category.id, 
        supplierId: supplier.id,
        cost_price: 10,
        selling_price: 20
      } 
    });
  }
  console.log(JSON.stringify({ supplierId: supplier.id, productId: product.id }));
}
main().finally(() => prisma.$disconnect());
