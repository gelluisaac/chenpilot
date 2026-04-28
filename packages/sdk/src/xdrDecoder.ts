import * as StellarSdk from "@stellar/stellar-sdk";

/**
 * Utility class for decoding and explaining Stellar XDR operations in human-readable format.
 */
export class XdrDecoder {
  /**
   * Explains a Stellar operation from its XDR representation in human-friendly terms.
   * @param operationXdr The XDR string of the operation.
   * @returns A human-readable description of the operation.
   */
  static explainOperation(operationXdr: string): string {
    try {
      const operation = StellarSdk.xdr.Operation.fromXDR(
        operationXdr,
        "base64"
      );
      const opType = operation.body().switch();
      const op = operation.body().value();

      switch (opType) {
        case StellarSdk.xdr.OperationType.createAccount(): {
          const createAccountOp = op as any;
          return `Create account for ${createAccountOp.destination().toString()} with starting balance of ${createAccountOp.startingBalance().toString()} XLM`;
        }

        case StellarSdk.xdr.OperationType.payment(): {
          const paymentOp = op as any;
          const asset = paymentOp.asset();
          const assetDesc = this.getAssetDesc(asset);
          return `Send ${paymentOp.amount().toString()} ${assetDesc} to ${paymentOp.destination().toString()}`;
        }

        case StellarSdk.xdr.OperationType.pathPaymentStrictReceive():
          const pathPaymentOp = op as any;
          const sendAsset = pathPaymentOp.sendAsset();
          const destAsset = pathPaymentOp.destAsset();
          const sendAssetDesc = this.getAssetDesc(sendAsset);
          const destAssetDesc = this.getAssetDesc(destAsset);
          return `Path payment: send up to ${pathPaymentOp.sendMax().toString()} ${sendAssetDesc} to receive exactly ${pathPaymentOp.destAmount().toString()} ${destAssetDesc} to ${pathPaymentOp.destination().toString()}`;

        case StellarSdk.xdr.OperationType.manageSellOffer():
          const manageSellOp = op as any;
          const selling = manageSellOp.selling();
          const buying = manageSellOp.buying();
          const sellingDesc = this.getAssetDesc(selling);
          const buyingDesc = this.getAssetDesc(buying);
          return `Manage sell offer: sell ${manageSellOp.amount().toString()} ${sellingDesc} for ${buyingDesc} at price ${manageSellOp.price().n().toString()}/${manageSellOp.price().d().toString()}`;

        case StellarSdk.xdr.OperationType.createPassiveSellOffer():
          const passiveSellOp = op as any;
          const pselling = passiveSellOp.selling();
          const pbuying = passiveSellOp.buying();
          const psellingDesc = this.getAssetDesc(pselling);
          const pbuyingDesc = this.getAssetDesc(pbuying);
          return `Create passive sell offer: sell ${passiveSellOp.amount().toString()} ${psellingDesc} for ${pbuyingDesc} at price ${passiveSellOp.price().n().toString()}/${passiveSellOp.price().d().toString()}`;

        case StellarSdk.xdr.OperationType.setOptions():
          return `Set account options`;

        case StellarSdk.xdr.OperationType.changeTrust():
          const changeTrustOp = op as any;
          const line = changeTrustOp.line();
          const limit = changeTrustOp.limit().toString();
          if (
            line.switch() ===
            (
              StellarSdk.xdr as any
            ).ChangeTrustAssetType?.changeTrustAssetTypeNative?.()
          ) {
            return `Change trust: remove trustline for XLM (limit: ${limit})`;
          } else {
            const assetDesc = this.getAssetDesc(
              (line as any).asset?.() || line
            );
            return `Change trust: set trustline for ${assetDesc} (limit: ${limit})`;
          }

        case StellarSdk.xdr.OperationType.allowTrust():
          const allowTrustOp = op as any;
          const trustor = allowTrustOp.trustor().toString();
          const assetCode = allowTrustOp.asset().toString();
          const authorize = allowTrustOp.authorize().toString();
          return `Allow trust: ${authorize === "1" ? "authorize" : "deauthorize"} ${trustor} to hold ${assetCode}`;

        case StellarSdk.xdr.OperationType.accountMerge():
          const mergeOp = op as any;
          return `Merge account into ${mergeOp.toString()}`;

        case StellarSdk.xdr.OperationType.inflation():
          return `Run inflation`;

        case StellarSdk.xdr.OperationType.manageData():
          const manageDataOp = op as any;
          const name = manageDataOp.dataName().toString();
          if (manageDataOp.dataValue()) {
            const value = manageDataOp.dataValue().toString();
            return `Set account data: "${name}" = "${value}"`;
          } else {
            return `Remove account data: "${name}"`;
          }

        case StellarSdk.xdr.OperationType.bumpSequence():
          const bumpSeqOp = op as any;
          return `Bump sequence number to ${bumpSeqOp.bumpTo().toString()}`;

        case StellarSdk.xdr.OperationType.createClaimableBalance():
          const createClaimOp = op as any;
          const claimants = createClaimOp.claimants();
          const asset = createClaimOp.asset();
          const amount = createClaimOp.amount().toString();
          const assetDesc = this.getAssetDesc(asset);
          return `Create claimable balance: ${amount} ${assetDesc} for ${claimants.length} claimant(s)`;

        case StellarSdk.xdr.OperationType.claimClaimableBalance():
          const claimOp = op as any;
          return `Claim claimable balance ${claimOp.balanceId().toString()}`;

        case StellarSdk.xdr.OperationType.beginSponsoringFutureReserves():
          const beginSponsorOp = op as any;
          return `Begin sponsoring future reserves for ${beginSponsorOp.sponsoredId().toString()}`;

        case StellarSdk.xdr.OperationType.endSponsoringFutureReserves():
          return `End sponsoring future reserves`;

        case StellarSdk.xdr.OperationType.revokeSponsorship():
          return `Revoke sponsorship`;

        case StellarSdk.xdr.OperationType.clawback():
          const clawbackOp = op as any;
          const from = clawbackOp.from().toString();
          const asset = clawbackOp.asset();
          const amount = clawbackOp.amount().toString();
          const assetDesc = this.getAssetDesc(asset);
          return `Clawback ${amount} ${assetDesc} from ${from}`;

        case StellarSdk.xdr.OperationType.clawbackClaimableBalance():
          const clawbackClaimOp = op as any;
          return `Clawback claimable balance ${clawbackClaimOp.balanceId().toString()}`;

        case StellarSdk.xdr.OperationType.setTrustLineFlags():
          const setTrustFlagsOp = op as any;
          const trustor = setTrustFlagsOp.trustor().toString();
          const asset = setTrustFlagsOp.asset();
          const assetDesc = this.getAssetDesc(asset);
          const clearFlags = setTrustFlagsOp.clearFlags().toString();
          const setFlags = setTrustFlagsOp.setFlags().toString();
          return `Set trustline flags for ${trustor}'s ${assetDesc}: clear ${clearFlags}, set ${setFlags}`;

        case StellarSdk.xdr.OperationType.liquidityPoolDeposit():
          const depositOp = op as any;
          const poolId = depositOp.liquidityPoolId().toString();
          return `Deposit into liquidity pool ${poolId}`;

        case StellarSdk.xdr.OperationType.liquidityPoolWithdraw():
          const withdrawOp = op as any;
          const poolId = withdrawOp.liquidityPoolId().toString();
          return `Withdraw from liquidity pool ${poolId}`;

        case StellarSdk.xdr.OperationType.invokeHostFunction():
          return `Invoke Soroban contract`;

        case StellarSdk.xdr.OperationType.extendFootprintTtl():
          const extendOp = op as any;
          return `Extend footprint TTL by ${extendOp.extendTo().toString()} ledgers`;

        case StellarSdk.xdr.OperationType.restoreFootprint():
          return `Restore footprint`;

        default:
          return `Unknown operation type: ${opType}`;
      }
    } catch (error) {
      return `Failed to decode operation: ${(error as Error).message}`;
    }
  }

  private static getAssetDesc(asset: any): string {
    if (asset.switch() === StellarSdk.xdr.AssetType.assetTypeNative()) {
      return "XLM";
    } else {
      return `${asset.assetCode().toString()} (${asset.issuer().toString()})`;
    }
  }
}
