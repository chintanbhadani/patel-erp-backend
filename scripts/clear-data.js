/**
 * Patel Strap ERP - Database Cleanup Script
 * Clears:
 *  1. Production Module Data:
 *     - Production Orders & Production Order Items
 *     - Weighment Ledger Entries (scale weighing records)
 *     - Production Jobs, Roll Entries, QC Logs
 *  2. Master Data:
 *     - Item Master (Products)
 *     - SKU Master
 *     - Item Groups (Categories)
 *     - Dependent transaction ledgers (StockLedger, InvoiceItem)
 *     - Unlinks references in GRN, Purchase Orders, Material Requests
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function runCleanup() {
  console.log('========================================================');
  console.log('   PATEL STRAP ERP - DATABASE CLEANUP SCRIPT');
  console.log('========================================================\n');
  console.log(`Target Database: ${process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@') : 'Not defined'}\n`);

  try {
    // 1. Snapshot Before Counts
    console.log('📊 RECORD COUNTS BEFORE CLEANUP:');
    const before = {
      'Weighment Ledger (Weighing)': await prisma.weighmentLedgerEntry.count(),
      'Production Orders': await prisma.productionOrder.count(),
      'Production Order Items': await prisma.productionOrderItem.count(),
      'Production Jobs': await prisma.productionJob.count(),
      'Roll Entries': await prisma.rollEntry.count(),
      'QC Logs': await prisma.qCLog.count(),
      'Stock Ledger Entries': await prisma.stockLedger.count(),
      'Invoice Items': await prisma.invoiceItem.count(),
      'Item Master (Products)': await prisma.product.count(),
      'SKU Master': await prisma.skuMaster.count(),
      'Item Groups (Categories)': await prisma.category.count()
    };
    console.table(before);

    console.log('\n🧹 EXECUTING CLEANUP...\n');

    // 2. Production Module
    console.log('  [1/10] Clearing Weighment Ledger Entries...');
    const weighmentRes = await prisma.weighmentLedgerEntry.deleteMany({});
    console.log(`         ✓ Removed ${weighmentRes.count} weighing entries.`);

    console.log('  [2/10] Clearing Production Order Items...');
    const poItemRes = await prisma.productionOrderItem.deleteMany({});
    console.log(`         ✓ Removed ${poItemRes.count} line items.`);

    console.log('  [3/10] Clearing Production Orders...');
    const poRes = await prisma.productionOrder.deleteMany({});
    console.log(`         ✓ Removed ${poRes.count} production orders.`);

    console.log('  [4/10] Clearing QC Logs, Roll Entries & Production Jobs...');
    const qcRes = await prisma.qCLog.deleteMany({});
    const rollRes = await prisma.rollEntry.deleteMany({});
    const jobRes = await prisma.productionJob.deleteMany({});
    console.log(`         ✓ Removed ${qcRes.count} QC logs, ${rollRes.count} rolls, ${jobRes.count} jobs.`);

    // 3. Dependent Transaction Tables on Products
    console.log('  [5/10] Clearing Stock Ledger & Invoice Items...');
    const stockRes = await prisma.stockLedger.deleteMany({});
    const invRes = await prisma.invoiceItem.deleteMany({});
    console.log(`         ✓ Removed ${stockRes.count} stock ledger rows, ${invRes.count} invoice items.`);

    console.log('  [6/10] Unlinking product references in GRN, Purchase Orders & Material Requests...');
    await prisma.grnItem.updateMany({ where: { productId: { not: null } }, data: { productId: null } });
    await prisma.purchaseOrderItem.updateMany({ where: { productId: { not: null } }, data: { productId: null } });
    await prisma.materialRequestItem.updateMany({ where: { productId: { not: null } }, data: { productId: null } });
    console.log('         ✓ Unlinked product references.');

    // 4. Item Master (Products) & SKU Master
    console.log('  [7/10] Clearing SKU Master...');
    const skuRes = await prisma.skuMaster.deleteMany({});
    console.log(`         ✓ Removed ${skuRes.count} SKU master records.`);

    console.log('  [8/10] Clearing Item Master (Products)...');
    const prodRes = await prisma.product.deleteMany({});
    console.log(`         ✓ Removed ${prodRes.count} products.`);

    // 5. Item Groups (Categories)
    console.log('  [9/10] Clearing Item Groups (Categories)...');
    const catRes = await prisma.category.deleteMany({});
    console.log(`         ✓ Removed ${catRes.count} categories/item groups.`);

    console.log('  [10/10] Finalizing transaction...');

    console.log('\n✅ CLEANUP COMPLETED SUCCESSFULLY!\n');

    // 6. Snapshot After Counts
    console.log('📊 RECORD COUNTS AFTER CLEANUP:');
    const after = {
      'Weighment Ledger (Weighing)': await prisma.weighmentLedgerEntry.count(),
      'Production Orders': await prisma.productionOrder.count(),
      'Production Order Items': await prisma.productionOrderItem.count(),
      'Production Jobs': await prisma.productionJob.count(),
      'Roll Entries': await prisma.rollEntry.count(),
      'QC Logs': await prisma.qCLog.count(),
      'Stock Ledger Entries': await prisma.stockLedger.count(),
      'Invoice Items': await prisma.invoiceItem.count(),
      'Item Master (Products)': await prisma.product.count(),
      'SKU Master': await prisma.skuMaster.count(),
      'Item Groups (Categories)': await prisma.category.count()
    };
    console.table(after);

  } catch (error) {
    console.error('\n❌ ERROR DURING CLEANUP:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runCleanup();
