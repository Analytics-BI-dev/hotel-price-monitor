const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const percentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});
const longDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  timeZone: "UTC",
});

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value);
}

export function formatSignedCurrency(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatCurrency(Math.abs(value))}`;
}

export function formatPercent(value: number, includeSign = true): string {
  const sign = includeSign && value > 0 ? "+" : value < 0 ? "−" : "";
  const formatted = percentFormatter.format(Math.abs(value));
  return `${sign}${formatted}%`;
}

export function formatShortDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return shortDateFormatter.format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatNightRange(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const checkout = new Date(Date.UTC(year, month - 1, day));
  checkout.setUTCDate(checkout.getUTCDate() + 1);
  const checkoutDate = checkout.toISOString().slice(0, 10);

  return `${formatShortDate(date)} → ${formatShortDate(checkoutDate)}`;
}

export function formatLongDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return longDateFormatter.format(new Date(Date.UTC(year, month - 1, day)));
}
