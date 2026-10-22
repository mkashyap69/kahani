-- CreateEnum
CREATE TYPE "KitStatus" AS ENUM ('QUEUED', 'RESEARCHING', 'WRITING', 'REVIEWING', 'ART', 'MUSIC', 'READY', 'APPLIED', 'FAILED');

-- AlterTable
ALTER TABLE "ApiCallLog" ADD COLUMN     "searches" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "bannerKey" TEXT,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "logoKey" TEXT,
ADD COLUMN     "shortsPlaylistId" TEXT,
ADD COLUMN     "storyPlaylistId" TEXT;

-- CreateTable
CREATE TABLE "LaunchKit" (
    "id" TEXT NOT NULL,
    "idea" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'hi-IN',
    "audience" TEXT NOT NULL DEFAULT '',
    "kidSafe" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" "KitStatus" NOT NULL DEFAULT 'QUEUED',
    "failedStep" "KitStatus",
    "error" TEXT,
    "research" JSONB,
    "kit" JSONB,
    "review" JSONB,
    "logoCandidates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "logoKey" TEXT,
    "bannerKey" TEXT,
    "chosenName" INTEGER NOT NULL DEFAULT 0,
    "costInr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "channelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaunchKit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicTrack" (
    "id" TEXT NOT NULL,
    "pack" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mood" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL DEFAULT '',
    "key" TEXT NOT NULL,
    "durationSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "license" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MusicTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LaunchKit_channelId_key" ON "LaunchKit"("channelId");

-- CreateIndex
CREATE INDEX "MusicTrack_pack_idx" ON "MusicTrack"("pack");

-- AddForeignKey
ALTER TABLE "LaunchKit" ADD CONSTRAINT "LaunchKit_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
