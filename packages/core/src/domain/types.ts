import type { Prisma } from "@prisma/client";

export type ThemeBundle = Prisma.ThemeGetPayload<{
  include: { characters: true; locations: true; storyline: { include: { directives: true } } };
}>;
export type CharacterRow = ThemeBundle["characters"][number];
export type LocationRow = ThemeBundle["locations"][number];

export const themeBundleInclude = {
  characters: { orderBy: { createdAt: "asc" } },
  locations: { orderBy: { createdAt: "asc" } },
  storyline: { include: { directives: { where: { consumedAt: null }, orderBy: { createdAt: "asc" } } } },
} satisfies Prisma.ThemeInclude;
