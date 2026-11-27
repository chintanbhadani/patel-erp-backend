import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// Helper to determine machine letter and normalized code
function getMachineInfo(machineNo?: string | null, rollCode?: string | null): { code: string; letter: 'A' | 'B' | 'C' | 'D'; name: string } {
  const m = String(machineNo || '').trim().toUpperCase();
  const r = String(rollCode || '').trim().toUpperCase();

  if (m === 'EXT-01' || m === 'M-01' || m === 'A' || m.includes('LINE A') || r.startsWith('A')) {
    return { code: 'EXT-01', letter: 'A', name: 'Machine 1 (Line A)' };
  }
  if (m === 'EXT-02' || m === 'M-02' || m === 'B' || m.includes('LINE B') || r.startsWith('B')) {
    return { code: 'EXT-02', letter: 'B', name: 'Machine 2 (Line B)' };
  }
  if (m === 'EXT-03' || m === 'M-03' || m === 'C' || m.includes('LINE C') || r.startsWith('C')) {
    return { code: 'EXT-03', letter: 'C', name: 'Machine 3 (Line C)' };
  }
  if (m === 'EXT-04' || m === 'M-04' || m === 'D' || m.includes('LINE D') || r.startsWith('D')) {
    return { code: 'EXT-04', letter: 'D', name: 'Machine 4 (Line D)' };
  }
  return { code: 'EXT-01', letter: 'A', name: 'Machine 1 (Line A)' };
}

// Helper to get date boundaries covering the full 24-hour day in both UTC and local time
function getDayDateRange(dateStr: string): { start: Date; end: Date } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  const end = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
  return { start, end };
}

/**
 * GET /api/daily-plant-log/production-summary?date=YYYY-MM-DD
 * Auto-aggregates finished goods production directly from WeighmentLedgerEntry for a given date
 */
router.get('/production-summary', async (req: Request, res: Response) => {
  try {
    const { date } = req.query;
    if (!date || typeof date !== 'string') {
      return res.status(400).json({ error: 'Date parameter (YYYY-MM-DD) is required' });
    }

    const { start, end } = getDayDateRange(date);

    // 1. Fetch all weighment records for this date
    const weighments = await prisma.weighmentLedgerEntry.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end
        }
      }
    });

    // 2. Initialize Machine breakdown structure
    const machines: Record<'A' | 'B' | 'C' | 'D', {
      machineCode: string;
      machineName: string;
      letter: 'A' | 'B' | 'C' | 'D';
      rollCount: number;
      rollKg: number;
      bagCount: number;
      bagKg: number;
      totalKg: number;
    }> = {
      A: { machineCode: 'EXT-01', machineName: 'Machine 1 (Line A)', letter: 'A', rollCount: 0, rollKg: 0, bagCount: 0, bagKg: 0, totalKg: 0 },
      B: { machineCode: 'EXT-02', machineName: 'Machine 2 (Line B)', letter: 'B', rollCount: 0, rollKg: 0, bagCount: 0, bagKg: 0, totalKg: 0 },
      C: { machineCode: 'EXT-03', machineName: 'Machine 3 (Line C)', letter: 'C', rollCount: 0, rollKg: 0, bagCount: 0, bagKg: 0, totalKg: 0 },
      D: { machineCode: 'EXT-04', machineName: 'Machine 4 (Line D)', letter: 'D', rollCount: 0, rollKg: 0, bagCount: 0, bagKg: 0, totalKg: 0 }
    };

    let totalRolls = 0;
    let totalRollKg = 0;
    let totalBags = 0;
    let totalBagKg = 0;

    weighments.forEach(item => {
      const info = getMachineInfo(item.machineNo, item.rollStickerCode);
      const wt = Number(item.actualNetWeightKg) || 0;
      const isBag = String(item.productName || '').toLowerCase().includes('bag') || String(item.rollGrade || '').toLowerCase().includes('bag');

      if (isBag) {
        machines[info.letter].bagCount += 1;
        machines[info.letter].bagKg += wt;
        totalBags += 1;
        totalBagKg += wt;
      } else {
        machines[info.letter].rollCount += 1;
        machines[info.letter].rollKg += wt;
        totalRolls += 1;
        totalRollKg += wt;
      }
      machines[info.letter].totalKg += wt;
    });

    // Round machine totals
    Object.keys(machines).forEach(key => {
      const k = key as 'A' | 'B' | 'C' | 'D';
      machines[k].rollKg = Number(machines[k].rollKg.toFixed(2));
      machines[k].bagKg = Number(machines[k].bagKg.toFixed(2));
      machines[k].totalKg = Number(machines[k].totalKg.toFixed(2));
    });

    const totalOutputKg = Number((totalRollKg + totalBagKg).toFixed(2));

    // 3. Check if existing DailyPlantLog has already been saved for this date
    const existingLog = await prisma.dailyPlantLog.findUnique({
      where: { date: start },
      include: {
        materialConsumptions: true,
        wastage: true,
        ancillaries: true
      }
    });

    res.json({
      date,
      machineOutputs: machines,
      summary: {
        totalRolls,
        totalRollKg: Number(totalRollKg.toFixed(2)),
        totalBags,
        totalBagKg: Number(totalBagKg.toFixed(2)),
        totalOutputKg,
        weighmentEntriesCount: weighments.length
      },
      existingLog
    });
  } catch (error: any) {
    console.error('Error fetching production summary from weighing:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch production summary' });
  }
});

/**
 * POST /api/daily-plant-log
 * Create or update daily plant log (Raw Material Consumption, Wastage, Ancillaries, PGVCL Bill)
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      date,
      remarks = '',
      pgvclBillAmount = 0,
      status = 'Submitted',
      materialConsumptions = [],
      wastage = {},
      ancillaries = {}
    } = req.body;

    if (!date) {
      return res.status(400).json({ error: 'Date is required (YYYY-MM-DD)' });
    }

    const { start, end } = getDayDateRange(date);

    // Calculate total weighed output for this date to determine power cost per kg
    const weighments = await prisma.weighmentLedgerEntry.findMany({
      where: {
        createdAt: { gte: start, lte: end }
      },
      select: { actualNetWeightKg: true }
    });
    const totalOutputKg = weighments.reduce((sum, w) => sum + (Number(w.actualNetWeightKg) || 0), 0);
    const billNum = Number(pgvclBillAmount) || 0;
    const powerCostPerKg = totalOutputKg > 0 ? Number((billNum / totalOutputKg).toFixed(2)) : 0;

    // Execute atomic upsert
    const savedLog = await prisma.$transaction(async (tx) => {
      // Find or create daily log header
      let log = await tx.dailyPlantLog.findUnique({
        where: { date: start }
      });

      if (log) {
        // Update header
        log = await tx.dailyPlantLog.update({
          where: { id: log.id },
          data: {
            remarks,
            pgvclBillAmount: billNum,
            powerCostPerKg,
            status,
            updatedAt: new Date()
          }
        });

        // Delete existing relations to replace with updated records
        await tx.dailyMaterialConsumption.deleteMany({ where: { plantLogId: log.id } });
        await tx.dailyWastageEntry.deleteMany({ where: { plantLogId: log.id } });
        await tx.dailyAncillaryEntry.deleteMany({ where: { plantLogId: log.id } });
      } else {
        // Create new log header
        log = await tx.dailyPlantLog.create({
          data: {
            date: start,
            remarks,
            pgvclBillAmount: billNum,
            powerCostPerKg,
            status
          }
        });
      }

      // Insert material consumptions (CONS-1 F, CONS-2 G, CONS-3 M, CONS-4 E, CONS-5 V)
      if (Array.isArray(materialConsumptions) && materialConsumptions.length > 0) {
        for (const mc of materialConsumptions) {
          await tx.dailyMaterialConsumption.create({
            data: {
              plantLogId: log.id,
              gradeCode: mc.gradeCode || 'F',
              consumedKg: Number(mc.consumedKg) || 0,
              purchasedKg: Number(mc.purchasedKg) || 0,
              closingStockKg: Number(mc.closingStockKg) || 0
            }
          });
        }
      }

      // Insert wastage record
      const burntKg = Number(wastage.burntWasteKg) || 0;
      const stockKg = Number(wastage.stockWasteKg) || 0;
      const plantKg = Number(wastage.plantWasteKg) || 0;
      const totalWaste = burntKg + stockKg + plantKg;

      await tx.dailyWastageEntry.create({
        data: {
          plantLogId: log.id,
          burntWasteKg: burntKg,
          stockWasteKg: stockKg,
          plantWasteKg: plantKg,
          totalWasteKg: totalWaste
        }
      });

      // Insert ancillaries & consumables record
      await tx.dailyAncillaryEntry.create({
        data: {
          plantLogId: log.id,
          pattaPurKg: Number(ancillaries.pattaPurKg) || 0,
          pattaPurNos: Number(ancillaries.pattaPurNos) || 0,
          pattaStockNos: Number(ancillaries.pattaStockNos) || 0,
          bagPurKg: Number(ancillaries.bagPurKg) || 0,
          bagPurNos: Number(ancillaries.bagPurNos) || 0,
          bagStockNos: Number(ancillaries.bagStockNos) || 0,
          paperCorePurNos: Number(ancillaries.paperCorePurNos) || 0,
          paperCoreUsedNos: Number(ancillaries.paperCoreUsedNos) || weighments.length,
          paperCoreStockNos: Number(ancillaries.paperCoreStockNos) || 0,
          lumpsGenKg: Number(ancillaries.lumpsGenKg) || 0,
          lumpsSalesKg: Number(ancillaries.lumpsSalesKg) || 0,
          lumpsStockKg: Number(ancillaries.lumpsStockKg) || 0,
          jaliPurNos: Number(ancillaries.jaliPurNos) || 0,
          jaliUsedNos: Number(ancillaries.jaliUsedNos) || 0,
          jaliStockNos: Number(ancillaries.jaliStockNos) || 0
        }
      });

      return await tx.dailyPlantLog.findUnique({
        where: { id: log.id },
        include: {
          materialConsumptions: true,
          wastage: true,
          ancillaries: true
        }
      });
    });

    res.json({
      success: true,
      message: `Daily plant log for ${date} saved successfully.`,
      log: savedLog
    });
  } catch (error: any) {
    console.error('Error saving daily plant log:', error);
    res.status(500).json({ error: error.message || 'Failed to save daily plant log' });
  }
});

/**
 * POST /api/daily-plant-log/bulk-upload
 * Bulk upserts daily plant logs across multiple dates with all 4 sections:
 * 1. Raw Material Consumptions (F, G, M, E, V)
 * 2. Wastage (Burnt, Stock, Plant)
 * 3. Ancillaries (Patta, Bags, Cores, Lumps, Jali)
 * 4. Utilities (PGVCL Bill)
 */
router.post('/bulk-upload', async (req: Request, res: Response) => {
  try {
    const { logs } = req.body;
    if (!Array.isArray(logs) || logs.length === 0) {
      return res.status(400).json({ error: 'No daily logs provided. Expected an array of logs.' });
    }

    const savedLogs: any[] = [];

    await prisma.$transaction(async (tx) => {
      for (const item of logs) {
        const {
          date,
          remarks = '',
          pgvclBillAmount = 0,
          status = 'Submitted',
          materialConsumptions = [],
          wastage = {},
          ancillaries = {}
        } = item;

        if (!date) continue;
        const { start, end } = getDayDateRange(date);

        // Calculate power cost per kg from weighments
        const weighments = await tx.weighmentLedgerEntry.findMany({
          where: { createdAt: { gte: start, lte: end } },
          select: { actualNetWeightKg: true }
        });
        const totalOutputKg = weighments.reduce((sum, w) => sum + (Number(w.actualNetWeightKg) || 0), 0);
        const billNum = Number(pgvclBillAmount) || 0;
        const powerCostPerKg = totalOutputKg > 0 ? Number((billNum / totalOutputKg).toFixed(2)) : 0;

        let log = await tx.dailyPlantLog.findUnique({ where: { date: start } });

        if (log) {
          log = await tx.dailyPlantLog.update({
            where: { id: log.id },
            data: {
              remarks: remarks || log.remarks,
              pgvclBillAmount: billNum,
              powerCostPerKg,
              status
            }
          });
        } else {
          log = await tx.dailyPlantLog.create({
            data: {
              date: start,
              remarks,
              pgvclBillAmount: billNum,
              powerCostPerKg,
              status
            }
          });
        }

        // Material Consumptions (F, G, M, E, V)
        if (Array.isArray(materialConsumptions) && materialConsumptions.length > 0) {
          for (const mc of materialConsumptions) {
            const grade = String(mc.gradeCode || '').toUpperCase();
            if (!grade) continue;

            const existingMc = await tx.dailyMaterialConsumption.findFirst({
              where: { plantLogId: log.id, gradeCode: grade }
            });

            const consumed = Number(mc.consumedKg) || 0;
            const purchased = Number(mc.purchasedKg) || 0;
            const closing = Number(mc.closingStockKg) || 0;

            if (existingMc) {
              await tx.dailyMaterialConsumption.update({
                where: { id: existingMc.id },
                data: { consumedKg: consumed, purchasedKg: purchased, closingStockKg: closing }
              });
            } else {
              await tx.dailyMaterialConsumption.create({
                data: {
                  plantLogId: log.id,
                  gradeCode: grade,
                  consumedKg: consumed,
                  purchasedKg: purchased,
                  closingStockKg: closing
                }
              });
            }
          }
        }

        // Wastage
        if (wastage) {
          const burnt = Number(wastage.burntWasteKg) || 0;
          const stock = Number(wastage.stockWasteKg) || 0;
          const plant = Number(wastage.plantWasteKg) || 0;
          const totalWaste = burnt + stock + plant;

          const existingWastage = await tx.dailyWastageEntry.findUnique({
            where: { plantLogId: log.id }
          });

          if (existingWastage) {
            await tx.dailyWastageEntry.update({
              where: { id: existingWastage.id },
              data: { burntWasteKg: burnt, stockWasteKg: stock, plantWasteKg: plant, totalWasteKg: totalWaste }
            });
          } else {
            await tx.dailyWastageEntry.create({
              data: {
                plantLogId: log.id,
                burntWasteKg: burnt,
                stockWasteKg: stock,
                plantWasteKg: plant,
                totalWasteKg: totalWaste
              }
            });
          }
        }

        // Ancillaries
        if (ancillaries) {
          const ancData = {
            pattaPurKg: Number(ancillaries.pattaPurKg) || 0,
            pattaPurNos: Number(ancillaries.pattaPurNos) || 0,
            pattaStockNos: Number(ancillaries.pattaStockNos) || 0,
            bagPurKg: Number(ancillaries.bagPurKg) || 0,
            bagPurNos: Number(ancillaries.bagPurNos) || 0,
            bagStockNos: Number(ancillaries.bagStockNos) || 0,
            paperCorePurNos: Number(ancillaries.paperCorePurNos) || 0,
            paperCoreUsedNos: Number(ancillaries.paperCoreUsedNos) || 0,
            paperCoreStockNos: Number(ancillaries.paperCoreStockNos) || 0,
            lumpsGenKg: Number(ancillaries.lumpsGenKg) || 0,
            lumpsSalesKg: Number(ancillaries.lumpsSalesKg) || 0,
            lumpsStockKg: Number(ancillaries.lumpsStockKg) || 0,
            jaliPurNos: Number(ancillaries.jaliPurNos) || 0,
            jaliUsedNos: Number(ancillaries.jaliUsedNos) || 0,
            jaliStockNos: Number(ancillaries.jaliStockNos) || 0
          };

          const existingAnc = await tx.dailyAncillaryEntry.findUnique({
            where: { plantLogId: log.id }
          });

          if (existingAnc) {
            await tx.dailyAncillaryEntry.update({
              where: { id: existingAnc.id },
              data: ancData
            });
          } else {
            await tx.dailyAncillaryEntry.create({
              data: { plantLogId: log.id, ...ancData }
            });
          }
        }

        savedLogs.push({ id: log.id, date });
      }
    });

    res.json({
      success: true,
      message: `Successfully bulk uploaded ${savedLogs.length} daily plant log(s).`,
      count: savedLogs.length,
      savedLogs
    });
  } catch (error: any) {
    console.error('Error in bulk uploading daily plant logs:', error);
    res.status(500).json({ error: error.message || 'Failed to bulk upload daily plant logs' });
  }
});

/**
 * GET /api/daily-plant-log/master-sheet?month=YYYY-MM&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * Complete monthly or custom date range reconciliation combining auto-aggregated production from weighing
 * with raw material consumption, wastage, and ancillary records.
 */
router.get('/master-sheet', async (req: Request, res: Response) => {
  try {
    const { month, startDate, endDate } = req.query;

    let rangeStart: Date;
    let rangeEnd: Date;
    let periodLabel: string;
    let monthStr = typeof month === 'string' ? month : '';

    if (startDate && endDate && typeof startDate === 'string' && typeof endDate === 'string') {
      const [sY, sM, sD] = startDate.split('-').map(Number);
      const [eY, eM, eD] = endDate.split('-').map(Number);
      if (!sY || !sM || !sD || !eY || !eM || !eD) {
        return res.status(400).json({ error: 'Invalid startDate or endDate format. Expected YYYY-MM-DD' });
      }
      rangeStart = new Date(Date.UTC(sY, sM - 1, sD, 0, 0, 0, 0));
      rangeEnd = new Date(Date.UTC(eY, eM - 1, eD, 23, 59, 59, 999));
      periodLabel = `${startDate} to ${endDate}`;
      if (!monthStr) {
        monthStr = `${sY}-${String(sM).padStart(2, '0')}`;
      }
    } else if (month && typeof month === 'string') {
      const [yearNum, monthNum] = month.split('-').map(Number);
      if (!yearNum || !monthNum || monthNum < 1 || monthNum > 12) {
        return res.status(400).json({ error: 'Invalid month format. Expected YYYY-MM' });
      }
      const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
      rangeStart = new Date(Date.UTC(yearNum, monthNum - 1, 1, 0, 0, 0, 0));
      rangeEnd = new Date(Date.UTC(yearNum, monthNum - 1, daysInMonth, 23, 59, 59, 999));
      periodLabel = month;
      monthStr = month;
    } else {
      const now = new Date();
      const yearNum = now.getFullYear();
      const monthNum = now.getMonth() + 1;
      monthStr = `${yearNum}-${String(monthNum).padStart(2, '0')}`;
      const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
      rangeStart = new Date(Date.UTC(yearNum, monthNum - 1, 1, 0, 0, 0, 0));
      rangeEnd = new Date(Date.UTC(yearNum, monthNum - 1, daysInMonth, 23, 59, 59, 999));
      periodLabel = monthStr;
    }

    // 1. Fetch all weighments for the range in one single query
    const allWeighments = await prisma.weighmentLedgerEntry.findMany({
      where: {
        createdAt: {
          gte: rangeStart,
          lte: rangeEnd
        }
      },
      select: {
        id: true,
        machineNo: true,
        rollStickerCode: true,
        actualNetWeightKg: true,
        productName: true,
        rollGrade: true,
        createdAt: true
      }
    });

    // 2. Fetch all daily plant logs for the range
    const allPlantLogs = await prisma.dailyPlantLog.findMany({
      where: {
        date: {
          gte: rangeStart,
          lte: rangeEnd
        }
      },
      include: {
        materialConsumptions: true,
        wastage: true,
        ancillaries: true
      }
    });

    // Index plant logs by date string "YYYY-MM-DD"
    const logByDateMap = new Map<string, any>();
    allPlantLogs.forEach(log => {
      const d = new Date(log.date);
      const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      logByDateMap.set(dateStr, log);
    });

    // Index weighments by date string "YYYY-MM-DD"
    const weighmentsByDateMap = new Map<string, any[]>();
    allWeighments.forEach(w => {
      const d = new Date(w.createdAt);
      const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const list = weighmentsByDateMap.get(dateStr) || [];
      list.push(w);
      weighmentsByDateMap.set(dateStr, list);
    });

    // 3. Build day-by-day rows
    const days: any[] = [];
    let totalBag = 0;
    let totalBagKg = 0;
    let totalRoll = 0;
    let totalRollKg = 0;
    let totalOutputKg = 0;
    let totalConsKg = 0;
    let totalBurntWasteKg = 0;
    let totalStockWasteKg = 0;
    let totalPlantWasteKg = 0;
    let totalPgvclBill = 0;

    const machineTotals = {
      A: { rollCount: 0, rollKg: 0, bagCount: 0, bagKg: 0, totalKg: 0 },
      B: { rollCount: 0, rollKg: 0, bagCount: 0, bagKg: 0, totalKg: 0 },
      C: { rollCount: 0, rollKg: 0, bagCount: 0, bagKg: 0, totalKg: 0 },
      D: { rollCount: 0, rollKg: 0, bagCount: 0, bagKg: 0, totalKg: 0 }
    };

    let activeDaysCount = 0;
    const curr = new Date(rangeStart.getTime());
    let dayIndex = 1;

    while (curr <= rangeEnd) {
      const y = curr.getUTCFullYear();
      const m = String(curr.getUTCMonth() + 1).padStart(2, '0');
      const d = String(curr.getUTCDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;
      const dayWeighments = weighmentsByDateMap.get(dateStr) || [];
      const plantLog = logByDateMap.get(dateStr);

      // Aggregate machine production from weighing
      const machines = {
        A: { rollCount: 0, rollKg: 0, bagCount: 0, bagKg: 0, totalKg: 0 },
        B: { rollCount: 0, rollKg: 0, bagCount: 0, bagKg: 0, totalKg: 0 },
        C: { rollCount: 0, rollKg: 0, bagCount: 0, bagKg: 0, totalKg: 0 },
        D: { rollCount: 0, rollKg: 0, bagCount: 0, bagKg: 0, totalKg: 0 }
      };

      let dayTotalRoll = 0;
      let dayTotalRollKg = 0;
      let dayTotalBag = 0;
      let dayTotalBagKg = 0;

      dayWeighments.forEach(item => {
        const info = getMachineInfo(item.machineNo, item.rollStickerCode);
        const wt = Number(item.actualNetWeightKg) || 0;
        const isBag = String(item.productName || '').toLowerCase().includes('bag') || String(item.rollGrade || '').toLowerCase().includes('bag');

        if (isBag) {
          machines[info.letter].bagCount += 1;
          machines[info.letter].bagKg += wt;
          dayTotalBag += 1;
          dayTotalBagKg += wt;

          machineTotals[info.letter].bagCount += 1;
          machineTotals[info.letter].bagKg += wt;
        } else {
          machines[info.letter].rollCount += 1;
          machines[info.letter].rollKg += wt;
          dayTotalRoll += 1;
          dayTotalRollKg += wt;

          machineTotals[info.letter].rollCount += 1;
          machineTotals[info.letter].rollKg += wt;
        }
        machines[info.letter].totalKg += wt;
        machineTotals[info.letter].totalKg += wt;
      });

      const dayOutputKg = Number((dayTotalRollKg + dayTotalBagKg).toFixed(2));
      if (dayOutputKg > 0) activeDaysCount++;

      // Material consumption mapping
      const consumptionsMap: Record<string, { consumedKg: number; purchasedKg: number; closingStockKg: number }> = {
        F: { consumedKg: 0, purchasedKg: 0, closingStockKg: 0 },
        G: { consumedKg: 0, purchasedKg: 0, closingStockKg: 0 },
        M: { consumedKg: 0, purchasedKg: 0, closingStockKg: 0 },
        E: { consumedKg: 0, purchasedKg: 0, closingStockKg: 0 },
        V: { consumedKg: 0, purchasedKg: 0, closingStockKg: 0 }
      };

      let dayConsKg = 0;
      if (plantLog && plantLog.materialConsumptions) {
        plantLog.materialConsumptions.forEach((mc: any) => {
          const code = (mc.gradeCode || '').toUpperCase();
          if (consumptionsMap[code]) {
            consumptionsMap[code].consumedKg = Number(mc.consumedKg) || 0;
            consumptionsMap[code].purchasedKg = Number(mc.purchasedKg) || 0;
            consumptionsMap[code].closingStockKg = Number(mc.closingStockKg) || 0;
            dayConsKg += Number(mc.consumedKg) || 0;
          }
        });
      }

      // Wastage
      const burntWaste = plantLog?.wastage ? Number(plantLog.wastage.burntWasteKg) || 0 : 0;
      const stockWaste = plantLog?.wastage ? Number(plantLog.wastage.stockWasteKg) || 0 : 0;
      const plantWaste = plantLog?.wastage ? Number(plantLog.wastage.plantWasteKg) || 0 : 0;
      const dayTotalWaste = burntWaste + stockWaste + plantWaste;

      // Ancillaries
      const anc = plantLog?.ancillaries || {};
      const lumpsGen = Number(anc.lumpsGenKg) || 0;
      const lumpsSales = Number(anc.lumpsSalesKg) || 0;
      const lumpsStock = Number(anc.lumpsStockKg) || 0;
      const jaliPur = Number(anc.jaliPurNos) || 0;
      const jaliUsed = Number(anc.jaliUsedNos) || 0;
      const jaliStock = Number(anc.jaliStockNos) || 0;
      const paperCorePur = Number(anc.paperCorePurNos) || 0;
      const paperCoreUsed = Number(anc.paperCoreUsedNos) || (dayTotalRoll > 0 ? dayTotalRoll : 0);
      const paperCoreStock = Number(anc.paperCoreStockNos) || 0;
      const pattaPurKg = Number(anc.pattaPurKg) || 0;
      const pattaPurNos = Number(anc.pattaPurNos) || 0;
      const pattaStockNos = Number(anc.pattaStockNos) || 0;
      const bagPurKg = Number(anc.bagPurKg) || 0;
      const bagPurNos = Number(anc.bagPurNos) || 0;
      const bagStockNos = Number(anc.bagStockNos) || 0;

      // Difference = Consumed - (Output + Waste)
      const dayDiffKg = dayConsKg > 0 ? Number((dayConsKg - (dayOutputKg + dayTotalWaste)).toFixed(2)) : 0;

      const pgvclBill = plantLog ? Number(plantLog.pgvclBillAmount) || 0 : 0;

      // Accumulate monthly totals
      totalBag += dayTotalBag;
      totalBagKg += dayTotalBagKg;
      totalRoll += dayTotalRoll;
      totalRollKg += dayTotalRollKg;
      totalOutputKg += dayOutputKg;
      totalConsKg += dayConsKg;
      totalBurntWasteKg += burntWaste;
      totalStockWasteKg += stockWaste;
      totalPlantWasteKg += plantWaste;
      totalPgvclBill += pgvclBill;

      days.push({
        day: dayIndex++,
        date: dateStr,
        production: {
          machineA: machines.A,
          machineB: machines.B,
          machineC: machines.C,
          machineD: machines.D,
          totalOutputKg: dayOutputKg,
          totalRoll: dayTotalRoll,
          totalRollKg: dayTotalRollKg,
          totalBag: dayTotalBag,
          totalBagKg: dayTotalBagKg
        },
        consumption: {
          F: consumptionsMap.F.consumedKg,
          G: consumptionsMap.G.consumedKg,
          M: consumptionsMap.M.consumedKg,
          E: consumptionsMap.E.consumedKg,
          V: consumptionsMap.V.consumedKg,
          totalConsKg: Number(dayConsKg.toFixed(2))
        },
        wastage: {
          burntWasteKg: burntWaste,
          stockWasteKg: stockWaste,
          plantWasteKg: plantWaste,
          totalWasteKg: dayTotalWaste
        },
        purchases: {
          F: consumptionsMap.F.purchasedKg,
          G: consumptionsMap.G.purchasedKg,
          M: consumptionsMap.M.purchasedKg,
          E: consumptionsMap.E.purchasedKg,
          V: consumptionsMap.V.purchasedKg
        },
        stocks: {
          F: consumptionsMap.F.closingStockKg,
          G: consumptionsMap.G.closingStockKg,
          M: consumptionsMap.M.closingStockKg,
          E: consumptionsMap.E.closingStockKg,
          V: consumptionsMap.V.closingStockKg
        },
        ancillaries: {
          pattaPurKg,
          pattaPurNos,
          pattaStockNos,
          bagPurKg,
          bagPurNos,
          bagStockNos,
          paperCorePurNos: paperCorePur,
          paperCoreUsedNos: paperCoreUsed,
          paperCoreStockNos: paperCoreStock,
          lumpsGenKg: lumpsGen,
          lumpsSalesKg: lumpsSales,
          lumpsStockKg: lumpsStock,
          jaliPurNos: jaliPur,
          jaliUsedNos: jaliUsed,
          jaliStockNos: jaliStock
        },
        reconciliation: {
          differenceKg: dayDiffKg,
          pgvclBill
        }
      });

      // Advance to next day
      curr.setUTCDate(curr.getUTCDate() + 1);
    }

    const effectiveDays = Math.max(1, activeDaysCount);
    const avgOutputPerDay = Math.round(totalOutputKg / effectiveDays);
    const powerCostPerDay = totalPgvclBill > 0 ? Math.round(totalPgvclBill / effectiveDays) : 0;
    const powerCostPerKg = totalOutputKg > 0 ? Number((totalPgvclBill / totalOutputKg).toFixed(2)) : 0;
    const totalWasteKg = totalBurntWasteKg + totalStockWasteKg + totalPlantWasteKg;
    const totalDifferenceKg = Number((totalConsKg - (totalOutputKg + totalWasteKg)).toFixed(2));

    res.json({
      month: monthStr,
      periodLabel,
      startDate: rangeStart.toISOString().slice(0, 10),
      endDate: rangeEnd.toISOString().slice(0, 10),
      daysInPeriod: days.length,
      daysInMonth: days.length,
      activeDaysCount,
      days,
      summary: {
        totalBag,
        totalBagKg: Number(totalBagKg.toFixed(2)),
        totalRoll,
        totalRollKg: Number(totalRollKg.toFixed(2)),
        totalOutputKg: Number(totalOutputKg.toFixed(2)),
        totalConsKg: Number(totalConsKg.toFixed(2)),
        totalWasteKg: Number(totalWasteKg.toFixed(2)),
        totalDifferenceKg,
        avgOutputPerDay,
        totalPgvclBill: Number(totalPgvclBill.toFixed(2)),
        powerCostPerDay,
        powerCostPerKg
      },
      machineBreakdown: {
        machineA: { totalKg: Number(machineTotals.A.totalKg.toFixed(2)), avgPerDay: Math.round(machineTotals.A.totalKg / effectiveDays) },
        machineB: { totalKg: Number(machineTotals.B.totalKg.toFixed(2)), avgPerDay: Math.round(machineTotals.B.totalKg / effectiveDays) },
        machineC: { totalKg: Number(machineTotals.C.totalKg.toFixed(2)), avgPerDay: Math.round(machineTotals.C.totalKg / effectiveDays) },
        machineD: { totalKg: Number(machineTotals.D.totalKg.toFixed(2)), avgPerDay: Math.round(machineTotals.D.totalKg / effectiveDays) }
      }
    });
  } catch (error: any) {
    console.error('Error generating master sheet report:', error);
    res.status(500).json({ error: error.message || 'Failed to generate master sheet report' });
  }
});

/**
 * GET /api/daily-plant-log/:date
 * Fetch plant log for a specific date
 */
router.get('/:date', async (req: Request, res: Response) => {
  try {
    const { date } = req.params;
    const { start } = getDayDateRange(date);

    const log = await prisma.dailyPlantLog.findUnique({
      where: { date: start },
      include: {
        materialConsumptions: true,
        wastage: true,
        ancillaries: true
      }
    });

    if (!log) {
      return res.status(404).json({ error: `No plant log found for date ${date}` });
    }

    res.json(log);
  } catch (error: any) {
    console.error('Error fetching plant log by date:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch plant log' });
  }
});

export default router;
