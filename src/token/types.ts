/**
 * Content token types.
 *
 * Each piece of content can have a BSV-21 token minted for it.
 * The token represents ownership of the content's revenue stream.
 * Revenue from streaming flows to the token address and is
 * distributed to token holders as dividends.
 */

export interface ContentToken {
  /** BSV-21 token ID: {deploy_txid}_0 */
  tokenId: string;
  /** Token ticker (e.g. $EMPRESS) */
  ticker: string;
  /** Display name */
  name: string;
  /** Total supply (fixed at mint) */
  supply: number;
  /** The content this token is linked to */
  infohash: string;
  /** Address where streaming revenue accumulates */
  revenueAddress: string;
  /** Deploy transaction ID */
  deployTxid: string;
  /** Creator's address (holds 100% initially) */
  creatorAddress: string;
  /** Timestamp of minting */
  mintedAt: number;
  /** Whether this was minted on-chain or simulated */
  live: boolean;
}

export interface TokenHolder {
  address: string;
  amount: number;
  /** Percentage of total supply */
  percentage: number;
}

export interface TokenRevenue {
  /** Total sats accumulated at the revenue address */
  totalSats: number;
  /** Total streams that contributed */
  totalStreams: number;
  /** Sats pending distribution */
  pendingDividends: number;
  /** Sats already distributed */
  distributedDividends: number;
}

export interface TokenDashboard {
  token: ContentToken;
  holders: TokenHolder[];
  revenue: TokenRevenue;
}
