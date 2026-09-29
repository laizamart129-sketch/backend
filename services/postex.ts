const POSTEX_API_BASE_URL = 'https://api.postex.pk/services/integration/api/order';

export interface PostExTrackingEvent {
  transactionStatusMessage?: string;
  transactionStatusMessageCode?: string;
}

export interface PostExTrackingDetails {
  trackingNumber?: string;
  transactionStatus?: string;
  transactionStatusHistory?: PostExTrackingEvent[];
}

interface PostExEnvelope<T> {
  statusCode?: string | number;
  statusMessage?: string;
  dist?: T;
}

const getToken = () => process.env.POSTEX_API_TOKEN?.trim();

const getErrorMessage = (payload: unknown, fallback: string) => {
  if (payload && typeof payload === 'object' && 'statusMessage' in payload) {
    const message = (payload as { statusMessage?: unknown }).statusMessage;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
};

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const token = getToken();
  if (!token) {
    throw new Error('PostEx is not configured. Add POSTEX_API_TOKEN to the backend environment.');
  }

  const response = await fetch(`${POSTEX_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      token,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, `PostEx request failed (${response.status}).`));
  }

  const envelope = payload as PostExEnvelope<T>;
  if (envelope.statusCode && Number(envelope.statusCode) >= 400) {
    throw new Error(envelope.statusMessage || 'PostEx could not complete this request.');
  }

  return envelope.dist as T;
};

export const postExConfig = () => ({
  configured: Boolean(getToken()),
  pickupAddressCode: process.env.POSTEX_PICKUP_ADDRESS_CODE?.trim() || '',
  operationalCity: process.env.POSTEX_OPERATIONAL_CITY?.trim() || 'Lahore',
});

export const getPostExPickupAddresses = () => request<Array<{ addressCode?: string }>>(
  `/v1/get-merchant-address?cityName=${encodeURIComponent(postExConfig().operationalCity)}`,
);

export const createPostExOrder = (payload: Record<string, unknown>) => request<{
  trackingNumber?: string;
  orderStatus?: string;
  orderDate?: string;
}>('/v3/create-order', {
  method: 'POST',
  body: JSON.stringify(payload),
});

export const getPostExTracking = (trackingNumber: string) => request<PostExTrackingDetails>(
  `/v1/track-order/${encodeURIComponent(trackingNumber)}`,
);

export const getPostExAirwayBill = async (trackingNumbers: string[]) => {
  const token = getToken();
  if (!token) {
    throw new Error('PostEx is not configured. Add POSTEX_API_TOKEN to the backend environment.');
  }

  const response = await fetch(
    `${POSTEX_API_BASE_URL}/v1/get-invoice?trackingNumbers=${encodeURIComponent(trackingNumbers.join(','))}`,
    { headers: { token } },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(getErrorMessage(payload, `PostEx airway bill request failed (${response.status}).`));
  }
  return Buffer.from(await response.arrayBuffer());
};

export const normalizePakistaniPhone = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('92') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.length === 10 && digits.startsWith('3')) return `0${digits}`;
  return digits;
};
