import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // MSG91 twins are called with trailing slashes (control.msg91.com/api/v5/.../).
  skipTrailingSlashRedirect: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "ui-avatars.com" },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/api/v5/:path*/",
        destination: "/api/internal/msg91/v5/:path*",
      },
      {
        source: "/api/v5/:path*",
        destination: "/api/internal/msg91/v5/:path*",
      },
    ];
  },
  async headers() {
    return [
      {
        // Phone.Email's popup flow (features/phone-email/components/PhoneEmailAdapter.tsx)
        // navigates our main tab via window.opener after the user verifies
        // inside the popup. Without this header, Chrome's default heuristics
        // can sever window.opener after the popup's cross-origin navigation
        // chain, breaking that handoff — this is Phone.Email's own
        // documented fix (their reference Django integration sets the same
        // header), not something specific to this app.
        source: "/:path*",
        headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" }],
      },
    ];
  },
};

export default nextConfig;
