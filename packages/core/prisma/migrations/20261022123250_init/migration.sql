-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('STORY', 'SHORT');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('QUEUED', 'SCRIPTING', 'SCRIPT_READY', 'IMAGING', 'IMAGES_READY', 'VOICING', 'ANIMATING', 'ASSEMBLING', 'REVIEW', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ShortsMode" AS ENUM ('MINI_STORY', 'TEASER');

-- CreateEnum
CREATE TYPE "SheetStatus" AS ENUM ('NONE', 'GENERATING', 'PENDING_APPROVAL', 'APPROVED');

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "youtubeChannelId" TEXT,
    "oauthTokensEnc" TEXT,
    "language" TEXT NOT NULL DEFAULT 'hi-IN',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "themeId" TEXT NOT NULL,
    "generationTime" TEXT NOT NULL DEFAULT '02:00',
    "storyPublishTime" TEXT NOT NULL DEFAULT '18:00',
    "shortPublishTimes" TEXT[] DEFAULT ARRAY['12:00', '20:30']::TEXT[],
    "thumbnailStyle" TEXT NOT NULL DEFAULT 'bold-closeup',
    "introClipKey" TEXT,
    "outroClipKey" TEXT,
    "musicPack" TEXT NOT NULL DEFAULT 'village-warm',
    "subtitlesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "madeForKids" BOOLEAN NOT NULL DEFAULT false,
    "aiDisclosure" BOOLEAN NOT NULL DEFAULT true,
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "shortsMode" "ShortsMode" NOT NULL DEFAULT 'TEASER',
    "motionProvider" TEXT NOT NULL DEFAULT 'kenburns',
    "storyTargetMinutes" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Theme" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "artStylePrompt" TEXT NOT NULL,
    "negativeStyle" TEXT NOT NULL DEFAULT '',
    "tone" TEXT NOT NULL DEFAULT '',
    "targetAudience" TEXT NOT NULL DEFAULT 'family',
    "contentRules" TEXT NOT NULL DEFAULT '',
    "kidSafe" BOOLEAN NOT NULL DEFAULT false,
    "styleTestImages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "styleTestStatus" TEXT NOT NULL DEFAULT 'idle',
    "narratorSpeaker" TEXT NOT NULL DEFAULT 'vidya',
    "narratorPitch" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "narratorPace" DOUBLE PRECISION NOT NULL DEFAULT 0.95,
    "narratorLoudness" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Theme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "age" INTEGER,
    "personality" TEXT NOT NULL,
    "speechStyle" TEXT NOT NULL,
    "visualDescription" TEXT NOT NULL,
    "referenceImages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pendingImages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sheetStatus" "SheetStatus" NOT NULL DEFAULT 'NONE',
    "voiceSpeaker" TEXT NOT NULL DEFAULT 'anushka',
    "voicePitch" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "voicePace" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "voiceLoudness" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "referenceImage" TEXT,
    "pendingImage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Storyline" (
    "id" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "premise" TEXT NOT NULL,
    "worldRules" TEXT NOT NULL DEFAULT '',
    "characterArcs" TEXT NOT NULL DEFAULT '',
    "runningGags" TEXT NOT NULL DEFAULT '',
    "forbiddenTopics" TEXT NOT NULL DEFAULT '',
    "storyMemory" TEXT NOT NULL DEFAULT '',
    "episodeCount" INTEGER NOT NULL DEFAULT 0,
    "openThreads" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Storyline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryDirective" (
    "id" TEXT NOT NULL,
    "storylineId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "consumedById" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryDirective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyRun" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "runDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "type" "ContentType" NOT NULL,
    "channelId" TEXT NOT NULL,
    "dailyRunId" TEXT,
    "parentId" TEXT,
    "slot" INTEGER NOT NULL DEFAULT 0,
    "episodeNumber" INTEGER,
    "status" "ContentStatus" NOT NULL DEFAULT 'QUEUED',
    "failedStage" "ContentStatus",
    "error" TEXT,
    "scriptJson" JSONB,
    "safetyReport" JSONB,
    "title" TEXT,
    "youtubeMeta" JSONB,
    "thumbnailKey" TEXT,
    "videoKey" TEXT,
    "durationSec" DOUBLE PRECISION,
    "costInr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scheduledPublishAt" TIMESTAMP(3),
    "youtubeVideoId" TEXT,
    "memoryApplied" BOOLEAN NOT NULL DEFAULT false,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shot" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "location" TEXT NOT NULL,
    "timeOfDay" TEXT NOT NULL,
    "framing" TEXT NOT NULL,
    "charactersInFrame" TEXT[],
    "speaker" TEXT,
    "dialogueHi" TEXT,
    "emotion" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "imagePromptEn" TEXT NOT NULL,
    "sfx" TEXT,
    "estSeconds" DOUBLE PRECISION NOT NULL,
    "variant" INTEGER NOT NULL DEFAULT 0,
    "imageKey" TEXT,
    "imageHash" TEXT,
    "consistencyScore" DOUBLE PRECISION,
    "audioKey" TEXT,
    "audioHash" TEXT,
    "audioSeconds" DOUBLE PRECISION,
    "durationSec" DOUBLE PRECISION,
    "clipKey" TEXT,
    "clipHash" TEXT,
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCallLog" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "characters" INTEGER NOT NULL DEFAULT 0,
    "images" INTEGER NOT NULL DEFAULT 0,
    "seconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costInr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiCallLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetCache" (
    "hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetCache_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Channel_themeId_key" ON "Channel"("themeId");

-- CreateIndex
CREATE UNIQUE INDEX "Character_themeId_key_key" ON "Character"("themeId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Location_themeId_key_key" ON "Location"("themeId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Storyline_themeId_key" ON "Storyline"("themeId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRun_channelId_runDate_key" ON "DailyRun"("channelId", "runDate");

-- CreateIndex
CREATE INDEX "ContentItem_channelId_createdAt_idx" ON "ContentItem"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentItem_status_idx" ON "ContentItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Shot_contentItemId_idx_key" ON "Shot"("contentItemId", "idx");

-- CreateIndex
CREATE INDEX "ApiCallLog_createdAt_idx" ON "ApiCallLog"("createdAt");

-- CreateIndex
CREATE INDEX "ApiCallLog_contentItemId_idx" ON "ApiCallLog"("contentItemId");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Storyline" ADD CONSTRAINT "Storyline_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryDirective" ADD CONSTRAINT "StoryDirective_storylineId_fkey" FOREIGN KEY ("storylineId") REFERENCES "Storyline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRun" ADD CONSTRAINT "DailyRun_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_dailyRunId_fkey" FOREIGN KEY ("dailyRunId") REFERENCES "DailyRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shot" ADD CONSTRAINT "Shot_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiCallLog" ADD CONSTRAINT "ApiCallLog_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
