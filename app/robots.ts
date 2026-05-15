import type { MetadataRoute } from "next";

// 社内ツールのため、全 User-Agent / 全パスをインデックス対象外とする。
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
