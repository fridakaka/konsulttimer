// Fel som är begripliga för användaren (svensk text i message).
export class AppError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }
}
