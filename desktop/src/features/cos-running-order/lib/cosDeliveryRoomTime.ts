const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export function strictDeliveryRoomDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const match = RFC3339.exec(value);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second, offset] = match;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const [
    yearNumber,
    monthNumber,
    dayNumber,
    hourNumber,
    minuteNumber,
    secondNumber,
  ] = parts;
  if (
    monthNumber < 1 ||
    monthNumber > 12 ||
    dayNumber < 1 ||
    dayNumber > new Date(Date.UTC(yearNumber, monthNumber, 0)).getUTCDate() ||
    hourNumber > 23 ||
    minuteNumber > 59 ||
    secondNumber > 59
  ) {
    return undefined;
  }
  if (offset !== "Z") {
    const [offsetHour, offsetMinute] = offset.slice(1).split(":").map(Number);
    if (offsetHour > 23 || offsetMinute > 59) return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
