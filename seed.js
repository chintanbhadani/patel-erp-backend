const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash('password123', salt);

  const usersToSeed = [
    { username: 'admin@patelpetstrap.com', role: 'PLANT_ADMIN' },
    { username: 'payroll.tz@neelkanth.com', role: 'PLANT_ADMIN' },
    { username: 'admin', role: 'PLANT_ADMIN' }
  ];

  for (const u of usersToSeed) {
    const user = await prisma.user.upsert({ 
      where: { username: u.username },
      update: {
        password: hashedPassword,
        role: u.role
      },
      create: {
        username: u.username,
        password: hashedPassword,
        role: u.role,
      },
    });
    console.log('Seeded user:', user.username);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
