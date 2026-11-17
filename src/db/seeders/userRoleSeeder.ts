import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { 
  userRoles, 
  categories, 
  partOfs, 
  subPartOfs,
  cores,
  dies,
  grades,
  units
} from '../seederMasters';

const prisma = new PrismaClient();

/**
 * Upsert / Seed helper function:
 * Checks if record already exists based on unique criteria / name.
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
      const userPassword = item.password
        ? await bcrypt.hash(item.password, 10)
        : defaultPasswordHash;

      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { username: item.username },
            { employeeId: item.employeeId }
          ]
        }
      });

      if (existingUser) {
        if (item.username === 'chintan') {
          await prisma.user.update({
            where: { id: existingUser.id },
            data: {
              password: userPassword,
              role: item.role,
              status: item.status,
              isBlock: item.isBlock
            }
          });
          console.log(`🔄 [UPDATED USER] Updated credentials: username='${item.username}' | role='${item.role}'`);
        } else {
          console.log(`ℹ️ [SKIP USER] Already exists: username='${item.username}' | role='${item.role}'`);
          userSkipped++;
        }
      } else {
        const createdUser = await prisma.user.create({
          data: {
            employeeId: item.employeeId,
            username: item.username,
            fullName: item.fullName,
            email: item.email,
            contactNumber: item.contactNumber,
            password: userPassword,
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
  console.log('📦 Starting Category / Item Group Seeder...');
  console.log('-----------------------------------------');
  let catInserted = 0;
  let catSkipped = 0;

  for (const cat of categories) {
    try {
      const existingCat = await prisma.category.findFirst({
        where: {
          name: { equals: cat.name, mode: 'insensitive' }
        }
      });

      if (existingCat) {
        console.log(`ℹ️ [SKIP CATEGORY] Already exists: name='${existingCat.name}'`);
        catSkipped++;
      } else {
        const createdCat = await prisma.category.create({
          data: {
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

  console.log('-----------------------------------------');
  console.log('🧩 Starting Part Of Seeder...');
  console.log('-----------------------------------------');
  let partOfInserted = 0;
  let partOfSkipped = 0;

  for (const item of partOfs) {
    try {
      const existing = await prisma.partOf.findFirst({
        where: {
          name: { equals: item.name, mode: 'insensitive' }
        }
      });

      if (existing) {
        console.log(`ℹ️ [SKIP PART OF] Already exists: name='${existing.name}'`);
        partOfSkipped++;
      } else {
        const created = await prisma.partOf.create({
          data: {
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

  console.log('-----------------------------------------');
  console.log('🧩 Starting Sub Part Of Seeder...');
  console.log('-----------------------------------------');
  let subPartOfInserted = 0;
  let subPartOfSkipped = 0;

  for (const item of subPartOfs) {
    try {
      const existing = await prisma.subPartOf.findFirst({
        where: {
          name: { equals: item.name, mode: 'insensitive' }
        }
      });

      if (existing) {
        console.log(`ℹ️ [SKIP SUB PART OF] Already exists: name='${existing.name}'`);
        subPartOfSkipped++;
      } else {
        const created = await prisma.subPartOf.create({
          data: {
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

  console.log('-----------------------------------------');
  console.log('⚙️ Starting Core Master Seeder...');
  console.log('-----------------------------------------');
  let coreInserted = 0;
  let coreSkipped = 0;

  for (const item of cores) {
    try {
      const existing = await prisma.coreMaster.findFirst({
        where: { name: { equals: item.name, mode: 'insensitive' } }
      });
      if (existing) {
        console.log(`ℹ️ [SKIP CORE] Already exists: name='${existing.name}'`);
        coreSkipped++;
      } else {
        const created = await prisma.coreMaster.create({
          data: { name: item.name, disabled: false }
        });
        console.log(`✅ [INSERTED CORE] ID=${created.id} | name='${created.name}'`);
        coreInserted++;
      }
    } catch (err: any) {
      console.error(`❌ Error processing seed Core '${item.name}':`, err.message || err);
    }
  }

  console.log('-----------------------------------------');
  console.log('🔘 Starting Die Master Seeder...');
  console.log('-----------------------------------------');
  let dieInserted = 0;
  let dieSkipped = 0;

  for (const item of dies) {
    try {
      const existing = await prisma.dieMaster.findFirst({
        where: { name: { equals: item.name, mode: 'insensitive' } }
      });
      if (existing) {
        console.log(`ℹ️ [SKIP DIE] Already exists: name='${existing.name}'`);
        dieSkipped++;
      } else {
        const created = await prisma.dieMaster.create({
          data: { name: item.name, disabled: false }
        });
        console.log(`✅ [INSERTED DIE] ID=${created.id} | name='${created.name}'`);
        dieInserted++;
      }
    } catch (err: any) {
      console.error(`❌ Error processing seed Die '${item.name}':`, err.message || err);
    }
  }

  console.log('-----------------------------------------');
  console.log('🏷️ Starting Grade Master Seeder...');
  console.log('-----------------------------------------');
  let gradeInserted = 0;
  let gradeSkipped = 0;

  for (const item of grades) {
    try {
      const existing = await prisma.gradeMaster.findFirst({
        where: { name: { equals: item.name, mode: 'insensitive' } }
      });
      if (existing) {
        console.log(`ℹ️ [SKIP GRADE] Already exists: name='${existing.name}'`);
        gradeSkipped++;
      } else {
        const created = await prisma.gradeMaster.create({
          data: { name: item.name, disabled: false }
        });
        console.log(`✅ [INSERTED GRADE] ID=${created.id} | name='${created.name}'`);
        gradeInserted++;
      }
    } catch (err: any) {
      console.error(`❌ Error processing seed Grade '${item.name}':`, err.message || err);
    }
  }

  console.log('-----------------------------------------');
  console.log('📏 Starting Unit (UOM) Seeder...');
  console.log('-----------------------------------------');
  let unitInserted = 0;
  let unitSkipped = 0;

  for (const item of units) {
    try {
      const existing = await prisma.unit.findFirst({
        where: { name: { equals: item.name, mode: 'insensitive' } }
      });
      if (existing) {
        console.log(`ℹ️ [SKIP UNIT] Already exists: name='${existing.name}'`);
        unitSkipped++;
      } else {
        const created = await prisma.unit.create({
          data: { name: item.name, disabled: false }
        });
        console.log(`✅ [INSERTED UNIT] ID=${created.id} | name='${created.name}'`);
        unitInserted++;
      }
    } catch (err: any) {
      console.error(`❌ Error processing seed Unit '${item.name}':`, err.message || err);
    }
  }

  console.log('-----------------------------------------');
  console.log(`🎉 Master Seeding Complete!`);
  console.log(`   Users: ${userInserted} inserted, ${userSkipped} skipped.`);
  console.log(`   Categories / Item Groups: ${catInserted} inserted, ${catSkipped} skipped.`);
  console.log(`   Part Of: ${partOfInserted} inserted, ${partOfSkipped} skipped.`);
  console.log(`   Sub Part Of: ${subPartOfInserted} inserted, ${subPartOfSkipped} skipped.`);
  console.log(`   Cores: ${coreInserted} inserted, ${coreSkipped} skipped.`);
  console.log(`   Dies: ${dieInserted} inserted, ${dieSkipped} skipped.`);
  console.log(`   Grades: ${gradeInserted} inserted, ${gradeSkipped} skipped.`);
  console.log(`   Units: ${unitInserted} inserted, ${unitSkipped} skipped.`);
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
