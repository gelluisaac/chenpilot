import * as fs from "fs";
import * as path from "path";
import * as StellarSdk from "@stellar/stellar-sdk";

export interface AssetInfo {
  code: string;
  issuer: string;
  name?: string;
  description?: string;
  image?: string;
  homeDomain?: string;
  lastUpdated: number;
}

export class AssetCache {
  private cache = new Map<string, AssetInfo>();
  private cacheFile: string;

  constructor(cacheDir = path.join(process.cwd(), ".asset-cache")) {
    this.cacheFile = path.join(cacheDir, "assets.json");
    this.loadCache();
  }

  private getKey(asset: StellarSdk.Asset): string {
    if (asset.isNative()) {
      return "XLM";
    } else {
      return `${asset.getCode()}:${asset.getIssuer()}`;
    }
  }

  private loadCache(): void {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const data = fs.readFileSync(this.cacheFile, "utf8");
        const cacheData = JSON.parse(data);
        for (const [key, info] of Object.entries(cacheData)) {
          this.cache.set(key, info as AssetInfo);
        }
      }
    } catch (error) {
      // Ignore errors, start with empty cache
    }
  }

  private saveCache(): void {
    try {
      const cacheDir = path.dirname(this.cacheFile);
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      const cacheData = Object.fromEntries(this.cache);
      fs.writeFileSync(this.cacheFile, JSON.stringify(cacheData, null, 2));
    } catch (error) {
      // Ignore errors
    }
  }

  get(asset: StellarSdk.Asset): AssetInfo | undefined {
    const key = this.getKey(asset);
    return this.cache.get(key);
  }

  set(asset: StellarSdk.Asset, info: AssetInfo): void {
    const key = this.getKey(asset);
    this.cache.set(key, { ...info, lastUpdated: Date.now() });
    this.saveCache();
  }

  async fetchAndCache(
    asset: StellarSdk.Asset,
    horizonUrl?: string
  ): Promise<AssetInfo | null> {
    const existing = this.get(asset);
    if (existing) {
      return existing;
    }

    // For now, just create basic info
    const info: AssetInfo = {
      code: asset.isNative() ? "XLM" : asset.getCode(),
      issuer: asset.isNative() ? "" : asset.getIssuer(),
      lastUpdated: Date.now(),
    };

    this.set(asset, info);
    return info;
  }

  clear(): void {
    this.cache.clear();
    this.saveCache();
  }
}
