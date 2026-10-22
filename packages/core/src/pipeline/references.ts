import { prisma } from "../db.js";
import { storage } from "../storage/index.js";
import { imageProvider } from "../providers/registry.js";
import { characterSheetPrompt, locationPrompt, STYLE_TEST_SUBJECTS } from "../prompts/image.js";
import { themeBundleInclude, type ThemeBundle } from "../domain/types.js";
import { hashOf } from "../util/crypto.js";
import { mapLimit } from "../util/retry.js";
import { getSettings } from "../settings.js";
import { logger } from "../util/log.js";

const log = logger("references");

export const loadTheme = (themeId: string): Promise<ThemeBundle> =>
  prisma.theme.findUniqueOrThrow({ where: { id: themeId }, include: themeBundleInclude });

/** Generate a candidate character sheet (turnaround + expressions). Awaits approval in Character Studio. */
export async function generateCharacterSheet(characterId: string, opts: { autoApprove?: boolean } = {}): Promise<string[]> {
  const ch = await prisma.character.update({ where: { id: characterId }, data: { sheetStatus: "GENERATING" } });
  try {
    const theme = await loadTheme(ch.themeId);
    const provider = await imageProvider();
    const base = characterSheetPrompt(theme, ch);
    const variants = [
      { suffix: "Turnaround: front view, three-quarter view and full-body view.", tag: "turnaround" },
      { suffix: "Expression sheet: three head shots — happy, angry, surprised.", tag: "expressions" },
    ];
    const nonce = Date.now().toString(36);
    const keys: string[] = [];
    for (const v of variants) {
      const img = await provider.generate(
        { prompt: `${base}\n${v.suffix}`, references: [], aspect: "16:9", meta: { kind: "sheet", characters: [ch.key], title: `${ch.name} — ${v.tag}` } },
        { operation: "character-sheet" },
      );
      const key = `themes/${theme.id}/characters/${ch.key}/${v.tag}-${nonce}.png`;
      await storage().put(key, img.data, img.mime);
      keys.push(key);
    }
    await prisma.character.update({
      where: { id: characterId },
      data: opts.autoApprove
        ? { referenceImages: keys, pendingImages: [], sheetStatus: "APPROVED" }
        : { pendingImages: keys, sheetStatus: "PENDING_APPROVAL" },
    });
    return keys;
  } catch (err) {
    await prisma.character.update({ where: { id: characterId }, data: { sheetStatus: ch.referenceImages.length ? "APPROVED" : "NONE" } });
    throw err;
  }
}

export async function approveCharacterSheet(characterId: string) {
  const ch = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
  if (!ch.pendingImages.length) throw new Error("no pending sheet to approve");
  await prisma.character.update({ where: { id: characterId }, data: { referenceImages: ch.pendingImages, pendingImages: [], sheetStatus: "APPROVED" } });
}

export async function rejectCharacterSheet(characterId: string) {
  const ch = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
  await prisma.character.update({ where: { id: characterId }, data: { pendingImages: [], sheetStatus: ch.referenceImages.length ? "APPROVED" : "NONE" } });
}

export async function generateLocationReference(locationId: string, opts: { autoApprove?: boolean } = {}) {
  const loc = await prisma.location.findUniqueOrThrow({ where: { id: locationId } });
  const theme = await loadTheme(loc.themeId);
  const img = await (await imageProvider()).generate(
    { prompt: locationPrompt(theme, loc), references: [], aspect: "16:9", meta: { kind: "location", location: loc.key, title: loc.name } },
    { operation: "location-reference" },
  );
  const key = `themes/${theme.id}/locations/${loc.key}-${hashOf([loc.description, Date.now()]).slice(0, 8)}.png`;
  await storage().put(key, img.data, img.mime);
  await prisma.location.update({ where: { id: locationId }, data: opts.autoApprove ? { referenceImage: key, pendingImage: null } : { pendingImage: key } });
  return key;
}

export async function approveLocationReference(locationId: string) {
  const loc = await prisma.location.findUniqueOrThrow({ where: { id: locationId } });
  if (!loc.pendingImage) throw new Error("no pending location image");
  await prisma.location.update({ where: { id: locationId }, data: { referenceImage: loc.pendingImage, pendingImage: null } });
}

/**
 * The pipeline never blocks on missing references: characters/locations that have never had a sheet
 * get one generated and auto-approved (logged), so a fresh theme can still run end-to-end.
 */
export async function ensureReferences(themeId: string) {
  const theme = await loadTheme(themeId);
  const settings = await getSettings();
  const missingChars = theme.characters.filter((c) => !c.referenceImages.length);
  const missingLocs = theme.locations.filter((l) => !l.referenceImage);
  if (!missingChars.length && !missingLocs.length) return;
  log.warn("auto-generating missing reference images (review them in Character Studio)", {
    characters: missingChars.map((c) => c.key),
    locations: missingLocs.map((l) => l.key),
  });
  const { errors } = await mapLimit(
    [
      ...missingChars.map((c) => (): Promise<unknown> => generateCharacterSheet(c.id, { autoApprove: true })),
      ...missingLocs.map((l) => (): Promise<unknown> => generateLocationReference(l.id, { autoApprove: true })),
    ],
    settings.imageConcurrency,
    (fn) => fn(),
  );
  if (errors.length) throw new Error(`reference generation failed: ${String(errors[0].error)}`);
}

/** "Test style" — 4 sample images with the theme's art style. */
export async function runStyleTest(themeId: string) {
  await prisma.theme.update({ where: { id: themeId }, data: { styleTestStatus: "running" } });
  try {
    const theme = await loadTheme(themeId);
    const provider = await imageProvider();
    const nonce = Date.now().toString(36);
    const { results, errors } = await mapLimit(STYLE_TEST_SUBJECTS, 4, async (subject, i) => {
      const img = await provider.generate(
        {
          prompt: `${theme.artStylePrompt}\n${subject}\nNo text.${theme.negativeStyle ? `\nAvoid: ${theme.negativeStyle}` : ""}`,
          references: [],
          aspect: "16:9",
          meta: { title: subject, location: `style-${i}` },
        },
        { operation: "style-test" },
      );
      const key = `themes/${themeId}/style-test/${nonce}-${i}.png`;
      await storage().put(key, img.data, img.mime);
      return key;
    });
    if (errors.length === STYLE_TEST_SUBJECTS.length) throw errors[0].error;
    await prisma.theme.update({ where: { id: themeId }, data: { styleTestImages: results.filter(Boolean) as string[], styleTestStatus: "done" } });
  } catch (err) {
    await prisma.theme.update({ where: { id: themeId }, data: { styleTestStatus: `error: ${String(err).slice(0, 200)}` } });
    throw err;
  }
}
