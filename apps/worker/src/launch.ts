/**
 * Channel launch kit from the command line:
 *   npm run launch -- "Panchatantra animal fables for kids" [--kids] [--apply]
 * Runs research → write → review → art → music in-process and prints the result.
 */
import { applyLaunchKit, KitSchema, logger, prisma, providerSummary, runLaunchKit, type Research } from "@kahani/core";

const args = process.argv.slice(2);
const idea = args.filter((a) => !a.startsWith("--")).join(" ").trim();
if (!idea) {
  console.error('usage: npm run launch -- "channel idea" [--kids] [--apply]');
  process.exit(1);
}
const log = logger("launch");
log.info("providers", await providerSummary());
const kit = await prisma.launchKit.create({ data: { idea, kidSafe: args.includes("--kids") } });
await runLaunchKit(kit.id);
const done = await prisma.launchKit.findUniqueOrThrow({ where: { id: kit.id } });
const k = KitSchema.parse(done.kit);
const r = done.research as unknown as Research;
console.log(`\n──── Launch kit ${kit.id} (₹${done.costInr.toFixed(2)}) ────`);
console.log("Research:", r.summary, `(${r.sources.length} sources)`);
console.log("Names:", k.channel.nameOptions.map((n) => `${n.name} / ${n.nameHi}`).join(" | "));
console.log("Cast:", k.characters.map((c) => `${c.name} [${c.voice.speaker}]`).join(", "), "· narrator", k.narrator.speaker);
console.log("Locations:", k.locations.map((l) => l.name).join(", "));
console.log("Music:", (await prisma.musicTrack.findMany({ where: { pack: `kit-${kit.id}` } })).map((t) => `${t.title} (${t.durationSec.toFixed(0)}s, ${t.source})`).join(", "));
console.log("Logo:", done.logoKey, "Banner:", done.bannerKey);
if (args.includes("--apply")) console.log("Applied:", await applyLaunchKit(kit.id));
await prisma.$disconnect();
