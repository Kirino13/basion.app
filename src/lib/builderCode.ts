export const BUILDER_CODE_SUFFIX = '0x62635f6b776a3568616576' as const;

const HEX_RE = /^0x[0-9a-fA-F]*$/;

function normalizeHexData(data?: string | null): `0x${string}` {
  if (!data) return '0x';
  if (!HEX_RE.test(data)) {
    throw new Error('Invalid hex calldata');
  }
  if (data.length % 2 !== 0) {
    throw new Error('Invalid hex calldata length');
  }
  return data as `0x${string}`;
}

export function appendBuilderSuffix(data?: string | null): `0x${string}` {
  const normalized = normalizeHexData(data);
  const suffixNoPrefix = BUILDER_CODE_SUFFIX.slice(2);

  if (normalized.toLowerCase().endsWith(suffixNoPrefix.toLowerCase())) {
    return normalized;
  }

  return `${normalized}${suffixNoPrefix}` as `0x${string}`;
}

export function stripBuilderSuffix(data: string): `0x${string}` {
  const normalized = normalizeHexData(data);
  const normalizedLower = normalized.toLowerCase();
  const suffixNoPrefix = BUILDER_CODE_SUFFIX.slice(2).toLowerCase();

  if (!normalizedLower.endsWith(suffixNoPrefix)) {
    return normalized;
  }

  return `0x${normalized.slice(2, normalized.length - suffixNoPrefix.length)}` as `0x${string}`;
}
