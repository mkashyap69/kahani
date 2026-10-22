-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "imageBatch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "imageModels" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "ContentItem" ADD COLUMN     "imageBatch" JSONB;

-- CreateTable
CREATE TABLE "ImageComparison" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "shotIdxs" INTEGER[],
    "models" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'queued',
    "results" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageComparison_pkey" PRIMARY KEY ("id")
);
