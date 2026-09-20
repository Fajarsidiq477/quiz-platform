import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` blocks its dev-only endpoints (hot reload) for any host other than localhost, and
  // then the page never becomes interactive. Add the address you open the dev site by. Only
  // affects `next dev`; a production build ignores it.
  allowedDevOrigins: ["192.168.56.1"],

  // A server action's body is limited to 1 MB by default. The quiz import uploads an Excel file of
  // up to 2 MB (MAX_IMPORT_BYTES), plus a little for the rest of the form.
  experimental: {
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;
