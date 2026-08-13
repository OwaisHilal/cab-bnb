import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
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
