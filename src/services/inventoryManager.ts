import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class InventoryManager {
  /**
   * Automates BOM (Bill of Materials) consumption when a finished roll is saved.
   * Typical ratios for PET straps might be:
   * 80% Recycled PET Flakes
   * 18% Virgin Chips
   * 2% Color Masterbatch
   * 
   * (These are example ratios, they can be adjusted or moved to a DB table)
   */
  static async consumeBOM(netWeight: number) {
    const flakesRatio = 0.80;
    const virginRatio = 0.18;
    const colorRatio = 0.02;

    const consumedFlakes = netWeight * flakesRatio;
    const consumedVirgin = netWeight * virginRatio;
    const consumedColor = netWeight * colorRatio;

    try {
      await prisma.$transaction([
        prisma.inventory.upsert({
          where: { materialName: 'Recycled PET Flakes' },
          update: { quantityKg: { decrement: consumedFlakes } },
          create: { materialName: 'Recycled PET Flakes', quantityKg: -consumedFlakes }
        }),
        prisma.inventory.upsert({
          where: { materialName: 'Virgin Chips' },
          update: { quantityKg: { decrement: consumedVirgin } },
          create: { materialName: 'Virgin Chips', quantityKg: -consumedVirgin }
        }),
        prisma.inventory.upsert({
          where: { materialName: 'Color Masterbatch' },
          update: { quantityKg: { decrement: consumedColor } },
          create: { materialName: 'Color Masterbatch', quantityKg: -consumedColor }
        })
      ]);
      
      console.log(`BOM Consumed for ${netWeight}kg roll. Flakes: ${consumedFlakes}kg, Virgin: ${consumedVirgin}kg, Color: ${consumedColor}kg`);
    } catch (error) {
      console.error('Error consuming BOM inventory:', error);
      throw error;
    }
  }
}
