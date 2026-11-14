const NEAR_ACCOUNT_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export function isValidNearAccount(id: string): boolean {
  return (
    typeof id === "string" &&
    id.length >= 2 &&
    id.length <= 64 &&
    NEAR_ACCOUNT_RE.test(id)
  );
}
