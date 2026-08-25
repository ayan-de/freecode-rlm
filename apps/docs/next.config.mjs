import nextra from "nextra";

const withNextra = nextra({
  defaultShowCopyCode: true,
  readingTime: true,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  cleanDistDir: true,
};

export default withNextra(nextConfig);
