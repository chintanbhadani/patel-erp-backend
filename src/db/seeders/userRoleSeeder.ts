import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { userRoles, categories, partOfs, subPartOfs } from '../seederMasters';

const prisma = new PrismaClient();

/**
 * Upsert / Seed helper function:
 * Checks if record already exists based on unique criteria.
 * If entry already exists -> DOES NOT ADD OR OVERWRITE DATA.
 * If entry does not exist -> Inserts record.
 */
export async function seedUserRoles() {
  console.log('-----------------------------------------');
  console.log('🌱 Starting Master Seeder...');
  console.log('-----------------------------------------');

  const defaultPasswordHash = await bcrypt.hash('admin123', 10);
  let userInserted = 0;
  let userSkipped = 0;

  for (const item of userRoles) {
    try {
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { username: item.username },
            { employeeId: item.employeeId }
          ]
        }
      });

      if (existingUser) {
        console.log(`ℹ️ [SKIP USER] Already exists: username='${item.username}' | role='${item.role}'`);
        userSkipped++;
      } else {
        const createdUser = await prisma.user.create({
          data: {
            employeeId: item.employeeId,
            username: item.username,
            fullName: item.fullName,
            email: item.email,
            contactNumber: item.contactNumber,
            password: defaultPasswordHash,
            role: item.role,
            status: item.status,
            isBlock: item.isBlock
          }
        });
        console.log(`✅ [INSERTED USER] ID=${createdUser.id} | username='${createdUser.username}' | role='${createdUser.role}'`);
        userInserted++;
      }
    } catch (err: any) {
      console.error(`❌ Error processing seed user '${item.username}':`, err.message || err);
    }
  }

  console.log('-----------------------------------------');
  console.log('📦 Starting Category Seeder...');
  console.log('-----------------------------------------');
  let catInserted = 0;
  let catSkipped = 0;

  for (const cat of categories) {
    try {
      const existingCat = await prisma.category.findFirst({
        where: {
          OR: [
            { id: cat.id },
            { name: cat.name }
          ]
        }
      });

      if (existingCat) {
        console.log(`ℹ️ [SKIP CATEGORY] Already exists: ID=${existingCat.id} | name='${existingCat.name}'`);
        catSkipped++;
      } else {
        const createdCat = await prisma.category.create({
          data: {
            id: cat.id,
            name: cat.name
          }
        });
        console.log(`✅ [INSERTED CATEGORY] ID=${createdCat.id} | name='${createdCat.name}'`);
        catInserted++;
      }
    } catch (err: any) {
      console.error(`❌ Error processing seed category '${cat.name}':`, err.message || err);
    }
  }

  // Sync postgres sequence for category_id_seq if needed
  try {
    await prisma.$executeRawUnsafe(`SELECT setval('public."Category_id_seq"', (SELECT COALESCE(MAX(id), 1) FROM "Category"));`);
  } catch (e) {
    // Ignore sequence warning if dev DB
  }

  console.log('-----------------------------------------');
  console.log('🧩 Starting Part Of Seeder...');
  console.log('-----------------------------------------');
  let partOfInserted = 0;
  let partOfSkipped = 0;

  for (const item of partOfs) {
    try {
      const existing = await prisma.partOf.findFirst({
        where: {
          OR: [
            { id: item.id },
            { name: item.name }
          ]
        }
      });

      if (existing) {
        console.log(`ℹ️ [SKIP PART OF] Already exists: ID=${existing.id} | name='${existing.name}'`);
        partOfSkipped++;
      } else {
        const created = await prisma.partOf.create({
          data: {
            id: item.id,
            name: item.name
          }
        });
        console.log(`✅ [INSERTED PART OF] ID=${created.id} | name='${created.name}'`);
        partOfInserted++;
      }
    } catch (err: any) {
      console.error(`❌ Error processing seed Part Of '${item.name}':`, err.message || err);
    }
  }

  try {
    await prisma.$executeRawUnsafe(`SELECT setval('public."PartOf_id_seq"', (SELECT COALESCE(MAX(id), 1) FROM "PartOf"));`);
  } catch (e) {
    // Ignore sequence warning if dev DB
  }

  console.log('-----------------------------------------');
  console.log('🧩 Starting Sub Part Of Seeder...');
  console.log('-----------------------------------------');
  let subPartOfInserted = 0;
  let subPartOfSkipped = 0;

  for (const item of subPartOfs) {
    try {
      const existing = await prisma.subPartOf.findFirst({
        where: {
          OR: [
            { id: item.id },
            { name: item.name }
          ]
        }
      });

      if (existing) {
        console.log(`ℹ️ [SKIP SUB PART OF] Already exists: ID=${existing.id} | name='${existing.name}'`);
        subPartOfSkipped++;
      } else {
        const created = await prisma.subPartOf.create({
          data: {
            id: item.id,
            name: item.name
          }
        });
        console.log(`✅ [INSERTED SUB PART OF] ID=${created.id} | name='${created.name}'`);
        subPartOfInserted++;
      }
    } catch (err: any) {
      console.error(`❌ Error processing seed Sub Part Of '${item.name}':`, err.message || err);
    }
  }

  try {
    await prisma.$executeRawUnsafe(`SELECT setval('public."SubPartOf_id_seq"', (SELECT COALESCE(MAX(id), 1) FROM "SubPartOf"));`);
  } catch (e) {
    // Ignore sequence warning if dev DB
  }

  console.log('-----------------------------------------');
  console.log(`🎉 Master Seeding Complete!`);
  console.log(`   Users: ${userInserted} inserted, ${userSkipped} skipped.`);
  console.log(`   Categories: ${catInserted} inserted, ${catSkipped} skipped.`);
  console.log(`   Part Of: ${partOfInserted} inserted, ${partOfSkipped} skipped.`);
  console.log(`   Sub Part Of: ${subPartOfInserted} inserted, ${subPartOfSkipped} skipped.`);
  console.log('-----------------------------------------');
}

// Auto-execute if script is called directly via CLI
if (require.main === module) {
  seedUserRoles()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error('❌ Seeder process failed:', e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
