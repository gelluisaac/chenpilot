"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveIssuerFromDomain = resolveIssuerFromDomain;
exports.hasValidStellarTrustline = hasValidStellarTrustline;
exports.createTrustlineOperation = createTrustlineOperation;
// @ts-ignore: dependency is provided at the workspace root
const stellar_sdk_1 = require("stellar-sdk");
/**
 * Resolves an asset issuer's address from a home domain using SEP-1.
 *
 * @param domain The home domain to resolve (e.g., "circle.com")
 * @param assetCode The asset code to find in the stellar.toml
 * @returns The issuer's public key or undefined
 */
function resolveIssuerFromDomain(domain, assetCode) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const url = `https://${domain}/.well-known/stellar.toml`;
            const response = yield fetch(url);
            if (!response.ok)
                return undefined;
            const text = yield response.text();
            // Simple TOML parser for CURRENCIES section
            const currenciesMatch = text.match(/\[\[CURRENCIES\]\]([\s\S]*?)(?=\[\[|$)/g);
            if (!currenciesMatch)
                return undefined;
            for (const currencyBlock of currenciesMatch) {
                const codeMatch = currencyBlock.match(/code\s*=\s*["'](.+?)["']/);
                const issuerMatch = currencyBlock.match(/issuer\s*=\s*["'](.+?)["']/);
                if (codeMatch && codeMatch[1].toUpperCase() === assetCode.toUpperCase() && issuerMatch) {
                    return issuerMatch[1];
                }
            }
            return undefined;
        }
        catch (error) {
            console.error(`Error resolving issuer from domain ${domain}:`, error);
            return undefined;
        }
    });
}
/**
 * Checks whether an account has a valid, non-frozen trustline for an asset.
 * - For native XLM the function returns exists=true, authorized=true.
 * - For other assets it fetches the account from Horizon and inspects balances.
 *
 * @param horizonUrl Horizon server URL (defaults to public Horizon)
 * @param accountId Stellar account id to check
 * @param assetCode Asset code (string; "XLM" for native)
 * @param assetIssuer Asset issuer public key (optional for native/XLM)
 */
function hasValidStellarTrustline(horizonUrl, accountId, assetCode, assetIssuer) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const server = new stellar_sdk_1.Server(horizonUrl || "https://horizon.stellar.org");
        // Native XLM does not require a trustline
        if (!assetCode || assetCode.toUpperCase() === "XLM") {
            return { exists: true, authorized: true };
        }
        let account;
        try {
            account = yield server.accounts().accountId(accountId).call();
        }
        catch (err) {
            return {
                exists: false,
                authorized: false,
                details: { error: String(err) },
            };
        }
        const balances = account.balances || [];
        const match = balances.find((b) => {
            return (b.asset_code === assetCode &&
                (assetIssuer ? b.asset_issuer === assetIssuer : true));
        });
        if (!match) {
            return { exists: false, authorized: false };
        }
        // Horizon may include authorization properties on the trustline/balance object
        const authorized = 
        // common property name
        (_c = (_b = (_a = match.is_authorized) !== null && _a !== void 0 ? _a : match.authorized) !== null && _b !== void 0 ? _b : 
        // if issuer uses 'authorized_to_maintain_liabilities' treat as authorized
        match.authorized_to_maintain_liabilities) !== null && _c !== void 0 ? _c : true;
        return { exists: true, authorized, details: { balance: match } };
    });
}
/**
 * Creates a ChangeTrust operation for a given asset.
 *
 * @param assetCode Asset code (e.g., "USDC")
 * @param assetIssuer Asset issuer public key or domain
 * @param limit Optional trust limit
 * @returns An Operation object
 */
function createTrustlineOperation(assetCode, assetIssuer, limit) {
    return __awaiter(this, void 0, void 0, function* () {
        let issuer = assetIssuer;
        // If issuer looks like a domain, resolve it
        if (assetIssuer.includes(".") && !assetIssuer.startsWith("G")) {
            const resolvedIssuer = yield resolveIssuerFromDomain(assetIssuer, assetCode);
            if (!resolvedIssuer) {
                throw new Error(`Could not resolve issuer for ${assetCode} from domain ${assetIssuer}`);
            }
            issuer = resolvedIssuer;
        }
        const asset = new stellar_sdk_1.Asset(assetCode, issuer);
        return stellar_sdk_1.Operation.changeTrust({
            asset,
            limit,
        });
    });
}
exports.default = hasValidStellarTrustline;
