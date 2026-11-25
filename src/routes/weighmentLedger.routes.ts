import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

/**
 * Ensures any unique PET Strap sizes/specifications present in weighment entries
 * exist in the Product Master (Product table). If not found, auto-creates them.
 */
async function ensurePetStrapProductsExist(entries: any[]): Promise<string[]> {
  const createdSkus: string[] = [];
  try {
    // 1. Collect unique size specifications
    const uniqueSpecs = new Map<string, {
      width: number;
      thickness: number;
      surface: 'Plain' | 'Embossed';
      billedWeight: number;
      color: string;
      productName: string;
      sizeDimensions: string;
    }>();

    for (const item of entries) {
      const rawDim = String(item.sizeDimensions || '').trim();
      const rawName = String(item.productName || '').trim();
      
      const match = rawDim.match(/(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)/) ||
                    rawName.match(/(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)/);
      
      if (!match) continue;

      const width = parseFloat(match[1]);
      const thickness = parseFloat(match[2]);
      if (isNaN(width) || isNaN(thickness) || width <= 0 || thickness <= 0) continue;

      const isEmbossed = /emboss/i.test(rawName) || /emboss/i.test(rawDim);
      const surface: 'Plain' | 'Embossed' = isEmbossed ? 'Embossed' : 'Plain';
      const billedWeight = Number(item.billedWeightKg) || (width >= 19 ? 25 : 20);
      const color = String(item.color || 'Green').trim();

      const specKey = `${width.toFixed(2)}_${thickness.toFixed(2)}_${surface.toLowerCase()}`;
      if (!uniqueSpecs.has(specKey)) {
        uniqueSpecs.set(specKey, {
          width,
          thickness,
          surface,
          billedWeight,
          color,
          productName: `${width.toFixed(2)} X ${thickness.toFixed(2)} PET Strap Roll (${surface})`,
          sizeDimensions: `${width.toFixed(2)} X ${thickness.toFixed(2)}`
        });
      }
    }

    if (uniqueSpecs.size === 0) return createdSkus;

    // 2. Ensure Category 'PET STRAP' exists
    let petCategory = await prisma.category.findFirst({
      where: { name: { equals: 'PET STRAP', mode: 'insensitive' } }
    });
    if (!petCategory) {
      petCategory = await prisma.category.create({
        data: { name: 'PET STRAP' }
      });
    }

    // 3. Ensure Unit 'Roll' or 'Kg' exists
    let rollUnit = await prisma.unit.findFirst({
      where: { name: { equals: 'Roll', mode: 'insensitive' } }
    });
    if (!rollUnit) {
      rollUnit = await prisma.unit.findFirst({
        where: { name: { equals: 'Kg', mode: 'insensitive' } }
      });
    }

    // 4. Query existing SKUs starting with 'PSR'
    const existingPsrProducts = await prisma.product.findMany({
      where: { sku: { startsWith: 'PSR' } },
      select: { sku: true }
    });

    let maxSeq = 0;
    existingPsrProducts.forEach(p => {
      const numPart = p.sku.replace(/\D/g, '');
      const num = parseInt(numPart, 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    });

    // 5. Check and auto-create products for each unique spec
    for (const spec of uniqueSpecs.values()) {
      // Check if product already exists by width, thickness & surface, or by exact formatted name
      const existingProduct = await prisma.product.findFirst({
        where: {
          OR: [
            {
              AND: [
                { rollWidth: spec.width },
                { thickness: spec.thickness },
                { rollSurface: { equals: spec.surface, mode: 'insensitive' } }
              ]
            },
            {
              name: { equals: spec.productName, mode: 'insensitive' }
            },
            {
              name: { equals: `${spec.width} X ${spec.thickness} PET Strap Roll (${spec.surface})`, mode: 'insensitive' }
            }
          ]
        }
      });

      if (!existingProduct) {
        maxSeq++;
        let candidateSku = `PSR${String(maxSeq).padStart(maxSeq >= 1000 ? 4 : 3, '0')}`;
        while (await prisma.product.findUnique({ where: { sku: candidateSku } })) {
          maxSeq++;
          candidateSku = `PSR${String(maxSeq).padStart(maxSeq >= 1000 ? 4 : 3, '0')}`;
        }

        const newProd = await prisma.product.create({
          data: {
            sku: candidateSku,
            name: spec.productName,
            quantity: 0,
            cost_price: 120.00,
            selling_price: 150.00,
            min_stock: 50,
            location: 'D-31',
            status: 'Active',
            categoryId: petCategory.id,
            unitId: rollUnit?.id || null,
            company: 'PATEL STRAP PVT LTD',
            partOf: 'FINISHED GOODS',
            subPartOf: 'PET STRAP',
            rollWidth: spec.width,
            thickness: spec.thickness,
            rollSurface: spec.surface,
            rollWeight: spec.billedWeight,
            color: spec.color || 'Green',
            grade: 'High Tensile (A-Grade)',
            maintainStock: true,
            includeInManufacturing: true,
            tags: 'PET STRAP, FINISHED GOODS, AUTO CREATED'
          }
        });

        createdSkus.push(newProd.sku);
        console.log(`Auto-added PET Strap product to Master: ${newProd.sku} - ${newProd.name}`);
      }
    }
  } catch (err) {
    console.error('Error auto-creating PET strap products in Product Master:', err);
  }

  return createdSkus;
}

// GET /api/weighment-ledger - Fetch weighing ledger records with server-side pagination & filtering
router.get('/', async (req, res) => {
  try {
    const {
      page = '1',
      limit = '20',
      search,
      date,
      machineNo,
      shift,
      rollGrade,
      productionOrderNo,
      all,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const where: any = {};
    if (machineNo) {
      where.machineNo = String(machineNo);
    }
    if (shift) {
      where.shift = String(shift).toUpperCase();
    }
    if (rollGrade) {
      where.rollGrade = String(rollGrade);
    }
    if (productionOrderNo) {
      where.productionOrderId = { contains: String(productionOrderNo), mode: 'insensitive' };
    }
    if (date) {
      const startOfDay = new Date(String(date));
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(String(date));
      endOfDay.setHours(23, 59, 59, 999);
      where.createdAt = {
        gte: startOfDay,
        lte: endOfDay
      };
    }

    if (search && String(search).trim()) {
      const s = String(search).trim();
      where.OR = [
        { rollStickerCode: { contains: s, mode: 'insensitive' } },
        { ginningStickerCode: { contains: s, mode: 'insensitive' } },
        { productName: { contains: s, mode: 'insensitive' } },
        { sizeDimensions: { contains: s, mode: 'insensitive' } },
        { productionOrderId: { contains: s, mode: 'insensitive' } },
        { operatorName: { contains: s, mode: 'insensitive' } },
        { machineNo: { contains: s, mode: 'insensitive' } },
        { notes: { contains: s, mode: 'insensitive' } }
      ];
    }

    const orderDirection = String(sortOrder).toLowerCase() === 'asc' ? 'asc' : 'desc';
    const orderField = String(sortBy);

    // If 'all=true' is explicitly requested (e.g. for full Excel / CSV export)
    if (all === 'true') {
      const entries = await prisma.weighmentLedgerEntry.findMany({
        where,
        orderBy: { [orderField]: orderDirection }
      });
      return res.json({
        success: true,
        data: entries,
        total: entries.length
      });
    }

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.max(1, Math.min(500, parseInt(String(limit), 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [total, entries] = await Promise.all([
      prisma.weighmentLedgerEntry.count({ where }),
      prisma.weighmentLedgerEntry.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { [orderField]: orderDirection }
      })
    ]);

    res.json({
      success: true,
      data: entries,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error: any) {
    console.error('Error fetching weighment ledger entries:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/weighment-ledger/bulk - Bulk add weighment entries from daily production upload
router.post('/bulk', async (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ success: false, message: 'No entries provided for bulk upload.' });
    }

    const formattedData = entries.map((item: any) => ({
      rollStickerCode: String(item.rollStickerCode || `ROL-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`).toUpperCase(),
      ginningStickerCode: String(item.ginningStickerCode || item.rollStickerCode || ''),
      productionOrderId: item.productionOrderId || null,
      machineNo: item.machineNo || item.machineCode || (
        String(item.rollStickerCode || '').toUpperCase().startsWith('D') ? 'EXT-04' :
        String(item.rollStickerCode || '').toUpperCase().startsWith('C') ? 'EXT-03' :
        String(item.rollStickerCode || '').toUpperCase().startsWith('B') ? 'EXT-02' :
        'EXT-01'
      ),
      productName: item.productName || item.finishedGoodName || 'PET Strap Roll',
      sizeDimensions: item.sizeDimensions || item.finishedGoodSku || '',
      color: item.color || 'Green',
      rollGrade: item.rollGrade || 'GRADE_A',
      grossWeightKg: Number(item.grossWeightKg) || 0,
      tareWeightKg: Number(item.tareWeightKg) || 0,
      actualNetWeightKg: Number(item.actualNetWeightKg) || 0,
      billedWeightKg: Number(item.billedWeightKg) || 0,
      giveawayWeightKg: Number(item.giveawayWeightKg) || 0,
      strapLengthMeters: Number(item.strapLengthMeters) || 1000,
      shift: String(item.shift || 'D').toUpperCase().charAt(0) || 'D',
      manualSuffix: item.manualSuffix ? String(item.manualSuffix) : null,
      operatorName: item.operatorName || 'Plant Operator',
      notes: item.notes || '',
      createdAt: item.createdAt ? new Date(item.createdAt) : new Date()
    }));

    // Auto-create any missing PET Strap sizes in Product Master data
    const createdProductSkus = await ensurePetStrapProductsExist(formattedData);

    // Process in batches of 500
    const batchSize = 500;
    let totalCreated = 0;
    for (let i = 0; i < formattedData.length; i += batchSize) {
      const batch = formattedData.slice(i, i + batchSize);
      const result = await prisma.weighmentLedgerEntry.createMany({
        data: batch,
        skipDuplicates: true
      });
      totalCreated += result.count;
    }

    res.json({
      success: true,
      count: totalCreated,
      totalReceived: formattedData.length,
      autoCreatedProducts: createdProductSkus,
      message: `Successfully stored ${totalCreated} production roll records in the database.${
        createdProductSkus.length > 0
          ? ` Auto-added ${createdProductSkus.length} new PET strap size(s) (${createdProductSkus.join(', ')}) to Product Master.`
          : ''
      }`
    });
  } catch (error: any) {
    console.error('Error in bulk weighment creation:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/weighment-ledger - Add a new weighment entry
router.post('/', async (req, res) => {
  try {
    const {
      rollStickerCode,
      ginningStickerCode,
      productionOrderId,
      machineNo,
      productName,
      sizeDimensions,
      color,
      rollGrade,
      grossWeightKg,
      tareWeightKg,
      actualNetWeightKg,
      billedWeightKg,
      giveawayWeightKg,
      strapLengthMeters,
      shift,
      manualSuffix,
      operatorName,
      notes
    } = req.body;

    // Auto-create PET strap size in Product Master if not present
    await ensurePetStrapProductsExist([{
      productName,
      sizeDimensions,
      color,
      billedWeightKg
    }]);

    const newEntry = await prisma.weighmentLedgerEntry.create({
      data: {
        rollStickerCode,
        ginningStickerCode,
        productionOrderId,
        machineNo,
        productName: productName || 'PET Strap Roll',
        sizeDimensions: sizeDimensions || '',
        color: color || 'Green',
        rollGrade: rollGrade || 'GRADE_A',
        grossWeightKg: Number(grossWeightKg),
        tareWeightKg: Number(tareWeightKg),
        actualNetWeightKg: Number(actualNetWeightKg),
        billedWeightKg: Number(billedWeightKg),
        giveawayWeightKg: Number(giveawayWeightKg),
        strapLengthMeters: Number(strapLengthMeters),
        shift: shift || 'D',
        manualSuffix: manualSuffix || '1',
        operatorName,
        notes
      }
    });

    res.json({
      success: true,
      data: newEntry,
      message: 'Weighment record saved to database successfully.'
    });
  } catch (error: any) {
    console.error('Error creating weighment entry:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/weighment-ledger/:id - Delete a weighment entry
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.weighmentLedgerEntry.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Entry deleted from database successfully.'
    });
  } catch (error: any) {
    console.error('Error deleting weighment entry:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
