export type Currency = 'USD' | 'INR';

export const EXCHANGE_RATE = 83.5; // Example exchange rate: 1 USD = 83.5 INR

export function convertPrice(usdAmount: number, currency: Currency): number {
  if (currency === 'INR') {
    return usdAmount * EXCHANGE_RATE;
  }
  return usdAmount;
}

export function formatPrice(usdAmount: number, currency: Currency): string {
  if (currency === 'INR') {
    const converted = convertPrice(usdAmount, 'INR');
    // Indian standard format (e.g. ₹1,500.00 or rounded depending on design)
    return `₹${converted.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `$${usdAmount.toFixed(2)}`;
}
