export class BarcodeEngine {
  /**
   * Generates a 7-digit roll sticker
   * Format Example: YMDSHID
   * Y = Year (1 digit, e.g., 6 for 2026)
   * M = Month (1 character, A-L for 1-12)
   * D = Day (1 character, 1-9, A-V for 10-31)
   * S = Shift (1 digit, 1=Day, 2=Night)
   * M = Machine ID (1 character, A, B, C, D)
   * XX = Sequential or random hash to complete 7 chars
   */
  static generateRollSticker(shift: 'DAY' | 'NIGHT', machine: 'A' | 'B' | 'C' | 'D'): string {
    const date = new Date();
    const yearChar = date.getFullYear().toString().slice(-1);
    
    // Month A-L
    const monthCode = String.fromCharCode(65 + date.getMonth());
    
    // Day 1-9, A-V
    const day = date.getDate();
    const dayCode = day < 10 ? day.toString() : String.fromCharCode(65 + (day - 10));
    
    const shiftCode = shift === 'DAY' ? '1' : '2';
    
    // Generate 2 random alphanumeric chars to complete the 7 digits uniquely
    const randomChars = Math.random().toString(36).substring(2, 4).toUpperCase();
    
    return `${yearChar}${monthCode}${dayCode}${shiftCode}${machine}${randomChars}`;
  }

  /**
   * Generates a 13-digit pallet sticker
   */
  static generatePalletSticker(shift: 'DAY' | 'NIGHT', machine: 'A' | 'B' | 'C' | 'D', totalWeight: number): string {
    const baseRoll = this.generateRollSticker(shift, machine);
    
    // Add 6 characters for total weight padded with zeros (e.g., 001255 for 125.5 kg)
    const weightStr = Math.round(totalWeight * 10).toString().padStart(6, '0');
    
    return `${baseRoll}${weightStr}`;
  }
}
