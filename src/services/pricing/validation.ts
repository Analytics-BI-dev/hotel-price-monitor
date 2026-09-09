import type {
  PricingSearchInput,
  ValidatedPricingSearch,
} from "@/types/pricing";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MILLISECONDS_PER_DAY = 86_400_000;

export const MAXIMUM_NIGHTS = 10;
export const MAXIMUM_NIGHTS_MESSAGE =
  "O período máximo permitido é de 10 diárias.";

function parseDateOnly(value: string): Date | null {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

export function addDays(date: string, amount: number): string {
  const parsed = parseDateOnly(date);

  if (!parsed) {
    return date;
  }

  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

export function differenceInNights(checkIn: string, checkOut: string): number {
  const start = parseDateOnly(checkIn);
  const end = parseDateOnly(checkOut);

  if (!start || !end) {
    return Number.NaN;
  }

  return Math.round((end.getTime() - start.getTime()) / MILLISECONDS_PER_DAY);
}

export function getStayDates(checkIn: string, nights: number): string[] {
  return Array.from({ length: nights }, (_, index) => addDays(checkIn, index));
}

export function getTodayInSaoPaulo(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export type PricingValidationResult =
  | { success: true; data: ValidatedPricingSearch }
  | { success: false; message: string };

export function validatePricingSearch(
  input: PricingSearchInput,
  today = getTodayInSaoPaulo(),
): PricingValidationResult {
  const checkIn = parseDateOnly(input.checkIn);
  const checkOut = parseDateOnly(input.checkOut);

  if (!checkIn || !checkOut) {
    return { success: false, message: "Informe datas válidas para a estadia." };
  }

  if (input.checkIn < today) {
    return {
      success: false,
      message: "O check-in não pode ser anterior à data atual.",
    };
  }

  const nights = differenceInNights(input.checkIn, input.checkOut);

  if (nights <= 0) {
    return {
      success: false,
      message: "O check-out deve ser posterior ao check-in.",
    };
  }

  if (nights > MAXIMUM_NIGHTS) {
    return { success: false, message: MAXIMUM_NIGHTS_MESSAGE };
  }

  if (![1, 2].includes(input.adults)) {
    return { success: false, message: "Selecione 1 ou 2 adultos." };
  }

  if (input.rooms !== 1 || input.children !== 0) {
    return { success: false, message: "A ocupação informada não é válida." };
  }

  return {
    success: true,
    data: { ...input, nights },
  };
}

