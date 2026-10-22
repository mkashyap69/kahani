import { prisma } from "../src/db.js";
import { seedDemo } from "../src/seed.js";

const channel = await seedDemo();
console.log(`Seeded channel "${channel.name}" (${channel.id})`);
await prisma.$disconnect();
