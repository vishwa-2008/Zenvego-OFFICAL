// Free payment integration via UPI (Unified Payments Interface).
// Works in India with any UPI app (PhonePe, Google Pay, Paytm, BHIM).
// Zero-cost, no gateway fees, no merchant onboarding needed for intent-based flow.
export interface UPIPaymentParams {
  payeeVpa: string; // Merchant VPA, e.g. merchant@upi
  payeeName: string;
  amount: number;
  currency?: 'INR' | 'USD';
  note?: string;
  transactionRef?: string;
}

export function buildUpiUrl(params: UPIPaymentParams): string {
  const url = new URL('upi://pay');
  url.searchParams.set('pa', params.payeeVpa);
  url.searchParams.set('pn', params.payeeName);
  url.searchParams.set('am', params.amount.toFixed(2));
  url.searchParams.set('cu', params.currency || 'INR');
  if (params.note) url.searchParams.set('tn', params.note);
  if (params.transactionRef) url.searchParams.set('tr', params.transactionRef);
  return url.toString();
}

export function initiateUPIPayment(params: UPIPaymentParams): void {
  const upiUrl = buildUpiUrl(params);
  // On mobile this opens the UPI app selector; on desktop show a QR fallback.
  window.location.href = upiUrl;
}

// Generate a UPI QR code URL (for scanning at checkout)
export function getUpiQrDataUrl(params: UPIPaymentParams): string {
  return buildUpiUrl(params);
}

export function isUPISupported(): boolean {
  // UPI intent works on Android / iOS with UPI apps installed.
  return /Android|iPhone|iPad/i.test(navigator.userAgent);
}
