export class AppError extends Error {
  constructor(status, code, errors = []) {
    super(code);
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}
