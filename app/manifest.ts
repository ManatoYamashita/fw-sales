import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FirstWeb - Reserch AI for Sales",
    short_name: "Reserch AI",
    description:
      "飲食店向け WEB 集客の営業活動を一元管理する社内向けリードマネジメントシステム。",
    start_url: "/stores",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "ja",
    dir: "ltr",
    background_color: "#f1f5f9",
    theme_color: "#0f172a",
    icons: [
      { src: "/favicon.ico", sizes: "any", type: "image/x-icon" },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon.webp",
        sizes: "500x500",
        type: "image/webp",
        purpose: "any",
      },
      {
        src: "/icon.png",
        sizes: "500x500",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
