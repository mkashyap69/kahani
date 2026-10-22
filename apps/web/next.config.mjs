/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@kahani/core"],
  serverExternalPackages: ["@prisma/client", ".prisma/client", "bullmq", "ioredis", "sharp", "googleapis", "@google/genai", "@anthropic-ai/sdk", "@aws-sdk/client-s3"],
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  experimental: { serverActions: { bodySizeLimit: "200mb" } },
  webpack(config) {
    // @kahani/core is ESM TypeScript that imports "./x.js" for "./x.ts"
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};
export default nextConfig;
