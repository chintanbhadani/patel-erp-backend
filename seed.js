const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash('password123', salt);

  const user = await prisma.user.upsert({ 
    where: { username: 'admin@patelpetstrap.com' },
    update: {
      password: hashedPassword
    },
    create: {
      username: 'admin@patelpetstrap.com',
      password: hashedPassword,
      role: 'PLANT_ADMIN',
    },
  });
  console.log('Seed created user:', user);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
