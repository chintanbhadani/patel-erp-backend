import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  let client = await prisma.client.findFirst();
  if (!client) {
    let rep = await prisma.user.findFirst();
    if (!rep) rep = await prisma.user.create({ data: { username: 'testrep', password: 'pw', role: 'SALES_REP' } });
    client = await prisma.client.create({ data: { companyName: 'Test Client', assignedRepId: rep.id } });
  }
  console.log(client.id);
}
main().finally(() => prisma.$disconnect());
