"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { chainName, filterTokens, groupByChain, type TokenInfo } from "@/lib/tokens";

type Props = {
  tokens: TokenInfo[];
  selected?: TokenInfo;
  onSelect: (token: TokenInfo) => void;
};

// Networks most payers use come first; the rest follow in the order the list gives them.
const POPULAR_CHAINS = ["eth", "base", "sol", "btc", "arb", "pol", "bsc", "op", "near"];

function orderGroups(groups: Array<[string, TokenInfo[]]>): Array<[string, TokenInfo[]]> {
  const rank = (chain: string) => {
    const i = POPULAR_CHAINS.indexOf(chain);
    return i === -1 ? POPULAR_CHAINS.length : i;
  };
  return groups
    .map((g, index) => ({ g, index }))
    .sort((a, b) => rank(a.g[0]) - rank(b.g[0]) || a.index - b.index)
    .map(({ g }) => g);
}

/** Search box plus tokens grouped by network. Each network is its own listbox of options. The filter applies 200 ms after typing stops. */
export function TokenPicker({ tokens, selected, onSelect }: Props) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const baseId = useId();
  useEffect(() => {
    const id = setTimeout(() => setQuery(input.trim()), 200);
    return () => clearTimeout(id);
  }, [input]);
  const groups = useMemo(() => orderGroups(Array.from(groupByChain(filterTokens(tokens, query)))), [tokens, query]);
  return (
    <div className="picker">
      <label className="field">
        Search token or network
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. USDC or Ethereum"
          autoComplete="off"
        />
      </label>
      <div className="picker__scroll">
        {groups.length === 0 && <p className="muted">No tokens match your search.</p>}
        {groups.map(([chain, list]) => {
          const headingId = `${baseId}-${chain}`;
          return (
            <div key={chain} className="picker__group">
              <h3 id={headingId} className="picker__heading">
                {chainName(chain)}
              </h3>
              <div role="listbox" aria-labelledby={headingId} className="picker__options">
                {list.map((t) => {
                  const isSelected = selected?.assetId === t.assetId;
                  return (
                    <button
                      key={t.assetId}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className="token-option"
                      onClick={() => onSelect(t)}
                    >
                      <span className="token-option__symbol">{t.symbol}</span>
                      <span className="token-option__chain">{chainName(chain)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
