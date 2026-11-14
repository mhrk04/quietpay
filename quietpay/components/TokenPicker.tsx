"use client";

import { useEffect, useMemo, useState } from "react";
import { chainName, filterTokens, groupByChain, type TokenInfo } from "@/lib/tokens";

type Props = {
  tokens: TokenInfo[];
  selected?: TokenInfo;
  onSelect: (token: TokenInfo) => void;
};

/** Search box plus tokens grouped by chain. The filter applies 200 ms after typing stops. */
export function TokenPicker({ tokens, selected, onSelect }: Props) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setQuery(input.trim()), 200);
    return () => clearTimeout(id);
  }, [input]);

  const groups = useMemo(() => Array.from(groupByChain(filterTokens(tokens, query))), [tokens, query]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label>
        Search token or network
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. USDC or Ethereum"
          autoComplete="off"
        />
      </label>
      <div
        role="listbox"
        aria-label="Tokens"
        style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 360, overflowY: "auto" }}
      >
        {groups.length === 0 && <p>No tokens match your search.</p>}
        {groups.map(([chain, list]) => (
          <section key={chain} aria-label={chain} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h3 style={{ margin: 0, fontSize: "0.9rem", textTransform: "uppercase" }}>{chainName(chain)}</h3>
            {list.map((t) => {
              const isSelected = selected?.assetId === t.assetId;
              return (
                <button
                  key={t.assetId}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => onSelect(t)}
                  style={{
                    justifyContent: "space-between",
                    background: isSelected ? "#111" : "#fff",
                    color: isSelected ? "#fff" : "#111",
                  }}
                >
                  <span>{t.symbol}</span>
                  <span>{chain}</span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
