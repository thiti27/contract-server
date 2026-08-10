// Thin error type carrying an HTTP status, so route handlers can translate a thrown
// error into the right response code without the service layer knowing about Express.
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
