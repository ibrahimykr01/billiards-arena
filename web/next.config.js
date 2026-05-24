/** @type {import('next').NextConfig} */
const path = require("path");
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.alias["@billiards/shared"] = path.resolve(__dirname, "../shared/src/index.ts");
    config.resolve.alias["@billiards/shared/constants"] = path.resolve(__dirname, "../shared/src/constants.ts");
    return config;
  },
  transpilePackages: ["@billiards/shared"],
};
module.exports = nextConfig;
