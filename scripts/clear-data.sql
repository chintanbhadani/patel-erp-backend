-- Patel Strap ERP: Clear Production & Master Data (Item Master & Item Groups)
-- Run with: psql -U postgres -d patel_strap_erp -f clear-data.sql

BEGIN;

-- 1. Clear Production Module Data
TRUNCATE TABLE "WeighmentLedgerEntry" CASCADE;
TRUNCATE TABLE "ProductionOrderItem" CASCADE;
TRUNCATE TABLE "ProductionOrder" CASCADE;
TRUNCATE TABLE "QCLog" CASCADE;
TRUNCATE TABLE "RollEntry" CASCADE;
TRUNCATE TABLE "ProductionJob" CASCADE;

-- 2. Clear & Unlink Dependent Records
TRUNCATE TABLE "StockLedger" CASCADE;
TRUNCATE TABLE "InvoiceItem" CASCADE;
UPDATE "GrnItem" SET "productId" = NULL WHERE "productId" IS NOT NULL;
UPDATE "PurchaseOrderItem" SET "productId" = NULL WHERE "productId" IS NOT NULL;
UPDATE "MaterialRequestItem" SET "productId" = NULL WHERE "productId" IS NOT NULL;

-- 3. Clear Item Master & SKU Master
TRUNCATE TABLE "Product" CASCADE;
TRUNCATE TABLE "SkuMaster" CASCADE;

-- 4. Clear Item Groups (Categories)
TRUNCATE TABLE "Category" CASCADE;

COMMIT;
